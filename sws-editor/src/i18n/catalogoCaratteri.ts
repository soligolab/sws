// Catalogo curato di caratteri speciali per i campi di testo (T-71).
//
// Non una tastiera Unicode libera: un utente inesperto vuole scrivere "🏠"
// senza importare un'immagine, non navigare un blocco Unicode. Il catalogo
// resta piccolo apposta e raggruppato per uso (stati, allarmi, energia,
// misure), non per blocco — coerente con la richiesta del maintainer.
//
// Ogni voce qui è garantita disegnabile su **entrambi** i motori: DejaVu
// Sans copre i simboli del Piano Multilingue di Base (☀ ⚙), e da T-71 anche
// LVGL ha Noto Emoji agganciato come fallback per le emoji vere (vedi
// `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_font.rs`) — quindi niente
// avviso "non si vede su LVGL" per voce: se non ci fosse la garanzia, la
// voce semplicemente non sarebbe qui.
//
// Punto di partenza: i 18 emoji già misurati nei template il 16-09-2026
// (🌀🌙🌡🍳🎨🏠💡💧📈🔋🔌🔍🔐🔒🗂🤖🦟🪟) più i simboli BMP già in uso da prima
// di T-71 (☀ ⚡ ⚠ ⚙).

export interface CategoriaCaratteri {
  id: string;
  label: string;
  caratteri: string[];
}

export const CATALOGO_CARATTERI: CategoriaCaratteri[] = [
  { id: "energia", label: "Energia", caratteri: ["⚡", "🔋", "💡", "🔌"] },
  { id: "allarmi", label: "Allarmi e sicurezza", caratteri: ["⚠", "🔐", "🔒"] },
  { id: "stati", label: "Stati e impianto", caratteri: ["🏠", "🗂", "🪟", "🤖", "🌀"] },
  { id: "misure", label: "Misure e grafici", caratteri: ["🌡", "📈", "🔍", "💧"] },
  { id: "altro", label: "Altro", caratteri: ["☀", "⚙", "🌙", "🍳", "🎨", "🦟"] },
];

/** Elenco piatto, per chi deve solo controllare se un carattere è nel catalogo. */
export const TUTTI_I_CARATTERI: string[] = CATALOGO_CARATTERI.flatMap((c) => c.caratteri);
