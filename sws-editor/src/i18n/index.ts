import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import it from "./it.json";
import en from "./en.json";

// UI language (chrome dell'IDE e del viewer) — asse INDIPENDENTE dalla lingua
// dei contenuti di progetto (tabella lingue, vedi src/i18n/projectI18n.ts).
// Base/source = italiano; fallback = inglese.

const STORAGE_KEY = "sws.uiLang";

export interface UiLang { code: string; label: string }
export const UI_LANGS: UiLang[] = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
];

function initialLang(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UI_LANGS.some((l) => l.code === stored)) return stored;
  } catch { /* ignore */ }
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "it";
  return UI_LANGS.some((l) => l.code === nav) ? nav : "it";
}

i18n.use(initReactI18next).init({
  lng: initialLang(),
  fallbackLng: "en",
  resources: { it: { translation: it }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/** Cambia la lingua UI e la persiste. */
export function setUiLang(code: string): void {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  void i18n.changeLanguage(code);
}

export function getUiLang(): string { return i18n.language; }

export default i18n;
