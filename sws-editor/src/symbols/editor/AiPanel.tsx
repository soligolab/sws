// The «IA» tab of the symbol editor (plan docs/plans/2026-11-19-assistente-ia-simboli.md):
// an instruction, «Modifica questo» or «Disegna nuovo», a photo if there is one.
// The model of the «Simboli» purpose answers with a proposal, shown here next to
// the symbol as it is; «Accetta» makes it a step of the editor's history (Ctrl+Z
// takes it back), «Scarta» drops it, and the next instruction starts from it.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SymbolAiResult } from "@/api/client";
import type { DescrizioneSimbolo } from "@/types";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import type { ManifestLib, SimboloLib } from "@/symbols/lib/manifest";
import type { StileSimboliProgetto } from "@/symbols/stileProgetto";
import { pictureForModel } from "@/images/optimize";
import { draws, type Op } from "./model";
import { C, input } from "./ui";

type Proposal = Extract<SymbolAiResult, { ok: true }> & { instruction: string };
type Failure = Extract<SymbolAiResult, { ok: false }> | { ok: false; code: "error"; message: string; attempts?: number; cost_usd?: number; model?: string };

const button = (primary: boolean, enabled = true): React.CSSProperties => ({
  padding: "5px 10px", fontSize: 12, borderRadius: 3, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.5,
  border: `1px solid ${primary ? C.accent : C.border}`, background: primary ? C.accent : "transparent",
  color: primary ? "var(--brand-on-primary, #fff)" : C.text,
});

/** The fields the editor owns: whatever the proposal says, accepting it keeps
 *  them as they are now (they may have changed while the model was drawing). */
function withOwnNames(p: DescrizioneSimbolo, d: DescrizioneSimbolo): DescrizioneSimbolo {
  const out: DescrizioneSimbolo = { ...p, slug: d.slug, it: d.it, en: d.en, tipo: d.tipo };
  if (d.overrides) out.overrides = d.overrides;
  else delete out.overrides;
  return out;
}

export function AiPanel({ d, commit, current, manifesto, projectStyle }: {
  d: DescrizioneSimbolo;
  commit: (d: DescrizioneSimbolo) => void;
  /** The symbol as it is, compiled. */
  current: { svg?: string; voce?: SimboloLib };
  manifesto: ManifestLib | null;
  projectStyle?: StileSimboliProgetto;
}) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState("");
  const [photo, setPhoto] = useState<{ media_type: string; data: string } | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasDrawing = d.ops.some((o) => draws(o as Op));

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (since === null) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [since]);

  const ask = async (mode: "new" | "edit") => {
    const base = proposal ? withOwnNames(proposal.description, d) : d;
    const ctl = new AbortController();
    abort.current = ctl;
    setSince(Date.now()); setNow(Date.now()); setFailure(null);
    try {
      const r = await api.symbolAi({ mode, instruction: instruction.trim(), description: base, ...(photo ? { photo } : {}) }, ctl.signal);
      if (r.ok) {
        setProposal({ ...r, instruction: instruction.trim() });
        setInstruction("");
        setPhoto(null);
      } else {
        setFailure(r);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setFailure({ ok: false, code: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (abort.current === ctl) abort.current = null;
      setSince(null);
    }
  };

  const addPhoto = async (f: File | undefined) => {
    if (!f) return;
    const p = await pictureForModel(f);
    if (p) setPhoto(p);
    else setFailure({ ok: false, code: "error", message: t("symbolEditor.ai.photoUnreadable") });
  };

  const busy = since !== null;
  const canAsk = !busy && (instruction.trim() !== "" || !!photo);
  const preview = (svg: string | undefined, voce: SimboloLib | undefined, w: number, h: number, prefix: string, testId: string) => (
    <div data-testid={testId} style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, aspectRatio: "1" }}>
      {svg && voce && manifesto && (
        <svg viewBox={`${-4} ${-4} ${w + 8} ${h + 8}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
          <SimboloLibSvg sim={voce} svg={svg} manifesto={manifesto} prefisso={prefix} x={0} y={0} w={w} h={h}
            valori={{ corpo: null, gira: false, periodoS: 2 }} progetto={projectStyle} />
        </svg>
      )}
    </div>
  );

  return (
    <div data-testid="symbol-ai" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.ai.note")}</p>
      <textarea style={{ ...input, minHeight: 70, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} value={instruction}
        data-testid="symbol-ai-instruction" disabled={busy}
        placeholder={t(proposal ? "symbolEditor.ai.placeholderRetouch" : "symbolEditor.ai.placeholder")}
        onChange={(e) => setInstruction(e.target.value)} />
      {photo ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} data-testid="symbol-ai-photo">
          <img src={`data:${photo.media_type};base64,${photo.data}`} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 3 }} />
          <span style={{ flex: 1, color: C.muted }}>{t("symbolEditor.ai.photoAdded")}</span>
          <button type="button" style={{ ...input, width: "auto", color: C.danger }} disabled={busy} title={t("symbolEditor.ai.removePhoto")}
            onClick={() => setPhoto(null)}>×</button>
        </div>
      ) : (
        <button type="button" style={{ ...input, width: "auto", alignSelf: "flex-start" }} disabled={busy}
          data-testid="symbol-ai-add-photo" onClick={() => fileRef.current?.click()}>
          + {t("symbolEditor.ai.addPhoto")}
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
        onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={button(hasDrawing || !!proposal, canAsk)} disabled={!canAsk} data-testid="symbol-ai-edit"
          onClick={() => void ask("edit")}>{t(proposal ? "symbolEditor.ai.editProposal" : "symbolEditor.ai.edit")}</button>
        <button type="button" style={button(!hasDrawing && !proposal, canAsk)} disabled={!canAsk} data-testid="symbol-ai-new"
          onClick={() => void ask("new")}>{t("symbolEditor.ai.new")}</button>
      </div>

      {busy && (
        <div data-testid="symbol-ai-busy" style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
          <span style={{ flex: 1 }}>{t("symbolEditor.ai.drawing", { s: Math.max(0, Math.round((now - since) / 1000)) })}</span>
          <button type="button" style={{ ...input, width: "auto" }} onClick={() => abort.current?.abort()}>{t("symbolEditor.ai.stop")}</button>
        </div>
      )}

      {failure && <FailureNote f={failure} />}

      {proposal && (
        <div data-testid="symbol-ai-proposal" style={{ border: `1px solid ${C.accent}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: C.muted, fontSize: 11 }}>{t("symbolEditor.ai.now")}</span>
              {preview(current.svg, current.voce, d.w, d.h, "sym-ai-now", "symbol-ai-now")}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: C.muted, fontSize: 11 }}>{t("symbolEditor.ai.proposal")}</span>
              {preview(proposal.svg, proposal.voce, proposal.description.w, proposal.description.h, "sym-ai-prop", "symbol-ai-proposal-drawing")}
            </div>
          </div>
          {proposal.instruction && <div style={{ color: C.muted, fontStyle: "italic" }}>«{proposal.instruction}»</div>}
          <div style={{ color: C.subtle, fontSize: 11 }} data-testid="symbol-ai-figures">
            {t("symbolEditor.ai.figures", {
              model: proposal.model ?? "?", n: proposal.attempts,
              cost: proposal.cost_usd > 0 ? `${proposal.cost_usd.toFixed(3)} $` : t("symbolEditor.ai.free"),
            })}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={button(true)} data-testid="symbol-ai-accept"
              onClick={() => { commit(withOwnNames(proposal.description, d)); setProposal(null); }}>{t("symbolEditor.ai.accept")}</button>
            <button type="button" style={button(false)} data-testid="symbol-ai-discard"
              onClick={() => setProposal(null)}>{t("symbolEditor.ai.discard")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FailureNote({ f }: { f: Failure }) {
  const { t } = useTranslation();
  const text = f.code === "invalid" ? t("symbolEditor.ai.err.invalid", { n: f.attempts })
    : f.code === "blind_model" ? t("symbolEditor.ai.err.blind_model", { model: f.model ?? "?" })
    : f.code === "no_model" ? t("symbolEditor.ai.err.no_model")
    : f.code === "cap_reached" ? t("symbolEditor.ai.err.cap_reached", { detail: f.message ?? "" })
    : f.code === "provider" ? t("symbolEditor.ai.err.provider", { detail: f.message ?? "" })
    : f.code === "bad_request" ? t("symbolEditor.ai.err.bad_request", { detail: f.message ?? "" })
    : t("symbolEditor.ai.err.error", { detail: f.message ?? "" });
  return (
    <div data-testid="symbol-ai-error" data-code={f.code} style={{ color: C.danger, display: "flex", flexDirection: "column", gap: 3 }}>
      <span>{text}</span>
      {f.code === "invalid" && f.errors && (
        <ul style={{ margin: 0, paddingLeft: 16, color: C.muted, fontSize: 11 }}>
          {f.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
