// La prova di un commit vecchio, detta in cima all'IDE (piano
// `docs/archive/2026-09-26-gestore-repository-progetto.md`, Fase 2). In cima e
// non solo nella scheda Git perché il blocco vale ovunque: finché la prova
// dura il runtime rifiuta ogni salvataggio del progetto (409 dal filtro
// `blocca_in_prova`), e chi modifica un sinottico deve sapere perché.
//
// Uscire ricarica la pagina: l'editor tiene il progetto in memoria, e dopo un
// checkout la sola cosa vera è il disco.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { ProvaInfo } from "@/types";
import { useAppStore } from "@/store";

export function BannerProvaGit({ stileBottone }: { stileBottone: React.CSSProperties }) {
  const { t } = useTranslation();
  const nomeProgetto = useAppStore((s) => s.project?.meta.name);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const [prova, setProva] = useState<ProvaInfo | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!nomeProgetto) { setProva(null); return; }
    // Un progetto senza repository risponde 404: nessuna prova, niente da dire.
    api.getGitStatus().then((g) => setProva(g.prova ?? null)).catch(() => setProva(null));
  }, [nomeProgetto]);

  if (!prova) return null;

  const agisci = async (azione: () => Promise<unknown>) => {
    setOccupato(true);
    setErrore(null);
    try {
      await azione();
      window.location.reload();
    } catch (e: any) {
      setErrore(String(e?.message ?? e));
      setOccupato(false);
    }
  };

  const data = new Date(prova.date).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  const bottone: React.CSSProperties = { ...stileBottone, background: "#4c1d95", borderColor: "#7c3aed", color: "#ede9fe" };

  return (
    <div data-testid="banner-prova-git" style={{
      background: "#2e1065", borderBottom: "1px solid #7c3aed", padding: "6px 16px",
      display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#ede9fe", flexShrink: 0, flexWrap: "wrap",
    }}>
      <span>🧪</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        {t("gitProva.banner", { short: prova.short, data, message: prova.message, ramo: prova.ramo })}
        {errore && <span style={{ display: "block", color: "#fca5a5", marginTop: 2 }}>{errore}</span>}
      </span>
      <button type="button" style={bottone} disabled={occupato} onClick={() => navigateToConfig("git")}>
        {t("gitProva.storia")}
      </button>
      <button
        type="button" style={bottone} disabled={occupato}
        onClick={() => { if (window.confirm(t("gitProva.confermaRiparti", { short: prova.short, ramo: prova.ramo }))) void agisci(() => api.gitProvaRiparti()); }}
      >
        {t("gitProva.riparti")}
      </button>
      <button type="button" style={{ ...bottone, background: "#7c3aed" }} disabled={occupato} onClick={() => void agisci(() => api.gitProvaEsci())}>
        {t("gitProva.torna")}
      </button>
    </div>
  );
}
