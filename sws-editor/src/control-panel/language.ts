// The control panel speaks the project's content language (the language
// button of the viewer), not the UI language of the browser: on a device
// nobody ever picks a UI language, and that one defaults to English. Decision
// of the maintainer, 14-11-2026.
//
// A content language the UI has no words for falls back to English; with no
// project loaded yet (the pairing screen) the panel keeps the UI language.

import { useTranslation } from "react-i18next";
import { UI_LANGS } from "@/i18n";
import { effectiveProjectLang } from "@/i18n/projectI18n";
import { useAppStore } from "@/store";

export function panelLanguage(contentLang: string, uiLang: string): string {
  if (!contentLang) return uiLang;
  const base = contentLang.toLowerCase().split(/[-_]/)[0];
  return UI_LANGS.some((l) => l.code === base) ? base : "en";
}

export function usePanelTranslation() {
  const { i18n } = useTranslation();
  const table = useAppStore((s) => s.project?.languages);
  const projectLang = useAppStore((s) => s.projectLang);
  const lang = panelLanguage(effectiveProjectLang(table) || projectLang, i18n.language);
  return { t: i18n.getFixedT(lang), lang };
}
