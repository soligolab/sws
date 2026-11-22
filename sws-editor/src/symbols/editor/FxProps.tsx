// Groups, effects and photo masks of the selected shapes (plan
// docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md, block C).
//
// The maintainer, at the rc.28 test run: the effects «dovrebbero essere
// proprietà che posso assegnare ad oggetti o gruppi di oggetti». So they live
// with the selection: select the flame shape, add «Flame», pick the input it
// follows. The same for a group of shapes (Ctrl+G).

import { useTranslation } from "react-i18next";
import type { DescrizioneSimbolo } from "@/types";
import {
  addEffect, addIngresso, clipPhoto, draws, effectsOf, FX_KINDS, groupOf, groupOps, inputIds, membersOf,
  removeEffect, setEffect, ungroupOps, unclipPhoto, type FxKind, type FxOp, type Op,
} from "./model";
import { C, Field, Num, Section, button, input, note } from "./ui";
import { SPAZIO } from "@/editor/stilePannelli";

const NEW_INPUT = "__new__";
const OPS: NonNullable<FxOp["when"]>["op"][] = ["gt", "ge", "lt", "le", "eq", "ne"];

export function FxProps({ d, sel, commit, setSel }: {
  d: DescrizioneSimbolo;
  sel: number[];
  commit: (d: DescrizioneSimbolo) => void;
  setSel: (s: number[]) => void;
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

  // A new input goes at the start: every index moves by one.
  const withNewInput = (then: (d2: DescrizioneSimbolo, id: string, shift: (i: number) => number) => void) => {
    const r = addIngresso(d, ids.includes("acceso") ? undefined : "acceso");
    then(r.d, r.id, (i) => i + 1);
  };
  const add = (kind: FxKind) => {
    if (ids.length) {
      commit(addEffect(d, drawn, kind, ids[0]).d);
      return;
    }
    withNewInput((d2, id, shift) => {
      commit(addEffect(d2, drawn.map(shift), kind, id).d);
      setSel(sel.map(shift));
    });
  };
  const setInput = (at: number, v: string) => {
    if (v !== NEW_INPUT) { commit(setEffect(d, at, { input: v })); return; }
    withNewInput((d2, id, shift) => {
      commit(setEffect(d2, shift(at), { input: id }));
      setSel(sel.map(shift));
    });
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
              onClick={() => commit(groupOps(d, drawn).d)}>{t("symbolEditor.fx.groupIt")}</button>
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
              <select style={input} value={fx.input} data-testid={`symbol-fx-input-${fx.kind}`} onChange={(e) => setInput(at, e.target.value)}>
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
          <select style={input} value="" data-testid="symbol-fx-add" onChange={(e) => { if (e.target.value) add(e.target.value as FxKind); }}>
            <option value="" />
            {FX_KINDS.map((k) => <option key={k} value={k}>{t(`symbolEditor.fx.kind.${k}`)}</option>)}
          </select>
        </Field>
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
