import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { paginaCentrata, schedaModulo } from "@/components/schermataAccesso";

/**
 * Primo accesso di un'installazione: non c'è ancora nessun utente, quindi non
 * c'è nessuno che possa fare login.
 *
 * **Perché chiede un codice.** Il codice si legge solo nei log del servizio,
 * cioè lo ha chi ha accesso alla macchina. Senza, chiunque trovasse questa
 * pagina su un'installazione appena accesa potrebbe prendersi
 * l'amministratore — è il buco classico degli strumenti appena installati, e
 * la ragione per cui Portainer fa esattamente la stessa cosa. È anche il
 * meccanismo che il pannello userà per il suo primo accesso (decisione CRA 4
 * del 05-10-2026: il codice di abbinamento mostrato sullo schermo).
 */
export function PrimoAmministratoreScreen({ onFatto }: { onFatto: () => void }) {
  const { t } = useTranslation();
  const [codice, setCodice] = useState("");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const passwordCorta = password.length > 0 && password.length < 8;
  const nonCombaciano = conferma.length > 0 && password !== conferma;
  const pronto =
    codice.trim() !== "" &&
    email.includes("@") &&
    password.length >= 8 &&
    password === conferma;

  const invia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pronto || inCorso) return;
    setErrore(null);
    setInCorso(true);
    try {
      await api.creaPrimoAmministratore(codice.trim(), email.trim(), nome.trim(), password);
      onFatto();
    } catch (e: unknown) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={paginaCentrata}>
      <form onSubmit={invia} style={schedaModulo(380)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: 20, letterSpacing: 1 }}>SWS</strong>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>
            {t("primoAccesso.titolo")}
          </span>
        </div>

        <p style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {t("primoAccesso.spiegazione")}
        </p>

        <Campo etichetta={t("primoAccesso.codice")}>
          <input
            value={codice}
            onChange={(e) => setCodice(e.target.value)}
            autoFocus
            spellCheck={false}
            style={{ ...input, fontFamily: "ui-monospace, monospace", letterSpacing: 0.5 }}
          />
        </Campo>

        <Campo etichetta={t("primoAccesso.email")}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            style={input}
          />
        </Campo>

        <Campo etichetta={t("primoAccesso.nome")}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={input} />
        </Campo>

        <Campo etichetta={t("primoAccesso.password")}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            style={input}
          />
        </Campo>

        <Campo etichetta={t("primoAccesso.ripetiPassword")}>
          <input
            type="password"
            value={conferma}
            onChange={(e) => setConferma(e.target.value)}
            autoComplete="new-password"
            style={input}
          />
        </Campo>

        {(passwordCorta || nonCombaciano || errore) && (
          <div
            style={{
              color: "var(--brand-danger-soft, #fca5a5)",
              fontSize: 12,
              background: "#7f1d1d33",
              padding: "6px 10px",
              borderRadius: 4,
              lineHeight: 1.4,
            }}
          >
            {errore ??
              (passwordCorta
                ? t("primoAccesso.passwordCorta")
                : t("primoAccesso.nonCombaciano"))}
          </div>
        )}

        <button
          type="submit"
          disabled={!pronto || inCorso}
          style={{
            background: !pronto
              ? "var(--brand-surface-2, #334155)"
              : inCorso
                ? "#1e3a8a"
                : "var(--brand-primary, #3b82f6)",
            color: !pronto ? "var(--brand-text-subtle, #64748b)" : "var(--brand-on-primary, #fff)",
            border: "none",
            borderRadius: 4,
            padding: "8px 12px",
            cursor: !pronto || inCorso ? "default" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {inCorso ? t("primoAccesso.creazione") : t("primoAccesso.crea")}
        </button>
      </form>
    </div>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          fontSize: 11,
          color: "var(--brand-text-muted, #94a3b8)",
          display: "block",
          marginBottom: 4,
        }}
      >
        {etichetta}
      </label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "7px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 14,
  boxSizing: "border-box",
};
