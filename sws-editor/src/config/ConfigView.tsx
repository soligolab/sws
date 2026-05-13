import { useEffect, useState } from "react";
import { api } from "@/api/client";
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

type ConfigTab = "tags" | "protocols" | "alarms";

const TAB_LABELS: Record<ConfigTab, string> = {
  tags:      "Variabili",
  protocols: "Protocolli",
  alarms:    "Allarmi",
};

export function ConfigView() {
  const [tab, setTab] = useState<ConfigTab>("tags");

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {(["tags", "protocols", "alarms"] as ConfigTab[]).map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {tab === "tags"      && <TagsTab />}
        {tab === "protocols" && <ProtocolsTab />}
        {tab === "alarms"    && <AlarmsTab />}
      </div>
    </div>
  );
}
