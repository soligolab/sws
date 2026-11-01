// La sezione «Collegamenti» (01-11-2026, piano
// docs/plans/2026-11-01-pannello-proprieta-per-frequenza.md, fase 2): tutti i
// tag di un oggetto in un punto solo, in testa al ramo della funzione.
//
// Si vedono **solo i tag collegati**, più il principale del tipo anche vuoto:
// un simbolo ne può avere nove e di solito ne usa uno o due, e nove campi vuoti
// in fila rifarebbero l'affollamento che questa sezione toglie. Gli altri si
// aggiungono da «+ Collega…». Ogni riga dice la direzione (← letto, → scritto,
// ⇄ tutti e due), l'effetto in parole e il valore live.
//
// Sotto stanno i riepiloghi dei tag in lista e i 🔗 dei singoli campi: si
// leggono qui e si cambiano dove sono, e un clic ci porta.
import { createContext, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type { SynopticObject } from "@/types";
import { testoValoreTag } from "../RigaTagLive";
import { SPAZIO, TESTO } from "../stilePannelli";
import { listeDiTag, slotDi, slotPresente, type CampoTag, type SlotTag, type Verso } from "./slotTag";

/** Porta al campo `data-field={campo}`, aprendo il ramo che lo tiene. La
 *  fornisce `PannelloDestro`; fuori (un test, la selezione multipla) è `null`
 *  e le righe non sono cliccabili. */
export const VaiACampo = createContext<((campo: string) => void) | null>(null);

/** Il `data-field` della sezione stessa: il bersaglio di `RimandoCollegamenti`. */
const CAMPO_SEZIONE = "links";

const FRECCIA: Record<Verso, string> = { in: "←", out: "→", inout: "⇄" };
const COLORE_QUALITA: Record<string, string> = {
  Good: "var(--brand-success, #22c55e)",
  Uncertain: "var(--brand-warning, #f59e0b)",
  Bad: "var(--brand-danger, #ef4444)",
};

/** Il valore live di un tag, corto, col colore della qualità. Una lettura
 *  dallo store che la connessione tiene già aggiornato: niente polling. */
function ValoreLive({ tag }: { tag: string }) {
  const stato = useAppStore((s) => (tag ? s.tagValues[tag] : undefined));
  if (!tag) return null;
  return (
    <span data-testid="valore-live" title={stato?.quality}
      style={{
        fontSize: TESTO.nota, fontFamily: "monospace", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", color: stato ? COLORE_QUALITA[stato.quality] ?? "inherit" : "var(--brand-text-subtle, #64748b)",
      }}>
      {stato ? testoValoreTag(stato.value) : "—"}
    </span>
  );
}

const STILE_X: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: "0 2px",
  color: "var(--brand-text-subtle, #94a3b8)", fontSize: 11, lineHeight: 1,
};

/** Una riga di slot: freccia, effetto, valore live e ✕ in alto; sotto il tag. */
function RigaSlot({ slot, obj, onChange, onTogli, stileCampo, vari }: {
  slot: SlotTag;
  /** Selezione multipla con valori diversi: il campo è vuoto e lo dice. */
  vari: boolean;
  obj: SynopticObject;
  onChange: (p: Partial<SynopticObject>) => void;
  onTogli: () => void;
  stileCampo: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const valore = (obj[slot.campo] as string | undefined) ?? "";
  const effetto = t(`props.slot.${slot.effetto}`);
  return (
    <div data-row={effetto} data-slot={slot.campo} style={{ display: "flex", gap: SPAZIO.xs, marginBottom: SPAZIO.s }}>
      <span aria-hidden="true" title={t(`props.slot.verso.${slot.verso}`)}
        style={{ width: 12, flexShrink: 0, fontSize: 12, lineHeight: "16px", color: "var(--brand-text-muted, #94a3b8)" }}>
        {FRECCIA[slot.verso]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPAZIO.xs, marginBottom: 2 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: TESTO.etichetta, color: "var(--brand-text-muted, #94a3b8)" }}>{effetto}</div>
          <ValoreLive tag={valore} />
          {(valore !== "" || !slot.principale) && (
            <button type="button" data-testid={`scollega-${slot.campo}`} style={STILE_X}
              title={t("props.slot.scollega")} aria-label={`${t("props.slot.scollega")}: ${effetto}`} onClick={onTogli}>✕</button>
          )}
        </div>
        <TagInput style={stileCampo} value={valore} placeholder={vari ? t("props.vari") : t("props.slot.scegli")}
          onChange={(v) => onChange({
            [slot.campo]: v || (slot.vuotoConta ? "" : undefined),
            ...(v && slot.alCollegare ? slot.alCollegare : {}),
          } as Partial<SynopticObject>)} />
      </div>
    </div>
  );
}

/** Una riga che si legge e porta altrove: un riepilogo o un 🔗. */
function RigaRimando({ icona, testo, dettaglio, campo, onTogli, etichettaTogli }: {
  icona: string; testo: string; dettaglio: string; campo: string;
  onTogli?: () => void; etichettaTogli?: string;
}) {
  const vai = useContext(VaiACampo);
  return (
    <div data-row={testo} style={{ display: "flex", alignItems: "center", gap: SPAZIO.xs, fontSize: 12, marginBottom: 2 }}>
      <span aria-hidden="true" style={{ width: 12, flexShrink: 0, fontSize: 11 }}>{icona}</span>
      <button type="button" disabled={!vai} onClick={() => vai?.(campo)} data-testid={`vai-${campo}`}
        style={{
          flex: 1, minWidth: 0, display: "flex", gap: SPAZIO.xs, textAlign: "left", border: "none", background: "transparent",
          padding: 0, color: "inherit", cursor: vai ? "pointer" : "default", font: "inherit",
        }}>
        <span style={{ color: "var(--brand-text-muted, #94a3b8)", flexShrink: 0 }}>{testo}</span>
        <span style={{ color: "var(--brand-primary-testo, #3b82f6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dettaglio}</span>
      </button>
      {onTogli && <button type="button" style={STILE_X} title={etichettaTogli} aria-label={etichettaTogli} onClick={onTogli}>✕</button>}
    </div>
  );
}

/** Il corpo di «Collegamenti». Il chiamante lo rimonta al cambio d'oggetto
 *  (`key`), così gli slot aggiunti e ancora vuoti non passano a un altro. */
export function Collegamenti({ obj, onChange, stileCampo, mixedKeys }: {
  obj: SynopticObject;
  /** I campi che differiscono fra gli oggetti di una selezione multipla. */
  mixedKeys?: ReadonlySet<string>;
  onChange: (p: Partial<SynopticObject>) => void;
  stileCampo: React.CSSProperties;
}) {
  const { t } = useTranslation();
  // Gli slot scelti da «+ Collega…» e non ancora collegati: stato locale, non
  // si scrive `""` nel progetto per un tag che non c'è ancora.
  const [aggiunti, setAggiunti] = useState<ReadonlySet<CampoTag>>(new Set());
  const slot = slotDi(obj);
  const vari = (s: SlotTag) => !!mixedKeys?.has(s.campo);
  const visibili = slot.filter((s) => s.principale || slotPresente(s, obj) || aggiunti.has(s.campo) || vari(s));
  const liberi = slot.filter((s) => !visibili.includes(s));
  const letti = visibili.filter((s) => s.verso === "in");
  const scritti = visibili.filter((s) => s.verso !== "in");

  const togli = (s: SlotTag) => {
    setAggiunti((a) => { const n = new Set(a); n.delete(s.campo); return n; });
    onChange(s.alloScollegare?.(obj) ?? ({ [s.campo]: undefined } as Partial<SynopticObject>));
  };
  const aggiungi = (campo: string) => {
    const s = liberi.find((x) => x.campo === campo);
    if (!s) return;
    if (s.vuotoConta) onChange({ [s.campo]: "", ...(s.alCollegare ?? {}) } as Partial<SynopticObject>);
    else if (s.mostraSe && s.alCollegare) onChange(s.alCollegare);
    setAggiunti((a) => new Set(a).add(s.campo));
  };

  const titolo = (chiave: string) => (
    <div style={{ fontSize: TESTO.nota, color: "var(--brand-text-subtle, #94a3b8)", margin: `${SPAZIO.xs}px 0 2px` }}>{t(chiave)}</div>
  );
  const riga = (s: SlotTag) => (
    <RigaSlot key={s.campo} slot={s} obj={obj} onChange={onChange} onTogli={() => togli(s)} stileCampo={stileCampo} vari={vari(s)} />
  );
  const liste = listeDiTag(obj);
  const legami = Object.entries(obj.bindings ?? {});

  return (
    <div data-field={CAMPO_SEZIONE} data-testid="collegamenti">
      {letti.length > 0 && <>{scritti.length > 0 && titolo("props.slot.letti")}{letti.map(riga)}</>}
      {scritti.length > 0 && <>{letti.length > 0 && titolo("props.slot.scritti")}{scritti.map(riga)}</>}
      {liste.map((l) => (
        <RigaRimando key={l.campo} icona="☰" campo={l.campo} testo={t(`props.slot.lista.${l.effetto}`)}
          dettaglio={t("props.slot.nTag", { count: l.n })} />
      ))}
      {legami.map(([prop, spec]) => (
        <RigaRimando key={prop} icona="🔗" campo={prop} testo={prop}
          dettaglio={typeof spec === "string"
            ? (spec || t("shell.noTag"))
            : spec.expr !== undefined
              ? `ƒ ${spec.expr || "…"}`
              : `${spec.tag || "…"}${spec.in_min !== undefined ? ` [${spec.in_min}..${spec.in_max}→${spec.out_min}..${spec.out_max}]` : ""}`}
          etichettaTogli={t("props.removeBinding")}
          onTogli={() => {
            const next = { ...obj.bindings! };
            delete next[prop];
            onChange({ bindings: Object.keys(next).length > 0 ? next : undefined });
          }} />
      ))}
      {liberi.length > 0 && (
        <select data-testid="collega-slot" value="" aria-label={t("props.slot.collega")}
          onChange={(e) => aggiungi(e.target.value)}
          style={{ ...stileCampo, cursor: "pointer", marginTop: SPAZIO.xs, color: "var(--brand-text-muted, #94a3b8)" }}>
          <option value="">{t("props.slot.collega")}</option>
          {liberi.map((s) => (
            <option key={s.campo} value={s.campo}>{`${FRECCIA[s.verso]} ${t(`props.slot.${s.effetto}`)}`}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Al posto di un tag spostato in Collegamenti, dove serve il contesto: «comandata
 *  da un tag», con il tag e il rimando. Si legge e basta (regola UI n. 2). */
export function RimandoCollegamenti({ tag }: { tag: string | undefined }) {
  const { t } = useTranslation();
  const vai = useContext(VaiACampo);
  return (
    <button type="button" data-testid="rimando-collegamenti" disabled={!vai} onClick={() => vai?.(CAMPO_SEZIONE)}
      style={{
        display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "2px 0",
        marginBottom: SPAZIO.xs, fontSize: TESTO.nota, color: "var(--brand-text-subtle, #94a3b8)", cursor: vai ? "pointer" : "default",
      }}>
      {tag ? t("props.slot.comandatoDa", { tag }) : t("props.slot.nessunTag")} <span aria-hidden="true">→</span>
    </button>
  );
}
