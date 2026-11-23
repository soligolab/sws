// Groups, effects and photo masks of the selected shapes (plan
// docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md, block C).
//
// The maintainer, at the rc.28 test run: the effects «dovrebbero essere
// proprietà che posso assegnare ad oggetti o gruppi di oggetti». So they live
// with the selection: select the flame shape, add «Flame», pick the input it
// follows. The same for a group of shapes (Ctrl+G).

import { useTranslation } from "react-i18next";
import type { DescrizioneSimbolo } from "@/types";
import { chiedi, conferma, scegli } from "@/finestraAvviso/finestraAvviso";
import {
  addEffect, addIngresso, clipPhoto, draws, effectPlan, effectsOf, freeInputId, FX_KINDS, groupOf, groupOps, groupPlan,
  idProblem, inputIds, inputs, membersOf, normalizeId, partOfAGroup, removeEffect, setEffect, ungroupOps, unclipPhoto,
  type FxKind, type FxOp, type IdNamespace, type IdProblem, type Op,
} from "./model";
import { C, Field, Num, Section, button, input, note } from "./ui";
import { SPAZIO } from "@/editor/stilePannelli";

const NEW_INPUT = "__new__";
const OPS: NonNullable<FxOp["when"]>["op"][] = ["gt", "ge", "lt", "le", "eq", "ne"];

type T = (k: string, o?: Record<string, unknown>) => string;

/** What a name that can't be is told, under the field or in the question. */
export function idMessage(t: T, ns: IdNamespace, p: IdProblem): string {
  if (ns === "port") return t(p === "taken" ? "symbolEditor.port.idTaken" : "symbolEditor.port.idRule");
  return t(p === "taken" ? "symbolEditor.id.taken" : p === "reserved" ? "symbolEditor.id.reserved" : "symbolEditor.id.rule");
}

/** The name of something new, asked before it is made (test of the rc.29,
 *  23-11-2026, the maintainer: what is created and then called by name asks
 *  the name first; Cancel makes nothing). Trimmed and lowercased, in the
 *  check and in the answer. `null`: cancelled, or a name that can't be (the
 *  tests' `rispondi` doesn't run `valida`). */
export async function askId(t: T, o: { ns: IdNamespace; title: string; text?: string; proposed: string; taken: Iterable<string> }): Promise<string | null> {
  const taken = [...o.taken];
  const why = (v: string) => {
    const p = idProblem(normalizeId(v), o.ns, taken);
    return p && idMessage(t, o.ns, p);
  };
  const v = await chiedi({ titolo: o.title, testo: o.text, iniziale: o.proposed, valida: why });
  return v === null || why(v) ? null : normalizeId(v);
}

/** Effects about to go, listed, and asked: they went in silence (test of the
 *  rc.29). `merge`: a group keeps one glow or flame; `input`: they follow an
 *  input that goes. */
export function confirmEffectsGo(t: T, fx: FxOp[], why: "merge" | "input"): Promise<boolean> {
  const lines = fx.map((f) => t("symbolEditor.fx.effectLine", { kind: t(`symbolEditor.fx.kind.${f.kind}`), group: f.group, input: f.input }));
  return conferma({
    titolo: t("symbolEditor.fx.goTitle"), pericolo: true,
    testo: `${lines.join("\n")}\n\n${t(why === "merge" ? "symbolEditor.fx.goMerge" : "symbolEditor.fx.goInput")}`,
  });
}

/** «Group» and Ctrl+G: the effects a merge drops are asked first. The group
 *  keeps an automatic name in the rc.30 (names of groups and renaming them
 *  come together in 2.27). */
export async function groupAsking(
  t: T, d: DescrizioneSimbolo, which: number[], latest: () => DescrizioneSimbolo, commit: (d: DescrizioneSimbolo) => void,
): Promise<void> {
  const { lost } = groupPlan(d, which);
  if (lost.length && (!(await confirmEffectsGo(t, lost, "merge")) || latest() !== d)) return;
  commit(groupOps(d, which).d);
}

export function FxProps({ d, sel, commit, setSel, latest, onCreated }: {
  d: DescrizioneSimbolo;
  sel: number[];
  commit: (d: DescrizioneSimbolo) => void;
  setSel: (s: number[]) => void;
  /** The drawing now: a question answered after the drawing changed (the AI
   *  commits on its own) makes nothing, its indexes are of another drawing. */
  latest: () => DescrizioneSimbolo;
  /** A new input was made with this name (the editor tracks renames for the page). */
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const ops = d.ops as Op[];
  const drawn = sel.filter((i) => draws(ops[i]));
  if (!drawn.length) return null;
  const groups = [...new Set(drawn.map((i) => groupOf(ops[i])))];
  const group = groups.length === 1 ? groups[0] : undefined;
  const wholeGroup = !!group && membersOf(d, group).every((i) => drawn.includes(i));
  const effects = wholeGroup ? effectsOf(d, group) : [];
  const ids = inputIds(d);
  // Some shapes of a group, not all: the effect would go on the whole group
  // and not show here. The menu waits for the whole group (decision D3 of the
  // maintainer, 23-11-2026).
  const partial = partOfAGroup(d, drawn);

  /** A new input, its name asked first; `null`: cancelled. */
  const newInput = () => askId(t, {
    ns: "input", title: t("symbolEditor.ask.inputTitle"), text: t("symbolEditor.ask.inputText"),
    proposed: freeInputId(d, t("symbolEditor.fx.inputName")), taken: ids,
  });
  /** The input a new effect follows, chosen among the inputs and the parts or
   *  a new one. Before the rc.30 it was the newest input, taken in silence:
   *  the one of the effect before (test of the rc.29). */
  const chooseInput = async (kind: FxKind): Promise<{ id: string; isNew: boolean } | null> => {
    const all = inputs(d).filter((i) => i.kind !== "state");
    const v = all.length ? await scegli<string>({
      titolo: t("symbolEditor.fx.pickInput"), testo: t("symbolEditor.fx.pickInputText", { kind: t(`symbolEditor.fx.kind.${kind}`) }),
      scelte: [
        ...all.map((i) => ({ valore: i.id, etichetta: `${t(`symbolEditor.input.${i.kind}`)} · ${i.id}` })),
        { valore: NEW_INPUT, etichetta: t("symbolEditor.fx.newInput") },
      ],
    }) : NEW_INPUT;
    if (v === null) return null;
    if (v !== NEW_INPUT) return { id: v, isNew: false };
    const id = await newInput();
    return id ? { id, isNew: true } : null;
  };
  /** A new input goes after the other inputs: the operations from `at` on move by one. */
  const withInput = (id: string): { d: DescrizioneSimbolo; shift: (i: number) => number } | null => {
    const r = addIngresso(d, id);
    if (!r) return null;
    onCreated(id);
    return { d: r.d, shift: (i) => (i >= r.at ? i + 1 : i) };
  };
  const add = async (kind: FxKind) => {
    const { lost } = effectPlan(d, drawn, kind);
    if (lost.length && !(await confirmEffectsGo(t, lost, "merge"))) return;
    const choice = await chooseInput(kind);
    if (!choice || latest() !== d) return;
    const r = choice.isNew ? withInput(choice.id) : { d, shift: (i: number) => i };
    if (!r) return;
    commit(addEffect(r.d, drawn.map(r.shift), kind, choice.id, t(`symbolEditor.fx.groupName.${kind}`)).d);
    if (choice.isNew) setSel(sel.map(r.shift));
  };
  const setInput = async (at: number, v: string) => {
    if (v !== NEW_INPUT) { commit(setEffect(d, at, { input: v })); return; }
    const id = await newInput();
    if (!id || latest() !== d) return;
    const r = withInput(id);
    if (!r) return;
    commit(setEffect(r.d, r.shift(at), { input: id }));
    setSel(sel.map(r.shift));
  };

  // The mask: a photo and a shape selected, or a photo already cut.
  const photo = sel.find((i) => ops[i]?.op === "image");
  const shape = sel.find((i) => ops[i]?.op === "forma");
  const canCut = sel.length === 2 && photo !== undefined && shape !== undefined;
  const cut = photo !== undefined && sel.length === 1 && !!ops[photo]?.clip;

  return (
    <>
      <Section id="group" title={t("symbolEditor.fx.group")}>
        {group && <p style={note}>{t("symbolEditor.fx.inGroup", { g: group, n: membersOf(d, group).length })}</p>}
        <div style={{ display: "flex", gap: SPAZIO.xs, flexWrap: "wrap" }}>
          {drawn.length > 1 && !wholeGroup && (
            <button type="button" style={button} data-testid="symbol-group"
              onClick={() => void groupAsking(t, d, drawn, latest, commit)}>{t("symbolEditor.fx.groupIt")}</button>
          )}
          {drawn.some((i) => groupOf(ops[i])) && (
            <button type="button" style={button} data-testid="symbol-ungroup"
              onClick={() => commit(ungroupOps(d, drawn))}>{t("symbolEditor.fx.ungroup")}</button>
          )}
        </div>
      </Section>
      <Section id="effects" title={t("symbolEditor.fx.effects")} count={effects.length || undefined}>
        {!wholeGroup && drawn.length > 1 && groups.length > 1 && <p style={note}>{t("symbolEditor.fx.mixed")}</p>}
        {effects.map(({ at, fx }) => (
          <div key={at} data-testid={`symbol-fx-${fx.kind}`} style={{ display: "flex", flexDirection: "column", gap: SPAZIO.xs, padding: SPAZIO.s, border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <strong style={{ flex: 1, fontSize: 12 }}>{t(`symbolEditor.fx.kind.${fx.kind}`)}</strong>
              <button type="button" style={{ ...button, color: C.danger }} onClick={() => commit(removeEffect(d, at))}>✕</button>
            </div>
            <Field label={t("symbolEditor.fx.input")}>
              <select style={input} value={fx.input} data-testid={`symbol-fx-input-${fx.kind}`} onChange={(e) => void setInput(at, e.target.value)}>
                {!ids.includes(fx.input) && <option value={fx.input}>{fx.input} ?</option>}
                {ids.map((id) => <option key={id} value={id}>{id}</option>)}
                <option value={NEW_INPUT}>{t("symbolEditor.fx.newInput")}</option>
              </select>
            </Field>
            <Field label={t("symbolEditor.fx.when")}>
              <select style={{ ...input, width: 74 }} value={fx.when?.op ?? ""}
                onChange={(e) => commit(setEffect(d, at, { when: e.target.value ? { op: e.target.value as NonNullable<FxOp["when"]>["op"], value: fx.when?.value ?? 0 } : undefined }))}>
                <option value="">{t("symbolEditor.fx.whenTrue")}</option>
                {OPS.map((o) => <option key={o} value={o}>{t(`symbolEditor.fx.op.${o}`)}</option>)}
              </select>
              {fx.when && <Num value={fx.when.value} step={1} onChange={(v) => commit(setEffect(d, at, { when: { ...fx.when!, value: v } }))} />}
            </Field>
            <Field label={t("symbolEditor.fx.level")}>
              <input type="checkbox" checked={!!fx.level} title={t("symbolEditor.fx.levelHint")}
                onChange={(e) => commit(setEffect(d, at, { level: e.target.checked ? { min: 0, max: 100 } : undefined }))} />
              {fx.level && <>
                <Num value={fx.level.min} step={1} onChange={(v) => commit(setEffect(d, at, { level: { ...fx.level!, min: v } }))} />
                <Num value={fx.level.max} step={1} onChange={(v) => commit(setEffect(d, at, { level: { ...fx.level!, max: v } }))} />
              </>}
            </Field>
            {fx.kind !== "flame" && (
              <Field label={t("symbolEditor.fx.colour")}>
                <input type="color" value={fx.color ?? (fx.kind === "smoke" ? "#9ca3af" : fx.kind === "bubbles" ? "#bae6fd" : "#22d3ee")}
                  onChange={(e) => commit(setEffect(d, at, { color: e.target.value }))} />
              </Field>
            )}
            {fx.kind === "glow" && (
              <Field label={t("symbolEditor.fx.radius")}><Num value={fx.radius ?? 4} onChange={(v) => commit(setEffect(d, at, { radius: Math.max(0.5, Math.min(20, v)) }))} /></Field>
            )}
            {fx.kind === "bubbles" && (
              <Field label={t("symbolEditor.fx.count")}><Num value={fx.count ?? 6} step={1} onChange={(v) => commit(setEffect(d, at, { count: Math.max(1, Math.min(12, Math.round(v))) }))} /></Field>
            )}
            {fx.kind !== "glow" && (
              <Field label={t("symbolEditor.fx.period")}><Num value={fx.period_ms ?? (fx.kind === "flame" ? 800 : 2000)} step={100}
                onChange={(v) => commit(setEffect(d, at, { period_ms: Math.max(400, Math.min(10000, v)) }))} /></Field>
            )}
          </div>
        ))}
        <Field label={t("symbolEditor.fx.add")}>
          <select style={input} value="" data-testid="symbol-fx-add" disabled={partial}
            onChange={(e) => { if (e.target.value) void add(e.target.value as FxKind); }}>
            <option value="" />
            {FX_KINDS.map((k) => <option key={k} value={k}>{t(`symbolEditor.fx.kind.${k}`)}</option>)}
          </select>
        </Field>
        {partial && <p style={note} data-testid="symbol-fx-whole-group">{t("symbolEditor.fx.wholeGroupFirst")}</p>}
        <p style={note}>{t("symbolEditor.fx.note")}</p>
      </Section>
      {(canCut || cut) && (
        <Section id="mask" title={t("symbolEditor.fx.mask")}>
          {canCut && (
            <button type="button" style={button} data-testid="symbol-clip"
              onClick={() => { commit(clipPhoto(d, photo!, shape!)); setSel([shape! < photo! ? photo! - 1 : photo!]); }}>
              {t("symbolEditor.fx.clip")}
            </button>
          )}
          {cut && (
            <button type="button" style={button} data-testid="symbol-unclip"
              onClick={() => commit(unclipPhoto(d, photo!))}>{t("symbolEditor.fx.unclip")}</button>
          )}
          <p style={note}>{t("symbolEditor.fx.maskNote")}</p>
        </Section>
      )}
    </>
  );
}
