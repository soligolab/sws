import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MqttSource, TagDataType, TagDef, TopicMapping } from "@/types";
import { S } from "@/config/comuni";

// ── MqttJsonExtractModal ──────────────────────────────────────────────────────
// Incolla un payload JSON di esempio, appiattiscilo a variabili "foglia" (path
// dot-separated) col tipo dedotto, scegli quali usare e genera una riga di
// TopicMapping per ciascuna (stesso topic, json_path = path). Opzionalmente crea
// anche i TagDef col tipo corrispondente (come l'import OPC-UA). Il backend
// naviga già i json_path annidati (decode_payload/navigate in sws-plugin-mqtt).

type JsonLeaf = { path: string; type: TagDataType; sample: string };

/** Appiattisce un oggetto JSON in variabili foglia scalari (bool/number/string).
 *  Ricorre negli oggetti annidati (`parent.child`); salta array e null perché
 *  non raggiungibili col dot-path del plugin. */
function flattenJsonLeaves(obj: unknown, prefix = ""): JsonLeaf[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: JsonLeaf[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || Array.isArray(v)) continue;
    if (typeof v === "object") { out.push(...flattenJsonLeaves(v, path)); continue; }
    let type: TagDataType;
    if (typeof v === "boolean") type = "bool";
    else if (typeof v === "number") type = Number.isInteger(v) ? "int" : "float";
    else type = "string";
    out.push({ path, type, sample: String(v) });
  }
  return out;
}

/** Base per il tag suggerito: ultimo segmento del topic, ripulito. */
function sanitizeTagBase(topic: string): string {
  const leaf = (topic.split("/").pop() ?? topic).trim();
  return leaf.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
}

export function MqttJsonExtractModal({
  source,
  onGenerate,
  onClose,
}: {
  source: MqttSource;
  onGenerate: (rows: TopicMapping[], tags: TagDef[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lastTopic = [...source.topics].reverse().find((t) => t.topic.trim() !== "")?.topic ?? "";
  const [topic, setTopic] = useState(lastTopic);
  const [jsonText, setJsonText] = useState("");
  const [leaves, setLeaves] = useState<JsonLeaf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagNames, setTagNames] = useState<Record<string, string>>({});
  const [autoCreateTags, setAutoCreateTags] = useState(true);
  const [filter, setFilter] = useState("");

  const analyze = () => {
    setError(null);
    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); }
    catch { setError("JSON non valido."); setLeaves(null); return; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("cfgUi.theJsonMustBeAn")); setLeaves(null); return;
    }
    const ls = flattenJsonLeaves(parsed);
    if (ls.length === 0) { setError(t("cfgUi.noVariablesCanBeExtracted")); setLeaves([]); return; }
    const base = sanitizeTagBase(topic);
    setLeaves(ls);
    setSelected(new Set(ls.map((l) => l.path)));
    setTagNames(Object.fromEntries(ls.map((l) => [l.path, base ? `${base}.${l.path}` : l.path])));
  };

  const visible = (leaves ?? []).filter((l) => l.path.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (path: string) => setSelected((prev) => {
    const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next;
  });
  const toggleAll = () => setSelected((prev) => {
    const allSel = visible.length > 0 && visible.every((l) => prev.has(l.path));
    const next = new Set(prev);
    for (const l of visible) { if (allSel) next.delete(l.path); else next.add(l.path); }
    return next;
  });

  const generate = () => {
    const chosen = (leaves ?? []).filter((l) => selected.has(l.path));
    const rows: TopicMapping[] = chosen.map((l) => ({
      tag: (tagNames[l.path] ?? "").trim(),
      topic: topic.trim(),
      json_path: l.path,
    }));
    const tags: TagDef[] = autoCreateTags
      ? chosen
          .filter((l) => (tagNames[l.path] ?? "").trim() !== "")
          .map((l) => ({ id: (tagNames[l.path] ?? "").trim(), description: `MQTT ${topic.trim()} · ${l.path}`, data_type: l.type }))
      : [];
    onGenerate(rows, tags);
    onClose();
  };

  const canGenerate = topic.trim() !== "" && selected.size > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, width: "min(92vw, 780px)", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.extractVariablesFromJson")}</div>
          <button style={{ ...S.btn("ghost"), padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>Topic</label>
          <input style={S.input} placeholder="zigbee2mqtt/presa.sandokan" value={topic} onChange={(e) => setTopic(e.target.value)} spellCheck={false} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.sampleJsonTopicPayload")}</label>
          <textarea
            style={{ ...S.input, minHeight: 90, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            placeholder={'{"energy":2284.4,"state":"ON","update":{"state":"idle"}}'}
            value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={S.btn("primary")} onClick={analyze} disabled={jsonText.trim() === ""}>Analizza</button>
          {leaves !== null && leaves.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{leaves.length} variabili — {selected.size} selezionate</span>
          )}
        </div>

        {error && (
          <div style={{ ...S.notice, background: "#450a0a", borderColor: "#991b1b", color: "var(--brand-danger-soft, #fca5a5)" }}>{error}</div>
        )}

        {leaves !== null && leaves.length > 0 && (
          <>
            <input style={S.input} placeholder={t("cfgUi.filterVariables")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div style={{ overflow: "auto", flex: 1, minHeight: 0, maxHeight: "42vh" }}>
              <table style={{ ...S.table, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 32 }}>
                      <input type="checkbox" onChange={toggleAll} checked={visible.length > 0 && visible.every((l) => selected.has(l.path))} />
                    </th>
                    <th style={{ ...S.th, width: "32%" }}>{t("cfgUi.variableJsonPath")}</th>
                    <th style={{ ...S.th, width: "12%" }}>Tipo</th>
                    <th style={{ ...S.th, width: "18%" }}>{t("cfgUi.sample")}</th>
                    <th style={{ ...S.th }}>Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", color: "var(--brand-text-subtle, #94a3b8)", padding: 12 }}>{t("cfgUi.noVariablesMatchTheFilter")}</td></tr>
                  )}
                  {visible.map((l) => (
                    <tr key={l.path} style={{ background: selected.has(l.path) ? "#172554" : "transparent" }}>
                      <td style={S.td}><input type="checkbox" checked={selected.has(l.path)} onChange={() => toggle(l.path)} /></td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{l.path}</td>
                      <td style={{ ...S.td, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{l.type}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.sample}>{l.sample.length > 18 ? l.sample.slice(0, 18) + "…" : l.sample}</td>
                      <td style={S.td}>
                        <input style={S.inputSm} value={tagNames[l.path] ?? ""} onChange={(e) => setTagNames((prev) => ({ ...prev, [l.path]: e.target.value }))} spellCheck={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
              <input type="checkbox" checked={autoCreateTags} onChange={(e) => setAutoCreateTags(e.target.checked)} />
              {t("cfgUi.alsoCreateTheTagsWith")}
            </label>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("cfgUi.close")}</button>
          <button style={S.btn("primary")} onClick={generate} disabled={!canGenerate}>Genera righe ({selected.size})</button>
        </div>
      </div>
    </div>
  );
}
