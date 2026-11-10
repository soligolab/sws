// L'IDE aspetta il runtime che si riavvia (10-11-2026).
//
// Gemella della pagina «Il pannello si sta riavviando, riprovo…» del viewer
// (`pannello_in_riavvio`, 2f0b760b), ma con un testo dell'IDE e non di
// sistema: qui chi legge è chi progetta, nella lingua dell'interfaccia.
//
// Prima un runtime che non rispondeva al montaggio portava alla WelcomeScreen
// come se nessun progetto fosse aperto, e si doveva riaprirlo a mano. Il giro
// dei tentativi sta in `App.tsx`; qui la decisione e la schermata.

import { useTranslation } from "react-i18next";
import { NoProjectError, RuntimeUnavailableError } from "@/api/client";

/** Ogni quanto si riprova, come il viewer. */
export const RIPROVA_RUNTIME_MS = 2_000;

/** L'errore dell'apertura dice «il runtime si sta riavviando»?
 *
 *  - nessuna risposta, o il 502/504 di un proxy: sì;
 *  - un 503 in locale è «nessun progetto aperto»: no, si va alla WelcomeScreen;
 *  - un 503 **nel cloud** (`nelCloud`, sotto `/p/<azienda>/<progetto>/`): sì.
 *    Lì il container *è* il progetto e non lo chiude mai (`executeClose` in
 *    `App.tsx`); il 503 lo scrive il gateway mentre il container riparte
 *    («il progetto si sta riaprendo», `gateway/rotte.rs`), e la WelcomeScreen
 *    del container sarebbe vuota;
 *  - tutto il resto (401, 403 del cambio password…) ha la sua strada. */
export function runtimeSiStaRiavviando(e: unknown, nelCloud: boolean): boolean {
  if (e instanceof RuntimeUnavailableError) return true;
  return nelCloud && e instanceof NoProjectError;
}

export function RuntimeInRiavvio() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="runtime-in-riavvio"
      role="status"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
        textAlign: "center",
        fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
        color: "var(--brand-text, #e2e8f0)",
        background: "var(--brand-bg, #0f172a)",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600 }}>{t("app.runtimeInRiavvio")}</div>
      <div style={{ fontSize: 13, color: "var(--brand-text-subtle, #94a3b8)" }}>
        {t("app.runtimeInRiavvioHint")}
      </div>
    </div>
  );
}
