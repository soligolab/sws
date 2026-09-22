// Il campo «Formato» con il suo elenco di formati pronti (▾), e l'anteprima
// del risultato **sul valore vero del tag**.
//
// Fino al 22-09-2026 il campo era un input libero: chi non conosceva la
// sintassi doveva indovinarla, e i formati nuovi per le durate e per le date
// (`{value:hms}`, `{value:datetime}`) non li avrebbe trovati nessuno. Il
// controllo è lo stesso del selettore delle variabili — un `▾` accanto al
// campo — perché è lì che si va a cercare quando un campo ha delle scelte.
//
// Scegliendo una voce si sostituisce **solo il segnaposto**: `{value:.1f} bar`
// con la durata diventa `{value:dhms} bar`. L'unità di misura scritta a mano è
// la cosa che costa di più riscrivere, e sparirebbe a ogni tentativo.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatValue } from "@/canvas/SvgCanvas";
import type { TagState } from "@/types";

/** I formati offerti, nell'ordine in cui compaiono. `campione` è il valore su
 *  cui si mostra l'anteprima quando il tag non ne ha ancora uno: un numero
 *  diverso per famiglia, altrimenti «3600» come durata e come istante direbbe
 *  due cose che non si somigliano. */
interface Voce {
  spec: string;
  gruppo: "numeri" | "durate" | "istanti";
  campione: number;
}

/// `{value:,.2f}` (separatore delle migliaia) **non** è nell'elenco pur essendo
/// accettato: sul web lo raggruppa `toLocaleString` secondo la lingua del
/// browser, sul pannello no — un separatore ha bisogno di una lingua, e il
/// pannello non ne ha una. È una divergenza dichiarata in `formatta_spec`
/// (lvgl_render.rs), e offrirla qui prometterebbe qualcosa che sul vetro non
/// succede. Chi la vuole la scrive a mano, sapendo cosa sta facendo.
export const FORMATI: readonly Voce[] = [
  { spec: "{value}", gruppo: "numeri", campione: 12.345 },
  { spec: "{value:.1f}", gruppo: "numeri", campione: 12.345 },
  { spec: "{value:.2f}", gruppo: "numeri", campione: 12.345 },
  { spec: "{value:.0f}", gruppo: "numeri", campione: 12.345 },
  { spec: "{value:+.1f}", gruppo: "numeri", campione: 12.345 },
  { spec: "{value:.2e}", gruppo: "numeri", campione: 1234567.891 },
  { spec: "{value:.1%}", gruppo: "numeri", campione: 0.427 },
  { spec: "{value:hms}", gruppo: "durate", campione: 19339477 },
  { spec: "{value:hm}", gruppo: "durate", campione: 19339477 },
  { spec: "{value:dhms}", gruppo: "durate", campione: 19339477 },
  { spec: "{value:date}", gruppo: "istanti", campione: 1790075079000 },
  { spec: "{value:time}", gruppo: "istanti", campione: 1790075079000 },
  { spec: "{value:datetime}", gruppo: "istanti", campione: 1790075079000 },
];

/** Il segnaposto dentro il testo: lo stesso di `formatValue`, senza i gruppi. */
const SEGNAPOSTO = /\{value(?::(?:datetime|dhms|date|time|hms|hm)|:(?:\+)?(?:,)?(?:\.\d+)?[fe%]?)?\}/;

/** Sostituisce **solo** il segnaposto, lasciando il testo attorno; se non c'è
 *  segnaposto (campo vuoto o solo testo) lo aggiunge in coda. */
export function applicaFormato(testoCorrente: string, spec: string): string {
  if (SEGNAPOSTO.test(testoCorrente)) return testoCorrente.replace(SEGNAPOSTO, spec);
  return testoCorrente ? `${testoCorrente}${testoCorrente.endsWith(" ") ? "" : " "}${spec}` : spec;
}

export function CampoFormato({
  value,
  onChange,
  placeholder,
  style,
  /** Lo stato del tag dell'oggetto, se ne ha uno: l'anteprima si fa su quello. */
  statoTag,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  statoTag?: TagState;
}) {
  const { t } = useTranslation();
  const contenitore = useRef<HTMLDivElement>(null);
  const [aperto, setAperto] = useState(false);

  useEffect(() => {
    if (!aperto) return;
    const h = (e: MouseEvent) => {
      if (!contenitore.current?.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aperto]);

  const dalVivo = typeof statoTag?.value === "number" ? statoTag.value : undefined;
  const voci = useMemo(
    () =>
      FORMATI.map((v) => ({
        ...v,
        // Il valore vero quando c'è: un'anteprima su un numero che non è il
        // proprio dice poco, e su una durata dice il falso.
        anteprima: formatValue(dalVivo ?? v.campione, v.spec),
        vera: dalVivo !== undefined,
      })),
    [dalVivo],
  );

  const gruppi = ["numeri", "durate", "istanti"] as const;

  return (
    <div ref={contenitore} style={{ position: "relative", display: "flex", gap: 2 }}>
      <input
        type="text"
        style={{ ...style, flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        title={t("props.formatHint")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="button"
        style={{
          flexShrink: 0,
          background: "var(--brand-surface, #1e293b)",
          border: "1px solid var(--brand-border, #475569)",
          borderRadius: 4,
          color: "var(--brand-text-muted, #94a3b8)",
          cursor: "pointer",
          padding: "0 6px",
          fontSize: 11,
          lineHeight: 1,
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAperto((v) => !v)}
        tabIndex={-1}
        title={t("props.formatPick")}
      >
        ▾
      </button>
      {aperto && (
        <div
          style={{
            // Largo quanto il campo, mai di più: il pannello destro si
            // restringe fino a 220px e taglia ciò che esce (`overflow:
            // hidden`). Ancorato a destra con una larghezza minima, l'elenco
            // debordava a sinistra e si vedeva mozzato — segnalato dal
            // maintainer il 22-09-2026. È lo stesso schema del selettore
            // delle variabili, che per questo non ha mai avuto il difetto.
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--brand-bg, #0f172a)",
            border: "1px solid var(--brand-surface-2, #334155)",
            borderRadius: 4,
            maxHeight: 320,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            marginTop: 2,
          }}
        >
          <div style={{ padding: "5px 8px", fontSize: 10, lineHeight: 1.4, color: "var(--brand-text-subtle, #64748b)", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
            {dalVivo !== undefined ? t("props.formatPreviewLive") : t("props.formatPreviewSample")}
          </div>
          {gruppi.map((g) => (
            <div key={g}>
              <div style={{ padding: "5px 8px 2px", fontSize: 10, color: "var(--brand-text-subtle, #64748b)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {t(`props.formatGroup.${g}`)}
              </div>
              {voci
                .filter((v) => v.gruppo === g)
                .map((v) => (
                  <div
                    key={v.spec}
                    // A pannello stretto l'anteprima va a capo invece di
                    // spingere fuori il segnaposto, che è quello che si clicca.
                    style={{ padding: "5px 8px", cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--brand-surface, #1e293b)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
                    onMouseDown={() => { onChange(applicaFormato(value, v.spec)); setAperto(false); }}
                  >
                    <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace", fontSize: 11, flexShrink: 0 }}>{v.spec}</span>
                    <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {v.anteprima}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
