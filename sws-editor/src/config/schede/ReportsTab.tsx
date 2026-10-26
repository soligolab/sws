/** Configurazione → Progetto → Report (P3, 26-10-2026; piano
 *  `docs/plans/2026-10-26-report-programmati.md`).
 *
 *  A sinistra i report del progetto, a destra quello scelto: periodo, quando,
 *  tag, formati, destinatari. Sotto, i file già generati e «Genera ora».
 *
 *  **Chi genera**: il pannello, dove gira l'impianto. Nell'IDE e nel cloud lo
 *  storico non c'è, quindi file e «Genera ora» parlano col pannello collegato
 *  (`remoto`); senza pannello si vedono solo le definizioni. */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { ReportDef, ReportElenco } from "@/types";
import { S, SaveBar } from "@/config/comuni";
import { useAppStore } from "@/store";
import { TagInput } from "@/components/TagInput";
import { DestinatariEmail } from "@/config/DestinatariEmail";

const PERIODI = ["turno", "giorno", "settimana", "mese"] as const;
const CRON_PREDEFINITO: Record<(typeof PERIODI)[number], string> = {
  turno: "0 6,14,22 * * *", giorno: "0 6 * * *", settimana: "0 6 * * 1", mese: "0 6 1 * *",
};
const ETICHETTA = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

function nuovo(esistenti: ReportDef[]): ReportDef {
  let n = esistenti.length + 1;
  while (esistenti.some((r) => r.id === `report_${n}`)) n++;
  return { id: `report_${n}`, periodo: "giorno", tags: [] };
}

export function ReportsTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const markSaveOk = useAppStore((s) => s.markSaveOk);
  const [reports, setReports] = useState<ReportDef[]>(() => project?.reports ?? []);
  const [scelto, setScelto] = useState(0);
  const [toccato, setToccato] = useState(false);
  const [elenco, setElenco] = useState<ReportElenco[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const [nuovoTag, setNuovoTag] = useState("");

  useEffect(() => { setReports(project?.reports ?? []); }, [project]);

  // Con un pannello collegato i file sono i suoi; senza, quelli di questa
  // istanza (che li genera solo se è lei a far girare l'impianto).
  const carica = () => {
    api.reports(remoteConnected).then(setElenco).catch(() => setElenco(null));
  };
  useEffect(carica, [remoteConnected]);

  const cur = reports[scelto] ?? null;
  const cambia = (patch: Partial<ReportDef>) => {
    setToccato(true);
    setReports((prev) => prev.map((r, i) => (i === scelto ? { ...r, ...patch } : r)));
  };

  async function salva() {
    await api.saveReports(reports);
    useAppStore.setState((s) => (s.project ? { project: { ...s.project, reports } } : {}));
    markSaveOk();
    setToccato(false);
  }

  const fileDi = (id: string) => elenco?.find((r) => r.id === id)?.file ?? [];
  const generaOra = async (id: string) => {
    setLavoro(true);
    setMsg(null);
    try {
      const f = await api.generaReport(remoteConnected, id);
      setMsg(t("reportTab.generati", { n: f.length }));
      carica();
    } catch (e) {
      setMsg(t("cfgUi.errorMsg", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLavoro(false);
    }
  };
  const scarica = async (id: string, nome: string) => {
    try {
      const b = await api.scaricaReport(remoteConnected, id, nome);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = nome;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMsg(t("cfgUi.errorMsg", { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  // Chi genera: un pannello collegato, o questa istanza se fa girare l'impianto.
  const programmati = remoteConnected || (elenco?.[0]?.programmati ?? false);

  return (
    <div style={S.section}>
      <SaveBar onSave={salva} section="reports" dirty={toccato} notice={msg} />
      <div style={S.sectionTitle}>{t("reportTab.titolo")}</div>
      <div style={S.notice}>{t("reportTab.intro")}</div>
      {!programmati && <div style={{ ...S.notice, color: "var(--brand-warning, #f59e0b)" }}>{t("reportTab.nonQui")}</div>}

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 200, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {reports.map((r, i) => (
            <button key={i} style={{ ...S.btn(i === scelto ? "primary" : "ghost"), textAlign: "left" }} onClick={() => setScelto(i)}
              data-testid={`report-${r.id}`}>
              {r.titolo || r.id}
            </button>
          ))}
          <button style={S.btn("ghost")} data-testid="report-nuovo"
            onClick={() => { const r = nuovo(reports); setToccato(true); setReports((p) => [...p, r]); setScelto(reports.length); }}>
            {t("reportTab.nuovo")}
          </button>
        </div>

        {cur && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 140px 200px", gap: 12 }}>
              <label style={ETICHETTA}>{t("reportTab.id")}
                <input style={S.input} value={cur.id} spellCheck={false} onChange={(e) => cambia({ id: e.target.value })} />
              </label>
              <label style={ETICHETTA}>{t("reportTab.titoloCampo")}
                <input style={S.input} value={cur.titolo ?? ""} onChange={(e) => cambia({ titolo: e.target.value || undefined })} />
              </label>
              <label style={ETICHETTA}>{t("reportTab.periodo")}
                <select style={S.input} value={cur.periodo ?? "giorno"} data-testid="report-periodo"
                  onChange={(e) => cambia({ periodo: e.target.value as ReportDef["periodo"] })}>
                  {PERIODI.map((p) => <option key={p} value={p}>{t(`reportTab.periodi.${p}`)}</option>)}
                </select>
              </label>
              <label style={ETICHETTA}>{t("reportTab.quando")}
                <input style={S.input} value={cur.quando ?? ""} spellCheck={false}
                  placeholder={CRON_PREDEFINITO[cur.periodo ?? "giorno"]} title={t("reportTab.quandoHint")}
                  onChange={(e) => cambia({ quando: e.target.value || undefined })} />
              </label>
            </div>

            <div>
              <span style={ETICHETTA}>{t("reportTab.tags")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {cur.tags.map((tg) => (
                  <span key={tg} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: "var(--brand-surface-2, #334155)" }}>
                    {tg} <button style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
                      onClick={() => cambia({ tags: cur.tags.filter((x) => x !== tg) })}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, maxWidth: 420 }}>
                <TagInput style={S.inputSm} value={nuovoTag} onChange={setNuovoTag} placeholder={t("reportTab.aggiungiTag")} />
                <button style={S.btn("ghost")} disabled={!nuovoTag.trim() || cur.tags.includes(nuovoTag.trim())}
                  onClick={() => { cambia({ tags: [...cur.tags, nuovoTag.trim()] }); setNuovoTag(""); }}>+</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={ETICHETTA}>{t("reportTab.passo")}
                <input style={{ ...S.input, width: 110 }} type="number" min={1} value={cur.intervallo_min ?? ""}
                  placeholder={String({ turno: 15, giorno: 60, settimana: 1440, mese: 1440 }[cur.periodo ?? "giorno"])}
                  onChange={(e) => cambia({ intervallo_min: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </label>
              <label style={{ ...ETICHETTA, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={cur.allarmi !== false} onChange={(e) => cambia({ allarmi: e.target.checked ? undefined : false })} />
                {t("reportTab.allarmi")}
              </label>
              {(["pdf", "xlsx"] as const).map((f) => {
                const formati = cur.formati ?? ["pdf", "xlsx"];
                return (
                  <label key={f} style={{ ...ETICHETTA, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={formati.includes(f)}
                      onChange={(e) => {
                        const n = e.target.checked ? [...formati, f] : formati.filter((x) => x !== f);
                        cambia({ formati: n.length === 2 || n.length === 0 ? undefined : n });
                      }} />
                    {f.toUpperCase()}
                  </label>
                );
              })}
              <label style={ETICHETTA}>{t("reportTab.conserva")}
                <input style={{ ...S.input, width: 90 }} type="number" min={1} value={cur.conserva ?? ""} placeholder="30"
                  onChange={(e) => cambia({ conserva: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </label>
            </div>

            <div style={{ maxWidth: 520 }}>
              <span style={ETICHETTA}>{t("reportTab.email")}</span>
              <DestinatariEmail value={cur.email} onChange={(v) => cambia({ email: v })} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.btn("danger")} onClick={() => { setToccato(true); setReports((p) => p.filter((_, i) => i !== scelto)); setScelto(0); }}>
                {t("cfgUi.delete")}
              </button>
              <button style={S.btn("primary")} disabled={lavoro || toccato || !programmati} data-testid="report-genera"
                title={toccato ? t("reportTab.salvaPrima") : undefined} onClick={() => generaOra(cur.id)}>
                {lavoro ? t("reportTab.generando") : t("reportTab.generaOra")}
              </button>
            </div>

            <div>
              <div style={{ ...ETICHETTA, fontWeight: 600 }}>{t("reportTab.file")}</div>
              {fileDi(cur.id).length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("reportTab.nessunFile")}</div>
              ) : (
                <table style={S.table}>
                  <tbody>
                    {fileDi(cur.id).map((f) => (
                      <tr key={f.nome}>
                        <td style={{ ...S.td, fontFamily: "monospace" }}>{f.nome}</td>
                        <td style={S.td}>{Math.max(1, Math.round(f.dimensione / 1024))} KB</td>
                        <td style={{ ...S.td, textAlign: "right" }}>
                          <button style={S.btnXs} onClick={() => scarica(cur.id, f.nome)}>{t("reportTab.scarica")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
