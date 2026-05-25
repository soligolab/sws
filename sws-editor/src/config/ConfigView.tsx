import React, { useEffect, useRef, useState } from "react";
import { api, type CreateUserBody, type UpdateUserBody, type UserRole, type UserSummary } from "@/api/client";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import { canConfigureProject } from "@/auth/permissions";
import type {
  AlarmCondition,
  AlarmDef,
  AlarmSeverity,
  BrowsedTopic,
  DatastoreBackendConfig,
  DatastoreConfig,
  DatastoreStats,
  EntityMapping,
  HaBrowsedEntity,
  HomeAssistantSource,
  ModbusTcpSource,
  ModbusRtuSource,
  OpcUaServerNodeMapping,
  OpcUaServerSource,
  MqttLastWill,
  MqttSource,
  MqttTlsConfig,
  OpcUaAuth,
  OpcUaBrowsedNode,
  OpcUaCertEntry,
  OpcUaEuromapVariable,
  OpcUaNodeMapping,
  OpcUaSource,
  RegisterMapping,
  SourceDef,
  TagDataType,
  TagDef,
  TopicMapping,
} from "@/types";

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden" as const,
    background: "#0f172a",
    color: "#e2e8f0",
  },
  tabBar: {
    display: "flex" as const,
    gap: 2,
    padding: "0 16px",
    background: "#1e293b",
    borderBottom: "1px solid #334155",
    flexShrink: 0,
  },
  tab: (active: boolean): React.CSSProperties => ({
    padding: "10px 20px",
    border: "none",
    borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
    background: "transparent",
    color: active ? "#e2e8f0" : "#64748b",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
  }),
  body: {
    flex: 1,
    overflow: "auto" as const,
    padding: 24,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: 1,
    marginBottom: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  },
  th: {
    textAlign: "left" as const,
    padding: "6px 10px",
    color: "#64748b",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.5,
    borderBottom: "1px solid #334155",
  },
  td: {
    padding: "4px 6px",
    borderBottom: "1px solid #1e293b",
    verticalAlign: "middle" as const,
  },
  input: {
    background: "#1e293b",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inputSm: {
    background: "#1e293b",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "4px 6px",
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  btn: (variant: "primary" | "danger" | "ghost" | "success"): React.CSSProperties => {
    const map = {
      primary: { background: "#1d4ed8", color: "#dbeafe", border: "1px solid #1e40af" },
      success: { background: "#166534", color: "#bbf7d0", border: "1px solid #15803d" },
      danger:  { background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b" },
      ghost:   { background: "transparent", color: "#64748b", border: "1px solid #334155" },
    };
    return {
      ...map[variant],
      borderRadius: 4,
      padding: "5px 12px",
      cursor: "pointer",
      fontSize: 13,
      whiteSpace: "nowrap" as const,
    };
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden" as const,
  },
  cardHead: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "10px 16px",
    background: "#1e293b",
    cursor: "pointer",
    borderBottom: "1px solid #334155",
  },
  notice: {
    background: "#172554",
    border: "1px solid #1e40af",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 12,
    color: "#93c5fd",
    marginBottom: 16,
  },
  // Compact field label used by the source-card grids.
  label: {
    fontSize: 11, color: "#64748b", display: "block" as const, marginBottom: 3,
  } as React.CSSProperties,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── QuickCreateTagModal ───────────────────────────────────────────────────────
// Minimal modal that lets the operator create a new tag without switching tab.

function QuickCreateTagModal({
  initialId,
  onConfirm,
  onClose,
}: {
  initialId: string;
  onConfirm: (tag: TagDef) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(initialId.trim());
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState<TagDataType>("float");

  const create = () => {
    const trimmed = id.trim();
    if (!trimmed) return;
    onConfirm({ id: trimmed, description: description.trim(), data_type: dataType });
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
        padding: 20, minWidth: 320, maxWidth: 440,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 14 }}>
          Crea variabile
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID tag *</label>
            <input
              style={S.input}
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoFocus
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Descrizione (opz.)</label>
            <input
              style={S.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Tipo dato</label>
            <select style={{ ...S.input, cursor: "pointer" }} value={dataType} onChange={(e) => setDataType(e.target.value as TagDataType)}>
              <option value="float">Float</option>
              <option value="int">Int</option>
              <option value="bool">Bool</option>
              <option value="string">String</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Annulla</button>
          <button style={S.btn("primary")} onClick={create} disabled={!id.trim()}>Crea</button>
        </div>
      </div>
    </div>
  );
}

function SaveBar({
  onSave,
  saving,
  saved,
  savedNotice = "✓ Salvato — modifiche applicate immediatamente.",
}: {
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  savedNotice?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
      <button style={S.btn("success")} onClick={onSave} disabled={saving}>
        {saving ? "Salvataggio…" : "Salva"}
      </button>
      {saved && (
        <span style={{ fontSize: 12, color: "#22c55e" }}>
          {savedNotice}
        </span>
      )}
    </div>
  );
}

// ── TAG tab ───────────────────────────────────────────────────────────────────

function TagsTab() {
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectTags   = useAppStore((s) => s.updateProjectTags);
  const tagValues           = useAppStore((s) => s.tagValues);
  const datastoreIds        = storeProject?.datastores?.map((d) => ({ id: d.id, label: d.label })) ?? [];

  const [tags, setTags]         = useState<TagDef[]>(storeProject?.tags ?? []);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [exprOpen, setExprOpen] = useState<Set<number>>(new Set());

  // Sync local state when store changes (e.g. on initial project load)
  useEffect(() => {
    if (storeProject?.tags) setTags(storeProject.tags);
  }, [storeProject?.tags?.length]);

  const addTag = () =>
    setTags((prev) => [...prev, { id: "", description: "", data_type: "float" }]);

  const updateTag = (idx: number, patch: Partial<TagDef>) =>
    setTags((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  const removeTag = (idx: number) =>
    setTags((prev) => prev.filter((_, i) => i !== idx));

  const toggleExpr = (idx: number) =>
    setExprOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const handleSave = async () => {
    const valid = tags.filter((t) => t.id.trim() !== "");
    setSaving(true);
    try {
      await api.updateTags(valid);
      updateProjectTags(valid);
      setTags(valid);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>VARIABILI (TAG)</div>
      <div style={S.notice}>
        Le variabili definiscono i punti dati del progetto. Collega ogni variabile a un
        registro nella sezione <em>Protocolli</em> per ricevere i valori in tempo reale.
        Valore attuale visibile solo se il runtime è in esecuzione.
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "22%" }}>ID variabile</th>
            <th style={{ ...S.th, width: "25%" }}>Descrizione</th>
            <th style={{ ...S.th, width: "9%" }}>Tipo</th>
            <th style={{ ...S.th, width: "6%", textAlign: "center" }}>Storico</th>
            <th style={{ ...S.th, width: "16%" }}>Datastore</th>
            <th style={{ ...S.th, width: "12%" }}>Valore live</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {tags.map((tag, i) => {
            const tv = tagValues[tag.id];
            return (
              <React.Fragment key={i}>
              <tr style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                <td style={S.td}>
                  <input
                    style={S.input}
                    placeholder="es. pump1.speed"
                    value={tag.id}
                    onChange={(e) => updateTag(i, { id: e.target.value })}
                    spellCheck={false}
                  />
                </td>
                <td style={S.td}>
                  <input
                    style={S.input}
                    placeholder="Descrizione opzionale"
                    value={tag.description}
                    onChange={(e) => updateTag(i, { description: e.target.value })}
                  />
                </td>
                <td style={S.td}>
                  <select
                    style={{ ...S.input, cursor: "pointer" }}
                    value={tag.data_type ?? "float"}
                    onChange={(e) => updateTag(i, { data_type: e.target.value as TagDataType })}
                  >
                    <option value="bool">Bool</option>
                    <option value="int">Int</option>
                    <option value="float">Float</option>
                    <option value="string">Stringa</option>
                  </select>
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={tag.history ?? false}
                    onChange={(e) => updateTag(i, { history: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                </td>
                <td style={S.td}>
                  {datastoreIds.length > 0 ? (
                    <select
                      style={{ ...S.input, cursor: "pointer" }}
                      value={tag.datastore_id ?? ""}
                      onChange={(e) => updateTag(i, { datastore_id: e.target.value || undefined })}
                      disabled={!tag.history}
                    >
                      <option value="">(default)</option>
                      {datastoreIds.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "#475569", fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {tv != null ? (
                    <span style={{
                      fontSize: 12,
                      color: tv.quality === "Good" ? "#22c55e" : tv.quality === "Bad" ? "#ef4444" : "#eab308",
                    }}>
                      {String(tv.value)}
                    </span>
                  ) : (
                    <span style={{ color: "#334155", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <button
                    style={{
                      ...S.btn("ghost"),
                      marginRight: 4,
                      color: tag.expression ? "#818cf8" : "#475569",
                      fontFamily: "monospace",
                      fontWeight: "bold",
                    }}
                    title="Espressione calcolata (Python)"
                    onClick={() => toggleExpr(i)}
                  >
                    λ
                  </button>
                  <button style={S.btn("danger")} onClick={() => removeTag(i)}>✕</button>
                </td>
              </tr>
              {(exprOpen.has(i) || !!tag.expression) && (
                <tr style={{ background: "#0a1628" }}>
                  <td colSpan={7} style={{ ...S.td, paddingTop: 4, paddingBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#818cf8", minWidth: 70, fontFamily: "monospace" }}>
                        λ espressione
                      </span>
                      <input
                        style={{ ...S.input, flex: 1, fontFamily: "monospace", fontSize: 12, color: "#c4b5fd" }}
                        placeholder='es. tags["motor.v"] * tags["motor.i"]'
                        value={tag.expression ?? ""}
                        onChange={(e) => updateTag(i, { expression: e.target.value || undefined })}
                        spellCheck={false}
                      />
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button style={S.btn("ghost")} onClick={addTag}>+ Aggiungi variabile</button>
      </div>

      <SaveBar onSave={handleSave} saving={saving} saved={saved} />
    </div>
  );
}

// ── PROTOCOL / SOURCE forms ───────────────────────────────────────────────────

function emptyModbus(): ModbusTcpSource {
  return {
    kind: "modbus_tcp",
    id: `plc-${genId()}`,
    host: "192.168.1.10",
    port: 502,
    unit_id: 1,
    poll_interval_ms: 1000,
    registers: [],
  };
}

function emptyModbusRtu(): ModbusRtuSource {
  return {
    kind: "modbus_rtu",
    id: `rtu-${genId()}`,
    device: "/dev/ttyUSB0",
    baud_rate: 9600,
    parity: "N",
    data_bits: 8,
    stop_bits: 1,
    unit_id: 1,
    poll_interval_ms: 1000,
    registers: [],
  };
}

function emptyRegister(): RegisterMapping {
  return { tag: "", address: 0, scale: 1 };
}

function emptyMqtt(): MqttSource {
  return {
    kind: "mqtt",
    id: `mqtt-${genId()}`,
    host: "broker.local",
    port: 1883,
    client_id: `sws-${genId()}`,
    topics: [],
  };
}

function emptyTopic(): TopicMapping {
  return { tag: "", topic: "", json_path: undefined };
}

function emptyOpcUa(): OpcUaSource {
  return {
    kind: "opcua_client",
    id: `opcua-${genId()}`,
    endpoint_url: "opc.tcp://localhost:4840",
    security_policy: "None",
    auth: { kind: "anonymous" },
    subscription_interval_ms: 500,
    nodes: [],
  };
}

function emptyOpcUaNode(): OpcUaNodeMapping {
  return { tag: "", node_id: "" };
}

function emptyOpcUaServer(): OpcUaServerSource {
  return {
    kind: "opcua_server",
    id: `opcua-srv-${genId()}`,
    port: 4840,
    namespace_uri: "urn:soligolab:sws",
    nodes: [],
  };
}

function emptyOpcUaServerNode(): OpcUaServerNodeMapping {
  return { tag: "" };
}

function emptyHomeAssistant(): HomeAssistantSource {
  return {
    kind: "homeassistant",
    id: `ha-${genId()}`,
    url: "http://homeassistant.local:8123",
    token: "",
    entities: [],
  };
}

function emptyEntityMapping(): EntityMapping {
  return { tag: "", entity_id: "" };
}

// ── HomeAssistant entity browser modal ────────────────────────────────────────

type HaBrowseTarget = { rowIdx: number; field: "entity_id" | "attribute" };

function HaBrowseModal({
  sourceId,
  target,
  onSelect,
  onClose,
}: {
  sourceId: string;
  target: HaBrowseTarget;
  onSelect: (entityId: string, attribute?: string) => void;
  onClose: () => void;
}) {
  const [entities, setEntities] = useState<HaBrowsedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.browseHaEntities(sourceId, domainFilter || undefined)
      .then((list) => { setEntities(list); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [sourceId, domainFilter]);

  const filtered = entities.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.entity_id.toLowerCase().includes(q) ||
      (e.friendly_name?.toLowerCase().includes(q) ?? false) ||
      e.state.toLowerCase().includes(q)
    );
  });

  const domains = Array.from(new Set(entities.map((e) => e.entity_id.split(".")[0]))).sort();

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div style={{
        background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
        width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #334155", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", letterSpacing: 0.5 }}>
            SFOGLIA ENTITÀ HOME ASSISTANT
          </span>
          <span style={{ fontSize: 11, color: "#64748b", flex: 1 }}>
            {target.field === "attribute" ? "Seleziona entità poi attributo" : "Seleziona entità"}
          </span>
          <button style={S.btn("ghost")} onClick={onClose}>✕</button>
        </div>

        {/* Filters */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e3a5f", display: "flex", gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="Cerca entity_id, nome, stato…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <select
            style={{ ...S.input, minWidth: 140 }}
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="">Tutti i domini</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "6px 0" }}>
          {loading && (
            <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Caricamento entità…</div>
          )}
          {error && (
            <div style={{ padding: 16, color: "#ef4444", fontSize: 12 }}>
              Errore: {error}. Verifica che l'URL e il token siano corretti e salva il progetto prima di sfogliare.
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#475569" }}>Nessuna entità trovata.</div>
          )}
          {!loading && !error && filtered.map((ent) => (
            <div key={ent.entity_id} style={{ borderBottom: "1px solid #0f172a" }}>
              <div
                style={{
                  padding: "7px 16px", display: "flex", alignItems: "center", gap: 12,
                  cursor: "pointer",
                  background: expandedId === ent.entity_id ? "#0f2f35" : "transparent",
                }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = "#162032"; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = expandedId === ent.entity_id ? "#0f2f35" : "transparent"; }}
              >
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => {
                  if (target.field === "entity_id") {
                    onSelect(ent.entity_id);
                  } else {
                    setExpandedId(expandedId === ent.entity_id ? null : ent.entity_id);
                  }
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                    {ent.entity_id}
                  </div>
                  {ent.friendly_name && ent.friendly_name !== ent.entity_id && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>{ent.friendly_name}</div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", minWidth: 80, textAlign: "right" }}>
                  {ent.state}
                </div>
                {target.field === "entity_id" ? (
                  <button
                    style={{ ...S.btn("primary"), padding: "3px 10px", fontSize: 11 }}
                    onClick={() => onSelect(ent.entity_id)}
                  >
                    Seleziona
                  </button>
                ) : (
                  <button
                    style={{ ...S.btn("ghost"), padding: "3px 10px", fontSize: 11 }}
                    onClick={() => setExpandedId(expandedId === ent.entity_id ? null : ent.entity_id)}
                  >
                    {expandedId === ent.entity_id ? "▲" : "▼"} attr
                  </button>
                )}
              </div>

              {/* Attribute list — shown when field=attribute and row is expanded */}
              {target.field === "attribute" && expandedId === ent.entity_id && ent.attributes.length > 0 && (
                <div style={{ padding: "4px 16px 8px 32px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ent.attributes.map((attr) => (
                    <button
                      key={attr}
                      style={{ ...S.btn("ghost"), padding: "2px 8px", fontSize: 11 }}
                      onClick={() => onSelect(ent.entity_id, attr)}
                    >
                      {attr}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid #334155", fontSize: 11, color: "#475569" }}>
          {!loading && !error && `${filtered.length} / ${entities.length} entità`}
        </div>
      </div>
    </div>
  );
}

// ── HomeAssistant card ────────────────────────────────────────────────────────

function HomeAssistantSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: HomeAssistantSource;
  onChange: (s: HomeAssistantSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browse, setBrowse] = useState<HaBrowseTarget | null>(null);

  const setField = <K extends keyof HomeAssistantSource>(k: K, v: HomeAssistantSource[K]) =>
    onChange({ ...source, [k]: v });

  const setEntity = (idx: number, patch: Partial<EntityMapping>) =>
    onChange({ ...source, entities: source.entities.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });

  const addEntity = () =>
    onChange({ ...source, entities: [...source.entities, emptyEntityMapping()] });

  const removeEntity = (idx: number) =>
    onChange({ ...source, entities: source.entities.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 1 }}>
            HOME ASSISTANT
          </span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{source.id}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {source.url} — {source.entities.length} entità
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "#475569", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID sorgente</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>URL HomeAssistant</label>
              <input style={S.input} placeholder="http://homeassistant.local:8123"
                value={source.url}
                onChange={(e) => setField("url", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
                Token accesso{" "}
                <span style={{ fontWeight: 400, color: "#475569" }}>(oppure usa token_env)</span>
              </label>
              <input style={S.input} type="password" placeholder="long-lived access token"
                value={source.token ?? ""}
                onChange={(e) => setField("token", e.target.value || undefined)} />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
              Variabile env per il token (opzionale — prevale su "Token accesso")
            </label>
            <input style={{ ...S.input, maxWidth: 240 }} placeholder="HA_TOKEN"
              value={source.token_env ?? ""}
              onChange={(e) => setField("token_env", e.target.value || undefined)}
              spellCheck={false} />
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
            ENTITÀ HA → TAG SWS
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>Tag SWS</th>
                <th style={{ ...S.th, width: "25%" }}>Entity ID HA</th>
                <th style={{ ...S.th, width: "14%" }}>Attributo</th>
                <th style={{ ...S.th, width: "14%" }}>Dominio write</th>
                <th style={{ ...S.th, width: "14%" }}>Servizio write</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.entities.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                    Nessuna entità — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.entities.map((e, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="sala.temp"
                        value={e.tag} onChange={(v) => setEntity(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title="Crea variabile"
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: e.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input style={S.inputSm} placeholder="sensor.living_room_temperature"
                        value={e.entity_id}
                        onChange={(ev) => setEntity(i, { entity_id: ev.target.value })}
                        spellCheck={false} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 13, lineHeight: 1 }}
                        title="Sfoglia entità disponibili"
                        onClick={() => setBrowse({ rowIdx: i, field: "entity_id" })}
                      >🔍</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input style={S.inputSm} placeholder="(stato)"
                        value={e.attribute ?? ""}
                        onChange={(ev) => setEntity(i, { attribute: ev.target.value || undefined })}
                        spellCheck={false} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 13, lineHeight: 1 }}
                        title="Sfoglia attributi disponibili"
                        onClick={() => setBrowse({ rowIdx: i, field: "attribute" })}
                      >🔍</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder="light"
                      value={e.write_domain ?? ""}
                      onChange={(ev) => setEntity(i, { write_domain: ev.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder="turn_on"
                      value={e.write_service ?? ""}
                      onChange={(ev) => setEntity(i, { write_service: ev.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeEntity(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={S.btn("ghost")} onClick={addEntity}>+ Aggiungi entità</button>
        </div>
      )}

      {browse !== null && (
        <HaBrowseModal
          sourceId={source.id}
          target={browse}
          onClose={() => setBrowse(null)}
          onSelect={(entityId, attribute) => {
            if (browse.field === "entity_id") {
              setEntity(browse.rowIdx, { entity_id: entityId });
            } else {
              setEntity(browse.rowIdx, { entity_id: entityId, attribute });
            }
            setBrowse(null);
          }}
        />
      )}

      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onClose={() => setQuickCreate(null)}
          onConfirm={(tag: TagDef) => { onCreateTag(tag); setQuickCreate(null); }}
        />
      )}
    </div>
  );
}

// ── OPC-UA card ───────────────────────────────────────────────────────────────
//
// Mirrors the MqttSourceCard shape on purpose so the operator's mental
// model is the same across protocols. PoC scope: anonymous + username
// auth; security policy "None" wired end-to-end (other values stored in
// YAML for forward-compat, ignored by the plugin).

function OpcUaSourceCard({
  source, onChange, onDelete, onCreateTag,
}: {
  source: OpcUaSource;
  onChange: (s: OpcUaSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [euromapOpen, setEuromapOpen] = useState(false);
  const [certs, setCerts] = useState<OpcUaCertEntry[] | null>(null);
  const [certsLoading, setCertsLoading] = useState(false);
  const [certsError, setCertsError] = useState<string | null>(null);

  const loadCerts = async () => {
    setCertsLoading(true);
    setCertsError(null);
    try {
      setCerts(await api.listOpcUaCerts(source.id));
    } catch (e) {
      setCertsError(String(e));
    } finally {
      setCertsLoading(false);
    }
  };

  const handleTrustCert = async (filename: string) => {
    try {
      await api.trustOpcUaCert(source.id, filename);
      await loadCerts();
    } catch (e) {
      setCertsError(String(e));
    }
  };

  const handleDeleteCert = async (filename: string) => {
    try {
      await api.deleteOpcUaCert(source.id, filename);
      await loadCerts();
    } catch (e) {
      setCertsError(String(e));
    }
  };

  const setField = <K extends keyof OpcUaSource>(k: K, v: OpcUaSource[K]) =>
    onChange({ ...source, [k]: v });

  const setAuth = (auth: OpcUaAuth) =>
    onChange({ ...source, auth });

  const setNode = (idx: number, patch: Partial<OpcUaNodeMapping>) =>
    onChange({
      ...source,
      nodes: source.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    });

  const addNode = () =>
    onChange({ ...source, nodes: [...source.nodes, emptyOpcUaNode()] });

  const removeNode = (idx: number) =>
    onChange({ ...source, nodes: source.nodes.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: open ? 12 : 0, cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#475569" }}>{open ? "▼" : "▶"}</span>
          <span style={{ fontWeight: 600 }}>OPC-UA · {source.id}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>{source.endpoint_url}</span>
        </div>
        <button
          style={S.btn("danger")}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >Elimina</button>
      </div>

      {open && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={S.label}>ID sorgente</label>
              <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Endpoint URL</label>
              <input
                style={S.input}
                placeholder="opc.tcp://192.168.1.100:4840"
                value={source.endpoint_url}
                onChange={(e) => setField("endpoint_url", e.target.value)}
              />
            </div>
            <div>
              <label style={S.label}>Security policy</label>
              <select
                style={S.input}
                value={source.security_policy}
                onChange={(e) => setField("security_policy", e.target.value)}
              >
                <option value="None">None (no crypto)</option>
                <option value="Basic128Rsa15">Basic128Rsa15 (deprecato)</option>
                <option value="Basic256">Basic256</option>
                <option value="Basic256Sha256">Basic256Sha256 (raccomandato)</option>
                <option value="Aes128Sha256RsaOaep">Aes128-SHA256-RsaOaep</option>
                <option value="Aes256Sha256RsaPss">Aes256-SHA256-RsaPss</option>
              </select>
            </div>
            <div>
              <label style={S.label}>Subscription interval (ms)</label>
              <input
                type="number" min={50} step={50} style={S.input}
                value={source.subscription_interval_ms}
                onChange={(e) => setField("subscription_interval_ms", Number(e.target.value) || 500)}
              />
            </div>
          </div>

          {/* Auth ------------------------------------------------------- */}
          <div style={{ marginTop: 12, marginBottom: 6, color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>
            AUTENTICAZIONE
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={source.auth.kind === "anonymous"}
                onChange={() => setAuth({ kind: "anonymous" })}
              />
              Anonima
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={source.auth.kind === "username_password"}
                onChange={() => setAuth({ kind: "username_password", username: "" })}
              />
              Utente + Password
            </label>
          </div>
          {source.auth.kind === "username_password" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
              <div>
                <label style={S.label}>Username</label>
                <input
                  style={S.input}
                  value={source.auth.username}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    username: e.target.value,
                  })}
                />
              </div>
              <div>
                <label style={S.label}>Password</label>
                <input
                  type="password"
                  style={S.input}
                  placeholder="(lascia vuoto se usi password_env)"
                  value={source.auth.password ?? ""}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    password: e.target.value || undefined,
                  })}
                />
              </div>
              <div>
                <label style={S.label}>Password env var</label>
                <input
                  style={S.input}
                  placeholder="SWS_OPCUA_PWD"
                  value={source.auth.password_env ?? ""}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    password_env: e.target.value || undefined,
                  })}
                />
              </div>
            </div>
          )}

          {/* Sicurezza -------------------------------------------------- */}
          <div style={{ marginTop: 12, marginBottom: 6, color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>
            SICUREZZA CERTIFICATI
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={source.trust_all_certs ?? true}
              onChange={(e) => onChange({ ...source, trust_all_certs: e.target.checked })}
            />
            Accetta qualsiasi certificato server (PoC — disabilita per gestione trust manuale)
          </label>
          {!(source.trust_all_certs ?? true) && (
            <div style={{ background: "#1e293b", borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>TRUST STORE</span>
                <button style={S.btn("ghost")} onClick={loadCerts} disabled={certsLoading}>
                  {certsLoading ? "..." : "Aggiorna"}
                </button>
              </div>
              {certsError && (
                <div style={{ color: "#f87171", fontSize: 11, marginBottom: 6 }}>{certsError}</div>
              )}
              {certs === null ? (
                <div style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
                  Clicca "Aggiorna" per vedere i certificati nel trust store.
                </div>
              ) : certs.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
                  Nessun certificato nel trust store. Abilita temporaneamente "Accetta qualsiasi" per
                  permettere la prima connessione, poi ricarica i certificati.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #334155" }}>
                      <th style={{ textAlign: "left", padding: "3px 6px", color: "#94a3b8" }}>File</th>
                      <th style={{ textAlign: "left", padding: "3px 6px", color: "#94a3b8" }}>Stato</th>
                      <th style={{ textAlign: "right", padding: "3px 6px", color: "#94a3b8" }}>Byte</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {certs.map((c) => (
                      <tr key={c.filename} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "3px 6px", fontFamily: "monospace", wordBreak: "break-all" }}>
                          {c.filename}
                        </td>
                        <td style={{ padding: "3px 6px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
                            background: c.status === "trusted" ? "#14532d" : "#7f1d1d",
                            color: c.status === "trusted" ? "#86efac" : "#fca5a5",
                          }}>
                            {c.status === "trusted" ? "TRUSTED" : "REJECTED"}
                          </span>
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "#94a3b8" }}>
                          {c.size_bytes}
                        </td>
                        <td style={{ padding: "3px 6px", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          {c.status === "rejected" && (
                            <button
                              style={{ ...S.btn("ghost"), padding: "1px 6px", fontSize: 10 }}
                              onClick={() => handleTrustCert(c.filename)}
                            >Trust</button>
                          )}
                          <button
                            style={{ ...S.btn("danger"), padding: "1px 6px", fontSize: 10 }}
                            onClick={() => handleDeleteCert(c.filename)}
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Nodes ------------------------------------------------------ */}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>
              NODI MONITORATI ({source.nodes.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                style={S.btn("ghost")}
                onClick={() => setBrowseOpen(true)}
                title="Sfoglia l'address space del server e seleziona i nodi"
              >🔍 Sfoglia server</button>
              <button
                style={S.btn("ghost")}
                onClick={() => setEuromapOpen(true)}
                title="Rileva variabili standard Euromap 77 / 83"
              >🤖 Rileva Euromap</button>
            </div>
          </div>
          {source.nodes.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: 12, fontStyle: "italic", marginTop: 6 }}>
              Nessun nodo. Clicca "+ Nodo" per aggiungerne uno.
            </div>
          ) : (
            <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#94a3b8" }}>Tag</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#94a3b8" }}>NodeId</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#94a3b8" }}>Descrizione</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {source.nodes.map((n, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <TagInput
                          value={n.tag}
                          onChange={(v) => setNode(i, { tag: v })}
                          style={{ ...S.input, padding: "2px 6px", flex: 1 }}
                        />
                        <button
                          title="Crea nuova variabile"
                          style={{ ...S.btn("ghost"), padding: "2px 6px" }}
                          onClick={() => setQuickCreate({ rowIdx: i, prefill: n.tag })}
                        >＋</button>
                      </div>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        style={{ ...S.input, padding: "2px 6px", fontFamily: "monospace" }}
                        placeholder="ns=2;s=Machine.CycleTime"
                        value={n.node_id}
                        onChange={(e) => setNode(i, { node_id: e.target.value })}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        style={{ ...S.input, padding: "2px 6px" }}
                        value={n.description ?? ""}
                        onChange={(e) => setNode(i, { description: e.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <button style={S.btn("danger")} onClick={() => removeNode(i)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 8 }}>
            <button style={S.btn("ghost")} onClick={addNode}>+ Nodo</button>
          </div>
        </>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setNode(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
      {browseOpen && (
        <OpcUaBrowseModal
          source={source}
          existingNodeIds={new Set(source.nodes.map((n) => n.node_id))}
          onClose={() => setBrowseOpen(false)}
          onImport={(picked) => {
            // Merge in the picked NodeIds, skipping any already present.
            const existing = new Set(source.nodes.map((n) => n.node_id));
            const fresh = picked
              .filter((p) => !existing.has(p.node_id))
              .map<OpcUaNodeMapping>((p) => ({
                tag: "",
                node_id: p.node_id,
                description: p.display_name || undefined,
              }));
            if (fresh.length > 0) {
              onChange({ ...source, nodes: [...source.nodes, ...fresh] });
            }
            setBrowseOpen(false);
          }}
        />
      )}
      {euromapOpen && (
        <OpcUaEuromapModal
          source={source}
          existingNodeIds={new Set(source.nodes.map((n) => n.node_id))}
          onClose={() => setEuromapOpen(false)}
          onCreateTag={onCreateTag}
          onImport={(picked, autoCreateTags) => {
            const existing = new Set(source.nodes.map((n) => n.node_id));
            const sid = source.id;
            const fresh = picked
              .filter((p) => !existing.has(p.node_id))
              .map<OpcUaNodeMapping>((p) => ({
                tag: autoCreateTags ? `${sid}.${p.suggested_tag_suffix}` : "",
                node_id: p.node_id,
                description: `Euromap ${p.spec} · ${p.description}`,
              }));
            if (fresh.length > 0) {
              onChange({ ...source, nodes: [...source.nodes, ...fresh] });
            }
            // Auto-create tags so the operator doesn't have to ＋ each row.
            if (autoCreateTags) {
              for (const p of picked) {
                if (existing.has(p.node_id)) continue;
                onCreateTag({
                  id: `${sid}.${p.suggested_tag_suffix}`,
                  description: `Euromap ${p.spec} · ${p.description}`,
                });
              }
            }
            setEuromapOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── OPC-UA server card ───────────────────────────────────────────────────────

function OpcUaServerSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: OpcUaServerSource;
  onChange: (s: OpcUaServerSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof OpcUaServerSource>(k: K, v: OpcUaServerSource[K]) =>
    onChange({ ...source, [k]: v });

  const setNode = (idx: number, patch: Partial<OpcUaServerNodeMapping>) =>
    onChange({ ...source, nodes: source.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)) });

  const addNode = () =>
    onChange({ ...source, nodes: [...source.nodes, emptyOpcUaServerNode()] });

  const removeNode = (idx: number) =>
    onChange({ ...source, nodes: source.nodes.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#8b5cf6", fontWeight: 700, letterSpacing: 1 }}>
            OPC-UA SERVER
          </span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{source.id}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            :{source.port} — {source.nodes.length} nodi
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "#475569", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID sorgente</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Porta TCP</label>
              <input style={S.input} type="number" min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Namespace URI</label>
              <input style={S.input} value={source.namespace_uri}
                onChange={(e) => setField("namespace_uri", e.target.value)} spellCheck={false} />
            </div>
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
            NODI ESPOSTI
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "45%" }}>Variabile (ID tag)</th>
                <th style={{ ...S.th, width: "45%" }}>Node ID OPC-UA (opzionale)</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.nodes.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                    Nessun nodo — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.nodes.map((n, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="pump1.speed"
                        value={n.tag} onChange={(v) => setNode(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title="Crea variabile"
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: n.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder={n.tag || "uguale al tag"}
                      value={n.node_id ?? ""}
                      onChange={(e) => setNode(i, { node_id: e.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeNode(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={S.btn("ghost")} onClick={addNode}>+ Aggiungi nodo</button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setNode(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}

// ── OPC-UA browse modal ──────────────────────────────────────────────────────
//
// Tree view of the server's address space. Each "Object" folder is
// expandable on click — we lazy-load one level at a time so the payload
// stays small and the server doesn't have to fan out the whole namespace.
// "Variable" leaves are selectable via checkbox; "Method" rows are
// rendered but disabled (writes-to-method not in scope).

function OpcUaBrowseModal({
  source, existingNodeIds, onClose, onImport,
}: {
  source: OpcUaSource;
  existingNodeIds: Set<string>;
  onClose: () => void;
  onImport: (picked: OpcUaBrowsedNode[]) => void;
}) {
  // children[parentNodeId | "@root"] = level returned by browse_one_level
  const [children, setChildren] = useState<Record<string, OpcUaBrowsedNode[]>>({});
  // expanded folder keys; "@root" is always logically expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["@root"]));
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Selected variable rows (keyed by NodeId).
  const [picked, setPicked] = useState<Map<string, OpcUaBrowsedNode>>(new Map());

  const loadLevel = async (parentNodeId: string | null) => {
    const key = parentNodeId ?? "@root";
    if (children[key]) return; // cached
    setError(null);
    setBusy((prev) => new Set(prev).add(key));
    try {
      const res = await api.browseOpcUa({
        endpoint_url: source.endpoint_url,
        source_id: source.id,
        auth: source.auth,
        parent_node_id: parentNodeId ?? undefined,
      });
      setChildren((prev) => ({ ...prev, [key]: res.nodes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  useEffect(() => { loadLevel(null); }, []);

  const toggleExpand = (n: OpcUaBrowsedNode) => {
    if (n.node_class === "Variable" || n.node_class === "Method") return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.node_id)) {
        next.delete(n.node_id);
      } else {
        next.add(n.node_id);
        if (!children[n.node_id]) {
          loadLevel(n.node_id);
        }
      }
      return next;
    });
  };

  const togglePick = (n: OpcUaBrowsedNode) => {
    if (n.node_class !== "Variable") return;
    if (existingNodeIds.has(n.node_id)) return; // already imported
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(n.node_id)) next.delete(n.node_id);
      else next.set(n.node_id, n);
      return next;
    });
  };

  const renderLevel = (parentKey: string, depth: number): React.ReactNode => {
    const lvl = children[parentKey];
    const loading = busy.has(parentKey);
    if (!lvl && loading) {
      return (
        <div style={{ paddingLeft: depth * 16 + 28, color: "#64748b", fontSize: 11, fontStyle: "italic" }}>
          caricamento…
        </div>
      );
    }
    if (!lvl) return null;
    if (lvl.length === 0) {
      return (
        <div style={{ paddingLeft: depth * 16 + 28, color: "#64748b", fontSize: 11, fontStyle: "italic" }}>
          (vuoto)
        </div>
      );
    }
    return lvl.map((n) => {
      const isFolder = n.node_class === "Object" || n.node_class === "View";
      const isVariable = n.node_class === "Variable";
      const isExpanded = expanded.has(n.node_id);
      const isPicked = picked.has(n.node_id);
      const isImported = existingNodeIds.has(n.node_id);
      const icon = isFolder ? "📁" : isVariable ? "📊" : n.node_class === "Method" ? "⚙" : "·";
      const labelColor = isVariable
        ? (isImported ? "#475569" : isPicked ? "#5eead4" : "#cbd5e1")
        : isFolder ? "#fde68a"
        : "#64748b";
      return (
        <div key={n.node_id}>
          <div
            onClick={() => isFolder ? toggleExpand(n) : togglePick(n)}
            style={{
              paddingLeft: depth * 16 + 8,
              paddingTop: 3, paddingBottom: 3,
              display: "flex", alignItems: "center", gap: 6,
              cursor: isFolder ? "pointer" : isVariable ? (isImported ? "not-allowed" : "pointer") : "default",
              background: isPicked ? "#0f2922" : "transparent",
              fontSize: 12, color: labelColor,
            }}
            title={isImported ? "Già importato" : n.node_id}
          >
            {isFolder ? (
              <span style={{ width: 12, color: "#64748b" }}>{isExpanded ? "▼" : "▶"}</span>
            ) : isVariable ? (
              <input
                type="checkbox"
                checked={isPicked}
                disabled={isImported}
                onChange={() => togglePick(n)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 12, height: 12 }}
              />
            ) : (
              <span style={{ width: 12 }} />
            )}
            <span>{icon}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {n.display_name || n.browse_name || n.node_id}
            </span>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#475569" }}>
              {n.node_id}
            </span>
          </div>
          {isFolder && isExpanded && renderLevel(n.node_id, depth + 1)}
        </div>
      );
    });
  };

  const pickedList = Array.from(picked.values());

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
          width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e293b",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sfoglia server OPC-UA</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{source.endpoint_url}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", background: "#0a111e" }}>
          {renderLevel("@root", 0)}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1e293b",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: pickedList.length > 0 ? "#5eead4" : "#64748b" }}>
            {pickedList.length === 0
              ? "Espandi un Object e seleziona le Variable da importare."
              : `${pickedList.length} nod${pickedList.length === 1 ? "o" : "i"} selezionat${pickedList.length === 1 ? "o" : "i"}.`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={onClose}>Annulla</button>
            <button
              style={S.btn("primary")}
              disabled={pickedList.length === 0}
              onClick={() => onImport(pickedList)}
            >
              Importa {pickedList.length > 0 ? `(${pickedList.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── OPC-UA Euromap auto-detect modal (BL-005b) ──────────────────────────────
//
// Walks the server address space looking for Variable nodes whose
// browse_name matches a known Euromap 77 (injection moulding) or 83
// (temperature control unit) variable. Match list is server-side. UI:
// run-scan → table with checkbox per match → import.

function OpcUaEuromapModal({
  source, existingNodeIds, onClose, onCreateTag, onImport,
}: {
  source: OpcUaSource;
  existingNodeIds: Set<string>;
  onClose: () => void;
  onCreateTag: (tag: TagDef) => void;
  onImport: (picked: OpcUaEuromapVariable[], autoCreateTags: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    nodes_scanned: number;
    truncated: boolean;
    variables: OpcUaEuromapVariable[];
  } | null>(null);
  // Default = every match selected. Operator deselects what they don't want.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [autoCreateTags, setAutoCreateTags] = useState(true);
  // Kept for a future "create tag immediately" affordance per row.
  void onCreateTag;

  const runScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const det = await api.detectOpcUaEuromap({
        endpoint_url: source.endpoint_url,
        source_id: source.id,
        auth: source.auth,
        security_policy: source.security_policy,
      });
      setResult(det);
      // Pre-select every match that isn't already imported.
      setPicked(new Set(
        det.variables
          .filter((v) => !existingNodeIds.has(v.node_id))
          .map((v) => v.node_id),
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { runScan(); }, []);

  const togglePick = (nodeId: string) => {
    if (existingNodeIds.has(nodeId)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const pickedVariables = result
    ? result.variables.filter((v) => picked.has(v.node_id))
    : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
          width: 760, maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e293b",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              🤖 Auto-detect Euromap 77 / 83
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              {source.endpoint_url}
              {result && (
                <> · {result.nodes_scanned} nodi scansionati
                  {result.truncated && " (limite raggiunto)"}</>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", background: "#0a111e" }}>
          {busy && (
            <div style={{ padding: "24px 18px", color: "#94a3b8", fontSize: 13 }}>
              Scansione address space in corso (max ~500 nodi)…
            </div>
          )}
          {!busy && result && result.variables.length === 0 && (
            <div style={{ padding: "24px 18px", color: "#64748b", fontSize: 13, fontStyle: "italic" }}>
              Nessuna variabile Euromap 77 / 83 rilevata. Il server potrebbe non
              implementare le companion spec, oppure i nomi non corrispondono
              al match canonico. Usa "🔍 Sfoglia server" per esplorare manualmente.
            </div>
          )}
          {!busy && result && result.variables.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px", color: "#94a3b8", fontWeight: 600, width: 24 }}></th>
                  <th style={{ padding: "8px 12px", color: "#94a3b8", fontWeight: 600, width: 40 }}>Spec</th>
                  <th style={{ padding: "8px 12px", color: "#94a3b8", fontWeight: 600 }}>Variabile</th>
                  <th style={{ padding: "8px 12px", color: "#94a3b8", fontWeight: 600 }}>Tag suggerito</th>
                  <th style={{ padding: "8px 12px", color: "#94a3b8", fontWeight: 600 }}>NodeId</th>
                </tr>
              </thead>
              <tbody>
                {result.variables.map((v) => {
                  const imported = existingNodeIds.has(v.node_id);
                  const checked = picked.has(v.node_id);
                  return (
                    <tr
                      key={v.node_id}
                      onClick={() => togglePick(v.node_id)}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        cursor: imported ? "not-allowed" : "pointer",
                        background: checked ? "#0f2922" : "transparent",
                        color: imported ? "#475569" : "#cbd5e1",
                      }}
                    >
                      <td style={{ padding: "6px 12px" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={imported}
                          onChange={() => togglePick(v.node_id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 14, height: 14 }}
                        />
                      </td>
                      <td style={{ padding: "6px 12px",
                        fontFamily: "monospace", color: v.spec === "77" ? "#fbbf24" : "#a78bfa" }}>
                        {v.spec}
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <div style={{ fontWeight: 600 }}>{v.canonical_name}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{v.description}</div>
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#5eead4" }}>
                        {source.id}.{v.suggested_tag_suffix}
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace",
                        fontSize: 10, color: "#64748b" }}>
                        {v.node_id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1e293b",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
            <input
              type="checkbox"
              checked={autoCreateTags}
              onChange={(e) => setAutoCreateTags(e.target.checked)}
            />
            Crea automaticamente i tag SWS suggeriti
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={runScan} disabled={busy}>
              {busy ? "Scansione…" : "↻ Riprova"}
            </button>
            <button style={S.btn("ghost")} onClick={onClose}>Annulla</button>
            <button
              style={S.btn("primary")}
              disabled={pickedVariables.length === 0}
              onClick={() => onImport(pickedVariables, autoCreateTags)}
            >
              Importa {pickedVariables.length > 0 ? `(${pickedVariables.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModbusSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: ModbusTcpSource;
  onChange: (s: ModbusTcpSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof ModbusTcpSource>(k: K, v: ModbusTcpSource[K]) =>
    onChange({ ...source, [k]: v });

  const setRegister = (idx: number, patch: Partial<RegisterMapping>) =>
    onChange({
      ...source,
      registers: source.registers.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });

  const addRegister = () =>
    onChange({ ...source, registers: [...source.registers, emptyRegister()] });

  const removeRegister = (idx: number) =>
    onChange({ ...source, registers: source.registers.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      {/* Card header */}
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS TCP
          </span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{source.id}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {source.host}:{source.port} — {source.registers.length} registri
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "#475569", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          {/* Connection parameters */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px 80px",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID sorgente</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Host / IP</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Porta</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Unit ID</label>
              <input
                style={S.input}
                type="number"
                min={0} max={255}
                value={source.unit_id}
                onChange={(e) => setField("unit_id", Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
                Intervallo poll (ms)
              </label>
              <input
                style={S.input}
                type="number"
                min={100}
                value={source.poll_interval_ms}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))}
              />
            </div>
          </div>

          {/* Register mappings */}
          <div style={{ marginBottom: 6, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA REGISTRI HOLDING
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "40%" }}>Variabile (ID tag)</th>
                <th style={{ ...S.th, width: "20%" }}>Indirizzo reg.</th>
                <th style={{ ...S.th, width: "20%" }}>Scala (×)</th>
                <th style={{ ...S.th, width: "20%" }}>Tipo dato</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.registers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                    Nessun registro — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.registers.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={r.tag}
                        onChange={(v) => setRegister(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title="Crea variabile"
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: r.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      type="number"
                      min={0}
                      value={r.address}
                      onChange={(e) => setRegister(i, { address: Number(e.target.value) })}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      type="number"
                      step="0.001"
                      value={r.scale}
                      onChange={(e) => setRegister(i, { scale: Number(e.target.value) })}
                    />
                  </td>
                  <td style={{ ...S.td, color: "#64748b", fontSize: 11 }}>
                    Float (×scala)
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeRegister(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button style={S.btn("ghost")} onClick={addRegister}>
            + Aggiungi registro
          </button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setRegister(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}

// ── Modbus RTU card ───────────────────────────────────────────────────────────

function ModbusRtuSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: ModbusRtuSource;
  onChange: (s: ModbusRtuSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof ModbusRtuSource>(k: K, v: ModbusRtuSource[K]) =>
    onChange({ ...source, [k]: v });

  const setRegister = (idx: number, patch: Partial<RegisterMapping>) =>
    onChange({
      ...source,
      registers: source.registers.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });

  const addRegister = () =>
    onChange({ ...source, registers: [...source.registers, emptyRegister()] });

  const removeRegister = (idx: number) =>
    onChange({ ...source, registers: source.registers.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS RTU
          </span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{source.id}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {source.device} — {source.baud_rate} baud — {source.registers.length} registri
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "#475569", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          {/* Serial port parameters */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 80px 80px 80px 80px",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID sorgente</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Dispositivo seriale</label>
              <input style={S.input} value={source.device}
                onChange={(e) => setField("device", e.target.value)} spellCheck={false}
                placeholder="/dev/ttyUSB0" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Baud rate</label>
              <input style={S.input} type="number" min={1200} max={921600} step={100}
                value={source.baud_rate}
                onChange={(e) => setField("baud_rate", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Parità</label>
              <select style={S.input} value={source.parity}
                onChange={(e) => setField("parity", e.target.value)}>
                <option value="N">Nessuna (N)</option>
                <option value="E">Pari (E)</option>
                <option value="O">Dispari (O)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Bit dati</label>
              <select style={S.input} value={source.data_bits}
                onChange={(e) => setField("data_bits", Number(e.target.value))}>
                <option value={8}>8</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Bit stop</label>
              <select style={S.input} value={source.stop_bits}
                onChange={(e) => setField("stop_bits", Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "80px 160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Unit ID</label>
              <input style={S.input} type="number" min={0} max={255}
                value={source.unit_id}
                onChange={(e) => setField("unit_id", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Intervallo poll (ms)</label>
              <input style={S.input} type="number" min={100}
                value={source.poll_interval_ms}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
            </div>
          </div>

          {/* Register mappings — shared structure with Modbus TCP */}
          <div style={{ marginBottom: 6, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA REGISTRI HOLDING
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "40%" }}>Variabile (ID tag)</th>
                <th style={{ ...S.th, width: "20%" }}>Indirizzo reg.</th>
                <th style={{ ...S.th, width: "20%" }}>Scala (×)</th>
                <th style={{ ...S.th, width: "20%" }}>Tipo dato</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.registers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                    Nessun registro — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.registers.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={r.tag}
                        onChange={(v) => setRegister(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title="Crea variabile"
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: r.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} type="number" min={0}
                      value={r.address}
                      onChange={(e) => setRegister(i, { address: Number(e.target.value) })} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} type="number" step="0.001"
                      value={r.scale}
                      onChange={(e) => setRegister(i, { scale: Number(e.target.value) })} />
                  </td>
                  <td style={{ ...S.td, color: "#64748b", fontSize: 11 }}>Float (×scala)</td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeRegister(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button style={S.btn("ghost")} onClick={addRegister}>
            + Aggiungi registro
          </button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setRegister(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}

// ── MQTT card ─────────────────────────────────────────────────────────────────

function MqttSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: MqttSource;
  onChange: (s: MqttSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const setField = <K extends keyof MqttSource>(k: K, v: MqttSource[K]) =>
    onChange({ ...source, [k]: v });

  const setTopic = (idx: number, patch: Partial<TopicMapping>) =>
    onChange({
      ...source,
      topics: source.topics.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });

  const addTopic = () =>
    onChange({ ...source, topics: [...source.topics, emptyTopic()] });

  const removeTopic = (idx: number) =>
    onChange({ ...source, topics: source.topics.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#a855f7", fontWeight: 700, letterSpacing: 1 }}>
            MQTT
          </span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{source.id}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {source.host}:{source.port} — {source.topics.length} topic
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("ghost")}
            onClick={(e) => { e.stopPropagation(); setBrowseOpen(true); }}
          >
            Sfoglia broker
          </button>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "#475569", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 90px 1fr",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>ID sorgente</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Host / IP</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Porta</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Client ID</label>
              <input
                style={S.input}
                value={source.client_id}
                onChange={(e) => setField("client_id", e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <MqttAuthSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />
          <MqttConnectionSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />
          <MqttTlsSection
            tls={source.tls}
            onChange={(tls) => onChange({ ...source, tls })}
          />
          <MqttLastWillSection
            lw={source.last_will}
            onChange={(lw) => onChange({ ...source, last_will: lw })}
          />

          <div style={{ marginBottom: 6, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA TOPIC
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>Variabile (ID tag)</th>
                <th style={{ ...S.th, width: "32%" }}>Topic in (subscribe)</th>
                <th style={{ ...S.th, width: "14%" }}>JSON path (opz.)</th>
                <th style={{ ...S.th, width: "22%" }}>Topic out (publish, opz.)</th>
                <th style={{ ...S.th, width: "6%" }}>QoS</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.topics.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                    Nessun topic — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.topics.map((t, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={t.tag}
                        onChange={(v) => setTopic(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title="Crea variabile"
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: t.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="plant/floor1/temperature"
                      value={t.topic}
                      onChange={(e) => setTopic(i, { topic: e.target.value })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. temperature"
                      value={t.json_path ?? ""}
                      onChange={(e) => setTopic(i, { json_path: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. plant/floor1/cmd"
                      value={t.publish_topic ?? ""}
                      onChange={(e) => setTopic(i, { publish_topic: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <select
                      style={{ ...S.inputSm, cursor: "pointer" }}
                      value={t.qos ?? ""}
                      onChange={(e) => setTopic(i, { qos: e.target.value === "" ? undefined : Number(e.target.value) })}
                    >
                      <option value="">def.</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeTopic(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button style={S.btn("ghost")} onClick={addTopic}>
            + Aggiungi topic
          </button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setTopic(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
      {browseOpen && (
        <MqttBrowseModal
          source={source}
          onImport={(newTopics) => {
            onChange({ ...source, topics: [...source.topics, ...newTopics] });
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}

// ── MqttBrowseModal ───────────────────────────────────────────────────────────

function MqttBrowseModal({
  source,
  onImport,
  onClose,
}: {
  source: MqttSource;
  onImport: (topics: TopicMapping[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BrowsedTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per topic: suggested json_path (top-level key of JSON payload, if any).
  const [jsonPathPick, setJsonPathPick] = useState<Record<string, string>>({});
  const [duration, setDuration] = useState(8);
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
        background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
        padding: 20, width: "min(90vw, 740px)", maxHeight: "80vh",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, color: "#e2e8f0" }}>
            Sfoglia broker — {source.host}:{source.port}
          </div>
          <button style={{ ...S.btn("ghost"), padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11, color: "#64748b" }}>Durata (s)</label>
          <input
            style={{ ...S.input, width: 60 }}
            type="number" min={2} max={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={loading}
          />
          <button style={S.btn("primary")} onClick={startBrowse} disabled={loading}>
            {loading ? `Rilevamento… (${duration} s)` : result ? "Aggiorna" : "Avvia rilevamento"}
          </button>
          {result !== null && (
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {result.length} topic rilevati — {selected.size} selezionati
            </span>
          )}
        </div>

        {error && (
          <div style={{ ...S.notice, background: "#450a0a", borderColor: "#991b1b", color: "#fca5a5" }}>
            Errore: {error}
          </div>
        )}

        {/* Results */}
        {result !== null && (
          <>
            <input
              style={S.input}
              placeholder="Filtra topic…"
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
                    <th style={{ ...S.th, width: "36%" }}>Topic</th>
                    <th style={{ ...S.th, width: "32%" }}>Anteprima payload</th>
                    <th style={{ ...S.th }}>JSON path (opz.)</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ ...S.td, textAlign: "center", color: "#475569", padding: 12 }}>
                        Nessun topic corrisponde al filtro.
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
                              next.has(t.topic) ? next.delete(t.topic) : next.add(t.topic);
                              return next;
                            })}
                          />
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                          {t.topic}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
                              <option value="">— nessuno —</option>
                              {keys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: "#475569", fontSize: 11 }}>—</span>
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
          <button style={S.btn("ghost")} onClick={onClose}>Chiudi</button>
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

// ── MqttSourceCard sub-sections (auth / connection / TLS / last-will) ────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6, marginTop: 8, fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

function MqttAuthSection({
  source,
  onChange,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <SectionHeader>AUTENTICAZIONE</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Username</label>
          <input
            style={S.input}
            value={source.username ?? ""}
            onChange={(e) => onChange({ username: e.target.value || undefined })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
            Password{" "}
            <span style={{ color: "#475569" }}>(lascia "********" per non modificare)</span>
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              style={S.input}
              type={show ? "text" : "password"}
              value={source.password ?? ""}
              onChange={(e) => onChange({ password: e.target.value || undefined })}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              type="button"
              style={S.btn("ghost")}
              onClick={() => setShow((v) => !v)}
              title={show ? "Nascondi" : "Mostra"}
            >
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
            Password da env (opz.) — alternativa al campo password, letta a runtime
          </label>
          <input
            style={S.input}
            placeholder="es. MQTT_PUMP1_PWD"
            value={source.password_env ?? ""}
            onChange={(e) => onChange({ password_env: e.target.value || undefined })}
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

function MqttConnectionSection({
  source,
  onChange,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
}) {
  return (
    <>
      <SectionHeader>CONNESSIONE</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Keep-alive (s)</label>
          <input
            style={S.input}
            type="number" min={1} max={3600}
            value={source.keep_alive_secs ?? ""}
            placeholder="10"
            onChange={(e) => onChange({ keep_alive_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>QoS di default</label>
          <select
            style={{ ...S.input, cursor: "pointer" }}
            value={source.qos ?? ""}
            onChange={(e) => onChange({ qos: e.target.value === "" ? undefined : Number(e.target.value) })}
          >
            <option value="">0 (default)</option>
            <option value="0">0 — at most once</option>
            <option value="1">1 — at least once</option>
            <option value="2">2 — exactly once</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Clean session</label>
          <select
            style={{ ...S.input, cursor: "pointer" }}
            value={source.clean_session === undefined ? "" : source.clean_session ? "true" : "false"}
            onChange={(e) => onChange({ clean_session: e.target.value === "" ? undefined : e.target.value === "true" })}
          >
            <option value="">default (true)</option>
            <option value="true">true — drop server-side state</option>
            <option value="false">false — preserve subscriptions</option>
          </select>
        </div>
      </div>
    </>
  );
}

function MqttTlsSection({
  tls,
  onChange,
}: {
  tls?: MqttTlsConfig;
  onChange: (tls: MqttTlsConfig | undefined) => void;
}) {
  const current: MqttTlsConfig = tls ?? { enabled: false };
  const setField = <K extends keyof MqttTlsConfig>(k: K, v: MqttTlsConfig[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SectionHeader>TLS</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => setField("enabled", e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Abilita TLS
        </label>
        <input
          style={S.input}
          placeholder="ca_cert_path (PEM, richiesto se abilitato)"
          value={current.ca_cert_path ?? ""}
          onChange={(e) => setField("ca_cert_path", e.target.value || undefined)}
          spellCheck={false}
          disabled={!current.enabled}
        />
        <label style={{ fontSize: 11, color: "#fbbf24", cursor: "pointer" }} title="Non ancora implementato">
          <input
            type="checkbox"
            checked={current.insecure_skip_verify ?? false}
            onChange={(e) => setField("insecure_skip_verify", e.target.checked)}
            style={{ marginRight: 6 }}
            disabled={!current.enabled}
          />
          skip verify (not impl.)
        </label>
      </div>
    </>
  );
}

function MqttLastWillSection({
  lw,
  onChange,
}: {
  lw?: MqttLastWill;
  onChange: (lw: MqttLastWill | undefined) => void;
}) {
  const enabled = !!lw;
  const current: MqttLastWill = lw ?? { topic: "", payload: "", qos: 0, retain: false };
  const setField = <K extends keyof MqttLastWill>(k: K, v: MqttLastWill[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SectionHeader>LAST WILL</SectionHeader>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? current : undefined)}
            style={{ marginRight: 6 }}
          />
          Pubblica un last-will quando la connessione cade
        </label>
      </div>
      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, marginBottom: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Topic</label>
            <input
              style={S.input}
              placeholder="plant/floor1/status"
              value={current.topic}
              onChange={(e) => setField("topic", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Payload</label>
            <input
              style={S.input}
              placeholder="es. offline"
              value={current.payload}
              onChange={(e) => setField("payload", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>QoS</label>
            <select
              style={{ ...S.input, cursor: "pointer", minWidth: 70 }}
              value={current.qos}
              onChange={(e) => setField("qos", Number(e.target.value))}
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>Retain</label>
            <input
              type="checkbox"
              checked={current.retain}
              onChange={(e) => setField("retain", e.target.checked)}
              style={{ accentColor: "#3b82f6", marginTop: 5 }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── PROTOCOLS tab ─────────────────────────────────────────────────────────────

function ProtocolsTab() {
  const storeProject           = useAppStore((s) => s.project);
  const updateProjectSources   = useAppStore((s) => s.updateProjectSources);
  const updateProjectTags      = useAppStore((s) => s.updateProjectTags);

  const [sources, setSources]  = useState<SourceDef[]>(storeProject?.sources ?? []);
  const [saving, setSaving]    = useState(false);
  const [saved, setSaved]      = useState(false);
  // Tags created via QuickCreate inside this tab, pending save.
  const [pendingTags, setPendingTags] = useState<TagDef[]>([]);

  useEffect(() => {
    if (storeProject?.sources) setSources(storeProject.sources);
  }, [storeProject?.sources?.length]);

  const addModbus = () =>
    setSources((prev) => [...prev, emptyModbus()]);

  const addModbusRtu = () =>
    setSources((prev) => [...prev, emptyModbusRtu()]);

  const addMqtt = () =>
    setSources((prev) => [...prev, emptyMqtt()]);

  const addOpcUa = () =>
    setSources((prev) => [...prev, emptyOpcUa()]);

  const addOpcUaServer = () =>
    setSources((prev) => [...prev, emptyOpcUaServer()]);

  const addHomeAssistant = () =>
    setSources((prev) => [...prev, emptyHomeAssistant()]);

  const updateSource = (idx: number, updated: SourceDef) =>
    setSources((prev) => prev.map((s, i) => (i === idx ? updated : s)));

  const removeSource = (idx: number) =>
    setSources((prev) => prev.filter((_, i) => i !== idx));

  const handleCreateTag = (tag: TagDef) => {
    setPendingTags((prev) => {
      const existingIds = new Set([
        ...(storeProject?.tags ?? []).map(t => t.id),
        ...prev.map(t => t.id),
      ]);
      if (existingIds.has(tag.id)) return prev;
      return [...prev, tag];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSources(sources);
      updateProjectSources(sources);
      if (pendingTags.length > 0) {
        const allTags = [...(storeProject?.tags ?? []), ...pendingTags];
        await api.updateTags(allTags);
        updateProjectTags(allTags);
        setPendingTags([]);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>SORGENTI DATI / PROTOCOLLI</div>
      <div style={S.notice}>
        Configura le connessioni ai dispositivi di campo. Supportati: <strong>Modbus TCP</strong>
        (lettura registri holding), <strong>Modbus RTU</strong> (RS-485/RS-232 seriale),
        <strong>MQTT</strong> (sottoscrizione topic),
        <strong>OPC-UA client</strong> (subscription, security None),
        <strong>OPC-UA server</strong> (espone tag SWS a SCADA/MES superiori),
        <strong>HomeAssistant</strong> (sensori e attuatori domotica via WebSocket).
        Le sorgenti vengono ricollegate <strong>in tempo reale</strong> al salvataggio (niente
        riavvio del runtime).
      </div>

      {sources.length === 0 && (
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 16 }}>
          Nessuna sorgente configurata.
        </div>
      )}

      {sources.map((src, i) => {
        if (src.kind === "modbus_tcp") {
          return (
            <ModbusSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "modbus_rtu") {
          return (
            <ModbusRtuSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "mqtt") {
          return (
            <MqttSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "opcua_client") {
          return (
            <OpcUaSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "opcua_server") {
          return (
            <OpcUaServerSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "homeassistant") {
          return (
            <HomeAssistantSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        return null;
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <button style={S.btn("ghost")} onClick={addModbus}>
          + Aggiungi Modbus TCP
        </button>
        <button style={S.btn("ghost")} onClick={addModbusRtu}>
          + Aggiungi Modbus RTU
        </button>
        <button style={S.btn("ghost")} onClick={addMqtt}>
          + Aggiungi MQTT
        </button>
        <button style={S.btn("ghost")} onClick={addOpcUa}>
          + Aggiungi OPC-UA client
        </button>
        <button style={S.btn("ghost")} onClick={addOpcUaServer}>
          + Aggiungi OPC-UA server
        </button>
        <button style={S.btn("ghost")} onClick={addHomeAssistant}>
          + Aggiungi HomeAssistant
        </button>
      </div>

      {pendingTags.length > 0 && (
        <div style={{ ...S.notice, marginTop: 12 }}>
          {pendingTags.length} variabil{pendingTags.length === 1 ? "e" : "i"} nuov{pendingTags.length === 1 ? "a" : "e"} in attesa di salvataggio:{" "}
          {pendingTags.map(t => t.id).join(", ")}
        </div>
      )}
      <SaveBar
        onSave={handleSave}
        saving={saving}
        saved={saved}
        savedNotice="✓ Salvato — sorgenti ricollegate al volo."
      />
    </div>
  );
}

// ── ALARMS tab ────────────────────────────────────────────────────────────────

function emptyAlarm(): AlarmDef {
  return {
    id: `alm-${genId()}`,
    tag: "",
    condition: { kind: "above", threshold: 0 },
    message: "",
    severity: "Warning",
  };
}

function AlarmsTab() {
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectAlarms = useAppStore((s) => s.updateProjectAlarms);
  const liveAlarms          = useAppStore((s) => s.alarms);

  const [alarms, setAlarms] = useState<AlarmDef[]>(storeProject?.alarms ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    if (storeProject?.alarms) setAlarms(storeProject.alarms);
  }, [storeProject?.alarms?.length]);

  const addAlarm = () =>
    setAlarms((prev) => [...prev, emptyAlarm()]);

  const updateAlarm = (idx: number, patch: Partial<AlarmDef>) =>
    setAlarms((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

  const updateCondition = (idx: number, cond: AlarmCondition) =>
    updateAlarm(idx, { condition: cond });

  const removeAlarm = (idx: number) =>
    setAlarms((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    const valid = alarms.filter((a) => a.id.trim() !== "" && a.tag.trim() !== "");
    setSaving(true);
    try {
      await api.updateAlarms(valid);
      updateProjectAlarms(valid);
      setAlarms(valid);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>ALLARMI</div>
      <div style={S.notice}>
        Ogni allarme osserva una variabile e si attiva quando la condizione è
        soddisfatta. Condizioni disponibili: <em>above</em> / <em>below</em>
        (soglia numerica) e <em>bool_equals</em> (per tag booleani). Lo stato
        attivo è mostrato nella barra in alto della UI.
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "16%" }}>ID</th>
            <th style={{ ...S.th, width: "18%" }}>Tag</th>
            <th style={{ ...S.th, width: "10%" }}>Condizione</th>
            <th style={{ ...S.th, width: "10%" }}>Soglia</th>
            <th style={{ ...S.th, width: "8%" }} title="Isteresi: l'allarme rientra solo quando il valore supera (soglia ± dead-band)">Dead-band</th>
            <th style={{ ...S.th, width: "10%" }}>Severità</th>
            <th style={{ ...S.th, width: "20%" }}>Messaggio</th>
            <th style={{ ...S.th, width: "6%" }}>Stato</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {alarms.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
                Nessun allarme definito.
              </td>
            </tr>
          )}
          {alarms.map((alm, i) => {
            const live = liveAlarms[alm.id];
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                <td style={S.td}>
                  <input
                    style={S.inputSm}
                    value={alm.id}
                    onChange={(e) => updateAlarm(i, { id: e.target.value })}
                    spellCheck={false}
                  />
                </td>
                <td style={S.td}>
                  <TagInput
                    style={S.inputSm}
                    placeholder="es. boiler.t"
                    value={alm.tag}
                    onChange={(v) => updateAlarm(i, { tag: v })}
                  />
                </td>
                <td style={S.td}>
                  <select
                    style={{ ...S.inputSm, cursor: "pointer" }}
                    value={alm.condition.kind}
                    onChange={(e) => {
                      const kind = e.target.value as AlarmCondition["kind"];
                      if (kind === "above" || kind === "below") {
                        updateCondition(i, { kind, threshold: 0 });
                      } else {
                        updateCondition(i, { kind: "bool_equals", value: true });
                      }
                    }}
                  >
                    <option value="above">above</option>
                    <option value="below">below</option>
                    <option value="bool_equals">bool_equals</option>
                  </select>
                </td>
                <td style={S.td}>
                  {alm.condition.kind === "bool_equals" ? (
                    <select
                      style={{ ...S.inputSm, cursor: "pointer" }}
                      value={alm.condition.value ? "true" : "false"}
                      onChange={(e) =>
                        updateCondition(i, { kind: "bool_equals", value: e.target.value === "true" })
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      style={S.inputSm}
                      type="number"
                      step="any"
                      value={alm.condition.threshold}
                      onChange={(e) => {
                        const kind = alm.condition.kind as "above" | "below";
                        updateCondition(i, { kind, threshold: Number(e.target.value) });
                      }}
                    />
                  )}
                </td>
                <td style={S.td}>
                  {/* dead_band: only meaningful for above/below conditions */}
                  {alm.condition.kind !== "bool_equals" && (
                    <input
                      style={S.inputSm}
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      title="Isteresi: l'allarme rientra solo a (soglia ± dead-band)"
                      value={alm.dead_band ?? ""}
                      onChange={(e) => updateAlarm(i, { dead_band: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                  )}
                </td>
                <td style={S.td}>
                  <select
                    style={{ ...S.inputSm, cursor: "pointer" }}
                    value={alm.severity ?? "Warning"}
                    onChange={(e) => updateAlarm(i, { severity: e.target.value as AlarmSeverity })}
                  >
                    <option value="Info">Info</option>
                    <option value="Warning">Warning</option>
                    <option value="Critical">Critical</option>
                  </select>
                </td>
                <td style={S.td}>
                  <input
                    style={S.inputSm}
                    placeholder="es. Temperatura alta"
                    value={alm.message}
                    onChange={(e) => updateAlarm(i, { message: e.target.value })}
                  />
                  <input
                    style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                    placeholder="🔔 URL webhook (opz.)"
                    value={alm.notify_url ?? ""}
                    onChange={(e) => updateAlarm(i, { notify_url: e.target.value || undefined })}
                  />
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {live ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: live.active
                        ? (live.acknowledged ? "#eab308" : "#ef4444")
                        : "#64748b",
                    }}>
                      {live.active ? (live.acknowledged ? "ACK" : "ON") : "—"}
                    </span>
                  ) : (
                    <span style={{ color: "#334155", fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <button style={S.btn("danger")} onClick={() => removeAlarm(i)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button style={S.btn("ghost")} onClick={addAlarm}>+ Aggiungi allarme</button>
      </div>

      <SaveBar onSave={handleSave} saving={saving} saved={saved} />
    </div>
  );
}

// ── SYSTEM tab ───────────────────────────────────────────────────────────────

interface SystemStatus {
  runtime_version: string;
  uptime_s: number;
  active_project: string | null;
  tag_count: number;
  source_count: number;
  alarm_active_count: number;
  historian_samples: number;
  cpu_usage_pct: number;
  mem_used_mb: number;
  mem_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#0f172a", borderRadius: 4, height: 8, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{value}</div>
    </div>
  );
}

function SystemTab() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const s = await api.getSystemStatus();
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    void fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const fmtSamples = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M campioni`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k campioni`;
    return `${n} campioni`;
  };

  if (error) {
    return (
      <div style={{ color: "#fca5a5", background: "#450a0a", border: "1px solid #991b1b", borderRadius: 6, padding: "12px 16px", fontSize: 13 }}>
        Errore caricamento stato sistema: {error}
      </div>
    );
  }

  if (!status) {
    return <div style={{ color: "#64748b", fontSize: 13 }}>Caricamento…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 10 }}>
          RUNTIME
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MetricCard icon="🖥" label="Versione" value={status.runtime_version} />
          <MetricCard icon="📦" label="Progetto" value={status.active_project ?? "—"} />
          <MetricCard icon="⏱" label="Uptime" value={fmtUptime(status.uptime_s)} />
          <MetricCard icon="🏷" label="Tag" value={String(status.tag_count)} />
          <MetricCard icon="📡" label="Sorgenti" value={String(status.source_count)} />
          <MetricCard icon="🔔" label="Allarmi attivi" value={String(status.alarm_active_count)} />
        </div>
        <div style={{ marginTop: 8, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>📊 Storico</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{fmtSamples(status.historian_samples)}</div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 10 }}>
          SISTEMA
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>⚙ CPU</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{status.cpu_usage_pct.toFixed(1)}%</span>
            </div>
            <ProgressBar value={status.cpu_usage_pct} max={100} color="#60a5fa" />
          </div>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>💾 RAM</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{status.mem_used_mb} MB / {status.mem_total_mb} MB</span>
            </div>
            <ProgressBar value={status.mem_used_mb} max={status.mem_total_mb} color="#34d399" />
          </div>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>💿 Disco</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{status.disk_used_gb} GB / {status.disk_total_gb} GB</span>
            </div>
            <ProgressBar value={status.disk_used_gb} max={status.disk_total_gb} color="#fb923c" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ConfigView ───────────────────────────────────────────────────────────

// ── USERS tab ─────────────────────────────────────────────────────────────────
// Admin-only CRUD over `/api/auth/users`. Reset-password uses the same PUT
// as a role change — there's no dedicated "reset" endpoint, just a `password`
// field on UpdateUserBody. Non-admins never see this tab (the bar hides it).

const ROLES: UserRole[] = ["Viewer", "Operator", "Supervisor", "Admin"];

function UsersTab() {
  const authUser = useAppStore((s) => s.authUser);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  // New-user form state
  const [newUser, setNewUser] = useState<CreateUserBody>({
    username: "", password: "", role: "Operator", must_change_password: true,
  });

  // Per-row "reset password" buffer keyed by username.
  const [resetBuf, setResetBuf] = useState<Record<string, string>>({});

  const refresh = async () => {
    setError(null);
    try {
      const list = await api.listUsers();
      setUsers(list);
    } catch (e: any) {
      setError(`Errore nel caricamento utenti: ${String(e?.message ?? e)}`);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const fmtDate = (ms: number) => {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleString();
  };

  const onCreate = async () => {
    setError(null);
    if (!newUser.username.trim() || !newUser.password) {
      setError("Username e password sono obbligatori.");
      return;
    }
    setBusy(true);
    try {
      await api.createUser({
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role,
        must_change_password: newUser.must_change_password ?? true,
      });
      setNewUser({ username: "", password: "", role: "Operator", must_change_password: true });
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("409") || msg.includes("already_exists")) {
        setError(`L'utente "${newUser.username}" esiste già.`);
      } else {
        setError(`Errore nella creazione: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onPatch = async (username: string, patch: UpdateUserBody) => {
    setError(null);
    setBusy(true);
    try {
      await api.updateUser(username, patch);
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("409") || msg.includes("last_admin")) {
        setError("Non puoi rimuovere l'ultimo amministratore.");
      } else if (msg.includes("400") || msg.includes("invalid_password")) {
        setError("Password non valida.");
      } else {
        setError(`Errore nell'aggiornamento: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async (username: string) => {
    const pwd = resetBuf[username];
    if (!pwd) return;
    await onPatch(username, { password: pwd, must_change_password: true });
    setResetBuf((prev) => ({ ...prev, [username]: "" }));
  };

  const onDelete = async (username: string) => {
    if (username === authUser) {
      setError("Non puoi eliminare il tuo stesso utente.");
      return;
    }
    if (!confirm(`Eliminare l'utente "${username}"?`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteUser(username);
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("409") || msg.includes("last_admin")) {
        setError("Non puoi eliminare l'ultimo amministratore.");
      } else if (msg.includes("cannot_delete_self")) {
        setError("Non puoi eliminare il tuo stesso utente.");
      } else {
        setError(`Errore nell'eliminazione: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={S.section}>
        <div style={S.sectionTitle}>UTENTI</div>
        <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 0 }}>
          Gli utenti sono salvati in <code>users.yaml</code> nella cartella del progetto.
          La password viene cifrata con Argon2id; il file non contiene mai testo in chiaro.
        </p>

        {error && (
          <div style={{ color: "#fca5a5", background: "#7f1d1d33", padding: "8px 10px", borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {users === null ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Caricamento…</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Utente</th>
                <th style={S.th}>Ruolo</th>
                <th style={S.th}>Cambio pwd</th>
                <th style={S.th}>Aggiornato</th>
                <th style={S.th}>Reset password</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.username === authUser;
                return (
                  <tr key={u.username}>
                    <td style={S.td}>
                      <strong>{u.username}</strong>
                      {isSelf && <span style={{ marginLeft: 6, color: "#64748b", fontSize: 11 }}>(tu)</span>}
                    </td>
                    <td style={S.td}>
                      <select
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => onPatch(u.username, { role: e.target.value as UserRole })}
                        style={S.input}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={S.td}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={u.must_change_password}
                          disabled={busy}
                          onChange={(e) => onPatch(u.username, { must_change_password: e.target.checked })}
                        />
                        forza
                      </label>
                    </td>
                    <td style={S.td}>
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>{fmtDate(u.updated_at_ms)}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="password"
                          value={resetBuf[u.username] ?? ""}
                          placeholder="nuova password"
                          onChange={(e) => setResetBuf((prev) => ({ ...prev, [u.username]: e.target.value }))}
                          style={{ ...S.inputSm, minWidth: 140 }}
                        />
                        <button
                          type="button"
                          disabled={busy || !(resetBuf[u.username] ?? "").length}
                          onClick={() => onResetPassword(u.username)}
                          style={S.btn("primary")}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                    <td style={S.td}>
                      <button
                        type="button"
                        disabled={busy || isSelf}
                        onClick={() => onDelete(u.username)}
                        style={S.btn("danger")}
                        title={isSelf ? "Non puoi eliminare il tuo stesso utente" : "Elimina utente"}
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>NUOVO UTENTE</div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 130px auto",
          gap: 8,
          alignItems: "end",
        }}>
          <div>
            <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Username</label>
            <input
              type="text"
              value={newUser.username}
              onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
              style={S.input}
              placeholder="es. operatore2"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Password iniziale</label>
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
              style={S.input}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Ruolo</label>
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value as UserRole }))}
              style={S.input}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || !newUser.username.trim() || !newUser.password}
            style={S.btn("success")}
          >
            + Crea
          </button>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={newUser.must_change_password ?? true}
            onChange={(e) => setNewUser((s) => ({ ...s, must_change_password: e.target.checked }))}
          />
          Forza cambio password al primo accesso (consigliato)
        </label>
      </div>
    </div>
  );
}

// ── ResourcesTab ─────────────────────────────────────────────────────────────

const LICENSE_OPTIONS = ["CC0 1.0", "CC-BY 4.0", "Apache-2.0", "MIT", "BSD-2-Clause", "Public domain"];

const EMPTY_FORM = { label: "", url: "", author: "", source: "", license: "CC0 1.0" };

function ResourcesTab() {
  const customSymbols          = useAppStore((s) => s.customSymbols);
  const updateProjectCustomSymbols = useAppStore((s) => s.updateProjectCustomSymbols);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const persist = async (next: typeof customSymbols) => {
    setSaving(true); setError(null);
    try {
      await api.updateCustomSymbols(next);
      updateProjectCustomSymbols(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    const id = form.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (customSymbols.some((s) => s.id === id)) {
      setError(`Esiste già un simbolo con id "${id}"`);
      return;
    }
    const next = [
      ...customSymbols,
      { id, label: form.label.trim(), url: form.url.trim(),
        attribution: { author: form.author.trim(), source: form.source.trim(), license: form.license } },
    ];
    await persist(next);
    if (!error) setForm(EMPTY_FORM);
  };

  const remove = (id: string) => persist(customSymbols.filter((s) => s.id !== id));

  const inp: React.CSSProperties = {
    background: "#0f172a", border: "1px solid #334155", borderRadius: 4,
    color: "#e2e8f0", padding: "4px 8px", fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: "#64748b", marginBottom: 2 };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 700 }}>

      {/* Simboli già aggiunti */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
          SIMBOLI PROGETTO ({customSymbols.length})
        </div>
        {customSymbols.length === 0 ? (
          <div style={{ color: "#475569", fontSize: 13 }}>Nessun simbolo custom aggiunto.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#64748b", borderBottom: "1px solid #334155" }}>
                {["Etichetta", "URL", "Licenza", "Autore / fonte", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customSymbols.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "6px 8px", color: "#e2e8f0" }}>{s.label}</td>
                  <td style={{ padding: "6px 8px", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6" }}>{s.url}</a>
                  </td>
                  <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{s.attribution.license}</td>
                  <td style={{ padding: "6px 8px", color: "#64748b" }}>{s.attribution.author}{s.attribution.source ? ` / ${s.attribution.source}` : ""}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      onClick={() => remove(s.id)}
                      style={{ background: "transparent", border: "1px solid #7f1d1d", borderRadius: 4, color: "#fca5a5", cursor: "pointer", padding: "2px 8px", fontSize: 12 }}
                    >Rimuovi</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Form aggiunta */}
      <section style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
          AGGIUNGI SIMBOLO SVG
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px 12px", alignItems: "start" }}>
          <div>
            <div style={lbl}>Etichetta *</div>
            <input style={inp} placeholder="es. Pompa centrifuga" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div>
            <div style={lbl}>URL SVG * (https://… oppure /symbols/…)</div>
            <input style={inp} placeholder="https://example.com/pump.svg" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          </div>
          <div>
            <div style={lbl}>Licenza *</div>
            <select style={{ ...inp, cursor: "pointer" }} value={form.license} onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}>
              {LICENSE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>Autore</div>
            <input style={inp} placeholder="es. Wikimedia Commons / Mario Rossi" value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={lbl}>URL fonte (per attribuzione CC-BY)</div>
            <input style={inp} placeholder="https://commons.wikimedia.org/wiki/…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          </div>
        </div>
        {error && <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={add}
            disabled={saving || !form.label.trim() || !form.url.trim()}
            style={{
              background: "#3b82f6", border: "none", borderRadius: 4, color: "#fff",
              cursor: saving ? "wait" : "pointer", padding: "6px 20px", fontSize: 13,
              opacity: (!form.label.trim() || !form.url.trim()) ? 0.5 : 1,
            }}
          >{saving ? "Salvataggio…" : "Aggiungi al progetto"}</button>
          <span style={{ fontSize: 11, color: "#475569" }}>
            Confermando accetti di rispettare i termini della licenza selezionata.
          </span>
        </div>
      </section>
    </div>
  );
}

// ── DATASTORES tab ────────────────────────────────────────────────────────────

function newSqliteConfig(): DatastoreBackendConfig {
  return { kind: "sqlite", path: ".history/historian.db" };
}
function newPostgresConfig(): DatastoreBackendConfig {
  return { kind: "postgres", host: "localhost", port: 5432, database: "sws", username: "sws", password: "", ssl_mode: "disable", schema: "public" };
}
function newOdbcConfig(): DatastoreBackendConfig {
  return { kind: "odbc", dsn: "", connection_string: "", table: "sws_samples", col_tag: "tag_id", col_value: "value", col_ts: "ts_ms" };
}

function DatastoresTab() {
  const project = useAppStore((s) => s.project);
  const [datastores, setDatastores] = useState<DatastoreConfig[]>(project?.datastores ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [statsMap, setStatsMap]   = useState<Record<string, DatastoreStats | null>>({});

  // Keep local copy in sync when project reloads.
  useEffect(() => {
    setDatastores(project?.datastores ?? []);
    setDirty(false);
  }, [project]);

  const update = (ds: DatastoreConfig[]) => { setDatastores(ds); setDirty(true); };

  const addDatastore = () => {
    const id = `ds_${Date.now()}`;
    update([...datastores, { id, label: "Nuovo datastore", backend: newSqliteConfig(), retention_rows: undefined, retention_days: undefined }]);
  };

  const removeDatastore = (id: string) => update(datastores.filter((d) => d.id !== id));

  const setBackendKind = (id: string, kind: "sqlite" | "postgres" | "odbc") => {
    update(datastores.map((d) =>
      d.id === id ? { ...d, backend: kind === "sqlite" ? newSqliteConfig() : kind === "postgres" ? newPostgresConfig() : newOdbcConfig() } : d
    ));
  };

  const patchDs = (id: string, patch: Partial<DatastoreConfig>) =>
    update(datastores.map((d) => d.id === id ? { ...d, ...patch } : d));

  const patchBackend = (id: string, patch: Partial<DatastoreBackendConfig>) =>
    update(datastores.map((d) => d.id === id ? { ...d, backend: { ...d.backend, ...patch } as DatastoreBackendConfig } : d));

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      await api.saveDatastores(datastores);
      setDirty(false);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const testDs = async (id: string) => {
    setStatusMap((m) => ({ ...m, [id]: { ok: false, msg: "Test…" } }));
    try {
      const msg = await api.testDatastore(id);
      setStatusMap((m) => ({ ...m, [id]: { ok: true, msg } }));
    } catch (e) {
      setStatusMap((m) => ({ ...m, [id]: { ok: false, msg: String(e) } }));
    }
  };

  const loadStats = async (id: string) => {
    setStatsMap((m) => ({ ...m, [id]: null }));
    try {
      const stats = await api.datastoreStats(id);
      setStatsMap((m) => ({ ...m, [id]: stats }));
    } catch { /* ignore */ }
  };

  const cellStyle: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #1e293b", verticalAlign: "top" };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 2 };
  const inputStyle: React.CSSProperties = { width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: 4, padding: "3px 6px", fontSize: 12 };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "#94a3b8", flex: 1 }}>
          Configura i backend di persistenza dati storici. Ogni variabile con &quot;history&quot; attivo
          viene scritta nel datastore assegnato.
        </span>
        <button onClick={addDatastore} style={{ background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
          + Aggiungi
        </button>
        <button onClick={save} disabled={!dirty || saving}
          style={{ background: dirty ? "#22c55e" : "#334155", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: dirty ? "pointer" : "default", fontSize: 12 }}>
          {saving ? "Salvo…" : "Salva"}
        </button>
      </div>
      {saveError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{saveError}</div>}

      {datastores.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 13, padding: 24, textAlign: "center" }}>
          Nessun datastore configurato. Usa il pulsante + per aggiungerne uno.
        </div>
      )}

      {datastores.map((ds) => {
        const status = statusMap[ds.id];
        const stats  = statsMap[ds.id];
        return (
          <div key={ds.id} style={{ background: "#1e293b", borderRadius: 6, padding: 12, marginBottom: 12, border: "1px solid #334155" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input
                value={ds.label}
                onChange={(e) => patchDs(ds.id, { label: e.target.value })}
                placeholder="Etichetta"
                style={{ ...inputStyle, flex: 1, fontWeight: 600, fontSize: 13 }}
              />
              <input
                value={ds.id}
                onChange={(e) => patchDs(ds.id, { id: e.target.value })}
                placeholder="id (slug)"
                style={{ ...inputStyle, width: 140, fontFamily: "monospace" }}
              />
              <select
                value={ds.backend.kind}
                onChange={(e) => setBackendKind(ds.id, e.target.value as "sqlite" | "postgres" | "odbc")}
                style={{ ...inputStyle, width: 110 }}>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
                <option value="odbc">ODBC</option>
              </select>
              <button onClick={() => testDs(ds.id)} style={{ background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>Test</button>
              <button onClick={() => loadStats(ds.id)} style={{ background: "#475569", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>Stats</button>
              <button onClick={() => removeDatastore(ds.id)} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>X</button>
            </div>

            {/* Status + stats row */}
            {status && (
              <div style={{ fontSize: 11, color: status.ok ? "#4ade80" : "#f87171", marginBottom: 8 }}>
                {status.msg}
              </div>
            )}
            {stats !== undefined && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, display: "flex", gap: 16 }}>
                {stats === null ? "Caricamento stats…" : (
                  <>
                    <span>Campioni: {stats.sample_count.toLocaleString()}</span>
                    <span>Tag: {stats.tag_count}</span>
                    {stats.size_bytes != null && <span>Dim: {(stats.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                    <span style={{ color: stats.connected ? "#4ade80" : "#f87171" }}>{stats.connected ? "Connesso" : stats.error ?? "Disconnesso"}</span>
                  </>
                )}
              </div>
            )}

            {/* Backend-specific fields */}
            {ds.backend.kind === "sqlite" && (
              <div style={cellStyle}>
                <span style={labelStyle}>Percorso file</span>
                <input value={ds.backend.path} onChange={(e) => patchBackend(ds.id, { path: e.target.value })} style={inputStyle} placeholder=".history/historian.db" />
              </div>
            )}

            {ds.backend.kind === "postgres" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["host", "port", "database", "username", "password", "ssl_mode", "schema"] as const).map((field) => (
                  <div key={field} style={cellStyle}>
                    <span style={labelStyle}>{field}</span>
                    <input
                      type={field === "password" ? "password" : "text"}
                      value={String((ds.backend as unknown as Record<string, unknown>)[field] ?? "")}
                      onChange={(e) => patchBackend(ds.id, { [field]: field === "port" ? Number(e.target.value) : e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            )}

            {ds.backend.kind === "odbc" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["dsn", "connection_string", "table", "col_tag", "col_value", "col_ts"] as const).map((field) => (
                  <div key={field} style={cellStyle}>
                    <span style={labelStyle}>{field}</span>
                    <input
                      value={String((ds.backend as unknown as Record<string, unknown>)[field] ?? "")}
                      onChange={(e) => patchBackend(ds.id, { [field]: e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Retention */}
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <div>
                <span style={labelStyle}>Max righe per tag</span>
                <input type="number" min={0}
                  value={ds.retention_rows ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_rows: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder="illimitato" />
              </div>
              <div>
                <span style={labelStyle}>Giorni di ritenzione</span>
                <input type="number" min={0}
                  value={ds.retention_days ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_days: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder="illimitato" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ConfigView root ───────────────────────────────────────────────────────────

type ConfigTab = "tags" | "protocols" | "alarms" | "datastores" | "users" | "resources" | "system" | "backups";

const TAB_LABELS: Record<ConfigTab, string> = {
  tags:        "Variabili",
  protocols:   "Protocolli",
  alarms:      "Allarmi",
  datastores:  "Datastore",
  users:       "Utenti",
  resources:   "Risorse",
  system:      "Stato",
  backups:     "Backup",
};

export function ConfigView() {
  const storeTab    = useAppStore((s) => s.configTab) as ConfigTab;
  const setStoreTab = useAppStore((s) => s.setConfigTab);
  const [tab, setTab] = useState<ConfigTab>(storeTab);
  const authRole = useAppStore((s) => s.authRole);
  const isAdmin = authRole === "Admin";
  const project = useAppStore((s) => s.project);

  // Sync when the store tab changes (e.g. navigateToConfig from LeftPanel).
  useEffect(() => { setTab(storeTab); }, [storeTab]);

  const handleSetTab = (t: ConfigTab) => {
    setTab(t);
    setStoreTab(t);
  };

  // Hide the Utenti tab for non-admins; if the URL/state ever sneaks them
  // onto it, bounce back to tags.
  useEffect(() => {
    if (tab === "users" && !isAdmin) handleSetTab("tags");
  }, [tab, isAdmin]);

  const visibleTabs: ConfigTab[] = isAdmin
    ? ["tags", "protocols", "alarms", "datastores", "users", "resources", "backups", "system"]
    : ["tags", "protocols", "alarms", "resources", "system"];

  // Bounce non-admins off the backups and datastores tabs.
  useEffect(() => {
    if (tab === "backups"    && !isAdmin) handleSetTab("tags");
    if (tab === "datastores" && !isAdmin) handleSetTab("tags");
  }, [tab, isAdmin]);

  // Guard: tags/protocols/alarms tabs all initialise their local state from
  // store.project. If project hasn't loaded yet, rendering them would show
  // empty inputs over a populated YAML and a subsequent save would wipe the
  // file. The other tabs are independent so they stay available.
  const projectLoading = project === null
    && tab !== "users" && tab !== "resources" && tab !== "system"
    && tab !== "backups" && tab !== "datastores";

  // Belt-and-braces: App.tsx already gates mode="config" via effectiveMode,
  // so this is unreachable for non-Supervisor+ today. Kept so a future
  // direct mount can't slip past the role check. Placed after all hooks
  // to keep React's rules-of-hooks invariant intact across role changes.
  if (!canConfigureProject(authRole)) return null;

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {visibleTabs.map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => handleSetTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {projectLoading ? (
          <div style={{ color: "#64748b", fontSize: 13, padding: 24 }}>
            Caricamento progetto…
          </div>
        ) : (
          <>
            {tab === "tags"        && <TagsTab />}
            {tab === "protocols"   && <ProtocolsTab />}
            {tab === "alarms"      && <AlarmsTab />}
            {tab === "datastores"  && isAdmin && <DatastoresTab />}
            {tab === "users"       && isAdmin && <UsersTab />}
            {tab === "resources"   && <ResourcesTab />}
            {tab === "system"      && <SystemTab />}
            {tab === "backups"     && isAdmin && <BackupsTab />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Backups tab ──────────────────────────────────────────────────────────────
//
// Admin-only list / create / restore / delete on `/api/backups`. Backups are
// snapshots of `project.yaml`, `synoptics/`, and `users.yaml` under
// `<project>/.bak/<UTC-timestamp>/`. The runtime also takes them
// automatically when `--auto-backup-interval-minutes` is set.

function BackupsTab() {
  type BackupInfo = { name: string; created_at_ms: number; size_bytes: number };
  const [list, setList]       = useState<BackupInfo[] | null>(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const refresh = async () => {
    setErr(null);
    try {
      const r = await api.listBackups();
      setList(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { refresh(); }, []);

  const createNow = async () => {
    setBusy(true);
    try {
      await api.createBackup();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string) => {
    if (!window.confirm(
      `Ripristinare il backup "${name}"?\n\n` +
      `Sovrascrive project.yaml, tutte le synoptic e users.yaml dal backup.\n` +
      `Le modifiche non salvate sul disco vengono perse.`
    )) return;
    setBusy(true);
    try {
      await api.restoreBackup(name);
      // Reload the project so the UI reflects the restored state.
      const p = await api.getProject();
      useAppStore.getState().setProject(p);
      const names = await api.listSynoptics();
      const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
      useAppStore.getState().setPages(pages);
      await refresh();
      window.alert(`Backup "${name}" ripristinato.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (name: string) => {
    if (!window.confirm(`Eliminare il backup "${name}"? L'azione è definitiva.`)) return;
    setBusy(true);
    try {
      await api.deleteBackup(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmtSize = (b: number) => b < 1024 ? `${b} B`
    : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1024 / 1024).toFixed(1)} MB`;
  const fmtDate = (ms: number) => ms > 0
    ? new Date(ms).toLocaleString()
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
        Snapshot point-in-time del progetto (project.yaml + synoptics + users.yaml)
        salvati sotto <code>{`<project>/.bak/`}</code>. Il runtime ne crea uno automaticamente
        ogni N minuti se avviato con <code>--auto-backup-interval-minutes</code>.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={createNow}
          disabled={busy}
          style={{
            padding: "6px 14px", background: "#16a34a", color: "#f0fdf4",
            border: "none", borderRadius: 4, cursor: busy ? "wait" : "pointer",
            fontSize: 13, fontWeight: 600,
          }}
        >
          + Backup adesso
        </button>
        <button
          onClick={refresh}
          disabled={busy}
          style={{
            padding: "6px 14px", background: "#1e293b", color: "#cbd5e1",
            border: "1px solid #334155", borderRadius: 4,
            cursor: busy ? "wait" : "pointer", fontSize: 13,
          }}
        >
          ↻ Aggiorna
        </button>
      </div>
      {err && (
        <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
          Errore: {err}
        </div>
      )}
      {list === null ? (
        <div style={{ color: "#64748b", fontSize: 13 }}>Caricamento…</div>
      ) : list.length === 0 ? (
        <div style={{ color: "#64748b", fontSize: 13, fontStyle: "italic", padding: "16px 0" }}>
          Nessun backup. Click "+ Backup adesso" per crearne uno.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Nome</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Creato</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Dimensione</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "6px 8px", color: "#cbd5e1", fontFamily: "monospace" }}>{b.name}</td>
                <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{fmtDate(b.created_at_ms)}</td>
                <td style={{ padding: "6px 8px", color: "#94a3b8", textAlign: "right" }}>{fmtSize(b.size_bytes)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button
                    onClick={() => restore(b.name)}
                    disabled={busy}
                    style={{
                      marginRight: 4, padding: "3px 10px",
                      background: "#3b82f6", color: "#fff",
                      border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer",
                      fontSize: 12,
                    }}
                  >Ripristina</button>
                  <button
                    onClick={() => drop(b.name)}
                    disabled={busy}
                    style={{
                      padding: "3px 10px",
                      background: "transparent", color: "#fca5a5",
                      border: "1px solid #7f1d1d", borderRadius: 3,
                      cursor: busy ? "wait" : "pointer", fontSize: 12,
                    }}
                  >Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
