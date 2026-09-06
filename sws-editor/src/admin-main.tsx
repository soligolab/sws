import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { setForceLocalApi } from "@/api/client";
import { applyBranding, loadBranding } from "@/branding";
import { applyAppearance, getStoredMode, initThemeStorageListener, initThemeSystemListener } from "@/theme";
import { useAppStore } from "@/store";
import { App } from "./App";

// Port 8444 — full IDE (project management + canvas editor + ConfigView).
// Force all API calls to same-origin so localStorage sws.runtimeBaseUrl is ignored.
setForceLocalApi(true);

// Load the active white-label brand (logo, palette, title, favicon) before the
// first paint, then apply the light/dark theme (neutrals + status tokens) on top
// of the brand accent, then render. Falls back to SWS on any error — see @/branding.
async function bootstrap() {
  applyBranding(await loadBranding());
  applyAppearance(getStoredMode());
  initThemeSystemListener(() => useAppStore.getState().themeMode);
  // Simmetrico alle finestre staccate: se il tema cambia in una di quelle, o in
  // una seconda scheda dell'IDE, questa lo segue. Il rimbalzo lo ferma
  // `modoApplicato` in theme.ts.
  initThemeStorageListener((mode) => useAppStore.setState({ themeMode: mode }));
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void bootstrap();
