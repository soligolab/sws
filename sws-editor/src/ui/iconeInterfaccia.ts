// Le icone dell'interfaccia (28-10-2026, piano
// docs/plans/2026-10-26-aprire-sws-soligo-net.md, ramo B punto 3).
//
// Stessa famiglia delle icone degli strumenti (`editor/iconeStrumenti.ts`):
// tratto su viewBox 24×24, estremi arrotondati, colore dal tema
// (`currentColor`). Qui solo il contenuto dell'SVG, senza il tag esterno.
//
// **MODULO SEPARATO, e non una voce in più in `ICONE_STRUMENTI`.** Quella
// tabella è accoppiata alla palette da `scripts/check_icone_strumenti.sh`:
// aggiungerci «cartella» farebbe dire alla guardia «icona senza voce nella
// palette», che è vero e non è un difetto. Sono due famiglie con due regole.
//
// PERCHÉ ESISTONO
//
// Le due schermate che un nuovo arrivato vede per prime — accesso e scelta del
// progetto — erano fatte di **emoji letterali**: 📁 ⬆ ✓ ✕ ✎ 🗄 ▦ ☰ ⚑. Le
// disegna il sistema operativo, quindi cambiano da una macchina all'altra: su
// Windows sono a colori e grandi il doppio, su un pannello Yocto senza font
// emoji diventano rettangoli vuoti. Sono anche l'unico posto del prodotto dove
// il disegno non segue il tema.

/** Il contenuto SVG di ogni icona dell'interfaccia. */
export const ICONE_UI: Record<string, string> = {
  // ── progetti e cartelle ──
  progetto: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4L11 8.5h8.5A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  cartellaSu: '<path d="M4 18.5V7.5A1.5 1.5 0 0 1 5.5 6h4L12 8.5h6.5A1.5 1.5 0 0 1 20 10v8.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M12 17v-5M9.5 14.5L12 12l2.5 2.5"/>',
  archivio: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
  // ── viste ──
  griglia: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
  lista: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  // ── azioni ──
  matita: '<path d="M4 20l.8-3.6L15.4 5.8a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8L8.6 20.2 5 21z"/>',
  duplica: '<rect x="8.5" y="3.5" width="12" height="12" rx="2"/><path d="M15.5 19.5A1.5 1.5 0 0 1 14 21H5.5A1.5 1.5 0 0 1 4 19.5V8"/>',
  carica: '<path d="M12 16.5V4M8 8l4-4 4 4"/><path d="M4 15v4.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  piu: '<path d="M12 5v14M5 12h14"/>',
  conferma: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  chiudi: '<path d="M6 6l12 12M18 6L6 18"/>',
  // ── stati ──
  avviso: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  bandiera: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12.5l-2.5 4 2.5 4H5.5z"/>',
};

/** I nomi, per la guardia e per una tavola di prova. */
export const NOMI_ICONE_UI = Object.keys(ICONE_UI);
