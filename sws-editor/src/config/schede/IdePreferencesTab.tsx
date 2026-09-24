import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { chiudiAiStream } from "@/ws/aiStream";
import type { AiConfig } from "@/types";
import { useAppStore } from "@/store";

// ── Preferenze IDE ───────────────────────────────────────────────────────────
//
// Impostazioni di *questo browser/editor*, non del progetto: mai salvate in
// project.yaml, sempre in localStorage (ThemeToggle/UiLangSelect già
// esistenti, prima sparse fra la tab "Stato" — sezione ASPETTO — e il menu
// utente 👤). Le altre impostazioni IDE-locali censite (URL runtime override,
// larghezze pannelli, stato cassetto log, righelli/guide canvas...) restano
// dove sono: la prima precede l'apertura di un progetto (va scelta prima di
// arrivare qui), le altre sono stato di layout effimero, non "preferenze" nel
// senso in cui si cercherebbero in un pannello di configurazione.

/**
 * Configurare l'assistente IA senza andare in una shell.
 *
 * Sta nella tab «IDE» e non in «Sistema» col TLS perché è dove si cercano le
 * impostazioni dell'ambiente di lavoro. Con una differenza dichiarata a schermo,
 * perché altrimenti inganna: tutto il resto di questa tab vive nel browser,
 * **questa vive nel runtime locale**.
 *
 * Le rotte esistono solo sull'istanza IDE: su un runtime con viewer rispondono
 * 404, e qui il 404 si tratta come «non si configura da questa macchina», non
 * come un errore da mostrare in rosso.
 */
export function AssistenteSection() {
  const { t } = useTranslation();
  const authRole = useAppStore((s) => s.authRole);
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [assente, setAssente] = useState(false);
  const [fornitore, setFornitore] = useState("kimi");
  const [modello, setModello] = useState("");
  const [chiave, setChiave] = useState("");
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = () => {
    api.getAiConfig()
      .then((c) => {
        setCfg(c);
        setAssente(false);
        if (c.fornitore) setFornitore(c.fornitore);
        setModello(c.modello ?? "");
      })
      .catch(() => setAssente(true));
  };
  useEffect(carica, []);

  // Doppia difesa sopra `require_admin`, come fa TlsSection.
  if (authRole !== "Admin") return null;

  // Un 404 dice che la rotta non c'è, non *perché*: oltre all'istanza che serve
  // un impianto (il gate `solo_ide`) la stessa risposta arriva da un runtime più
  // vecchio della funzione. Prima qui si affermava la prima causa come se fosse
  // l'unica. La modalità dichiarata sta nella scheda Stato → «Modalità», e nel
  // marcatore in testata: qui si dice solo ciò che il 404 dimostra.
  if (assente) {
    return (
      <Box titolo="Assistente IA">
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          Questa istanza non espone la configurazione dell&apos;assistente: si configura
          sull&apos;IDE di sviluppo, non da qui. Vedi Stato → «Modalità» per sapere quale
          ruolo sta servendo.
        </div>
      </Box>
    );
  }
  if (!cfg) return <Box titolo="Assistente IA"><div style={{ fontSize: 12 }}>…</div></Box>;

  const salva = async () => {
    setBusy(true); setEsito(null); setErrore(null);
    try {
      // La chiave si manda solo se l'utente ne ha scritta una: omettendola, il
      // server tiene quella salvata. È la convenzione della sentinella, e senza
      // di essa cambiare il modello cancellerebbe la chiave.
      const r = await api.putAiConfig(fornitore, modello.trim() || undefined,
                                     chiave.trim() || undefined);
      setChiave("");
      carica();
      if (r.riconnetti) {
        // Il pezzo che nessuno indovinerebbe: la chiave si legge **all'apertura
        // della sessione** WebSocket, non a ogni turno. Senza questa riga si
        // salva la chiave e la chat continua a dire che non è configurata.
        chiudiAiStream();
      }
      setEsito(r.configurato
        ? t("cfgUi.savedTheChatWillUse")
        : t("cfgUi.savedButTheKeyFor"));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancella = async () => {
    if (!confirm(t("cfg.deleteAiKeyConfirm", { fornitore }))) return;
    setBusy(true); setEsito(null); setErrore(null);
    try {
      const r = await api.deleteAiKey(fornitore);
      carica();
      chiudiAiStream();
      setEsito(r.cera ? t("cfgUi.keyDeleted") : t("cfgUi.thereWasNoKeyTo"));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const haChiave = cfg.chiavi[fornitore] === true;

  return (
    <Box titolo="Assistente IA">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 4,
          background: cfg.configurato ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)",
        }} />
        <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>
          {cfg.configurato
            ? `Attivo — ${cfg.fornitore} / ${cfg.modello}`
            : t("cfgUi.notConfiguredTheChatStays")}
        </span>
      </div>

      {cfg.da_ambiente.length > 0 && (
        <div style={{
          fontSize: 11, color: "var(--brand-warning, #f59e0b)", marginBottom: 10,
          lineHeight: 1.5,
        }}>
          ⚠ Queste variabili d&apos;ambiente <b>scavalcano</b> quanto imposti qui:{" "}
          {cfg.da_ambiente.join(", ")}. Per configurare dall&apos;IDE, avvia il runtime senza
          di esse.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {t("cfgUi.provider")}
          <select
            value={fornitore}
            onChange={(e) => {
              setFornitore(e.target.value);
              setModello(cfg.modelli_default[e.target.value] ?? "");
            }}
            style={{ ...campoIA, marginTop: 4 }}
          >
            <option value="anthropic">Anthropic{cfg.chiavi.anthropic ? t("cfgUi.keyPresent") : ""}</option>
            <option value="kimi">Kimi (Moonshot){cfg.chiavi.kimi ? t("cfgUi.keyPresent") : ""}</option>
          </select>
        </label>

        <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          Modello
          <input
            value={modello}
            placeholder={cfg.modelli_default[fornitore] ?? ""}
            onChange={(e) => setModello(e.target.value)}
            style={{ ...campoIA, marginTop: 4 }}
          />
          <span style={{ display: "block", marginTop: 2 }}>
            Campo libero di proposito: i fornitori aggiungono modelli più spesso di quanto
            rilasciamo noi. Vuoto = {cfg.modelli_default[fornitore]}.
          </span>
        </label>

        <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {t("cfgUi.apiKey")}
          <input
            type="password"
            value={chiave}
            placeholder={haChiave ? t("cfgUi.savedLeaveEmptyToKeep") : "sk-…"}
            onChange={(e) => setChiave(e.target.value)}
            style={{ ...campoIA, marginTop: 4 }}
          />
          <span style={{ display: "block", marginTop: 2 }}>
            {t("cfgUi.itNeverEntersTheProject")}
          </span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={salva} disabled={busy} style={bottoneIA}>{t("cfgUi.save")}</button>
        {haChiave && (
          <button onClick={cancella} disabled={busy} style={bottoneIArosso}>{t("cfgUi.deleteKey")}</button>
        )}
      </div>

      {esito && <div style={{ fontSize: 11, marginTop: 8, color: "var(--brand-success, #22c55e)" }}>{esito}</div>}
      {errore && <div style={{ fontSize: 11, marginTop: 8, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>}
    </Box>
  );
}

const campoIA: React.CSSProperties = {
  width: "100%", background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)", color: "#f1f5f9",
  borderRadius: 4, padding: "4px 7px", fontSize: 12,
};

const bottoneIA: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, cursor: "pointer", borderRadius: 4,
  color: "#f8fafc", background: "var(--brand-primary, #3b82f6)",
  border: "1px solid var(--brand-primary, #3b82f6)",
};

const bottoneIArosso: React.CSSProperties = {
  ...bottoneIA,
  background: "transparent",
  color: "var(--brand-danger, #ef4444)",
  border: "1px solid var(--brand-danger, #ef4444)",
};

/** Contenitore delle sezioni della tab IDE: stessa cornice delle due esistenti. */
function Box({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--brand-bg, #0f172a)",
      border: "1px solid var(--brand-surface, #1e293b)",
      borderRadius: 6, padding: "10px 14px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 8 }}>
        {titolo}
      </div>
      {children}
    </div>
  );
}

export function IdePreferencesTab() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.5 }}>
        {t("cfgUi.settingsOfThisEditorThey")}
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>Tema chiaro/scuro</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.systemFollowsTheBrowserPreferences")}</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>Lingua interfaccia</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.languageOfTheEditorS")}</div>
        </div>
        <UiLangSelect />
      </div>
      <AssistenteSection />
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        Nota: tema e lingua vivono in questo browser; la configurazione dell'assistente vive
        nel runtime locale, quindi vale per chiunque apra questo IDE.
      </div>
    </div>
  );
}
