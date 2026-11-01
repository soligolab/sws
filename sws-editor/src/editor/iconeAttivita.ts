// Le icone delle barre di attività (31-10-2026, piano
// docs/plans/2026-10-31-ide-stile-vscode.md): la disposizione «Stile VS Code»
// ha una colonna di icone per lato, e a differenza di VS Code — richiesta del
// maintainer — sono colorate, una tinta per voce.
//
// Stesso formato di `iconeStrumenti.ts`: il contenuto dell'SVG su viewBox
// 24×24, a tratto, colore da `currentColor`. Il colore di ogni voce ha due
// varianti, una per tema, e il tema le scrive come variabili CSS
// (`--sws-att-<voce>`, in `applyAppearance`): così una barra non sa niente di
// chiaro e scuro. Ogni variante tiene un contrasto di almeno 3:1 con la
// superficie del suo tema (WCAG 1.4.11, elementi grafici): lo prova
// `barraAttivita.test.tsx`.

/** Il contenuto SVG di ogni voce. */
export const ICONE_ATTIVITA: Record<string, string> = {
  // ── sinistra: disegno ──
  cerca: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  pagine: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  strumenti: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M9 8V5h6v3"/><path d="M3 13h18"/><path d="M11 13v2h2v-2"/>',
  oggetti: '<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5" opacity=".55"/>',
  // ── sinistra: dati e logica ──
  tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8 8z"/><circle cx="8" cy="8.5" r="1.6"/>',
  comunicazione: '<path d="M8 3v5M16 3v5"/><path d="M5.5 8h13v3a6.5 6.5 0 0 1-13 0z"/><path d="M12 17.5V21"/>',
  allarmi: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  logica: '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/><path d="M13.5 4l-3 16"/>',
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M9.5 17.5v-3M12.5 17.5v-6M15.5 17.5v-4"/>',
  // ── sinistra: in fondo ──
  utenti: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 13.8a6.5 6.5 0 0 1 3.5 6.2"/>',
  dispositivo: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  progetto: '<path d="M3 6.5h6.5l2 2H21V19H3z"/>',
  preferenze: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  // ── destra: i rami del pannello proprietà (tre dal 01-11-2026) ──
  funzione: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="9" r="2" fill="var(--sws-att-fondo)"/><circle cx="12" cy="15" r="2" fill="var(--sws-att-fondo)"/><circle cx="19" cy="7" r="2" fill="var(--sws-att-fondo)"/>',
  aspetto: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.8-1.6-.8-2.5 1-1.5 2.3-1.5H18a3 3 0 0 0 3-3c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="10.5" cy="7" r="1.3"/><circle cx="15" cy="7.5" r="1.3"/>',
  comportamento: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  pagina: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  selezione: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.6"/><path d="M9 9h6v6H9z"/>',
};

/** Il colore di ogni voce: [tema scuro, tema chiaro]. */
export const COLORI_ATTIVITA: Record<string, readonly [string, string]> = {
  cerca: ["#38bdf8", "#0369a1"],
  pagine: ["#60a5fa", "#1d4ed8"],
  strumenti: ["#fbbf24", "#b45309"],
  oggetti: ["#a78bfa", "#6d28d9"],
  tag: ["#34d399", "#047857"],
  comunicazione: ["#22d3ee", "#0e7490"],
  allarmi: ["#f87171", "#b91c1c"],
  logica: ["#a3e635", "#4d7c0f"],
  report: ["#fb923c", "#c2410c"],
  utenti: ["#f472b6", "#be185d"],
  dispositivo: ["#2dd4bf", "#0f766e"],
  progetto: ["#818cf8", "#4338ca"],
  preferenze: ["#94a3b8", "#475569"],
  funzione: ["#fb923c", "#c2410c"],
  aspetto: ["#f472b6", "#be185d"],
  comportamento: ["#fde047", "#a16207"],
  pagina: ["#60a5fa", "#1d4ed8"],
  selezione: ["#a78bfa", "#6d28d9"],
};

/** Il nome della variabile CSS del colore di una voce. */
export const varAttivita = (voce: string) => `--sws-att-${voce}`;
