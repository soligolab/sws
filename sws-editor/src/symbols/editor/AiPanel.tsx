// The «IA» tab of the symbol editor (plan docs/archive/2026-11-19-assistente-ia-simboli.md):
// an instruction, «Modifica questo» or «Disegna nuovo», a photo if there is one.
// The model of the «Simboli» purpose answers with a proposal, shown here next to
// the symbol as it is; «Accetta» makes it a step of the editor's history (Ctrl+Z
// takes it back), «Scarta» drops it, and the next instruction starts from it.
//
// Before a drawing the model interviews the user (20-11-2026, the maintainer:
// «l'equivalente della modalità plan»): questions on what the request leaves
// open, at most two rounds, then a brief the user can correct, and the drawing
// is asked from the brief. A retouch of a proposal goes straight.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SymbolAiQuestion, type SymbolAiResult } from "@/api/client";
import type { DescrizioneSimbolo } from "@/types";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import type { ManifestLib, SimboloLib } from "@/symbols/lib/manifest";
import type { StileSimboliProgetto } from "@/symbols/stileProgetto";
import { pictureForModel } from "@/images/optimize";
import { draws, type Op } from "./model";
import { C, input } from "./ui";

type Proposal = Extract<SymbolAiResult, { ok: true }> & { instruction: string };
type Photo = { media_type: string; data: string };

/** An interview in progress: the request, the rounds answered, and now the
 *  questions to answer or the brief to confirm. */
interface Interview {
  mode: "new" | "edit";
  request: string;
  photo: Photo | null;
  rounds: { questions: string[]; answers: string[] }[];
  questions: SymbolAiQuestion[] | null;
  answers: string[];
  brief: string | null;
}

/** The request with what was answered, for «Salta, disegna subito». */
function withAnswers(iv: Interview): string {
  const all = [...iv.rounds, ...(iv.questions ? [{ questions: iv.questions.map((q) => q.text), answers: iv.answers }] : [])];
  const lines = all.flatMap((r) => r.questions.map((q, i) => (r.answers[i]?.trim() ? `- ${q} ${r.answers[i].trim()}` : "")).filter(Boolean));
  return lines.length ? `${iv.request}\n\n${lines.join("\n")}` : iv.request;
}
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
  if (d.library) out.library = d.library;
  else delete out.library;
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
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [busyKind, setBusyKind] = useState<"draw" | "interview">("draw");
  const [interview, setInterview] = useState<Interview | null>(null);
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

  /** One call to the model, with the waiting line and «Interrompi». */
  const run = async <T,>(kind: "draw" | "interview", call: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    const ctl = new AbortController();
    abort.current = ctl;
    setBusyKind(kind); setSince(Date.now()); setNow(Date.now()); setFailure(null);
    try {
      return await call(ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) setFailure({ ok: false, code: "error", message: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      if (abort.current === ctl) abort.current = null;
      setSince(null);
    }
  };

  const draw = async (mode: "new" | "edit", text: string, pic: Photo | null, shown: string) => {
    const base = proposal ? withOwnNames(proposal.description, d) : d;
    const r = await run("draw", (signal) => api.symbolAi({ mode, instruction: text, description: base, ...(pic ? { photo: pic } : {}) }, signal));
    if (!r) return;
    if (r.ok) {
      setProposal({ ...r, instruction: shown });
      setInstruction("");
      setPhoto(null);
      setInterview(null);
    } else {
      setFailure(r);
    }
  };

  /** One round of the interview: questions, or the brief. */
  const step = async (iv: Interview) => {
    const r = await run("interview", (signal) => api.symbolAiInterview({
      mode: iv.mode, instruction: iv.request, description: d, ...(iv.photo ? { photo: iv.photo } : {}), rounds: iv.rounds,
    }, signal));
    // Failed: back to the request, which is still in its box.
    if (!r) { setInterview(null); return; }
    if (!r.ok) {
      setInterview(null);
      setFailure(r.code === "invalid"
        ? { ok: false, code: "error", message: t("symbolEditor.ai.interview.unreadable") }
        : { ...r, attempts: 0 });
      return;
    }
    if (r.brief !== undefined) setInterview({ ...iv, questions: null, answers: [], brief: r.brief });
    else setInterview({ ...iv, questions: r.questions, answers: r.questions.map(() => ""), brief: null });
  };

  const ask = (mode: "new" | "edit") => {
    const text = instruction.trim();
    // A retouch of a proposal goes straight: the interview is for a request.
    if (proposal) { void draw(mode, text, photo, text); return; }
    const iv: Interview = { mode, request: text, photo, rounds: [], questions: null, answers: [], brief: null };
    setInterview(iv);
    void step(iv);
  };

  const answer = (i: number, a: string) => setInterview((iv) => iv && { ...iv, answers: iv.answers.map((x, k) => (k === i ? a : x)) });
  const goOn = () => {
    if (!interview?.questions) return;
    const iv: Interview = {
      ...interview, questions: null, answers: [], brief: null,
      rounds: [...interview.rounds, { questions: interview.questions.map((q) => q.text), answers: interview.answers }],
    };
    setInterview(iv);
    void step(iv);
  };
  const stopInterview = () => { abort.current?.abort(); setInterview(null); setFailure(null); };

  const addPhoto = async (f: File | undefined) => {
    if (!f) return;
    const p = await pictureForModel(f);
    if (p) setPhoto(p);
    else setFailure({ ok: false, code: "error", message: t("symbolEditor.ai.photoUnreadable") });
  };

  const busy = since !== null;
  const canAsk = !busy && !interview && (instruction.trim() !== "" || !!photo);
  /** The highlighted button, and what Ctrl+Enter asks. */
  const primary: "edit" | "new" = hasDrawing || proposal ? "edit" : "new";
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
      {!interview && <>
      <textarea style={{ ...input, minHeight: 70, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} value={instruction}
        data-testid="symbol-ai-instruction" disabled={busy}
        placeholder={t(proposal ? "symbolEditor.ai.placeholderRetouch" : "symbolEditor.ai.placeholder")}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canAsk) { e.preventDefault(); void ask(primary); } }} />
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
        <button type="button" style={button(primary === "edit", canAsk)} disabled={!canAsk} data-testid="symbol-ai-edit"
          onClick={() => void ask("edit")}>{t(proposal ? "symbolEditor.ai.editProposal" : "symbolEditor.ai.edit")}</button>
        <button type="button" style={button(primary === "new", canAsk)} disabled={!canAsk} data-testid="symbol-ai-new"
          onClick={() => void ask("new")}>{t("symbolEditor.ai.new")}</button>
      </div>
      </>}

      {interview && (
        <div data-testid="symbol-ai-interview" style={{ border: `1px solid ${C.accent}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>
            {t(interview.brief !== null ? "symbolEditor.ai.interview.brief" : "symbolEditor.ai.interview.title")}
          </span>
          <div style={{ color: C.muted, fontStyle: "italic" }}>«{interview.request}»</div>
          {interview.questions?.map((q, i) => (
            <div key={i} data-testid={`symbol-ai-question-${i}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span>{q.text}</span>
              {q.choices.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {q.choices.map((c) => (
                    <button key={c} type="button" aria-pressed={interview.answers[i] === c} disabled={busy}
                      style={{ ...button(interview.answers[i] === c), padding: "2px 7px", fontSize: 11 }}
                      onClick={() => answer(i, c)}>{c}</button>
                  ))}
                </div>
              )}
              <input style={{ ...input, boxSizing: "border-box" }} value={interview.answers[i] ?? ""} disabled={busy}
                data-testid={`symbol-ai-answer-${i}`} placeholder={t("symbolEditor.ai.interview.yourAnswer")}
                onChange={(e) => answer(i, e.target.value)} />
            </div>
          ))}
          {interview.brief !== null && (
            <textarea style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              value={interview.brief} disabled={busy} data-testid="symbol-ai-brief"
              onChange={(e) => setInterview({ ...interview, brief: e.target.value })} />
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {interview.questions && (
              <button type="button" style={button(true, !busy)} disabled={busy} data-testid="symbol-ai-continue"
                onClick={goOn}>{t("symbolEditor.ai.interview.continue")}</button>
            )}
            {interview.brief !== null && (
              <button type="button" style={button(true, !busy && interview.brief.trim() !== "")} data-testid="symbol-ai-draw-brief"
                disabled={busy || interview.brief.trim() === ""}
                onClick={() => void draw(interview.mode, interview.brief!.trim(), interview.photo, interview.brief!.trim())}>
                {t("symbolEditor.ai.interview.draw")}
              </button>
            )}
            {interview.brief === null && (
              <button type="button" style={button(false, !busy)} disabled={busy} data-testid="symbol-ai-skip"
                onClick={() => void draw(interview.mode, withAnswers(interview), interview.photo, interview.request)}>
                {t("symbolEditor.ai.interview.skip")}
              </button>
            )}
            <button type="button" style={button(false)} data-testid="symbol-ai-interview-cancel" onClick={stopInterview}>
              {t("symbolEditor.ai.interview.cancel")}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div data-testid="symbol-ai-busy" style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
          <span style={{ flex: 1 }}>{t(busyKind === "interview" ? "symbolEditor.ai.interview.thinking" : "symbolEditor.ai.drawing",
            { s: Math.max(0, Math.round((now - since) / 1000)) })}</span>
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
          {proposal.instruction && (
            <div style={{ color: C.muted, fontStyle: "italic" }} title={proposal.instruction}>
              «{proposal.instruction.length > 280 ? `${proposal.instruction.slice(0, 280)}…` : proposal.instruction}»
            </div>
          )}
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
