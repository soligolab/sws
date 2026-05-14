import { useEffect, useState } from "react";
import { api, type CreateUserBody, type UpdateUserBody, type UserRole, type UserSummary } from "@/api/client";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type {
  AlarmCondition,
  AlarmDef,
  AlarmSeverity,
  ModbusTcpSource,
  MqttLastWill,
  MqttSource,
  MqttTlsConfig,
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
    maxWidth: 900,
    width: "100%",
    alignSelf: "center" as const,
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
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

  const [tags, setTags]     = useState<TagDef[]>(storeProject?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

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
            <th style={{ ...S.th, width: "30%" }}>ID variabile</th>
            <th style={{ ...S.th, width: "33%" }}>Descrizione</th>
            <th style={{ ...S.th, width: "12%" }}>Tipo</th>
            <th style={{ ...S.th, width: "15%" }}>Valore live</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {tags.map((tag, i) => {
            const tv = tagValues[tag.id];
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
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
                  <button style={S.btn("danger")} onClick={() => removeTag(i)}>✕</button>
                </td>
              </tr>
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

function ModbusSourceCard({
  source,
  onChange,
  onDelete,
}: {
  source: ModbusTcpSource;
  onChange: (s: ModbusTcpSource) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);

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
                    <TagInput
                      style={S.inputSm}
                      placeholder="pump1.speed"
                      value={r.tag}
                      onChange={(v) => setRegister(i, { tag: v })}
                    />
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
    </div>
  );
}

// ── MQTT card ─────────────────────────────────────────────────────────────────

function MqttSourceCard({
  source,
  onChange,
  onDelete,
}: {
  source: MqttSource;
  onChange: (s: MqttSource) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);

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
                <th style={{ ...S.th, width: "26%" }}>Topic in (subscribe)</th>
                <th style={{ ...S.th, width: "16%" }}>JSON path (opz.)</th>
                <th style={{ ...S.th, width: "22%" }}>Topic out (publish, opz.)</th>
                <th style={{ ...S.th, width: "8%" }}>QoS</th>
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
                    <TagInput
                      style={S.inputSm}
                      placeholder="pump1.speed"
                      value={t.tag}
                      onChange={(v) => setTopic(i, { tag: v })}
                    />
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

  const [sources, setSources]  = useState<SourceDef[]>(storeProject?.sources ?? []);
  const [saving, setSaving]    = useState(false);
  const [saved, setSaved]      = useState(false);

  useEffect(() => {
    if (storeProject?.sources) setSources(storeProject.sources);
  }, [storeProject?.sources?.length]);

  const addModbus = () =>
    setSources((prev) => [...prev, emptyModbus()]);

  const addMqtt = () =>
    setSources((prev) => [...prev, emptyMqtt()]);

  const updateSource = (idx: number, updated: SourceDef) =>
    setSources((prev) => prev.map((s, i) => (i === idx ? updated : s)));

  const removeSource = (idx: number) =>
    setSources((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSources(sources);
      updateProjectSources(sources);
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
        (lettura registri holding) e <strong>MQTT</strong> (sottoscrizione topic). OPC-UA pianificato.
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
            />
          );
        }
        return null;
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button style={S.btn("ghost")} onClick={addModbus}>
          + Aggiungi Modbus TCP
        </button>
        <button style={S.btn("ghost")} onClick={addMqtt}>
          + Aggiungi MQTT
        </button>
        <button style={{ ...S.btn("ghost"), opacity: 0.4, cursor: "not-allowed" }} disabled>
          + OPC-UA (prossimamente)
        </button>
      </div>

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
            <th style={{ ...S.th, width: "14%" }}>Valore / soglia</th>
            <th style={{ ...S.th, width: "12%" }}>Severità</th>
            <th style={{ ...S.th, width: "20%" }}>Messaggio</th>
            <th style={{ ...S.th, width: "6%" }}>Stato</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {alarms.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...S.td, color: "#475569", textAlign: "center", padding: 12 }}>
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

// ── ConfigView root ───────────────────────────────────────────────────────────

type ConfigTab = "tags" | "protocols" | "alarms" | "users" | "resources";

const TAB_LABELS: Record<ConfigTab, string> = {
  tags:      "Variabili",
  protocols: "Protocolli",
  alarms:    "Allarmi",
  users:     "Utenti",
  resources: "Risorse",
};

export function ConfigView() {
  const [tab, setTab] = useState<ConfigTab>("tags");
  const authRole = useAppStore((s) => s.authRole);
  const isAdmin = authRole === "Admin";
  const project = useAppStore((s) => s.project);

  // Hide the Utenti tab for non-admins; if the URL/state ever sneaks them
  // onto it, bounce back to tags.
  useEffect(() => {
    if (tab === "users" && !isAdmin) setTab("tags");
  }, [tab, isAdmin]);

  const visibleTabs: ConfigTab[] = isAdmin
    ? ["tags", "protocols", "alarms", "users", "resources"]
    : ["tags", "protocols", "alarms", "resources"];

  // Guard: tags/protocols/alarms tabs all initialise their local state from
  // store.project. If project hasn't loaded yet, rendering them would show
  // empty inputs over a populated YAML and a subsequent save would wipe the
  // file. The Utenti and Risorse tabs are independent so they stay available.
  const projectLoading = project === null && tab !== "users" && tab !== "resources";

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {visibleTabs.map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
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
            {tab === "tags"      && <TagsTab />}
            {tab === "protocols" && <ProtocolsTab />}
            {tab === "alarms"    && <AlarmsTab />}
            {tab === "users"     && isAdmin && <UsersTab />}
            {tab === "resources" && <ResourcesTab />}
          </>
        )}
      </div>
    </div>
  );
}
