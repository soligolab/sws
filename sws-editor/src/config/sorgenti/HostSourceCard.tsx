import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { HOST_METRICS, definizioneMetrica, metricheSenzaParametro, senzaParametro, suggerimentiPer, type CatalogoHost, type ParametroHost } from "@/config/sorgenteHost";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type { HostMetric, HostMetricMapping, HostSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";

// ── Host (risorse di sistema) ─────────────────────────────────────────────────
// Metriche, parametri e catalogo stanno in `sorgenteHost.ts`, provabile da solo.

export function HostSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: HostSource;
  onChange: (s: HostSource) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  // Il catalogo — zone termiche, mount, interfacce — viene dal **dispositivo
  // connesso** se c'è, altrimenti da questa macchina, e la card dice quale.
  // Le zone del PC di chi disegna (`x86_pkg_temp`) non dicono niente su
  // quelle del pannello (`soc-thermal`): il 21-09-2026 due `temp` sono state
  // salvate senza zona proprio così, e i tag sono rimasti Bad in silenzio.
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const [catalogo, setCatalogo] = useState<CatalogoHost | null>(null);
  // «remoto-vecchio»: c'è un dispositivo connesso ma il suo runtime è anteriore
  // al 21-09-2026 e non ha la rotta — dire «nessun dispositivo» sarebbe falso,
  // e chi legge deve sapere che il rimedio è aggiornare il container.
  const [origineCatalogo, setOrigineCatalogo] = useState<"remoto" | "remoto-vecchio" | "locale" | "nessuno">("nessuno");
  useEffect(() => {
    let vivo = true;
    (async () => {
      let remotoFallito = false;
      if (remoteConnected) {
        try {
          const c = await api.remoteHostCatalog();
          if (vivo) { setCatalogo(c); setOrigineCatalogo("remoto"); }
          return;
        } catch { remotoFallito = true; }
      }
      try {
        const c = await api.hostCatalog();
        if (vivo) { setCatalogo(c); setOrigineCatalogo(remotoFallito ? "remoto-vecchio" : "locale"); }
      } catch {
        if (vivo) { setCatalogo(null); setOrigineCatalogo("nessuno"); }
      }
    })();
    return () => { vivo = false; };
  }, [remoteConnected, remoteUrl]);

  const upd = (patch: Partial<HostSource>) => onChange({ ...source, ...patch });
  const updM = (idx: number, patch: Partial<HostMetricMapping>) =>
    upd({ metrics: source.metrics.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const def = definizioneMetrica;
  const suggerimenti = (k: ParametroHost | undefined): string[] => suggerimentiPer(catalogo, k);
  const mancanti = metricheSenzaParametro(source);

  // `S.inputSm` e non uno stile locale (29-10-2026): quello di prima aveva il
  // bordo `--brand-surface-2`, invisibile nel tema chiaro.
  const campo: React.CSSProperties = { ...S.inputSm, width: "auto" };
  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  return (
    <div style={S.card}>
      {/* Senza stato in testata: la sorgente host legge la macchina su cui
          gira, non ha un altro capo che possa non rispondere. */}
      <TestataSorgente
        tipo="HOST"
        colore="var(--brand-primary-testo, #3b82f6)"
        id={source.id}
        riepilogo={t("cfgUi.hostMetricsCount", { n: source.metrics.length })}
        aperta={!collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
        senzaStato
      />
      {!collapsed && (
      <div style={{ padding: "0 16px 14px" }}>
      <SezioneSorgente titolo={t("sorgenti.sezioni.impostazioni")}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 240px", gap: 12, marginBottom: 8 }}>
          <div>
            <label style={etichetta}>Poll (ms)</label>
            <input type="number" value={source.poll_interval_ms} onChange={(e) => upd({ poll_interval_ms: Number(e.target.value) })} style={S.input} />
          </div>
          <div>
            <label style={etichetta}>{t("cfgUi.sourceId")}</label>
            <input value={source.id} onChange={(e) => upd({ id: e.target.value })} style={S.input} spellCheck={false} />
          </div>
        </div>
      </SezioneSorgente>

      <SezioneSorgente titolo={`${t("sorgenti.sezioni.metriche")} (${source.metrics.length})`}>
        <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfgUi.hostIntro")}</div>
        <div style={{ fontSize: 12, marginTop: 4, marginBottom: 8, color: origineCatalogo === "remoto" ? "var(--brand-success-soft, #4ade80)" : "var(--brand-warning-soft, #facc15)" }}>
          {origineCatalogo === "remoto" && t("cfgUi.hostCatalogoRemoto", { url: remoteUrl ?? "" })}
          {origineCatalogo === "remoto-vecchio" && t("cfgUi.hostCatalogoRemotoVecchio", { url: remoteUrl ?? "" })}
          {origineCatalogo === "locale" && t("cfgUi.hostCatalogoLocale")}
          {origineCatalogo === "nessuno" && t("cfgUi.hostCatalogoAssente")}
        </div>
        {mancanti > 0 && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "var(--brand-danger-soft, #f87171)" }}>
            ⚠ {t("cfgUi.hostSenzaParametro", { n: mancanti })}
          </div>
        )}
        {source.metrics.map((m, idx) => {
          const d = def(m.metric);
          const listId = `host-${source.id}-${idx}`;
          return (
            <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <TagInput value={m.tag} onChange={(v) => updM(idx, { tag: v })} placeholder={t("cfg.tagIdPh")} style={{ ...campo, width: 170 }} />
              <select value={m.metric} onChange={(e) => updM(idx, { metric: e.target.value as HostMetric, param: undefined })} style={campo}>
                {HOST_METRICS.map((x) => <option key={x.metric} value={x.metric}>{t(`cfgUi.hostMetric_${x.metric}`)}</option>)}
              </select>
              {d?.param && (
                <>
                  <input list={listId} value={m.param ?? ""} onChange={(e) => updM(idx, { param: e.target.value || undefined })}
                    placeholder={t(`cfgUi.hostParam_${d.param}`)}
                    title={senzaParametro(m) ? t("cfgUi.hostParamObbligatorio") : t(`cfgUi.hostParam_${d.param}`)}
                    aria-invalid={senzaParametro(m) || undefined}
                    style={{ ...campo, width: 170, ...(senzaParametro(m) ? { borderColor: "var(--brand-danger, #ef4444)" } : {}) }} />
                  <datalist id={listId}>{suggerimenti(d.param).map((v) => <option key={v} value={v} />)}</datalist>
                  {senzaParametro(m) && <span style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)" }}>{t("cfgUi.hostParamObbligatorio")}</span>}
                </>
              )}
              <button style={S.btnXs} title={t("cfg.createTag")}
                onClick={() => { if (m.tag) onCreateTag({ id: m.tag, data_type: d?.testo ? "string" : "float", unit: d?.unit, description: "", history: false }); }}>+var</button>
              <button style={S.btnXs} onClick={() => upd({ metrics: source.metrics.filter((_, i) => i !== idx) })}>✕</button>
            </div>
          );
        })}
        <button style={S.btn("ghost")} onClick={() => upd({ metrics: [...source.metrics, { tag: "", metric: "cpu_pct" }] })}>+ {t("cfgUi.hostMetric")}</button>
      </SezioneSorgente>
      </div>
      )}
    </div>
  );
}
