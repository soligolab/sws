// Il controllo colore del pannello proprietà: swatch + testo, sempre coerente
// con quello che il canvas disegna.
//
// Prima (fino al 21-09-2026) ogni chiamata passava il proprio ripiego, spesso
// una stringa CSS `var(…)`: `<input type="color">` la sanifica a #000000, e il
// pannello mostrava nero dove il canvas disegnava bianco. Ora il ripiego viene
// dalla tabella condivisa (`regola`) e lo swatch riceve **sempre** sei cifre
// hex (`estraiHex`), qualunque cosa ci sia nel progetto.
//
// Un campo **automatico** (regola `{ auto }`, es. il colore del testo) non ha
// valore nel file: segue lo sfondo della pagina. Qui si vede il colore
// effettivo con la dicitura «auto»; toccare swatch o testo lo rende esplicito,
// e il bottone ↺ lo rimette automatico. Per farlo il pannello deve conoscere lo
// **sfondo della pagina** — è l'unica cosa che il canvas sa da sé e il
// pannello no.

import { useTranslation } from "react-i18next";
import { coloreAuto, estraiHex, normalizzaColore, type RegolaColore } from "@/coloriPredefiniti";

const INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12,
};

export function CampoColore({
  valore, regola, sfondo, mixed = false, onChange, style,
}: {
  /** Il valore nel progetto, com'è (può essere un vecchio `var(…)`). */
  valore: unknown;
  /** La regola della tabella per questo tipo×campo; assente = testo automatico. */
  regola: RegolaColore | undefined;
  /** Lo sfondo della pagina corrente, **sempre** hex: senza, un campo
   *  automatico non avrebbe un colore da mostrare. */
  sfondo: string;
  /** Selezione multipla con valori diversi: swatch grigio, testo vuoto. */
  mixed?: boolean;
  /** `undefined` = torna automatico. */
  onChange: (v: string | undefined) => void;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const esplicito = normalizzaColore(valore);
  // Cosa succede quando il file non dice niente (30-09-2026: il pannello lo
  // **dichiara**, invece di un segnaposto grigio che sembrava un valore).
  //   auto     → il colore segue la pagina: lo si mostra, con «auto»;
  //   hex      → il predefinito della tabella: lo si mostra, con «predef.»
  //              (dopo `riempiPredefiniti` capita solo in casi rari);
  //   nessuno  → non si disegna;  derivato → calcolato da un altro colore.
  const stato: "esplicito" | "auto" | "hex" | "nessuno" | "derivato" = esplicito
    ? "esplicito"
    : !regola ? "auto"
    : "auto" in regola ? "auto"
    : "hex" in regola ? "hex"
    : regola.vuoto;
  const effettivo =
    esplicito ?? (regola && "hex" in regola ? regola.hex
      : regola && "auto" in regola ? coloreAuto(regola.auto, sfondo)
      : !regola ? coloreAuto("testo", sfondo)
      : undefined);
  const perSwatch = estraiHex(effettivo) ?? "#808080";
  // Il ↺ riporta allo stato senza valore: c'è per ogni regola che ne ha uno
  // voluto (auto, nessuno, derivato), non per un predefinito fisso.
  const haStatoVuoto = !!regola && !("hex" in regola);
  const etichetta: Record<string, [string, string]> = {
    auto: [t("props.colorAuto"), t("props.colorAutoHint")],
    hex: [t("props.colorPredefinito"), t("props.colorPredefinitoHint")],
    nessuno: [t("props.colorNessuno"), t("props.colorNessunoHint")],
    derivato: [t("props.colorDerivato"), t("props.colorDerivatoHint")],
  };
  const dichiarato = !mixed && stato !== "esplicito" ? etichetta[stato] : undefined;
  // Il colore che si vede davvero, scritto in chiaro (corsivo: non è nel file).
  const mostrato = mixed ? "" : stato === "esplicito" ? (typeof valore === "string" ? valore : "")
    : stato === "auto" || stato === "hex" ? perSwatch : "";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", ...style }}>
      <input
        type="color"
        style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none",
          opacity: mixed || stato === "nessuno" || stato === "derivato" ? 0.4 : 1 }}
        value={mixed ? "#808080" : perSwatch}
        title={dichiarato?.[1]}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        style={{ ...INPUT, flex: 1, minWidth: 0, ...(stato !== "esplicito" ? { fontStyle: "italic", color: "var(--brand-text-muted, #94a3b8)" } : {}) }}
        placeholder={mixed ? t("props.mixedValues") : undefined}
        value={mostrato}
        title={dichiarato?.[1]}
        // Testo vuoto = «non impostato», **sempre**. È l'unico gesto per
        // togliere un colore, e dev'essere lo stesso ovunque. Scrivere sopra
        // il colore mostrato in corsivo lo rende esplicito.
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
      {dichiarato && (
        <span style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", flex: "none" }} title={dichiarato[1]}>
          {dichiarato[0]}
        </span>
      )}
      {haStatoVuoto && stato === "esplicito" && !mixed && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title={regola && "vuoto" in regola
            ? t(regola.vuoto === "nessuno" ? "props.colorNessunoReset" : "props.colorDerivatoReset")
            : t("props.colorAutoReset")}
          style={{ ...INPUT, width: "auto", padding: "0 6px", cursor: "pointer", flex: "none" }}
        >↺</button>
      )}
    </div>
  );
}
