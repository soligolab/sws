/** Sicurezza → Certificati (25-10-2026): tutti gli archivi di certificati e
 *  impronte di un'istanza in un posto solo.
 *
 *  Decisioni del maintainer (piano `docs/archive/2026-10-15-certificati-in-un-posto-solo.md`):
 *  - **3** — una scheda, due colonne: «questa istanza» e, con un pannello
 *    collegato, «dispositivo connesso». Gli archivi stanno nella cartella di chi
 *    gira, quindi lo stesso schermo mostrerebbe cose diverse a seconda di dove
 *    si guarda: affiancati, non si confondono;
 *  - **4** — l'archivio del viewer LVGL si vede (in sola lettura) grazie al
 *    quadlet 7; con un quadlet più vecchio la riga lo dice;
 *  - **8** — le righe morte del pinning (porte non più in uso) si mostrano, col
 *    loro «Dimentica».
 *
 *  Ogni colonna parla col suo lato con funzioni esplicite (`remoto`), non con
 *  `suImpianto`: altrimenti, con un pannello collegato, tutte e due
 *  guarderebbero il pannello. */
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type ArchivioImpronte, type CertificatoFile, type DettagliCertificato, type InventarioCertificati } from "@/api/client";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { TlsSection } from "@/config/schede/SystemTab";

const SCATOLA: CSSProperties = {
  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)",
  borderRadius: 6, padding: "10px 14px", marginBottom: 12,
};
const TITOLO: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 6,
};
const NOTA: CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.4 };

/** `sha256:abcd…` → le prime 16 cifre, a gruppi di quattro: quanto basta per
 *  confrontarla con quella sullo schermo del pannello. */
export function impronteBreve(i: string): string {
  const hex = i.replace(/^sha256:/, "");
  return (hex.slice(0, 16).match(/.{1,4}/g) ?? []).join(" ") + (hex.length > 16 ? " …" : "");
}

const data = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString() : "—");

export function CertificatiTab() {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const host = (() => { try { return remoteUrl ? new URL(remoteUrl).host : ""; } catch { return remoteUrl ?? ""; } })();
  return (
    <div style={S.page}>
      <div style={S.body}>
        <p style={{ ...NOTA, fontSize: 12, marginTop: 0 }}>{t("certificati.intro")}</p>
        <div style={{ display: "grid", gridTemplateColumns: remoteConnected ? "1fr 1fr" : "1fr", gap: 16 }}>
          <ColonnaCertificati remoto={false} titolo={t("certificati.questaIstanza")} />
          {remoteConnected && <ColonnaCertificati remoto titolo={t("certificati.dispositivo", { host })} />}
        </div>
      </div>
    </div>
  );
}

function ColonnaCertificati({ remoto, titolo }: { remoto: boolean; titolo: string }) {
  const { t } = useTranslation();
  const [inv, setInv] = useState<InventarioCertificati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = () => {
    setErrore(null);
    api.certificati(remoto).then(setInv).catch((e: unknown) => setErrore(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => { setInv(null); carica(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [remoto]);

  const fai = async (azione: () => Promise<unknown>, conferma?: string) => {
    if (conferma && !window.confirm(conferma)) return;
    try { await azione(); carica(); } catch (e: unknown) { setErrore(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div data-testid={remoto ? "colonna-dispositivo" : "colonna-istanza"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ ...TITOLO, marginBottom: 0, color: remoto ? "var(--brand-primary, #3b82f6)" : TITOLO.color }}>{titolo}</span>
        <button style={S.btn("ghost")} onClick={carica}>{t("certificati.aggiorna")}</button>
      </div>
      {errore && <div style={{ color: "var(--brand-danger-soft, #f87171)", fontSize: 12, marginBottom: 8 }}>{errore}</div>}

      <TlsSection remoto={remoto} />
      {inv?.tls && <div style={{ ...SCATOLA, marginTop: 8 }}><Dettagli d={inv.tls} /></div>}

      {inv && (
        <>
          <Impronte titolo={t("certificati.dispositivi")} spiega={t("certificati.dispositiviSpiega")} a={inv.dispositivi}
            dimentica={(k) => fai(() => api.dimenticaImpronta(remoto, "dispositivi", k), t("certificati.dimenticaConferma", { chiave: k }))} />
          <Impronte titolo={t("certificati.mqtt")} spiega={t("certificati.mqttSpiega")} a={inv.mqtt}
            dimentica={(k) => fai(() => api.dimenticaImpronta(remoto, "mqtt", k), t("certificati.dimenticaConferma", { chiave: k }))} />
          <Impronte titolo={t("certificati.viewer")} spiega={inv.viewer_lvgl.disponibile ? t("certificati.viewerSpiega") : t("certificati.viewerAssente")}
            a={inv.viewer_lvgl} />

          <Sezione titolo={t("certificati.opcuaClient")}>
            {inv.opcua_client.length === 0 && <div style={NOTA}>{t("certificati.opcuaNessuna")}</div>}
            {inv.opcua_client.map((p) => (
              <div key={p.sorgente} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 4 }}>{p.sorgente}</div>
                <TabellaPki righe={p.certificati}
                  fidati={(f) => fai(() => api.fidatiCertificatoOpcUa(remoto, p.sorgente, f))}
                  elimina={(f) => fai(() => api.eliminaCertificatoOpcUa(remoto, p.sorgente, f), t("certificati.eliminaConferma", { file: f }))} />
              </div>
            ))}
          </Sezione>

          <Sezione titolo={t("certificati.opcuaServer")}>
            {inv.opcua_server ? <TabellaPki righe={inv.opcua_server} /> : <div style={NOTA}>{t("certificati.opcuaServerAssente")}</div>}
          </Sezione>

          <Sezione titolo={t("certificati.ssh")}>
            <div style={NOTA}>{t("certificati.sshChiave")}: {inv.ssh.chiave_progetto ?? "—"}</div>
            <div style={{ ...NOTA, marginTop: 4 }}>known_hosts: {inv.ssh.known_hosts.length === 0 ? "—" : ""}</div>
            {inv.ssh.known_hosts.map((h) => (
              <div key={h} style={{ fontSize: 11, fontFamily: "monospace", color: "var(--brand-text-muted, #94a3b8)" }}>{h}</div>
            ))}
          </Sezione>
        </>
      )}
    </div>
  );
}

function Sezione({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <div style={SCATOLA}>
      <div style={TITOLO}>{titolo}</div>
      {children}
    </div>
  );
}

function Dettagli({ d }: { d: DettagliCertificato }) {
  const { t } = useTranslation();
  const scaduto = d.valido_al_ms > 0 && d.valido_al_ms < Date.now();
  return (
    <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.5 }}>
      <div>{t("certificati.soggetto")}: <span style={{ color: "var(--brand-text, #e2e8f0)" }}>{d.soggetto || "—"}</span></div>
      <div>{t("certificati.emittente")}: {d.emittente || "—"}</div>
      {d.nomi.length > 0 && <div>{t("certificati.nomi")}: {d.nomi.join(", ")}</div>}
      <div style={{ color: scaduto ? "var(--brand-danger-soft, #f87171)" : undefined }}>
        {t("certificati.valido", { dal: data(d.valido_dal_ms), al: data(d.valido_al_ms) })}
      </div>
      <div style={{ fontFamily: "monospace" }}>{impronteBreve(d.impronta)}</div>
    </div>
  );
}

function Impronte({ titolo, spiega, a, dimentica }: {
  titolo: string; spiega: string; a: ArchivioImpronte; dimentica?: (chiave: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sezione titolo={titolo}>
      <div style={{ ...NOTA, marginBottom: 6 }}>{spiega}</div>
      {a.disponibile && (a.righe.length === 0
        ? <div style={NOTA}>{t("certificati.vuoto")}</div>
        : (
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>{t("certificati.chiave")}</th>
              <th style={S.th}>{t("certificati.impronta")}</th>
              <th style={S.th}>{t("certificati.vistoIl")}</th>
              {dimentica && <th style={S.th} />}
            </tr></thead>
            <tbody>
              {a.righe.map((r) => (
                <tr key={r.chiave}>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{r.chiave}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{impronteBreve(r.impronta)}</td>
                  <td style={S.td}>{data(r.visto_il_ms)}</td>
                  {dimentica && (
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button style={S.btnXs} onClick={() => dimentica(r.chiave)}>{t("certificati.dimentica")}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </Sezione>
  );
}

function TabellaPki({ righe, fidati, elimina }: {
  righe: CertificatoFile[]; fidati?: (file: string) => void; elimina?: (file: string) => void;
}) {
  const { t } = useTranslation();
  if (righe.length === 0) return <div style={NOTA}>{t("certificati.vuoto")}</div>;
  return (
    <table style={S.table}>
      <thead><tr>
        <th style={S.th}>{t("certificati.file")}</th>
        <th style={S.th}>{t("certificati.stato")}</th>
        <th style={S.th}>{t("certificati.soggetto")}</th>
        <th style={S.th}>{t("certificati.scade")}</th>
        {(fidati || elimina) && <th style={S.th} />}
      </tr></thead>
      <tbody>
        {righe.map((c) => (
          <tr key={`${c.stato}/${c.file}`}>
            <td style={{ ...S.td, fontFamily: "monospace", wordBreak: "break-all" }}>{c.file}</td>
            <td style={S.td}>{c.stato === "trusted" ? "TRUSTED" : c.stato === "rejected" ? "REJECTED" : t("certificati.proprio")}</td>
            <td style={S.td}>{c.dettagli?.soggetto ?? "—"}</td>
            <td style={S.td}>{c.dettagli ? data(c.dettagli.valido_al_ms) : "—"}</td>
            {(fidati || elimina) && (
              <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                {fidati && c.stato === "rejected" && <button style={S.btnXs} onClick={() => fidati(c.file)}>{t("certificati.fidati")}</button>}
                {elimina && c.stato !== "own" && <button style={{ ...S.btnXs, marginLeft: 4 }} onClick={() => elimina(c.file)}>×</button>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
