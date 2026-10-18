// La proposta di una cornice alla prima pagina di un progetto (piano delle
// cornici, 15-10-2026; fatta il 18-10-2026, programma delle funzioni utente,
// gruppo 1). Compare nel ramo Cornici quando il progetto ha pagine ma nessuna
// cornice: un modello crea la cornice e la rende la predefinita del progetto,
// «No, grazie» la toglie per sempre da questo progetto, in questo browser.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { MODELLI_CORNICE, idCornice, type ModelloCornice } from "./modello";
import { impostaCornicePredefinita } from "./predefinita";

const CHIAVE = (progetto: string) => `sws.cornice.proposta.${progetto}`;

export function propostaRifiutata(progetto: string): boolean {
  try { return localStorage.getItem(CHIAVE(progetto)) === "no"; } catch { return false; }
}

export function PropostaCornice({ progetto }: { progetto: string }) {
  const { t } = useTranslation();
  const addCornice = useAppStore((s) => s.addCornice);
  const [rifiutata, setRifiutata] = useState(() => propostaRifiutata(progetto));
  const [errore, setErrore] = useState<string | null>(null);
  if (rifiutata) return null;

  const scegli = (m: ModelloCornice) => {
    addCornice(m);
    // `addCornice` apre la cornice appena creata: è la pagina corrente.
    const st = useAppStore.getState();
    const nuova = st.pages.find((p) => p.id === st.currentPageId);
    if (!nuova) return;
    impostaCornicePredefinita(idCornice(nuova)).catch((e) => setErrore(e?.message ?? String(e)));
  };
  const rifiuta = () => {
    try { localStorage.setItem(CHIAVE(progetto), "no"); } catch { /* niente memoria: si richiederà */ }
    setRifiutata(true);
  };

  return (
    <div data-testid="proposta-cornice" style={{
      margin: "4px 8px", padding: 8, borderRadius: 6, fontSize: 11,
      border: "1px dashed var(--brand-accent, #3b82f6)", color: "var(--brand-text-muted, #94a3b8)",
    }}>
      <div style={{ marginBottom: 6 }}>{t("cornici.proposta.testo")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {MODELLI_CORNICE.filter((m) => m !== "vuota").map((m) => (
          <button key={m} type="button" data-testid={`proposta-cornice-${m}`} onClick={() => scegli(m)}
            style={{ textAlign: "left", fontSize: 11, cursor: "pointer" }}>
            {t(`cornici.modello.${m}`)}
          </button>
        ))}
        <button type="button" data-testid="proposta-cornice-no" onClick={rifiuta}
          style={{ textAlign: "left", fontSize: 11, cursor: "pointer", opacity: 0.8 }}>
          {t("cornici.proposta.no")}
        </button>
      </div>
      {errore && <div style={{ color: "var(--brand-danger, #ef4444)", marginTop: 4 }}>{errore}</div>}
    </div>
  );
}
