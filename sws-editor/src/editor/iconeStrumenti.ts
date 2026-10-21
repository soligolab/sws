// Le icone degli strumenti (14-10-2026, piano
// docs/archive/2026-10-14-strumenti-simboli-comandi.md, ramo 1).
//
// Una famiglia sola, disegnata da noi: tratto su viewBox 24×24, estremi
// arrotondati, colore dal tema (`currentColor`). Fino a oggi metà del pannello
// erano emoji, disegnate dal sistema operativo e diverse da una macchina
// all'altra, e l'altra metà glifi Unicode; `data_log` e `text_list` avevano la
// stessa icona.
//
// Qui solo i dati (il contenuto dell'SVG, senza il tag esterno): li leggono il
// componente `IconaStrumento` e la tavola di prova, e la guardia
// `check_icone_strumenti.sh` controlla che ogni tipo della palette ne abbia una.

/** Il contenuto SVG di ogni icona, per tipo di oggetto (più `simboli`, il ramo). */
export const ICONE_STRUMENTI: Record<string, string> = {
  // ── forme ──
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  line: '<path d="M5 19L19 5"/>',
  polyline: '<path d="M3 17l5-7 4 4 4-8 5 6"/>',
  polygon: '<path d="M12 3.5l8 6-3 10H7l-3-10z"/>',
  // ── testo e immagini ──
  text: '<path d="M6 6h12M12 6v13M9 19h6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 8"/>',
  // ── comandi ──
  button: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M9 12h6"/>',
  checkbox: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  radio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
  slider: '<path d="M3 12h7.5M17.5 12H21"/><circle cx="14" cy="12" r="3.2"/>',
  setpoint: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  // ── navigazione e lingua ──
  // Una pagina e una freccia che esce: col rettangolo arrotondato del `button` le due si confondevano.
  navbutton: '<path d="M13 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H13"/><path d="M10 12h11M17.5 8.5L21 12l-3.5 3.5"/>',
  page_navigator: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9.5h18M8 5v4.5M13 5v4.5"/>',
  lang_selector: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  lang_button: '<path d="M5.5 21V3.5M5.5 4h12l-2.5 4.5 2.5 4.5h-12"/>',
  // ── indicatori ──
  // Pieno con i raggi: col cerchio esterno somigliava al `radio`.
  led: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  state_lamp: '<circle cx="12" cy="11" r="5"/><path d="M10 18.5h4M10.5 21h3M12 2.5v1.5M4.6 5.1l1.1 1.1M19.4 5.1l-1.1 1.1"/>',
  gauge: '<path d="M4 16.5a8 8 0 1 1 16 0"/><path d="M12 16.5l4.2-5"/><circle cx="12" cy="16.5" r="1.3" fill="currentColor" stroke="none"/>',
  progress_bar: '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M6 12h7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  kpi_tile: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h5M7 16l3-3 3 2 4-5"/>',
  // ── grafici ──
  trend: '<path d="M3.5 3.5v17h17"/><path d="M7 15l4-5 3.5 3 5-7"/>',
  sparkline: '<path d="M2.5 14l3.2-4.5 3 5 3.3-9 3 7.5 3-3.5 3.5 2"/>',
  xy_plot: '<path d="M3.5 3.5v17h17"/><circle cx="8" cy="15" r="1.3"/><circle cx="12" cy="9.5" r="1.3"/><circle cx="16" cy="13" r="1.3"/><circle cx="18" cy="6.5" r="1.3"/>',
  bar_chart: '<path d="M3 20.5h18"/><rect x="5" y="11" width="3" height="9.5"/><rect x="10.5" y="5.5" width="3" height="15"/><rect x="16" y="14" width="3" height="6.5"/>',
  pie_chart: '<path d="M11 4a8.5 8.5 0 1 0 9 9h-9z"/><path d="M14 2.8a8.5 8.5 0 0 1 7.2 7.2H14z"/>',
  // ── tabelle e registri ──
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9.5 9v11"/>',
  data_log: '<path d="M4 6h11M4 11h8M4 16h6"/><circle cx="17" cy="16" r="4"/><path d="M17 14v2.2l1.6 1"/>',
  text_list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
  recipe_panel: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9.5 4.5V3h5v1.5M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  // ── allarmi ──
  alarm_viewer: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.2M12 16.8h.01"/>',
  alarm_bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.8 2H4.2z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  alarm_banner: '<rect x="2" y="7.5" width="20" height="9" rx="1.5"/><path d="M7 9.8l2.2 4.2H4.8z"/><path d="M12.5 12h6"/>',
  alarm_history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 3.5v4h4"/><path d="M12 7.5V12l3 2"/>',
  // ── impianto ──
  symbol: '<path d="M4 7.5v9l8-4.5zM20 7.5v9l-8-4.5z"/><path d="M12 12V5.5M9 5.5h6"/>',
  pipe: '<path d="M3 8.5h10.5a4.5 4.5 0 0 1 4.5 4.5v8"/><path d="M3 14.5h8.5a1.5 1.5 0 0 1 1.5 1.5v5"/>',
  faceplate: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18"/><circle cx="8.5" cy="14" r="2.6"/><path d="M13.5 13h5M13.5 16h3.5"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>',
};

/** Il markup completo di un'icona, per chi non passa da React (tavola di prova). */
export function svgIcona(tipo: string, px: number, spessore = 1.75): string {
  const corpo = ICONE_STRUMENTI[tipo] ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${spessore}" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;
}
