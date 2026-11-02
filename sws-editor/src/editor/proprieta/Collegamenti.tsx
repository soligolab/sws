// La sezione «Collegamenti» (01-11-2026, piano
// docs/archive/2026-11-01-pannello-proprieta-per-frequenza.md, fase 2): tutti i
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
import { CampoNumero } from "@/components/CampoNumero";
import { angoliLeva, trovaSimboloLib, useSimboloLib } from "@/symbols/lib/libreria";
import type { SimboloLib } from "@/symbols/lib/manifest";
import type { ParteLegata, SynopticObject } from "@/types";
import { testoValoreTag } from "../RigaTagLive";
import { SPAZIO, TESTO } from "../stilePannelli";
import { listeDiTag, slotDi, slotPresente, type CampoTag, type SlotTag, type Verso } from "./slotTag";

/** Porta al campo `data-field={campo}`, aprendo il ramo che lo tiene. La
 *  fornisce `PannelloDestro`; fuori (un test, la selezione multipla) è `null`
 *  e le righe non sono cliccabili. */
export const VaiACampo = createContext<((campo: string) => void) | null>(null);

/** Le parti vive di un simbolo che si legano a un tag: lancette, leve, spie.
 *  Livello e rotazione hanno già i loro slot (`fill_level_tag`, `symbol_spin_tag`). */
function partiLegabili(sim: SimboloLib | undefined) {
  return (sim?.parts ?? []).filter((p) => p.kind === "needle" || p.kind === "lever" || p.kind === "lamp");
}

/** Il tag di stato fa da predefinito alla leva a due posizioni (02-11-2026, il
 *  maintainer: «quando viene inserito un tag in "state" potresti ricopiarlo in
 *  "Lever open" così è il comportamento di default ma l'utente lo può
 *  sovrascrivere»). Si copia solo dove la leva non ha un tag, o ha quello di
 *  prima: un tag scelto apposta per la leva resta suo. */
export function conLevaDalloStato(obj: SynopticObject, patch: Partial<SynopticObject>): Partial<SynopticObject> {
  if (!("state_tag" in patch) || obj.type !== "symbol" || !obj.symbol_id) return patch;
  const leve = (trovaSimboloLib(obj.symbol_id)?.parts ?? [])
    .filter((p) => p.kind === "lever" && angoliLeva(p).length === 2);
  if (leve.length === 0) return patch;
  const prima = obj.state_tag ?? "";
  const dopo = patch.state_tag ?? "";
  const parti: Record<string, ParteLegata> = { ...(obj.symbol_parts ?? {}) };
  let cambiate = false;
  for (const p of leve) {
    const attuale = parti[p.id]?.tag ?? "";
    if (attuale !== "" && attuale !== prima) continue;
    const nuova: ParteLegata = { ...(parti[p.id] ?? {}) };
    if (dopo) nuova.tag = dopo; else delete nuova.tag;
    if (Object.keys(nuova).length === 0) delete parti[p.id]; else parti[p.id] = nuova;
    cambiate = true;
  }
  if (!cambiate) return patch;
  return { ...patch, symbol_parts: Object.keys(parti).length > 0 ? parti : undefined };
}

/** Le parti vive del simbolo, fra i tag principali (02-11-2026: «è una funzione
 *  molto utile e un po' troppo nascosta»). Erano una sezione a parte dentro
 *  «Parametri»; qui stanno con lo stato e il comando, ognuna col suo tag. */
function PartiDelSimbolo({ obj, onChange, stileCampo }: {
  obj: SynopticObject; onChange: (p: Partial<SynopticObject>) => void; stileCampo: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const { sim } = useSimboloLib(obj.type === "symbol" ? obj.symbol_id : undefined);
  const parti = partiLegabili(sim);
  if (parti.length === 0) return null;
  const legami = obj.symbol_parts ?? {};
  const metti = (id: string, patch: Partial<ParteLegata>) => {
    const nuovo = { ...(legami[id] ?? {}), ...patch };
    for (const k of Object.keys(nuovo) as (keyof ParteLegata)[]) if (nuovo[k] === undefined || nuovo[k] === "") delete nuovo[k];
    const tutti = { ...legami, [id]: nuovo };
    if (Object.keys(nuovo).length === 0) delete tutti[id];
    onChange({ symbol_parts: Object.keys(tutti).length > 0 ? tutti : undefined });
  };
  const numero = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const senzaTag = parti.filter((p) => !legami[p.id]?.tag).length;
  const piccola: React.CSSProperties = { fontSize: TESTO.nota, color: "var(--brand-text-subtle, #94a3b8)" };
  return (
    <div data-field="symbol_parts" data-testid="parti-del-simbolo">
      <div style={{ ...piccola, margin: `${SPAZIO.xs}px 0 2px` }}>{t("props.partiSimbolo")}</div>
      {/* Una parte senza tag resta ferma (scelta del maintainer del 02-11-2026):
          la leva a metà, la spia sempre accesa. Detto qui, o sembra un disegno
          con un solo aspetto. */}
      {senzaTag > 0 && (
        <div data-testid="parti-senza-tag" style={{ fontSize: TESTO.nota, color: "var(--brand-warning-soft, #fbbf24)", margin: "0 0 4px", lineHeight: 1.4 }}>
          {t("props.partiSenzaTag", { count: senzaTag })}
        </div>
      )}
      {parti.map((p) => {
        const l = legami[p.id] ?? {};
        // Una leva a più di due posizioni non si apre e non si chiude: si
        // mette su una posizione, e il tag è l'indice.
        const posizioni = p.kind === "lever" ? angoliLeva(p).length : 0;
        const etichetta = p.kind === "needle" ? t("props.parteLancetta")
          : p.kind === "lever"
            ? (posizioni >= 3 ? t("props.parteLevaPosizioni", { ultima: posizioni - 1 }) : t("props.parteLeva"))
          : t("props.parteSpia", { id: p.id });
        return (
          <div key={p.id} data-row={etichetta} data-parte={p.id} style={{ display: "flex", gap: SPAZIO.xs, marginBottom: SPAZIO.s }}>
            <span aria-hidden="true" style={{ width: 12, flexShrink: 0, fontSize: 12, lineHeight: "16px", color: "var(--brand-text-muted, #94a3b8)" }}>
              {FRECCIA.in}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: SPAZIO.xs, marginBottom: 2 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: TESTO.etichetta, color: "var(--brand-text-muted, #94a3b8)" }}>{etichetta}</div>
                <ValoreLive tag={l.tag ?? ""} />
              </div>
              <TagInput style={stileCampo} placeholder={t("props.slot.scegli")} value={l.tag ?? ""}
                onChange={(v) => metti(p.id, { tag: v || undefined })} />
              {p.kind === "needle" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
                  <div><div style={piccola}>{t("props.parteMin")}</div>
                    <CampoNumero style={stileCampo} placeholder="0" value={l.min ?? ""}
                      onTesto={(e) => metti(p.id, { min: numero(e) })} /></div>
                  <div><div style={piccola}>{t("props.parteMax")}</div>
                    <CampoNumero style={stileCampo} placeholder="100" value={l.max ?? ""}
                      onTesto={(e) => metti(p.id, { max: numero(e) })} /></div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
  // Il tag di stato porta con sé la leva (02-11-2026): vedi `conLevaDalloStato`.
  const onChangeOriginale = onChange;
  onChange = (p) => onChangeOriginale(conLevaDalloStato(obj, p));
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
      {!mixedKeys?.size && <PartiDelSimbolo obj={obj} onChange={onChange} stileCampo={stileCampo} />}
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
