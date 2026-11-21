// The parameters of a live part, one editor per kind (plan
// docs/archive/2026-11-19-animazioni-dei-simboli.md, session 2d): the pivot of a
// rotation, the window and the side of a level, the way of a slide, the step
// of a vibration, the breath of a pulse, the entries of a signal. Used by the
// «Pezzo» tab and by the inputs of «Struttura».

import { useTranslation } from "react-i18next";
import type { DescrizioneSimbolo } from "@/types";
import type { SignalEntry } from "@/symbols/lib/manifest";
import { setPartParam, ANIMATE_FAMILIES, type InputKind, type Op } from "./model";
import { C, Field, Num, input } from "./ui";
import { pickPhoto } from "./photoPicker";

/** The numbers of each kind, in the order they are shown. */
const NUMBERS: Record<string, string[]> = {
  rotor: ["cx", "cy", "symmetry"],
  needle: ["cx", "cy", "a0", "a1"],
  lever: ["cx", "cy", "open", "closed"],
  level: ["x", "y", "w", "h"],
  slide: ["dx", "dy", "transition_ms"],
  vibrate: ["amplitude", "period_ms"],
  pulse: ["depth", "period_ms"],
  glow: ["radius"],
  bubbles: ["x", "y", "w", "h", "count", "period_ms"],
  smoke: ["x", "y", "w", "h", "period_ms"],
};

/** What the engines use when a number is left out (`sws-core/src/simboli_lib.rs`). */
const DEFAULTS: Record<string, number> = { transition_ms: 300, amplitude: 1, period_ms: 0, depth: 0.6, radius: 4, count: 6 };

export function AnimationProps({ d, op, commit }: {
  d: DescrizioneSimbolo; op: number; commit: (d: DescrizioneSimbolo) => void;
}) {
  const { t } = useTranslation();
  const p = d.ops[op] as Op | undefined;
  if (p?.op !== "parte") return null;
  const kind = String(p.kind);
  const g = (p.geo as Record<string, unknown> | undefined) ?? {};
  const set = (k: string, v: unknown) => commit(setPartParam(d, op, k, v));
  const periodDefault = kind === "vibrate" ? 200 : kind === "bubbles" || kind === "smoke" ? 2000 : 1000;
  return (
    <>
      {(NUMBERS[kind] ?? []).map((k) => (
        <Field key={k} label={t(`symbolEditor.geo.${k}`, { defaultValue: k })}>
          <Num value={typeof g[k] === "number" ? (g[k] as number) : k === "period_ms" ? periodDefault : DEFAULTS[k] ?? 0}
            step={k.endsWith("_ms") ? 50 : k === "depth" ? 0.05 : 0.5} onChange={(n) => set(k, n)} />
        </Field>
      ))}
      {kind === "rotor" && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
          <input type="checkbox" checked={g.ccw === true} data-testid="symbol-part-ccw"
            onChange={(e) => set("ccw", e.target.checked || undefined)} />
          {t("symbolEditor.anim.ccw")}
        </label>
      )}
      {kind === "level" && (
        <Field label={t("symbolEditor.anim.dir")}>
          <select style={input} value={String(g.dir ?? "up")} data-testid="symbol-part-dir" onChange={(e) => set("dir", e.target.value)}>
            {["up", "down", "left", "right"].map((v) => <option key={v} value={v}>{t(`symbolEditor.anim.dirs.${v}`)}</option>)}
          </select>
        </Field>
      )}
      {kind === "vibrate" && (
        <Field label={t("symbolEditor.anim.axis")}>
          <select style={input} value={String(g.axis ?? "x")} onChange={(e) => set("axis", e.target.value)}>
            <option value="x">{t("symbolEditor.anim.axes.x")}</option>
            <option value="y">{t("symbolEditor.anim.axes.y")}</option>
          </select>
        </Field>
      )}
      {kind === "signal" && (
        <SignalEntries colour={typeof g.color === "string" ? g.color : "#64748b"}
          entries={Array.isArray(g.entries) ? (g.entries as SignalEntry[]) : []}
          onColour={(c) => set("color", c)} onEntries={(e) => set("entries", e)} />
      )}
      {(kind === "bubbles" || kind === "smoke") && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
          <input type="checkbox" checked={typeof g.color === "string"}
            onChange={(e) => set("color", e.target.checked ? (kind === "smoke" ? "#9ca3af" : "#bae6fd") : undefined)} />
          {t("symbolEditor.anim.ownColour")}
          {typeof g.color === "string" && (
            <input type="color" style={{ ...input, padding: 0, height: 20, width: 32 }} value={g.color} onChange={(e) => set("color", e.target.value)} />
          )}
        </label>
      )}
      {(kind === "bubbles" || kind === "smoke") && <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.anim.fxNote")}</p>}
      {kind === "glow" && (
        <>
          <label style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
            <input type="checkbox" checked={typeof g.color === "string"} data-testid="symbol-glow-own-colour"
              onChange={(e) => set("color", e.target.checked ? "#22d3ee" : undefined)} />
            {t("symbolEditor.anim.glowColour")}
          </label>
          {typeof g.color === "string" && (
            <input type="color" style={{ ...input, padding: 0, height: 22 }} value={g.color} onChange={(e) => set("color", e.target.value)} />
          )}
          <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.anim.glowNote")}</p>
        </>
      )}
      {kind === "slide" && <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.anim.slideNote")}</p>}
    </>
  );
}

/** The entries of a signal, like the states of a symbol: a value or a range,
 *  a colour, blink, hidden. At most 8, as the compiler wants. */
function SignalEntries({ colour, entries, onColour, onEntries }: {
  colour: string; entries: SignalEntry[]; onColour: (c: string) => void; onEntries: (e: SignalEntry[]) => void;
}) {
  const { t } = useTranslation();
  const put = (i: number, e: SignalEntry) => onEntries(entries.map((x, j) => (j === i ? e : x)));
  // A text that reads as a number is a number; «true»/«false» are yes/no.
  const parse = (v: string): SignalEntry["value"] =>
    v === "true" ? true : v === "false" ? false : v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return (
    <>
      <Field label={t("symbolEditor.anim.drawnColour")}>
        <input type="color" style={{ ...input, padding: 0, height: 22 }} value={colour} onChange={(e) => onColour(e.target.value)} />
      </Field>
      <div style={{ color: C.muted }}>{t("symbolEditor.anim.entries")}</div>
      {entries.map((e, i) => {
        const range = e.value_min !== undefined || e.value_max !== undefined;
        return (
          <div key={i} data-testid={`symbol-signal-entry-${i}`}
            style={{ border: `1px solid ${C.border}`, borderRadius: 3, padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select style={{ ...input, width: "auto" }} value={range ? "range" : "value"} onChange={(ev) => put(i, ev.target.value === "range"
                ? { ...e, value: undefined, value_min: 0, value_max: 10 }
                : { ...e, value_min: undefined, value_max: undefined, value: 1 })}>
                <option value="value">{t("symbolEditor.anim.exact")}</option>
                <option value="range">{t("symbolEditor.anim.range")}</option>
              </select>
              {range ? (
                <>
                  <input style={input} placeholder="min" value={e.value_min ?? ""} onChange={(ev) => put(i, { ...e, value_min: num(ev.target.value) })} />
                  <input style={input} placeholder="max" value={e.value_max ?? ""} onChange={(ev) => put(i, { ...e, value_max: num(ev.target.value) })} />
                </>
              ) : (
                <input style={input} data-testid={`symbol-signal-value-${i}`} value={String(e.value ?? "")}
                  onChange={(ev) => put(i, { ...e, value: parse(ev.target.value) })} />
              )}
              <button type="button" style={{ ...input, width: "auto", color: C.danger }} title={t("symbolEditor.delete")}
                onClick={() => onEntries(entries.filter((_, j) => j !== i))}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
              <input type="color" style={{ ...input, padding: 0, height: 20, width: 32 }} value={e.color ?? colour}
                disabled={e.hidden} onChange={(ev) => put(i, { ...e, color: ev.target.value })} />
              <label style={{ display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!e.blink} onChange={(ev) => put(i, { ...e, blink: ev.target.checked || undefined })} />
                {t("symbolEditor.anim.blink")}
              </label>
              <label style={{ display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!e.hidden} onChange={(ev) => put(i, { ...e, hidden: ev.target.checked || undefined })} />
                {t("symbolEditor.anim.hidden")}
              </label>
            </div>
            {/* The photo of the entry (plan 2026-11-21-simboli-fase-3-foto): the
                images of the part show it while the entry matches. */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", color: C.muted }}>
              {t("symbolEditor.photo.entry")}
              <button type="button" style={{ ...input, width: "auto", flex: 1 }} data-testid={`symbol-signal-photo-${i}`}
                disabled={e.hidden}
                onClick={() => void pickPhoto().then((p) => { if (p) put(i, { ...e, image: p.name }); })}>
                {e.image ?? t("symbolEditor.photo.asDrawn")}
              </button>
              {e.image && (
                <button type="button" style={{ ...input, width: "auto" }} title={t("symbolEditor.photo.clear")}
                  onClick={() => put(i, { ...e, image: undefined })}>×</button>
              )}
            </div>
          </div>
        );
      })}
      {entries.length < 8 && (
        <button type="button" style={{ ...input, width: "auto" }} data-testid="symbol-signal-add"
          onClick={() => onEntries([...entries, { value: entries.length + 1, color: "#22c55e" }])}>
          + {t("symbolEditor.anim.addEntry")}
        </button>
      )}
    </>
  );
}

/** «Anima…» in the «Pezzo» tab: on shapes, the kinds by family; on the shapes
 *  of a piece, its kind, its parameters and «Togli animazione». */
export function AnimateBlock({ d, partOp, onAnimate, onRemove, commit }: {
  d: DescrizioneSimbolo; partOp?: number; onAnimate: (kind: InputKind) => void; onRemove: () => void;
  commit: (d: DescrizioneSimbolo) => void;
}) {
  const { t } = useTranslation();
  const kind = partOp !== undefined ? String((d.ops[partOp] as Op).kind) : "";
  const choose = (
    <select style={input} value={kind} data-testid="symbol-animate"
      onChange={(e) => { if (e.target.value && e.target.value !== kind) onAnimate(e.target.value as InputKind); }}>
      {partOp === undefined && <option value="">{t("symbolEditor.anim.animate")}</option>}
      {/* A kind the menu doesn't offer (the lamp): shown, so it isn't lost. */}
      {kind && !ANIMATE_FAMILIES.some((f) => f.kinds.includes(kind as InputKind)) && (
        <option value={kind}>{t(`symbolEditor.input.${kind}`)}</option>
      )}
      {ANIMATE_FAMILIES.map((f) => (
        <optgroup key={f.family} label={t(`symbolEditor.anim.family.${f.family}`)}>
          {f.kinds.map((k) => <option key={k} value={k}>{t(`symbolEditor.anim.kind.${k}`)}</option>)}
        </optgroup>
      ))}
    </select>
  );
  return (
    <div data-testid="symbol-animate-block" style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
      <Field label={t("symbolEditor.anim.animation")}>{choose}</Field>
      {partOp === undefined ? (
        <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.anim.note")}</p>
      ) : (
        <>
          <AnimationProps d={d} op={partOp} commit={commit} />
          <button type="button" style={{ ...input, width: "auto", color: C.danger }} data-testid="symbol-animate-remove" onClick={onRemove}>
            {t("symbolEditor.anim.remove")}
          </button>
        </>
      )}
    </div>
  );
}
