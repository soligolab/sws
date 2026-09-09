// L'avvio comune delle quattro pagine dell'editor (viewer, IDE, chat staccata,
// log staccato): branding, tema, e il montaggio della radice React.
//
// Erano quattro file identici a meno del componente radice e di un flag —
// venti righe ciascuno che cambiavano insieme (revisione 2026-09-09).

import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { setForceLocalApi } from "@/api/client";
import { applyBranding, loadBranding } from "@/branding";
import { applyAppearance, getStoredMode, initThemeStorageListener, initThemeSystemListener } from "@/theme";
import { dimenticaPasswordLegacy } from "@/passwordNelBrowser";
import { useAppStore } from "@/store";

export async function avvia(Radice: React.ComponentType, opzioni: { apiLocale?: boolean } = {}): Promise<void> {
  // Le pagine dell'IDE parlano sempre con il runtime che le serve, anche se
  // l'editor è collegato a uno remoto: il remoto lo si raggiunge dal server.
  if (opzioni.apiLocale) setForceLocalApi(true);
  // Le versioni fino alla 2.6.6 lasciavano password in chiaro nel profilo del
  // browser: si tolgono prima di disegnare qualunque cosa.
  dimenticaPasswordLegacy();
  applyBranding(await loadBranding());
  applyAppearance(getStoredMode());
  initThemeSystemListener(() => useAppStore.getState().themeMode);
  initThemeStorageListener((mode) => useAppStore.setState({ themeMode: mode }));
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Radice />
    </React.StrictMode>,
  );
}
