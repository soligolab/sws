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
const DARK_NEUTRALS: Neutrals = {
  bg: "#0f172a", surface: "#1e293b", surface2: "#334155", border: "#475569",
  text: "#e2e8f0", text2: "#cbd5e1", textMuted: "#a3b2c9", textSubtle: "#8b9bb5",
};

const LIGHT_NEUTRALS: Neutrals = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9", border: "#cbd5e1",
  text: "#0f172a", text2: "#334155", textMuted: "#576475", textSubtle: "#6b7890",
};

const DARK_STATUS: StatusColors = {
  danger: "#ef4444",  dangerSoft: "#fca5a5",  dangerBg: "#7f1d1d",
  success: "#22c55e", successSoft: "#4ade80", successBg: "#166534",
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
 * Applica il tema alla pagina: scrive i token neutri + stato come proprietà
 * inline su :root (l'accento resta quello del brand), imposta data-theme,
 * color-scheme e il meta theme-color, e persiste la preferenza.
 */
export function applyAppearance(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveMode(mode);
  const neutrals = resolved === "light" ? LIGHT_NEUTRALS : DARK_NEUTRALS;
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
  const brand = getBrand();
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
