/** The AI on one IDE field (plan `docs/plans/2026-11-20-ia-sui-campi.md`).
 *
 *  A small sparkle next to a hard field — a tag's expression, a display
 *  format. A click opens a window: the person says what they want, the model of
 *  the «AI on fields» purpose proposes the value of the field and, when the
 *  request needs it, of its neighbours (unit, decimals). The window shows each
 *  change as before → after; «Apply» writes them all, «Cancel» none. When the
 *  request is ambiguous the model asks one question first, with its choices.
 *
 *  Nothing is saved: the changes go into the form, and the person saves as
 *  usual. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { ICONE_ATTIVITA } from "@/editor/iconeAttivita";

export type AiFieldKind = "tag_expression" | "format";

export interface AiFieldNeighbour {
  /** The field's key, as the entity has it (`unit`, `decimals`). */
  field: string;
  /** What the person reads. */
  label: string;
  /** Its value now, as text. */
  value: string;
}

export interface AiFieldProps {
  kind: AiFieldKind;
  field: string;
  label: string;
  value: string;
  /** The whole thing the field belongs to (the tag, the object). */
  entity: unknown;
  liveValue?: unknown;
  /** The other fields the model may change. */
  neighbours?: AiFieldNeighbour[];
  /** For an expression: the names of the project's tags. */
  tags?: string[];
  /** Field → new value, as text; called only on «Apply». */
  onApply: (changes: Record<string, string>) => void;
  disabled?: boolean;
}

type Round = { question: string; answer: string };
type Proposal = { changes: { field: string; value: string }[]; note: string };

export function AiFieldButton(p: AiFieldProps) {
  const { t } = useTranslation();
  const open = async () => {
    const changes = await modulo<Record<string, string>>({
      titolo: t("aiField.title", { label: p.label }),
      corpo: (fine) => <AiFieldDialog {...p} fine={fine} />,
    });
    if (changes && Object.keys(changes).length) p.onApply(changes);
  };
  return (
    <button
      type="button"
      data-testid={`ai-field-${p.field}`}
      title={t("aiField.button")}
      aria-label={t("aiField.button")}
      disabled={p.disabled}
      onClick={() => void open()}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, padding: 0, flexShrink: 0, cursor: p.disabled ? "default" : "pointer",
        background: "transparent", border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
        color: "var(--brand-primary, #3b82f6)",
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        // Our own constant markup: no user data goes through here.
        dangerouslySetInnerHTML={{ __html: ICONE_ATTIVITA.ia }} />
    </button>
  );
}

const ERRORS = new Set(["no_model", "cap_reached", "provider", "invalid", "bad_request"]);

function AiFieldDialog(p: AiFieldProps & { fine: (v: Record<string, string> | null) => void }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [question, setQuestion] = useState<{ text: string; choices: string[] } | null>(null);
  const [answer, setAnswer] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const before = (field: string) =>
    field === p.field ? p.value : p.neighbours?.find((n) => n.field === field)?.value ?? "";
  const labelOf = (field: string) =>
    field === p.field ? p.label : p.neighbours?.find((n) => n.field === field)?.label ?? field;

  const ask = async (withRounds: Round[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.aiField({
        kind: p.kind, field: p.field, value: p.value, entity: p.entity ?? null,
        live_value: p.liveValue ?? null,
        allowed: [p.field, ...(p.neighbours ?? []).map((n) => n.field)],
        tags: p.tags ?? [], request, rounds: withRounds,
      });
      if (!r.ok) {
        setError(ERRORS.has(r.code ?? "") ? t(`aiField.err.${r.code}`, { detail: r.message ?? "" }) : r.message ?? t("aiField.err.provider", { detail: "" }));
      } else if (r.kind === "question" && r.question) {
        setQuestion({ text: r.question, choices: r.choices ?? [] });
        setAnswer("");
      } else {
        setQuestion(null);
        setProposal({ changes: r.changes ?? [], note: r.note ?? "" });
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setError(msg.includes("404") ? t("aiField.err.ideOnly") : t("aiField.err.provider", { detail: msg }));
    } finally {
      setBusy(false);
    }
  };

  const reply = (a: string) => {
    if (!question) return;
    const next = [...rounds, { question: question.text, answer: a }];
    setRounds(next);
    void ask(next);
  };

  const apply = () => {
    if (!proposal) return;
    p.fine(Object.fromEntries(proposal.changes.map((c) => [c.field, c.value])));
  };

  const box: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8, minWidth: 320, maxWidth: 520 };
  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)",
    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "6px 8px",
    color: "var(--brand-text, #e2e8f0)", fontSize: 13, fontFamily: "inherit",
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    padding: "5px 12px", fontSize: 13, borderRadius: 4, cursor: "pointer",
    border: `1px solid ${primary ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)"}`,
    background: primary ? "var(--brand-primary, #3b82f6)" : "transparent",
    color: primary ? "var(--brand-on-primary, #fff)" : "var(--brand-text-2, #cbd5e1)",
  });
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0 };

  return (
    <div style={box} data-testid="ai-field-dialog">
      <p style={muted}>{t("aiField.explain")}</p>
      {p.liveValue !== undefined && p.liveValue !== null && (
        <p style={muted}>{t("aiField.live", { value: String(p.liveValue) })}</p>
      )}
      <textarea
        data-testid="ai-field-request" value={request} rows={2} autoFocus
        placeholder={t(p.kind === "format" ? "aiField.placeholderFormat" : "aiField.placeholderExpression")}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && request.trim() && !busy) { e.preventDefault(); setRounds([]); setProposal(null); void ask([]); }
        }}
        style={{ ...input, resize: "vertical" }}
      />
      {!question && !proposal && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn(false)} onClick={() => p.fine(null)}>{t("aiField.cancel")}</button>
          <button type="button" data-testid="ai-field-ask" style={btn(true)} disabled={busy || !request.trim()}
            onClick={() => { setRounds([]); void ask([]); }}>
            {busy ? t("aiField.thinking") : t("aiField.ask")}
          </button>
        </div>
      )}

      {question && (
        <div data-testid="ai-field-question" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{question.text}</strong>
          {question.choices.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {question.choices.map((c) => (
                <button key={c} type="button" style={btn(false)} disabled={busy} onClick={() => reply(c)}>{c}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input data-testid="ai-field-answer" style={input} value={answer} placeholder={t("aiField.answer")}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); reply(answer); } }} />
            <button type="button" style={btn(true)} disabled={busy} onClick={() => reply(answer)}>
              {busy ? t("aiField.thinking") : t("aiField.send")}
            </button>
          </div>
        </div>
      )}

      {proposal && (
        <div data-testid="ai-field-proposal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {proposal.changes.length > 0 ? (
            <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {proposal.changes.map((c) => (
                  <tr key={c.field}>
                    <td style={{ padding: "3px 6px 3px 0", color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "nowrap" }}>{labelOf(c.field)}</td>
                    <td style={{ padding: "3px 6px", fontFamily: "monospace", opacity: 0.7, textDecoration: "line-through" }}>{before(c.field) || "—"}</td>
                    <td style={{ padding: "3px 0", fontFamily: "monospace" }}>{c.value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={muted}>{t("aiField.noChanges")}</p>}
          {proposal.note && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{proposal.note}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btn(false)} onClick={() => p.fine(null)}>{t("aiField.cancel")}</button>
            <button type="button" style={btn(false)} disabled={busy}
              onClick={() => { setProposal(null); setRounds([]); void ask([]); }}>{t("aiField.retry")}</button>
            {proposal.changes.length > 0 && (
              <button type="button" data-testid="ai-field-apply" style={btn(true)} onClick={apply}>{t("aiField.apply")}</button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, background: "var(--sws-danger-bg, #7f1d1d33)", padding: "6px 10px", borderRadius: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
