// Entry point della finestra staccata dei log.
//
// Gemello di `admin-main.tsx`, e l'ordine delle chiamate conta: vedi il
// commento su `setForceLocalApi`.

import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { setForceLocalApi } from "@/api/client";
import { applyBranding, loadBranding } from "@/branding";
import { applyAppearance, getStoredMode, initThemeStorageListener, initThemeSystemListener } from "@/theme";
import { useAppStore } from "@/store";
import { LogWindow } from "@/components/LogWindow";

// **Per primo, e non è un dettaglio di stile.** `_forceLocalApi` è una
// variabile di modulo (`api/client.ts`), quindi in questa finestra riparte da
// `false`: senza questa riga la finestra onorerebbe `localStorage
// sws.runtimeBaseUrl` e potrebbe mostrare i log di un runtime **diverso** da
// quello dell'editor da cui è stata aperta, senza dirlo.
setForceLocalApi(true);

async function bootstrap() {
  applyBranding(await loadBranding());
  applyAppearance(getStoredMode());
  initThemeSystemListener(() => useAppStore.getState().themeMode);
  // Questa è una finestra a sé: senza questo, il tema scelto nella finestra
  // principale non arriva mai qui e l'unico modo di allinearla è chiuderla.
  // Si aggiorna anche lo store, o i componenti che leggono `themeMode` — le
  // tinte della palette, per dirne una — resterebbero indietro rispetto ai
  // token CSS appena riapplicati.
  initThemeStorageListener((mode) => useAppStore.setState({ themeMode: mode }));
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <LogWindow />
    </React.StrictMode>,
  );
}
void bootstrap();
