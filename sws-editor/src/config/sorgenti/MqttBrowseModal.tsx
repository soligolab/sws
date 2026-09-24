import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { BrowsedTopic, MqttSource, TopicMapping } from "@/types";
import i18n from "@/i18n";
import { S } from "@/config/comuni";

// ── MqttBrowseModal ───────────────────────────────────────────────────────────

export function MqttBrowseModal({
  source,
  onImport,
  onClose,
}: {
  source: MqttSource;
  onImport: (topics: TopicMapping[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BrowsedTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per topic: suggested json_path (top-level key of JSON payload, if any).
  const [jsonPathPick, setJsonPathPick] = useState<Record<string, string>>({});
  const [duration, setDuration] = useState(30);
  const [filter, setFilter] = useState("");

  const startBrowse = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setSelected(new Set());
    setJsonPathPick({});
    try {
      const res = await api.browseMqttTopics({
        host: source.host,
        port: source.port,
        source_id: source.id,
        client_id: source.client_id,
        username: source.username,
        password: source.password,
        tls_enabled: source.tls?.enabled ?? false,
        insecure_skip_verify: source.tls?.insecure_skip_verify ?? false,
        ca_cert_path: source.tls?.ca_cert_path,
        duration_secs: duration,
      });
      setResult(res.topics);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    if (!result) return;
    const visible = result.filter(t => !filter || t.topic.includes(filter));
    const allSel = visible.every(t => selected.has(t.topic));
    setSelected(prev => {
      const next = new Set(prev);
      visible.forEach(t => allSel ? next.delete(t.topic) : next.add(t.topic));
      return next;
    });
  };

  const doImport = () => {
    if (!result) return;
    const newTopics: TopicMapping[] = result
      .filter(t => selected.has(t.topic))
      .map(t => ({ tag: "", topic: t.topic, json_path: jsonPathPick[t.topic] || undefined }));
    onImport(newTopics);
    onClose();
  };

  const visible = result ? result.filter(t => !filter || t.topic.includes(filter)) : [];

  // Parse top-level JSON keys from a sample payload.
  const jsonKeys = (payload: string): string[] => {
    try {
      const v = JSON.parse(payload);
      if (v && typeof v === "object" && !Array.isArray(v)) return Object.keys(v);
    } catch { /* not JSON */ }
    return [];
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: 20, width: "min(90vw, 740px)", maxHeight: "80vh",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>
            Sfoglia broker — {source.host}:{source.port}
          </div>
          <button style={{ ...S.btn("ghost"), padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.durationS")}</label>
          <input
            style={{ ...S.input, width: 60 }}
            type="number" min={2} max={120}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={loading}
          />
          <button style={S.btn("primary")} onClick={startBrowse} disabled={loading}>
            {loading ? `Rilevamento… (${duration} s)` : result ? "Aggiorna" : t("cfgUi.startDiscovery")}
          </button>
          {result !== null && (
            <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
              {result.length} topic rilevati — {selected.size} selezionati
            </span>
          )}
        </div>

        {error && (
          <div style={{ ...S.notice, background: "#450a0a", borderColor: "#991b1b", color: "var(--brand-danger-soft, #fca5a5)" }}>
            Errore: {error}
          </div>
        )}

        {/* Results */}
        {result !== null && (
          <>
            <input
              style={S.input}
              placeholder={t("cfg.filterTopic")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div style={{ overflow: "auto", flex: 1, minHeight: 0, maxHeight: "40vh" }}>
              <table style={{ ...S.table, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 32 }}>
                      <input type="checkbox" onChange={toggleAll}
                        checked={visible.length > 0 && visible.every(t => selected.has(t.topic))} />
                    </th>
                    <th style={{ ...S.th, width: "36%" }}>{t("cfg.topic")}</th>
                    <th style={{ ...S.th, width: "32%" }}>{t("cfg.payloadPreview")}</th>
                    <th style={{ ...S.th }}>{t("cfg.jsonPathOpt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ ...S.td, textAlign: "center", color: "var(--brand-text-subtle, #94a3b8)", padding: 12 }}>
                        {t("cfgUi.noTopicsMatchTheFilter")}
                      </td>
                    </tr>
                  )}
                  {visible.map((t) => {
                    const keys = jsonKeys(t.sample_payload);
                    return (
                      <tr key={t.topic} style={{ background: selected.has(t.topic) ? "#172554" : "transparent" }}>
                        <td style={S.td}>
                          <input
                            type="checkbox"
                            checked={selected.has(t.topic)}
                            onChange={() => setSelected(prev => {
                              const next = new Set(prev);
                              if (next.has(t.topic)) { next.delete(t.topic); } else { next.add(t.topic); }
                              return next;
                            })}
                          />
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                          {t.topic}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={t.sample_payload}>
                          {t.sample_payload.length > 55 ? t.sample_payload.slice(0, 55) + "…" : t.sample_payload}
                        </td>
                        <td style={S.td}>
                          {keys.length > 0 ? (
                            <select
                              style={{ ...S.inputSm, cursor: "pointer" }}
                              value={jsonPathPick[t.topic] ?? ""}
                              onChange={(e) => setJsonPathPick(prev => ({ ...prev, [t.topic]: e.target.value }))}
                            >
                              <option value="">{i18n.t("cfgUi.none")}</option>
                              {keys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 11 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("common.close")}</button>
          {result !== null && (
            <button style={S.btn("primary")} onClick={doImport} disabled={selected.size === 0}>
              Importa selezionati ({selected.size})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
