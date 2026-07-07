import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { applyBranding, loadBranding } from "@/branding";
import { applyAppearance, getStoredMode, initThemeSystemListener } from "@/theme";
import { useAppStore } from "@/store";
import { RuntimeViewer } from "./viewer/RuntimeViewer";

// Port 8443 — runtime synoptic viewer (operator/anonymous).
// No project management, no canvas editor.
// Load the active white-label brand before the first paint, then apply the
// light/dark theme on top, then render.
async function bootstrap() {
  applyBranding(await loadBranding());
  applyAppearance(getStoredMode());
  initThemeSystemListener(() => useAppStore.getState().themeMode);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RuntimeViewer />
    </React.StrictMode>,
  );
}
void bootstrap();
