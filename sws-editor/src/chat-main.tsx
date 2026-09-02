// Entry point della finestra staccata della chat.
//
// Gemello di `log-main.tsx`, e l'ordine delle chiamate conta: vedi il commento
// su `setForceLocalApi`.

import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { setForceLocalApi } from "@/api/client";
import { applyBranding, loadBranding } from "@/branding";
import { applyAppearance, getStoredMode, initThemeSystemListener } from "@/theme";
import { useAppStore } from "@/store";
import { ChatWindow } from "@/components/ChatWindow";

// **Per primo, e non è un dettaglio di stile.** `_forceLocalApi` è una variabile
// di modulo (`api/client.ts`), quindi in questa finestra riparte da `false`:
// senza questa riga onorerebbe `localStorage sws.runtimeBaseUrl` e potrebbe
// chiedere il diff — o applicare — a un runtime **diverso** da quello
// dell'editor da cui è stata aperta, senza dirlo.
setForceLocalApi(true);

async function bootstrap() {
  applyBranding(await loadBranding());
  applyAppearance(getStoredMode());
  initThemeSystemListener(() => useAppStore.getState().themeMode);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ChatWindow />
    </React.StrictMode>,
  );
}
void bootstrap();
