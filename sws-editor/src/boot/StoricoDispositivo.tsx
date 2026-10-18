import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

/** Lo storico del dispositivo collegato in CSV (18-10-2026, gruppo 3 del
 *  programma delle funzioni utente). Il trend del pannello non ha un «⬇ CSV»:
 *  il pannello non ha dove salvare un file. Qui si sceglie uno dei trend delle
 *  pagine e un intervallo, e il CSV arriva dal dispositivo, con i suoi dati. */
export const INTERVALLI_CSV = [
  { id: "1h", s: 3_600 },
  { id: "8h", s: 8 * 3_600 },
  { id: "24h", s: 24 * 3_600 },
  { id: "7g", s: 7 * 86_400 },
] as const;

export interface TrendDelProgetto { chiave: string; nome: string; tags: string[] }

/** I trend delle pagine (finestre comprese), con le loro tracce non vuote. */
export function trendDelProgetto(pages: { name: string; objects: { id: string; type: string; trend_tags?: { tag?: string }[] }[] }[]): TrendDelProgetto[] {
  const out: TrendDelProgetto[] = [];
  for (const p of pages) {
    for (const o of p.objects) {
      if (o.type !== "trend") continue;
      const tags = (o.trend_tags ?? []).map((t) => t.tag ?? "").filter((t) => t.trim());
      if (tags.length === 0) continue;
      out.push({ chiave: `${p.name}/${o.id}`, nome: `${p.name} · ${tags.join(", ")}`, tags });
    }
  }
  return out;
}

export function StoricoDispositivo() {
  const { t } = useTranslation();
  const pages = useAppStore((s) => s.pages);
  const trend = useMemo(() => trendDelProgetto(pages as never), [pages]);
  const [scelto, setScelto] = useState("");
  const [intervallo, setIntervallo] = useState<string>("24h");
  const [msg, setMsg] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const voce = trend.find((x) => x.chiave === scelto) ?? trend[0];

  const scarica = async () => {
    if (!voce) return;
    const s = INTERVALLI_CSV.find((x) => x.id === intervallo)?.s ?? 86_400;
    const a = Date.now();
    setInCorso(true);
    setMsg(null);
    try {
      const blob = await api.remoteExportHistoryCsv(voce.tags, a - s * 1000, a);
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = `sws-${voce.chiave.replace(/[^\w.-]+/g, "_")}-${intervallo}.csv`;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, testo: t("storicoDispositivo.scaricato") });
    } catch (e: any) {
      setMsg({ ok: false, testo: e?.message ?? String(e) });
    } finally {
      setInCorso(false);
    }
  };

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("storicoDispositivo.titolo")}
      </div>
      {trend.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("storicoDispositivo.nessunTrend")}</div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select data-testid="storico-trend" value={voce?.chiave ?? ""} onChange={(e) => setScelto(e.target.value)}
            style={{ maxWidth: 420 }}>
            {trend.map((x) => <option key={x.chiave} value={x.chiave}>{x.nome}</option>)}
          </select>
          <select data-testid="storico-intervallo" value={intervallo} onChange={(e) => setIntervallo(e.target.value)}>
            {INTERVALLI_CSV.map((x) => <option key={x.id} value={x.id}>{t(`storicoDispositivo.intervallo.${x.id}`)}</option>)}
          </select>
          <button type="button" data-testid="storico-scarica" onClick={() => void scarica()} disabled={inCorso}>
            {t("storicoDispositivo.scarica")}
          </button>
          {msg && (
            <span style={{ fontSize: 12, color: msg.ok ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>{msg.testo}</span>
          )}
        </div>
      )}
    </section>
  );
}
