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
  /** La regola della tabella per questo tipo×campo; assente = nessun «auto». */
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
  const puoEssereAuto = !!regola && "auto" in regola;
  const effettivo =
    esplicito ?? (regola ? ("hex" in regola ? regola.hex : coloreAuto(regola.auto, sfondo)) : coloreAuto("testo", sfondo));
  const perSwatch = estraiHex(effettivo) ?? "#808080";
  const auto = puoEssereAuto && !esplicito;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", ...style }}>
      <input
        type="color"
        style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none", opacity: mixed ? 0.4 : 1 }}
        value={mixed ? "#808080" : perSwatch}
        title={auto ? t("props.colorAutoHint") : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        style={{ ...INPUT, flex: 1, minWidth: 0 }}
        placeholder={mixed ? t("props.mixedValues") : perSwatch}
        value={mixed || auto ? "" : (typeof valore === "string" ? valore : "")}
        title={auto ? t("props.colorAutoHint") : undefined}
        // Testo vuoto = «non impostato», **sempre**, non solo sui campi che
        // hanno un automatico. È l'unico gesto per togliere un colore, e
        // dev'essere lo stesso ovunque: prima i campi con un «assente» valido
        // (lo sfondo di un oggetto, quello dell'elenco allarmi) si svuotavano
        // ognuno col suo bottone, e solo alcuni ce l'avevano.
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
      {auto && (
        <span style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", flex: "none" }} title={t("props.colorAutoHint")}>
          {t("props.colorAuto")}
        </span>
      )}
      {puoEssereAuto && !auto && !mixed && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title={t("props.colorAutoReset")}
          style={{ ...INPUT, width: "auto", padding: "0 6px", cursor: "pointer", flex: "none" }}
        >↺</button>
      )}
    </div>
  );
}
