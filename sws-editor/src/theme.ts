// ── Tema chiaro/scuro ──────────────────────────────────────────────────────
//
// SWS usa 10 token semantici come CSS custom properties (--brand-*), introdotti
// dalla feature branding (vedi src/branding) e consumati in tutta la UI via
// `var(--brand-x, #fallback)`. Questo modulo estende quel backbone con un tema
// chiaro/scuro tri-stato.
//
// Principio: **il tema controlla i neutri e i colori di stato; il branding
// controlla l'accento (primary) e logo/favicon/titolo.** Entrambi scrivono le
// stesse CSS custom properties come PROPRIETÀ INLINE su :root (che vincono su
// qualsiasi regola CSS `:root[data-theme=…]`), quindi il tema va applicato con
// lo stesso meccanismo del branding, non con solo CSS.
//
// Eccezione decisa in OPEN_QUESTIONS Q12: un brand può fare override dei
// neutri per variante (`neutrals_dark`/`neutrals_light` in brand.json), campo
// per campo con fallback ai condivisi qui sotto.
//
// applyAppearance() va chiamato nel bootstrap (admin-main.tsx / main.tsx) DOPO
// applyBranding(), così i neutri del tema sovrascrivono quelli del brand mentre
// l'accento del brand resta. Lo stesso script pre-paint negli HTML imposta
// `data-theme` prima del primo paint per evitare il flash.

import { CSS_VARS, getBrand } from "@/branding";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "sws.theme";

// Nomi delle CSS custom properties introdotte dal tema (oltre ai --brand-*
// neutri/accento già definiti dal branding).
const VAR_TEXT_SUBTLE   = "--brand-text-subtle";
/** T-52: il colore del **tavolo** attorno al foglio, nel canvas dell'editor.
 *
 *  Sta qui e non in `BrandColors` di proposito: non è un colore di marca ma
 *  un'affordance di editing — dice «qui puoi lavorare, ma non è il foglio» —
 *  e un brand che lo ridefinisse potrebbe farlo coincidere col colore pagina,
 *  cancellando l'unica cosa che il token esiste per rendere visibile.
 *
 *  Perché non si riusa un token esistente: `--brand-bg` no, perché il wrapper
 *  del canvas non ha sfondo e il desk diventerebbe indistinguibile dalla
 *  chrome dell'app; `--brand-surface-2` no, perché in chiaro è `#f1f5f9`, cioè
 *  indistinguibile da una pagina bianca. */
const VAR_CANVAS_DESK   = "--brand-canvas-desk";
const VAR_DANGER        = "--brand-danger";
const VAR_DANGER_SOFT   = "--brand-danger-soft";
const VAR_DANGER_BG     = "--brand-danger-bg";
const VAR_SUCCESS       = "--brand-success";
const VAR_SUCCESS_SOFT  = "--brand-success-soft";
const VAR_SUCCESS_BG    = "--brand-success-bg";
const VAR_WARNING       = "--brand-warning";
const VAR_WARNING_SOFT  = "--brand-warning-soft";
const VAR_WARNING_BG    = "--brand-warning-bg";
// Colori di primo piano (testo/icone) leggibili sopra i fill accento/stato,
// calcolati per max-contrasto in applyAppearance().
const VAR_ON_PRIMARY    = "--brand-on-primary";
const VAR_ON_DANGER     = "--brand-on-danger";
const VAR_ON_SUCCESS    = "--brand-on-success";
const VAR_ON_WARNING    = "--brand-on-warning";

// I 7 neutri gestiti dal tema (l'accento primary/hover/on resta al branding).
interface Neutrals {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  text2: string;
  textMuted: string;
  textSubtle: string;
}

// Token di stato (allarmi, quality, feedback). *-soft = tinta per testo/hover,
// *-bg = sfondo tenue del badge/pannello.
interface StatusColors {
  danger: string;      dangerSoft: string;  dangerBg: string;
  success: string;     successSoft: string; successBg: string;
  warning: string;     warningSoft: string; warningBg: string;
}

// text-muted/text-subtle affinati per raggiungere WCAG AA (contrasto verificato
// su bg/surface/surface-2 in entrambi i temi).
//
// **Riverificato il 2026-09-06, misurando**: `textSubtle` non ci arrivava.
// Valeva `#8b9bb5` in scuro (3,68 su `surface2`) e `#6b7890` in chiaro (4,26 su
// `bg`, 4,07 su `surface2`) — sotto la soglia 4,5 di AA per il testo normale,
// mentre il commento qui sopra dichiarava il contrario. Ora `#9fb0c7` e
// `#5b6779`: il minimo sulle tre superfici passa da 3,68 a **4,69** in scuro e
// da 4,07 a **5,24** in chiaro. `textMuted` e `text2` erano già a posto
// (5,5 e 4,82 i minimi), e non si toccano.
const DARK_NEUTRALS: Neutrals = {
  bg: "#0f172a", surface: "#1e293b", surface2: "#334155", border: "#475569",
  text: "#e2e8f0", text2: "#cbd5e1", textMuted: "#a3b2c9", textSubtle: "#9fb0c7",
};

const LIGHT_NEUTRALS: Neutrals = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9", border: "#cbd5e1",
  text: "#0f172a", text2: "#334155", textMuted: "#576475", textSubtle: "#5b6779",
};

// Il tavolo del canvas (T-52). Fuori da `Neutrals` perché non lo si può
// sovrascrivere per brand: vedi il commento su `VAR_CANVAS_DESK`.
//
// In scuro è **più scuro** dello sfondo app (`#0f172a`), così il foglio
// galleggia sopra al tavolo invece di annegarci; in chiaro è un grigio da
// tavolo, distinguibile dal `#f8fafc` dell'app e da una pagina bianca.
const DARK_DESK  = "#0a0f1a";
const LIGHT_DESK = "#e2e8f0";

const DARK_STATUS: StatusColors = {
  danger: "#ef4444",  dangerSoft: "#fca5a5",  dangerBg: "#7f1d1d",
  // successSoft schiarito da #4ade80: su successBg dava 4,09, sotto AA.
  success: "#22c55e", successSoft: "#86efac", successBg: "#166534",
  warning: "#f59e0b", warningSoft: "#facc15", warningBg: "#78350f",
};

// In light le tinte base di success/warning sono scurite quanto basta perché
// restino leggibili anche usate come TESTO su superficie chiara (≥4.5:1).
const LIGHT_STATUS: StatusColors = {
  danger: "#dc2626",  dangerSoft: "#b91c1c",  dangerBg: "#fee2e2",
  success: "#15803d", successSoft: "#166534", successBg: "#dcfce7",
  warning: "#b45309", warningSoft: "#92400e", warningBg: "#fef3c7",
};

// ── Foreground leggibile su uno sfondo arbitrario ────────────────────────────
const DARK_INK  = "#0f172a";
const LIGHT_INK = "#f8fafc";

function relLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = relLuminance(a), lb = relLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
/** Testo (scuro o chiaro) col contrasto maggiore sopra `bg`. */
export function readableOn(bg: string): string {
  return contrast(LIGHT_INK, bg) >= contrast(DARK_INK, bg) ? LIGHT_INK : DARK_INK;
}

let mql: MediaQueryList | null = null;
function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  if (!mql) mql = window.matchMedia("(prefers-color-scheme: dark)");
  return mql.matches;
}

/** Modalità persistita; default "system". */
export function getStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore */ }
  return "system";
}

function storeMode(mode: ThemeMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

/** Risolve "system" in "light"/"dark" secondo la preferenza OS. */
export function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * Sceglie lo sfondo pagina giusto per il tema attivo. `backgroundDark` è
 * opzionale: se non impostato si ricade su `background`, così una pagina
 * salvata prima dell'introduzione di questo campo resta identica in
 * entrambi i temi invece di sparire in un colore non scelto da nessuno.
 */
export function resolvePageBackground(
  background: string | undefined,
  backgroundDark: string | undefined,
  mode: ThemeMode,
): string | undefined {
  return resolveMode(mode) === "dark" ? (backgroundDark || background) : background;
}

/** Luminanza relativa (WCAG) di un colore `#rgb`/`#rrggbb`, o `null` se non
 *  interpretabile — un colore che non si sa leggere non si può giudicare. */
export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Colore del testo predefinito degli oggetti di un sinottico, ricavato dallo
 *  SFONDO DELLA PAGINA e non dal tema dell'app (Q18, deciso 2026-08-25).
 *
 *  Il difetto che chiude: un oggetto senza `color` esplicito usava il token
 *  `--brand-text`, che segue il tema chiaro/scuro dell'applicazione, mentre lo
 *  sfondo della pagina lo sceglie il progettista. Con tema chiaro e pagina
 *  scura il testo era scuro su scuro — invisibile, e non per una svista del
 *  progettista ma per una combinazione che nessuno aveva messo alla prova.
 *
 *  Un sinottico è un disegno, non l'interfaccia di un sistema: i suoi colori
 *  devono seguire il foglio su cui è disegnato. Il tema dell'app resta per la
 *  chrome di IDE e viewer.
 *
 *  Sfondo assente o non interpretabile (un gradiente, un `var(...)`) → si
 *  ricade sul token di tema, cioè sul comportamento di prima: senza sapere
 *  cosa c'è sotto, indovinare sarebbe peggio.
 *
 *  Soglia a 0.5: sopra è chiaro, e per la luminanza relativa WCAG è il punto
 *  in cui il contrasto verso il bianco e verso il nero si equivale. */
export function defaultObjectTextColor(pageBackground: string | undefined): string {
  const lum = pageBackground ? relativeLuminance(pageBackground) : null;
  if (lum === null) return "var(--brand-text, #e2e8f0)";
  return lum > 0.5 ? "#0f172a" : "#e2e8f0";
}

/**
 * Applica il tema alla pagina: scrive i token neutri + stato come proprietà
 * inline su :root (l'accento resta quello del brand), imposta data-theme,
 * color-scheme e il meta theme-color, e persiste la preferenza.
 */
/** L'ultimo tema **applicato** in questo documento.
 *
 *  Serve a spezzare il rimbalzo fra finestre: `applyAppearance` persiste in
 *  `localStorage`, e la finestra che riceve un evento `storage` e riapplica
 *  finirebbe per riscrivere lo stesso valore, generando un evento nell'altra
 *  finestra, che riapplica, e così via. Con questo, il secondo passaggio è un
 *  no-op e il giro si ferma dopo un salto. */
let modoApplicato: ThemeMode | null = null;

export function applyAppearance(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveMode(mode);
  // Q12: un brand può fare override dei neutri per variante (brand.json →
  // neutrals_dark/neutrals_light), campo per campo con fallback ai condivisi.
  // I condivisi sono verificati WCAG AA; chi definisce un override risponde
  // del proprio contrasto.
  const brand = getBrand();
  const override = resolved === "light" ? brand.neutralsLight : brand.neutralsDark;
  const neutrals: Neutrals = {
    ...(resolved === "light" ? LIGHT_NEUTRALS : DARK_NEUTRALS),
    ...override,
  };
  const status   = resolved === "light" ? LIGHT_STATUS   : DARK_STATUS;
  const root = document.documentElement;
  const s = root.style;

  // Neutri (riusa i nomi var del branding per i 7 che coincidono).
  s.setProperty(CSS_VARS.bg,        neutrals.bg);
  s.setProperty(CSS_VARS.surface,   neutrals.surface);
  s.setProperty(CSS_VARS.surface2,  neutrals.surface2);
  s.setProperty(CSS_VARS.border,    neutrals.border);
  s.setProperty(CSS_VARS.text,      neutrals.text);
  s.setProperty(CSS_VARS.text2,     neutrals.text2);
  s.setProperty(CSS_VARS.textMuted, neutrals.textMuted);
  s.setProperty(VAR_TEXT_SUBTLE,    neutrals.textSubtle);
  s.setProperty(VAR_CANVAS_DESK,    resolved === "light" ? LIGHT_DESK : DARK_DESK);

  // Stato.
  s.setProperty(VAR_DANGER,       status.danger);
  s.setProperty(VAR_DANGER_SOFT,  status.dangerSoft);
  s.setProperty(VAR_DANGER_BG,    status.dangerBg);
  s.setProperty(VAR_SUCCESS,      status.success);
  s.setProperty(VAR_SUCCESS_SOFT, status.successSoft);
  s.setProperty(VAR_SUCCESS_BG,   status.successBg);
  s.setProperty(VAR_WARNING,      status.warning);
  s.setProperty(VAR_WARNING_SOFT, status.warningSoft);
  s.setProperty(VAR_WARNING_BG,   status.warningBg);

  // L'accento resta quello del brand: se non ancora impostato (chiamata prima
  // di applyBranding), riempi coi default del brand corrente.
  s.setProperty(CSS_VARS.primary,      brand.colors.primary);
  s.setProperty(CSS_VARS.primaryHover, brand.colors.primaryHover);

  // Foreground leggibile sopra i fill accento/stato: calcolato per max-contrasto
  // (ignora brand.onPrimary, che per alcuni brand — es. ACME verde — fallirebbe).
  s.setProperty(VAR_ON_PRIMARY, readableOn(brand.colors.primary));
  s.setProperty(VAR_ON_DANGER,  readableOn(status.danger));
  s.setProperty(VAR_ON_SUCCESS, readableOn(status.success));
  s.setProperty(VAR_ON_WARNING, readableOn(status.warning));

  root.setAttribute("data-theme", resolved);
  s.setProperty("color-scheme", resolved);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = neutrals.bg;

  storeMode(mode);
  modoApplicato = mode;
  return resolved;
}

/**
 * Riapplica automaticamente il tema quando cambia la preferenza OS, ma solo se
 * la modalità corrente è "system". `getMode` legge la modalità attuale (dallo
 * store) al momento del cambio.
 */
export function initThemeSystemListener(getMode: () => ThemeMode): void {
  if (typeof window === "undefined" || !window.matchMedia) return;
  if (!mql) mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (getMode() === "system") applyAppearance("system");
  });
}

/** Segue il tema scelto in **un'altra finestra** della stessa applicazione.
 *
 *  Le finestre staccate — il log e l'assistente — sono documenti a sé: montano,
 *  applicano il tema una volta e poi non ne sanno più niente. Cambiando tema
 *  dalla finestra principale restavano com'erano, segnalato dal maintainer il
 *  2026-09-06, e l'unico modo di allinearle era chiuderle e riaprirle.
 *
 *  L'evento `storage` è fatto per questo: il browser lo consegna a **tutti** i
 *  documenti della stessa origine **tranne** quello che ha scritto, quindi non
 *  serve nessun canale nostro e non c'è il rischio di rincorrersi fra finestre.
 *
 *  Vale anche al contrario: se si aggiungesse un selettore del tema nella
 *  finestra del log, la principale lo seguirebbe. */
export function initThemeStorageListener(onChange?: (mode: ThemeMode) => void): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const mode = e.newValue === "light" || e.newValue === "dark" || e.newValue === "system"
      ? e.newValue : "system";
    if (mode === modoApplicato) return;   // vedi `modoApplicato`: ferma il rimbalzo
    applyAppearance(mode);
    onChange?.(mode);
  });
}
