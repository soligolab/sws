import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { LoginScreen } from "@/components/LoginScreen";
import { Aziende } from "./Aziende";
import { Persone } from "./Persone";
import { Marchi } from "./Marchi";
import { Posta } from "./Posta";
import { Installazione } from "./Installazione";

/**
 * La console di amministrazione della piattaforma.
 *
 * **Non è una schermata dell'IDE**, ed è una scelta con una ragione precisa
 * (decisione 44 del 06-10-2026): da qui si decide su quale versione gira ogni
 * azienda, e lo strumento che governa le versioni non può essere fissato a una
 * di esse. Oggi la serve il runtime dell'IDE, domani il gateway — e il fatto
 * che sia un'applicazione a sé è ciò che le permetterà di traslocare.
 *
 * Condivide con l'editor solo marchio, lingua e **sessione**: stessa origine,
 * stesso `localStorage["sws.auth"]`, quindi chi è già entrato nell'IDE si
 * ritrova dentro senza riautenticarsi.
 */
type Scheda = "aziende" | "marchi" | "persone" | "posta" | "installazione";

export function Console() {
  const { t } = useTranslation();
  const authToken = useAppStore((s) => s.authToken);
  const [scheda, setScheda] = useState<Scheda>("aziende");
  const [permesso, setPermesso] = useState<boolean | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Si chiede al server, non si deduce dal ruolo nel token: `role` è il ruolo
  // nel progetto, e amministrare la piattaforma è un asse diverso. L'unico
  // modo onesto di saperlo è provare una rotta della console e guardare se
  // risponde 403.
  const verifica = useCallback(() => {
    if (!authToken) return;
    setErrore(null);
    api.amministrazioneAziende()
      .then(() => setPermesso(true))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("403") || msg.toLowerCase().includes("amministratore")) {
          setPermesso(false);
        } else {
          setPermesso(false);
          setErrore(msg);
        }
      });
  }, [authToken]);

  useEffect(verifica, [verifica]);

  if (!authToken) return <LoginScreen />;

  if (permesso === null) {
    return <Centro>{t("console.verifica")}</Centro>;
  }

  if (!permesso) {
    return (
      <Centro>
        <strong style={{ fontSize: 16 }}>{t("console.nonPermesso")}</strong>
        <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>
          {t("console.nonPermessoSpiegazione")}
        </p>
        {errore && (
          <code style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{errore}</code>
        )}
      </Centro>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", color: "var(--brand-text, #e2e8f0)" }}>
      {/* Colonna a sinistra invece di una barra in alto (scelta del maintainer,
          06-10-2026): regge la crescita — posta, quote, pannelli, registro —
          ed è la stessa forma della Configurazione dell'IDE, che è già un
          albero a sinistra. */}
      <aside
        style={{
          width: 210, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: "1px solid var(--brand-surface-2, #334155)",
          background: "var(--brand-surface, #1e293b)",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
          <strong style={{ fontSize: 16, letterSpacing: 1 }}>SWS</strong>
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, marginTop: 2 }}>
            {t("console.titolo")}
          </div>
        </div>
        <nav style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {(["aziende", "marchi", "persone", "posta", "installazione"] as Scheda[]).map((s) => (
            <button
              key={s}
              onClick={() => setScheda(s)}
              style={{
                textAlign: "left",
                background: scheda === s ? "var(--brand-primary, #3b82f6)" : "transparent",
                color: scheda === s ? "var(--brand-on-primary, #fff)" : "var(--brand-text-muted, #94a3b8)",
                border: "none", borderRadius: 4, padding: "8px 12px",
                cursor: "pointer", fontSize: 13, fontWeight: scheda === s ? 600 : 400,
              }}
            >
              {t(`console.scheda.${s}`)}
            </button>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: 18, minWidth: 0 }}>
        {scheda === "aziende" && <Aziende />}
        {scheda === "marchi" && <Marchi />}
        {scheda === "persone" && <Persone />}
        {scheda === "posta" && <Posta />}
        {scheda === "installazione" && <Installazione />}
      </main>
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
        textAlign: "center", padding: 24,
      }}
    >
      {children}
    </div>
  );
}
