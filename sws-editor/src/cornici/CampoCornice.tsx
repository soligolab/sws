// La cornice predefinita del progetto, nella finestra «Impostazioni progetto»
// (piano dell'impostazione iniziale, 08-11-2026). È l'unico posto che la
// sceglie: la spunta «predefinita» nelle proprietà di una cornice e la proposta
// nel ramo Cornici (`PropostaCornice`, 18-10-2026) se ne sono andate, perché
// erano tre punti che scrivevano lo stesso campo (regola UI n. 2).
//
// Si sceglie fra «nessuna», le cornici che il progetto ha già e una nuova da
// uno dei modelli. La nuova nasce col formato predefinito del progetto, non con
// la misura della pagina aperta: la finestra parla del progetto.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { useNomePagina } from "@/i18n/nomePagina";
import { MODELLI_CORNICE, idCornice, pagineCornice, paginaACornice, type ModelloCornice } from "./modello";
import { impostaCornicePredefinita } from "./predefinita";

const NUOVA = "nuova:";

/** Crea una cornice dal modello, la salva e la rende la predefinita. Prima il
 *  file della cornice, poi la predefinita (03-11-2026): la predefinita va
 *  subito su `project.yaml`, e chi usciva senza salvare restava con un progetto
 *  che puntava a una cornice inesistente. La pagina aperta resta quella di
 *  prima: chi sta impostando il progetto non deve trovarsi su un'altra pagina. */
export async function creaCornicePredefinita(modello: ModelloCornice): Promise<void> {
  const st = useAppStore.getState();
  const prima = st.currentPageId;
  const l = st.project?.page_layout;
  const misura = l?.default_width && l?.default_height ? { width: l.default_width, height: l.default_height } : undefined;
  st.addCornice(modello, misura);
  const dopo = useAppStore.getState();
  const nuova = dopo.pages.find((p) => p.id === dopo.currentPageId);
  if (prima) dopo.setCurrentPage(prima);
  if (!nuova) return;
  await api.saveCornice(paginaACornice(nuova));
  await impostaCornicePredefinita(idCornice(nuova));
}

export function CampoCornice() {
  const { t } = useTranslation();
  const nomePagina = useNomePagina();
  const pages = useAppStore((s) => s.pages);
  const predefinita = useAppStore((s) => s.project?.page_layout?.cornice_predefinita);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const cornici = pagineCornice(pages);

  const scegli = async (valore: string) => {
    setErrore(null); setOccupato(true);
    try {
      if (valore.startsWith(NUOVA)) await creaCornicePredefinita(valore.slice(NUOVA.length) as ModelloCornice);
      else await impostaCornicePredefinita(valore || undefined);
    } catch (e) {
      setErrore(t("cornici.predefinitaFallita", { err: e instanceof Error ? e.message : String(e) }));
    } finally {
      setOccupato(false);
    }
  };

  return (
    <div data-testid="campo-cornice">
      <select data-testid="campo-cornice-scelta" value={predefinita ?? ""} disabled={occupato}
        onChange={(e) => void scegli(e.target.value)}
        style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
          borderRadius: 4, padding: "4px 8px", fontSize: 12, width: "100%", cursor: occupato ? "default" : "pointer" }}>
        <option value="">{t("cornici.nessunaPredefinita")}</option>
        {cornici.length > 0 && (
          <optgroup label={t("cornici.esistenti")}>
            {cornici.map((p) => <option key={p.id} value={idCornice(p)}>{nomePagina(p.name)}</option>)}
          </optgroup>
        )}
        <optgroup label={t("cornici.nuovaDaModello")}>
          {MODELLI_CORNICE.filter((m) => m !== "vuota").map((m) => (
            <option key={m} value={`${NUOVA}${m}`}>{t(`cornici.modello.${m}`)}</option>
          ))}
        </optgroup>
      </select>
      <p style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "4px 0 0" }}>{t("cornici.campoAiuto")}</p>
      {errore && <p style={{ fontSize: 10, color: "var(--brand-danger-soft, #f87171)", margin: "4px 0 0" }}>{errore}</p>}
    </div>
  );
}
