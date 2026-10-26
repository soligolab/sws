// Le scorciatoie da tastiera dell'IDE, in un registro solo (18-10-2026, gruppo 4
// del programma delle funzioni utente; seme `2026-09-25-scorciatoie-da-tastiera`).
//
// Prima erano dieci ascoltatori `keydown` che confrontavano `e.key` con lettere
// scritte a mano, e la guida `?` era un secondo elenco che nessuno teneva
// allineato. Ora: ogni azione ha qui il suo id, il gruppo e la combinazione
// predefinita; gli ascoltatori chiedono `azioneDi(e)`; la guida e la scheda delle
// preferenze leggono da qui. Le combinazioni cambiate dall'utente vivono in questo
// browser (`localStorage`, come tema e lingua): decisione del maintainer.
//
// Restano fuori dal registro, perché non sono una combinazione ma un gesto: le
// frecce (spostano di 1 px, con Maiusc di un passo di griglia), Esc nei modali,
// rotellina e trascinamento del canvas.

export type ContestoScorciatoia = "globale" | "editor";

export interface AzioneScorciatoia {
  id: string;
  gruppo: "file" | "modifica" | "selezione" | "ordine" | "navigazione" | "aiuto";
  predefinita: string;
  contesto: ContestoScorciatoia;
  /** La descrizione, chiave del catalogo i18n. */
  testo: string;
}

export const AZIONI: readonly AzioneScorciatoia[] = [
  { id: "salva", gruppo: "file", predefinita: "Mod+S", contesto: "globale", testo: "scorciatoie.salva" },
  { id: "editorConfigurazione", gruppo: "navigazione", predefinita: "Mod+,", contesto: "globale", testo: "scorciatoie.editorConfigurazione" },
  { id: "cercaOvunque", gruppo: "navigazione", predefinita: "Mod+K", contesto: "globale", testo: "scorciatoie.cercaOvunque" },
  { id: "paginaSuccessiva", gruppo: "navigazione", predefinita: "Alt+PageDown", contesto: "editor", testo: "scorciatoie.paginaSuccessiva" },
  { id: "paginaPrecedente", gruppo: "navigazione", predefinita: "Alt+PageUp", contesto: "editor", testo: "scorciatoie.paginaPrecedente" },
  { id: "annulla", gruppo: "modifica", predefinita: "Mod+Z", contesto: "editor", testo: "shortcut.undo" },
  { id: "ripeti", gruppo: "modifica", predefinita: "Mod+Y", contesto: "editor", testo: "shortcut.redo" },
  { id: "ripetiAlt", gruppo: "modifica", predefinita: "Mod+Shift+Z", contesto: "editor", testo: "shortcut.redo" },
  { id: "copia", gruppo: "modifica", predefinita: "Mod+C", contesto: "editor", testo: "shortcut.copy" },
  { id: "taglia", gruppo: "modifica", predefinita: "Mod+X", contesto: "editor", testo: "shortcut.cut" },
  { id: "incolla", gruppo: "modifica", predefinita: "Mod+V", contesto: "editor", testo: "shortcut.paste" },
  { id: "duplica", gruppo: "modifica", predefinita: "Mod+D", contesto: "editor", testo: "shortcut.duplicate" },
  { id: "elimina", gruppo: "modifica", predefinita: "Delete", contesto: "editor", testo: "shortcut.deleteSel" },
  { id: "eliminaAlt", gruppo: "modifica", predefinita: "Backspace", contesto: "editor", testo: "shortcut.deleteSel" },
  { id: "selezionaTutto", gruppo: "selezione", predefinita: "Mod+A", contesto: "editor", testo: "shortcut.selectAll" },
  { id: "raggruppa", gruppo: "selezione", predefinita: "Mod+G", contesto: "editor", testo: "shortcut.group" },
  { id: "avanti", gruppo: "ordine", predefinita: "Mod+]", contesto: "editor", testo: "shortcut.bringForward" },
  { id: "inPrimoPiano", gruppo: "ordine", predefinita: "Mod+Shift+]", contesto: "editor", testo: "shortcut.bringFront" },
  { id: "indietro", gruppo: "ordine", predefinita: "Mod+[", contesto: "editor", testo: "shortcut.sendBackward" },
  { id: "inFondo", gruppo: "ordine", predefinita: "Mod+Shift+[", contesto: "editor", testo: "shortcut.sendBack" },
  { id: "guida", gruppo: "aiuto", predefinita: "?", contesto: "editor", testo: "shortcut.toggleHelp" },
];

/** Combinazioni che il browser non restituisce alla pagina: inutile proporle. */
export const RISERVATE = new Set(["Mod+W", "Mod+T", "Mod+N", "Mod+Q", "Mod+Shift+W", "Mod+Shift+T", "Mod+Shift+N", "Mod+Tab", "Mod+PageUp", "Mod+PageDown"]);

const CHIAVE = "sws.scorciatoie";

/** I tasti che la combinazione non nomina da soli: i modificatori. */
const SOLO_MODIFICATORI = new Set(["Control", "Meta", "Shift", "Alt", "AltGraph", "OS"]);

/** La combinazione di un evento, nella forma del registro: `Mod+Shift+Z`.
 *
 *  - `Mod` è Ctrl o ⌘: sul Mac si usa ⌘ dove altrove si usa Ctrl;
 *  - le lettere sono maiuscole, e Maiusc si scrive esplicitamente;
 *  - per un simbolo stampabile (`?`, `,`) Maiusc **non** si scrive: è già nel
 *    carattere, e su tastiere diverse sta su tasti diversi;
 *  - le parentesi quadre si leggono dal tasto fisico (`e.code`): con Maiusc
 *    `]` diventa `}`, e su una tastiera italiana sta su AltGr.
 *  `null` per un tasto solo modificatore. */
export function combinazioneDi(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (SOLO_MODIFICATORI.has(e.key)) return null;
  let tasto = e.key;
  if (e.code === "BracketRight") tasto = "]";
  else if (e.code === "BracketLeft") tasto = "[";
  const lettera = /^[a-z]$/i.test(tasto);
  if (lettera) tasto = tasto.toUpperCase();
  const simbolo = tasto.length === 1 && !lettera && !/^[0-9]$/.test(tasto) && tasto !== "]" && tasto !== "[";
  const parti: string[] = [];
  if (e.ctrlKey || e.metaKey) parti.push("Mod");
  if (e.altKey) parti.push("Alt");
  if (e.shiftKey && !simbolo) parti.push("Shift");
  parti.push(tasto === " " ? "Space" : tasto);
  return parti.join("+");
}

export type Personalizzate = Record<string, string>;

export function leggiPersonalizzate(): Personalizzate {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function salvaPersonalizzate(p: Personalizzate): void {
  try { localStorage.setItem(CHIAVE, JSON.stringify(p)); } catch { /* finestra privata */ }
  try { window.dispatchEvent(new CustomEvent("sws:scorciatoie")); } catch { /* test */ }
}

/** La combinazione in uso per un'azione. */
export function combinazione(id: string, p: Personalizzate = leggiPersonalizzate()): string {
  return p[id] ?? AZIONI.find((a) => a.id === id)?.predefinita ?? "";
}

/** L'azione di un evento nel contesto dato. Le azioni globali valgono ovunque. */
export function azioneDi(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  contesto: ContestoScorciatoia,
  p: Personalizzate = leggiPersonalizzate(),
): string | null {
  const c = combinazioneDi(e);
  if (!c) return null;
  const a = AZIONI.find((x) => (x.contesto === contesto || x.contesto === "globale") && combinazione(x.id, p) === c);
  return a?.id ?? null;
}

/** Le azioni che usano già `combo`, tranne `escluso`: un conflitto da dire. */
export function conflittiDi(combo: string, escluso: string, p: Personalizzate = leggiPersonalizzate()): string[] {
  return AZIONI.filter((a) => a.id !== escluso && combinazione(a.id, p) === combo).map((a) => a.id);
}

/** Come si mostra: `Mod` diventa Ctrl, o ⌘ sul Mac. */
export function mostra(combo: string, mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)): string {
  return combo.split("+").map((p) => (p === "Mod" ? (mac ? "⌘" : "Ctrl") : p === "Shift" ? (mac ? "⇧" : "Shift") : p)).join("+");
}

/** Le righe delle combinazioni, per gruppo: le azioni con la stessa descrizione
 *  (Ctrl+Y e Ctrl+Shift+Z) stanno su una riga sola. */
export function righeDalRegistro(p: Personalizzate = leggiPersonalizzate()): [string, string][] {
  const righe: [string, string][] = [];
  let gruppo = "";
  const viste = new Map<string, number>();
  for (const a of AZIONI) {
    if (a.gruppo !== gruppo) {
      gruppo = a.gruppo;
      righe.push([`scorciatoie.gruppo.${gruppo}`, ""]);
    }
    const c = combinazione(a.id, p);
    if (!c) continue;
    const k = `${gruppo}/${a.testo}`;
    const i = viste.get(k);
    if (i !== undefined) {
      righe[i] = [`${righe[i][0]} / ${mostra(c)}`, a.testo];
    } else {
      viste.set(k, righe.length);
      righe.push([mostra(c), a.testo]);
    }
  }
  return righe;
}
