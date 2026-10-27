/** Istanza → Prestazioni (26-10-2026, piano
 *  `docs/archive/2026-10-26-dove-se-ne-va-il-tempo.md`).
 *
 *  Dove se ne va il tempo: i lavori di questa istanza e, con un pannello
 *  collegato, quelli del pannello — runtime e viewer LVGL. Due colonne come
 *  Certificati, perché le due macchine sono due cose diverse.
 *
 *  **Guardarla accende il viewer**: ogni lettura rinnova la richiesta per un
 *  minuto, e finché c'è il viewer manda le fasi del suo fotogramma. Chiusa la
 *  pagina, entro un minuto il viewer torna zitto. */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, SOGLIE_PRESTAZIONI_MS, type Prestazioni, type VocePrestazioni } from "@/api/client";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { etichettaDispositivo } from "@/ws/remoteLogStream";

const SCATOLA: CSSProperties = {
  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)",
  borderRadius: 6, padding: "10px 14px", marginBottom: 12,
};
const TITOLO: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 6,
};
const NOTA: CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.4 };
const NUMERO: CSSProperties = { ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** Un fotogramma a 60 al secondo: la misura di tutte le barre del viewer. */
const FOTOGRAMMA_MS = 16;

/** Il 95° percentile per eccesso, come `Voce::p95_ms` in `sws-core`. */
export function p95(v: VocePrestazioni): number {
  if (v.n === 0) return 0;
  const soglia = Math.ceil(v.n * 0.95);
  let visti = 0;
  for (let i = 0; i < v.secchi.length; i++) {
    visti += v.secchi[i];
    if (visti >= soglia) return Math.min(SOGLIE_PRESTAZIONI_MS[i] ?? v.max_ms, v.max_ms);
  }
  return v.max_ms;
}

const ms = (x: number) => (x >= 10 ? x.toFixed(0) : x.toFixed(x >= 1 ? 1 : 2));

export function PrestazioniTab() {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const host = etichettaDispositivo(remoteUrl, []);
  return (
    <div style={S.page}>
      <div style={S.body}>
        <p style={{ ...NOTA, fontSize: 12, marginTop: 0 }}>{t("prestazioni.intro")}</p>
        <div style={{ display: "grid", gridTemplateColumns: remoteConnected ? "1fr 1fr" : "1fr", gap: 16 }}>
          <ColonnaPrestazioni remoto={false} titolo={t("prestazioni.questaIstanza")} />
          {remoteConnected && <ColonnaPrestazioni remoto titolo={t("prestazioni.dispositivo", { host })} />}
        </div>
      </div>
    </div>
  );
}

export function ColonnaPrestazioni({ remoto, titolo }: { remoto: boolean; titolo: string }) {
  const [dati, setDati] = useState<Prestazioni | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const leggi = () => {
      api.prestazioni(remoto)
        .then((d) => { if (vivo) { setDati(d); setErrore(null); } })
        .catch((e: unknown) => { if (vivo) setErrore(e instanceof Error ? e.message : String(e)); });
    };
    leggi();
    const id = setInterval(leggi, 2000);
    return () => { vivo = false; clearInterval(id); };
  }, [remoto]);

  return (
    <div data-testid={remoto ? "colonna-remota" : "colonna-locale"}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{titolo}</div>
      {errore && <div style={{ ...NOTA, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>}
      {dati && <Viewer dati={dati} />}
      {dati && <Runtime dati={dati} />}
    </div>
  );
}

function Viewer({ dati }: { dati: Prestazioni }) {
  const { t } = useTranslation();
  const v = dati.viewer;
  if (!v) {
    return (
      <div style={SCATOLA}>
        <div style={TITOLO}>{t("prestazioni.viewer")}</div>
        <div style={NOTA}>{t("prestazioni.viewerAssente")}</div>
      </div>
    );
  }
  const giro = v.voci.find((x) => x.nome === "giro");
  const fotogrammi = giro?.n ?? 0;
  const fps = v.intervallo_s > 0 ? fotogrammi / v.intervallo_s : 0;
  // Per fotogramma: quanto pesa ogni fase in media su un fotogramma, anche le
  // fasi che non scattano a ogni giro (un canvas che si ridisegna ogni tanto).
  const righe = v.voci.filter((x) => x.nome !== "giro");
  return (
    <div style={SCATOLA}>
      <div style={TITOLO}>{t("prestazioni.viewer")}</div>
      <div style={{ fontSize: 13, marginBottom: 6 }} data-testid="fps">
        {t("prestazioni.fps", { fps: fps.toFixed(0), giro: giro ? ms(giro.somma_ms / Math.max(1, giro.n)) : "—" })}
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>{t("prestazioni.fase")}</th>
            <th style={S.th}>{t("prestazioni.perFotogramma")}</th>
            <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.volte")}</th>
            <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.media")}</th>
            <th style={{ ...S.th, textAlign: "right" }}>p95</th>
            <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.massimo")}</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((x) => {
            const perFotogramma = fotogrammi > 0 ? x.somma_ms / fotogrammi : 0;
            const quota = Math.min(1, perFotogramma / FOTOGRAMMA_MS);
            return (
              <tr key={x.nome} data-testid={`fase-${x.nome}`}>
                <td style={S.td} title={x.nome}>{t(`prestazioni.fasi.${x.nome}`, { defaultValue: x.nome })}</td>
                <td style={{ ...S.td, minWidth: 120 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 8, background: "var(--brand-surface, #1e293b)", borderRadius: 4 }}>
                      <div style={{ width: `${quota * 100}%`, height: 8, borderRadius: 4,
                        background: quota > 0.5 ? "var(--brand-warning, #f59e0b)" : "var(--brand-primary, #3b82f6)" }} />
                    </div>
                    <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{ms(perFotogramma)} ms</span>
                  </div>
                </td>
                <td style={NUMERO}>{x.n}</td>
                <td style={NUMERO}>{ms(x.somma_ms / Math.max(1, x.n))}</td>
                <td style={NUMERO}>{ms(p95(x))}</td>
                <td style={NUMERO}>{ms(x.max_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ ...NOTA, marginTop: 6 }}>{t("prestazioni.viewerNota")}</div>
    </div>
  );
}

function Runtime({ dati }: { dati: Prestazioni }) {
  const { t } = useTranslation();
  const r = dati.runtime;
  return (
    <div style={SCATOLA}>
      <div style={TITOLO}>{t("prestazioni.runtime")}</div>
      {r.voci.length === 0 ? (
        <div style={NOTA}>{t("prestazioni.runtimeVuoto")}</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>{t("prestazioni.lavoro")}</th>
              <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.alSecondo")}</th>
              <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.media")}</th>
              <th style={{ ...S.th, textAlign: "right" }}>p95</th>
              <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.massimo")}</th>
              <th style={{ ...S.th, textAlign: "right" }}>{t("prestazioni.occupato")}</th>
            </tr>
          </thead>
          <tbody>
            {r.voci.map((x) => (
              <tr key={x.nome} data-testid={`lavoro-${x.nome}`}>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{x.nome}</td>
                <td style={NUMERO}>{r.intervallo_s > 0 ? (x.n / r.intervallo_s).toFixed(1) : "—"}</td>
                <td style={NUMERO}>{ms(x.somma_ms / Math.max(1, x.n))}</td>
                <td style={NUMERO}>{ms(p95(x))}</td>
                <td style={NUMERO}>{ms(x.max_ms)}</td>
                <td style={NUMERO}>{r.intervallo_s > 0 ? `${((x.somma_ms / (r.intervallo_s * 1000)) * 100).toFixed(1)} %` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ ...NOTA, marginTop: 6 }}>{t("prestazioni.runtimeNota")}</div>
    </div>
  );
}
