import { useTranslation } from "react-i18next";
import type { MqttSource, PubblicazioneMqtt } from "@/types";
import { S } from "@/config/comuni";
import { TagInput } from "@/components/TagInput";
import { CampoNumero } from "@/components/CampoNumero";

/** La sezione PUBBLICAZIONE della card MQTT (01-11-2026, piano
 *  docs/archive/2026-11-01-inverter-solarman.md, fase 5): i tag che SWS mette sul
 *  broker. Il caso che l'ha fatta nascere: SWS lettore unico di un inverter con
 *  la chiavetta Solarman, e Home Assistant che legge lo stato da qui invece di
 *  interrogare la chiavetta (che con due client mescola le risposte).
 *
 *  Ogni riga: il topic, i tag (un tag, una variabile, un suo ramo come
 *  `inverter.principali`), il formato, retain, l'intervallo, e la disponibilità
 *  `online`/`offline` presa da un tag booleano (`<sorgente>.disponibile`). */
export function MqttPubblicazioniSection({ source, onChange }: {
  source: MqttSource;
  onChange: (p: PubblicazioneMqtt[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const righe = source.pubblica ?? [];
  const metti = (i: number, patch: Partial<PubblicazioneMqtt>) =>
    onChange(righe.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const togli = (i: number) => {
    const resto = righe.filter((_, j) => j !== i);
    onChange(resto.length ? resto : undefined);
  };
  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8, lineHeight: 1.4 }}>
        {t("sorgenti.pubblica.nota")}
      </div>
      {righe.map((r, i) => (
        <div key={i} data-testid={`mqtt-pubblica-${i}`}
          style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 28px", gap: 10, alignItems: "end", marginBottom: 8 }}>
            <label style={etichetta}>{t("cfg.topic")}
              <input style={S.input} value={r.topic} spellCheck={false} placeholder="inverter/casa/state"
                onChange={(e) => metti(i, { topic: e.target.value })} />
            </label>
            <label style={etichetta}>{t("sorgenti.pubblica.formato")}
              <select style={{ ...S.input, cursor: "pointer" }} value={r.formato ?? "json"}
                onChange={(e) => metti(i, { formato: e.target.value === "json" ? undefined : "valore" })}>
                <option value="json">JSON</option>
                <option value="valore">{t("sorgenti.pubblica.valore")}</option>
              </select>
            </label>
            <label style={etichetta} title={t("sorgenti.pubblica.intervalloHint")}>{t("sorgenti.pubblica.intervallo")}
              <CampoNumero style={S.input} min={0} value={(r.intervallo_ms ?? 0) / 1000}
                onTesto={(e) => metti(i, { intervallo_ms: Math.round(Number(e) * 1000) || undefined })} />
            </label>
            <button style={S.btn("ghost")} title={t("cfgUi.delete")} aria-label={t("cfgUi.delete")} onClick={() => togli(i)}>✕</button>
          </div>
          <div style={etichetta}>{t("sorgenti.pubblica.tags")}</div>
          {[...r.tags, ""].map((tag, k) => (
            <div key={k} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <TagInput value={tag} placeholder={k === r.tags.length ? t("sorgenti.pubblica.aggiungiTag") : undefined}
                  onChange={(v) => {
                    const tags = [...r.tags];
                    if (k === r.tags.length) { if (v) tags.push(v); } else if (v) tags[k] = v; else tags.splice(k, 1);
                    metti(i, { tags });
                  }} />
              </div>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end", marginTop: 6 }}>
            <label style={etichetta} title={t("sorgenti.pubblica.disponibilitaHint")}>{t("sorgenti.pubblica.disponibilitaTag")}
              <TagInput value={r.disponibilita?.tag ?? ""} tipoSuggerito="bool"
                onChange={(v) => metti(i, { disponibilita: v ? { topic: r.disponibilita?.topic || r.topic.replace(/\/state$/, "") + "/availability", tag: v } : undefined })} />
            </label>
            <label style={etichetta}>{t("sorgenti.pubblica.disponibilitaTopic")}
              <input style={S.input} value={r.disponibilita?.topic ?? ""} spellCheck={false} disabled={!r.disponibilita}
                onChange={(e) => r.disponibilita && metti(i, { disponibilita: { ...r.disponibilita, topic: e.target.value } })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, paddingBottom: 6 }} title={t("sorgenti.pubblica.retainHint")}>
              <input type="checkbox" checked={r.retain !== false} onChange={(e) => metti(i, { retain: e.target.checked ? undefined : false })} />
              retain
            </label>
          </div>
        </div>
      ))}
      <button style={S.btn("ghost")} data-testid={`mqtt-pubblica-aggiungi-${source.id}`}
        onClick={() => onChange([...righe, { topic: "", tags: [] }])}>
        {t("sorgenti.pubblica.aggiungi")}
      </button>
    </>
  );
}
