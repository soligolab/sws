// La ritenzione automatica dei datastore, in testa alla scheda Datastore (20-10-2026,
// piano docs/archive/2026-10-20-ritenzione-automatica.md).
//
// Tre cose sole: l'ora del giro notturno (nel progetto), lo stato di ogni datastore,
// e la conferma del primo giro con i numeri sotto gli occhi. La conferma è per
// datastore, e la chiede solo l'Admin (decisioni del maintainer). Con un dispositivo
// collegato si vede anche il suo stato: i numeri da confermare sono quelli del
// pannello che cancellerà, non quelli di questo PC.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { StatoRitenzione, StatoRitenzioneDatastore } from "@/types";

/** Byte leggibili: kB sotto il mega, MB sopra, nel formato della lingua. */
const peso = (b: number, lingua: string) => {
  const f = (n: number) => n.toLocaleString(lingua, { maximumFractionDigits: 1 });
  return b < 1024 * 1024 ? `${f(b / 1024)} kB` : `${f(b / 1024 / 1024)} MB`;
};

function Riga({ ds, remoto, onConferma, busy }: {
  ds: StatoRitenzioneDatastore;
  remoto: boolean;
  onConferma: (id: string, remoto: boolean) => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lingua = i18n.language;
  const limiti = [
    ds.retention_days != null ? t("ritenzione.giorni", { n: ds.retention_days }) : null,
    ds.retention_rows != null ? t("ritenzione.righe", { n: ds.retention_rows.toLocaleString(lingua) }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <div data-testid={`retention-${remoto ? "remote" : "local"}-${ds.id}`}
      style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12, padding: "3px 0" }}>
      <b>{ds.label || ds.id}</b>
      <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{limiti || t("ritenzione.senzaLimiti")}</span>
      {ds.stato === "attiva" && <span style={{ color: "var(--brand-success, #22c55e)" }}>✓ {t("ritenzione.attiva")}</span>}
      {ds.stato === "da_confermare" && (
        <>
          <span style={{ color: "var(--brand-warning, #eab308)" }}>
            ⚠ {ds.anteprima
              ? t("ritenzione.anteprima", {
                  righe: (ds.anteprima.righe_per_eta + ds.anteprima.righe_per_numero).toLocaleString(lingua),
                  totali: ds.anteprima.righe_totali.toLocaleString(lingua),
                  peso: ds.anteprima.byte_stimati != null ? peso(ds.anteprima.byte_stimati, lingua) : "?",
                })
              : ds.errore ?? t("ritenzione.daConfermare")}
          </span>
          <button onClick={() => onConferma(ds.id, remoto)} disabled={busy || !ds.anteprima}
            data-testid={`retention-confirm-${ds.id}`}
            style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>
            {t("ritenzione.conferma")}
          </button>
        </>
      )}
    </div>
  );
}

export function RitenzioneAutomatica() {
  const { t, i18n } = useTranslation();
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const isAdmin = useAppStore((s) => s.authRole) === "Admin";
  const [locale, setLocale] = useState<StatoRitenzione | null>(null);
  const [remoto, setRemoto] = useState<StatoRitenzione | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ora, setOra] = useState(project?.ritenzione_ora ?? "");

  useEffect(() => { setOra(project?.ritenzione_ora ?? ""); }, [project?.ritenzione_ora]);

  const ricarica = useCallback(async () => {
    if (!isAdmin) return;
    setErrore(null);
    try { setLocale(await api.statoRitenzione(false)); } catch (e) { setErrore(String(e instanceof Error ? e.message : e)); }
    if (remoteConnected) {
      try { setRemoto(await api.statoRitenzione(true)); } catch (e) { setRemoto(null); setErrore(String(e instanceof Error ? e.message : e)); }
    } else setRemoto(null);
  }, [isAdmin, remoteConnected]);

  // Una lettura al montaggio e quando cambiano i datastore: l'anteprima conta le righe,
  // quindi niente polling.
  useEffect(() => { void ricarica(); }, [ricarica, project?.datastores]);

  if (!isAdmin) return null;

  const conferma = async (id: string, suRemoto: boolean) => {
    const stato = (suRemoto ? remoto : locale)?.datastores.find((d) => d.id === id);
    const a = stato?.anteprima;
    const testo = t("ritenzione.confermaDomanda", {
      id,
      dove: suRemoto ? t("ritenzione.sulDispositivo") : t("ritenzione.qui"),
      righe: a ? (a.righe_per_eta + a.righe_per_numero).toLocaleString(i18n.language) : "?",
      peso: a?.byte_stimati != null ? peso(a.byte_stimati, i18n.language) : "?",
    });
    if (!window.confirm(testo)) return;
    setBusy(true);
    try {
      const nuovo = await api.confermaRitenzione(id, suRemoto);
      if (suRemoto) setRemoto(nuovo); else setLocale(nuovo);
    } catch (e) {
      setErrore(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const salvaOra = async () => {
    setBusy(true);
    setErrore(null);
    try {
      await api.updateRitenzioneOra(ora.trim() === "" ? null : ora.trim());
      useAppStore.getState().setProject(await api.getProject());
      await ricarica();
    } catch (e) {
      setErrore(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const configurati = (s: StatoRitenzione | null) => (s?.datastores ?? []).filter((d) => d.stato !== "non_configurata");

  return (
    <div data-testid="retention" style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t("ritenzione.titolo")}</div>
      <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8 }}>{t("ritenzione.spiega")}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 8 }}>
        {t("ritenzione.ora")}
        <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} placeholder="03:00"
          style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "2px 6px", fontSize: 12 }} />
        <button onClick={() => void salvaOra()} disabled={busy || ora === (project?.ritenzione_ora ?? "")}
          style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>
          {t("common.save")}
        </button>
        <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{t("ritenzione.oraVuota")}</span>
      </label>

      {remoteConnected && remoto && configurati(remoto).length > 0 && configurati(locale).length > 0 && (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("ritenzione.questaIstanza", { ora: locale?.ora ?? "03:00" })}</div>
      )}
      {configurati(locale).length === 0 && <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("ritenzione.nessunLimite")}</div>}
      {configurati(locale).map((d) => <Riga key={d.id} ds={d} remoto={false} onConferma={conferma} busy={busy} />)}

      {remoteConnected && remoto && configurati(remoto).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("ritenzione.dispositivoCollegato", { ora: remoto.ora })}</div>
          {configurati(remoto).map((d) => <Riga key={d.id} ds={d} remoto onConferma={conferma} busy={busy} />)}
        </div>
      )}
      {errore && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)", marginTop: 6 }}>✗ {errore}</div>}
    </div>
  );
}
