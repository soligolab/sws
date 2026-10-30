/** Chiudere il proprio account (30-10-2026, ramo C di
 *  `docs/plans/2026-10-26-aprire-sws-soligo-net.md`). Solo per chi si è
 *  registrato da sé: fuori subito, cancellato fra 30 giorni, e la piattaforma
 *  lo può riattivare prima. La password conferma che a chiudere è davvero lui. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { campoAccesso, erroreAccesso, etichettaAccesso, pulsanteAccesso } from "@/components/schermataAccesso";

export function ChiudiAccount({ onAnnulla, onChiuso }: { onAnnulla: () => void; onChiuso: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const chiudi = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setOccupato(true);
    try {
      await api.chiudiAccount(password);
      onChiuso();
    } catch (err) {
      setErrore(t("accesso.chiudiErrore", { motivo: err instanceof Error ? err.message : String(err) }));
    } finally {
      setOccupato(false);
    }
  };

  const spento = occupato || password.length === 0;
  return (
    <div role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, background: "#0009", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <form onSubmit={chiudi}
        style={{
          display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 420, boxSizing: "border-box",
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
          borderRadius: 8, padding: 20, color: "var(--brand-text, #e2e8f0)",
        }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t("accesso.chiudiTitolo")}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--brand-text-2, #cbd5e1)" }}>{t("accesso.chiudiSpiegazione")}</div>
        <div>
          <label style={etichettaAccesso}>{t("accesso.chiudiPassword")}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus style={campoAccesso} />
        </div>
        {errore && <div style={erroreAccesso}>{errore}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" onClick={onAnnulla}
            style={{ ...pulsanteAccesso(false), background: "transparent", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", width: "auto" }}>
            {t("auth.annulla")}
          </button>
          <button type="submit" disabled={spento}
            style={{ ...pulsanteAccesso(spento), background: spento ? undefined : "var(--brand-danger, #dc2626)", width: "auto" }}>
            {t("accesso.chiudiConferma")}
          </button>
        </div>
      </form>
    </div>
  );
}
