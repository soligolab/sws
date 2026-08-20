import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getAuthToken, type CreateUserBody, type DiscoveredRuntime, type SystemStatus, type UpdateUserBody, type UserRole, type UserSummary } from "@/api/client";
import { getBrand } from "@/branding";
import { containerDeployPayload, effectiveDataPath, type ContainerSource } from "@/containerDeploy";
import { containerManagePayload, type ManageAction, type RestartPolicy } from "@/containerManage";
import { genId } from "@/id";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { TagInput } from "@/components/TagInput";
import { PythonEditor, type PythonEditorHandle } from "@/components/PythonEditor";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { SvgObject, substituteFaceplateParams } from "@/canvas/SvgCanvas";
import { selectIsDirty, useAppStore } from "@/store";
import { sourceTagIds } from "@/tagCatalog";
import { canConfigureProject } from "@/auth/permissions";
import type {
  AlarmCondition,
  AlarmDef,
  AlarmSeverity,
  AlarmTelegramMode,
  AuditEntry,
  AuditVerifyReport,
  LanguageTable,
  LangEntry,
  BrowsedTopic,
  DatastoreBackendConfig,
  DatastoreConfig,
  DatastoreStats,
  EntityMapping,
  GlobalScriptDef,
  HaBrowsedEntity,
  HomeAssistantSource,
  ModbusTcpSource,
  ModbusRtuSource,
  NotificationConfig,
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
  EnIpDataType,
  EnIpSource,
  EnIpTagMapping,
  FaceplateDef,
  RecipeDef,
  RecipeSummary,
  SmtpConfig,
  TelegramConfig,
  S7DataType,
  S7Source,
  S7TagMapping,
  ScriptTriggerKind,
  SparkplugConfig,
  SparkplugMetricMapping,
  SourceDef,
  SynopticObject,
  TagDataType,
  TagDef,
  TopicMapping,
  SavedDevice,
  PackageFile,
  ContainerPackage,
} from "@/types";

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden" as const,
    background: "var(--brand-bg, #0f172a)",
    color: "var(--brand-text, #e2e8f0)",
  },
  tabBar: {
    display: "flex" as const,
    gap: 2,
    padding: "0 16px",
    background: "var(--brand-surface, #1e293b)",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
    flexShrink: 0,
  },
  tab: (active: boolean): React.CSSProperties => ({
    padding: "10px 20px",
    border: "none",
    borderBottom: active ? "2px solid var(--brand-primary, #3b82f6)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)",
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
    color: "var(--brand-text-subtle, #64748b)",
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
    color: "var(--brand-text-subtle, #64748b)",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.5,
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
  },
  td: {
    padding: "4px 6px",
    borderBottom: "1px solid var(--brand-surface, #1e293b)",
    verticalAlign: "middle" as const,
  },
  input: {
    background: "var(--brand-surface, #1e293b)",
    color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inputSm: {
    background: "var(--brand-surface, #1e293b)",
    color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    padding: "4px 6px",
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  btn: (variant: "primary" | "danger" | "ghost" | "success"): React.CSSProperties => {
    const map = {
      primary: { background: "#1d4ed8", color: "#dbeafe", border: "1px solid #1e40af" },
      success: { background: "var(--brand-success-bg, #166534)", color: "#bbf7d0", border: "1px solid #15803d" },
      danger:  { background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid #991b1b" },
      ghost:   { background: "transparent", color: "var(--brand-text-subtle, #64748b)", border: "1px solid var(--brand-surface-2, #334155)" },
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
    background: "var(--brand-surface, #1e293b)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden" as const,
  },
  cardHead: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "10px 16px",
    background: "var(--brand-surface, #1e293b)",
    cursor: "pointer",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
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
    fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block" as const, marginBottom: 3,
  } as React.CSSProperties,
  // Tiny icon-sized button for delete/close actions inside cards.
  btnXs: {
    background: "transparent",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    color: "var(--brand-text-subtle, #64748b)",
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 6px",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const { t } = useTranslation();
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
        background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: 20, minWidth: 320, maxWidth: 440,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 14 }}>
          Crea variabile
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.tagIdReq")}</label>
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
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.descriptionOpt")}</label>
            <input
              style={S.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.dataType")}</label>
            <select style={{ ...S.input, cursor: "pointer" }} value={dataType} onChange={(e) => setDataType(e.target.value as TagDataType)}>
              <option value="float">Float</option>
              <option value="int">Int</option>
              <option value="bool">Bool</option>
              <option value="string">String</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
          <button style={S.btn("primary")} onClick={create} disabled={!id.trim()}>{t("cfg.create")}</button>
        </div>
      </div>
    </div>
  );
}

// Barra di salvataggio uniforme: sempre in ALTO A DESTRA di ogni tab, tasto
// VERDE, con feedback di conferma "✓ Salvato". Sticky in cima così resta
// visibile scorrendo il contenuto. `label` per varianti ("Salva tutti",
// "Salva tabella"); `disabled` per i save condizionati (es. !dirty); `notice`
// per un messaggio esplicito (verde, o rosso se inizia con "Errore"/"✗").
//
// Passando `section` + `dirty` la barra diventa anche la sorgente dello stato
// "modifiche non salvate" a livello di app: registra nello store come salvare
// questa sezione, così l'indicatore in header si accende e Ctrl+S ("Salva
// tutto") svuota anche la bozza della tab attiva.
/** Sentinella con cui il backend maschera i segreti già salvati (password SMTP,
 *  bot token Telegram). Rimandarla indietro invariata lascia il valore com'è. */
const MASKED = "********";

function SaveBar({
  onSave,
  saving,
  saved,
  savedNotice = "✓ Salvato — modifiche applicate immediatamente.",
  label = "Salva",
  disabled = false,
  notice,
  section,
  dirty,
}: {
  /** I handler delle tab sono `async`: il tipo lo dichiara così `saveAll()`
   *  può attendere davvero il flush della bozza. */
  onSave: () => void | Promise<void>;
  saving: boolean;
  saved: boolean;
  savedNotice?: string;
  label?: string;
  disabled?: boolean;
  notice?: string | null;
  /** Chiave della sezione nel registro delle bozze pendenti. */
  section?: string;
  /** True se la bozza locale differisce da quanto salvato. */
  dirty?: boolean;
}) {
  const registerPendingSection = useAppStore((s) => s.registerPendingSection);
  // onSave cambia identità a ogni render della tab: tenerlo in una ref evita
  // di ri-registrare (e quindi ri-renderizzare) a ogni battuta di tasto.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!section) return;
    registerPendingSection(section, dirty ? async () => { await onSaveRef.current(); } : null);
    return () => registerPendingSection(section, null);
  }, [section, dirty, registerPendingSection]);

  const noticeIsError = !!notice && (/^(errore|✗|✕)/i).test(notice.trim());
  return (
    <div style={{
      display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12,
      marginBottom: 16, position: "sticky", top: 0, zIndex: 5,
      padding: "8px 0", background: "var(--brand-bg, #0f172a)",
    }}>
      {notice != null ? (
        <span style={{ fontSize: 12, color: noticeIsError ? "var(--brand-danger, #ef4444)" : "var(--brand-success, #22c55e)" }}>
          {notice}
        </span>
      ) : saved ? (
        <span style={{ fontSize: 12, color: "var(--brand-success, #22c55e)" }}>
          {savedNotice}
        </span>
      ) : null}
      <button style={S.btn("success")} onClick={onSave} disabled={saving || disabled}>
        {saving ? "Salvataggio…" : label}
      </button>
    </div>
  );
}

// ── TAG tab ───────────────────────────────────────────────────────────────────

function TagsTab() {
  const { t } = useTranslation();
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectTags   = useAppStore((s) => s.updateProjectTags);
  const tagValues           = useAppStore((s) => s.tagValues);
  const markSaveOk          = useAppStore((s) => s.markSaveOk);
  const datastoreIds        = storeProject?.datastores?.map((d) => ({ id: d.id, label: d.label })) ?? [];

  const [tags, setTags]         = useState<TagDef[]>(storeProject?.tags ?? []);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [exprOpen, setExprOpen] = useState<Set<number>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync local state when store changes (e.g. on initial project load or after ZIP import).
  // Depend on the full project object so content changes (not just count) trigger a refresh.
  useEffect(() => {
    if (storeProject?.tags) setTags(storeProject.tags);
  }, [storeProject]);

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
      // Segnala il salvataggio riuscito allo stesso stato globale che
      // saveAll() usa per la finestra "è stato un salvataggio nostro" del
      // watcher progetto (App.tsx) — altrimenti un salvataggio qui, che non
      // passa da saveAll(), fa comparire il banner "progetto cambiato
      // esternamente" sulla stessa sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const header = "id,data_type,description,history,expression";
    const rows = tags.map((t) =>
      [t.id, t.data_type ?? "float", t.description ?? "", t.history ? "true" : "false", t.expression ?? ""]
        .map((v) => (v.includes(",") || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v))
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "tags.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async () => {
    setImportMsg(null);
    try {
      const result = await api.importTagsCsv(importText);
      setImportMsg(`✓ Importati ${result.imported} tag. Ricarica la pagina o salva per aggiornare la vista.`);
      // Refresh from server
      const proj = await api.getProject();
      if (proj.tags) { setTags(proj.tags); updateProjectTags(proj.tags); }
      setImportText("");
    } catch (e: unknown) {
      setImportMsg(`Errore: ${e instanceof Error ? e.message : "importazione fallita"}`);
    }
  };

  return (
    <div style={S.section}>
{/* Volutamente NON registrata in `pendingSections`: un confronto strutturale
          bozza-vs-store non esprime l'intenzione dell'utente, e con "Salva tutto"
          che svuota le bozze una bozza momentaneamente disallineata veniva
          scritta su disco. Il 2026-07-28 questo ha azzerato le variabili di un
          progetto (audit: `{"count": 0, "what": "tags"}` contro 16 su disco).
          Questa tab si salva solo col proprio pulsante, come prima. Si potrà
          ri-abilitare quando traccerà l'intenzione reale, come fanno Notifiche
          (flag `touched`) e Datastore (flag `dirty` locale). */}
      <SaveBar onSave={handleSave} saving={saving} saved={saved} />
      {showImport && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 8000,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}
        >
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, width: 560, display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>Importa tag da CSV</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
              Prima riga = intestazione. Colonne obbligatorie: <code>id</code>. Opzionali: <code>data_type</code>, <code>description</code>, <code>history</code>, <code>expression</code>.
              I tag esistenti vengono aggiornati; i nuovi vengono aggiunti.
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => setImportText(ev.target?.result as string ?? "");
                reader.readAsText(file);
              }}
            />
            <button onClick={() => fileRef.current?.click()} style={{ ...S.btn("ghost"), alignSelf: "flex-start" }}>
              📂 Scegli file CSV…
            </button>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"id,data_type,description,history\npump1.speed,float,Velocità pompa 1,true\npump1.run,bool,Stato marcia,false"}
              rows={8}
              style={{ ...S.input, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            />
            {importMsg && (
              <div style={{ fontSize: 12, color: importMsg.startsWith("✓") ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
                {importMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => { setShowImport(false); setImportMsg(null); setImportText(""); }}>{t("common.cancel")}</button>
              <button style={S.btn("primary")} onClick={handleImportSubmit} disabled={!importText.trim()}>
                Importa
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={S.sectionTitle}>VARIABILI (TAG)</div>
      <div style={S.notice}>
        Le variabili definiscono i punti dati del progetto. Collega ogni variabile a un
        registro nella sezione <em>{t("config.tabs.protocols")}</em> per ricevere i valori in tempo reale.
        Valore attuale visibile solo se il runtime è in esecuzione.
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "22%" }}>{t("cfg.tagId")}</th>
            <th style={{ ...S.th, width: "25%" }}>{t("cfg.description")}</th>
            <th style={{ ...S.th, width: "9%" }}>{t("cfg.type")}</th>
            <th style={{ ...S.th, width: "6%", textAlign: "center" }}>{t("cfg.history")}</th>
            <th style={{ ...S.th, width: "16%" }}>{t("cfg.datastore")}</th>
            <th style={{ ...S.th, width: "12%" }}>{t("cfg.liveValue")}</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {tags.map((tag, i) => {
            const tv = tagValues[tag.id];
            return (
              <React.Fragment key={i}>
              <tr style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)" }}>
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
                    placeholder={t("cfg.descriptionOptional")}
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
                    <option value="string">{t("cfg.stringType")}</option>
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
                    <span style={{ color: "var(--brand-border, #475569)", fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {tv != null ? (
                    <span style={{
                      fontSize: 12,
                      color: tv.quality === "Good" ? "var(--brand-success, #22c55e)" : tv.quality === "Bad" ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #eab308)",
                    }}>
                      {String(tv.value)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--brand-surface-2, #334155)", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <button
                    style={{
                      ...S.btn("ghost"),
                      marginRight: 4,
                      color: tag.expression ? "#818cf8" : "var(--brand-border, #475569)",
                      fontFamily: "monospace",
                      fontWeight: "bold",
                    }}
                    title={t("cfg.computedExpr")}
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

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={S.btn("ghost")} onClick={addTag}>+ Aggiungi variabile</button>
        <button style={S.btn("ghost")} onClick={handleExportCsv} title={t("cfg.downloadTagsCsv")}>⬇ Esporta CSV</button>
        <button style={S.btn("ghost")} onClick={() => setShowImport(true)} title={t("cfg.importTagsCsv")}>⬆ Importa CSV</button>
      </div>

      {/* Orphan source tags — present in protocol sources but missing from project.tags */}
      {(() => {
        const explicitIds = new Set(tags.map(t => t.id));
        const orphanIds = [...sourceTagIds(storeProject).keys()].filter(id => !explicitIds.has(id));
        if (orphanIds.length === 0) return null;
        return (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
              TAG DA SORGENTI — non ancora nella lista variabili
            </div>
            <div style={{ fontSize: 11, color: "var(--brand-border, #475569)", marginBottom: 8 }}>
              Questi tag sono attivi nei protocolli ma non hanno una definizione variabile.
              "Abilita storico" li aggiunge alla lista con <em>history: true</em> — poi salva.
            </div>
            {orphanIds.map((id) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 8,
                                     padding: "5px 8px", background: "var(--brand-bg, #0f172a)",
                                     border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4, marginBottom: 2 }}>
                <span style={{ flex: 1, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace" }}>{id}</span>
                <span style={{ fontSize: 10, color: "var(--brand-surface-2, #334155)", padding: "1px 5px",
                               border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 3 }}>da sorgente</span>
                <button
                  title={t("cfg.addTagWithHistory")}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#1e3a5f",
                           color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 3, cursor: "pointer" }}
                  onClick={() => setTags(prev => [...prev, {
                    id, data_type: "float" as TagDataType, description: "", history: true,
                    datastore_id: datastoreIds[0]?.id,
                  }])}
                >
                  Abilita storico
                </button>
                <button
                  title={t("cfg.addTagNoHistory")}
                  style={{ fontSize: 11, padding: "2px 8px", background: "var(--brand-surface-2, #334155)",
                           color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-border, #475569)", borderRadius: 3, cursor: "pointer" }}
                  onClick={() => setTags(prev => [...prev, {
                    id, data_type: "float" as TagDataType, description: "", history: false,
                  }])}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        );
      })()}
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
    // Nuove sorgenti nascono con Random attivo di default: il client_id
    // letterale collide silenziosamente se lo stesso progetto viene aperto
    // dall'IDE e/o deployato su più device verso lo stesso broker.
    random_client_id: { enabled: true, position: "suffix" },
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

function emptyS7(): S7Source {
  return {
    kind: "s7",
    id: `s7-${genId()}`,
    ip: "192.168.1.5",
    rack: 0,
    slot: 1,
    poll_interval_ms: 500,
    tags: [],
  };
}

function emptyS7Tag(): S7TagMapping {
  return {
    tag: "",
    area: "db",
    db_num: 1,
    byte_offset: 0,
    bit_offset: 0,
    data_type: "real",
    writable: false,
  };
}

// ── S7SourceCard ──────────────────────────────────────────────────────────────

function S7SourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: S7Source;
  onChange: (s: S7Source) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  function upd(patch: Partial<S7Source>) {
    onChange({ ...source, ...patch });
  }

  function updateTag(idx: number, patch: Partial<S7TagMapping>) {
    const tags = source.tags.map((t, i) => i === idx ? { ...t, ...patch } : t);
    upd({ tags });
  }

  function addTag() {
    upd({ tags: [...source.tags, emptyS7Tag()] });
  }

  function removeTag(idx: number) {
    upd({ tags: source.tags.filter((_, i) => i !== idx) });
  }

  const headerRow = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
      onClick={() => setCollapsed((c) => !c)}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-primary, #3b82f6)" }}>S7</span>
      <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
        {source.id} — {source.ip} R{source.rack}/S{source.slot}
        ({source.tags.length} tag)
      </span>
      <span style={{ marginLeft: "auto", color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>{collapsed ? "▶" : "▼"}</span>
      <button style={S.btnXs} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
    </div>
  );

  if (collapsed) {
    return <div style={{ ...S.card, padding: "10px 16px" }}>{headerRow}</div>;
  }

  const inp = (label: string, val: string | number, set: (v: string) => void, type = "text") => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{label}</span>
      <input
        type={type}
        value={val}
        onChange={(e) => set(e.target.value)}
        style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 120 }}
      />
    </label>
  );

  return (
    <div style={S.card}>
      {headerRow}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {inp("ID sorgente", source.id, (v) => upd({ id: v }))}
        {inp("IP PLC", source.ip, (v) => upd({ ip: v }))}
        {inp("Rack", source.rack, (v) => upd({ rack: Number(v) }), "number")}
        {inp("Slot", source.slot, (v) => upd({ slot: Number(v) }), "number")}
        {inp("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8 }}>TAG ({source.tags.length})</div>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag}
              onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.tagIdPh")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 160 }}
            />
            <select
              value={tm.area}
              onChange={(e) => updateTag(idx, { area: e.target.value as S7TagMapping["area"] })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="db">DB</option>
              <option value="m">M (Merker)</option>
              <option value="i">I (Input)</option>
              <option value="q">Q (Output)</option>
            </select>
            {tm.area === "db" && (
              <input
                type="number"
                value={tm.db_num}
                onChange={(e) => updateTag(idx, { db_num: Number(e.target.value) })}
                title={t("cfg.dbNumber")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 60 }}
              />
            )}
            <input
              type="number"
              value={tm.byte_offset}
              onChange={(e) => updateTag(idx, { byte_offset: Number(e.target.value) })}
              title="byte offset"
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 60 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as S7DataType })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="real">REAL (4B float)</option>
              <option value="int">INT (2B signed)</option>
              <option value="dint">DINT (4B signed)</option>
              <option value="word">WORD (2B unsigned)</option>
              <option value="byte">BYTE</option>
              <option value="bool">BOOL</option>
            </select>
            {tm.data_type === "bool" && (
              <input
                type="number"
                min={0}
                max={7}
                value={tm.bit_offset}
                onChange={(e) => updateTag(idx, { bit_offset: Number(e.target.value) })}
                title="bit (0-7)"
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 50 }}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              <input
                type="checkbox"
                checked={tm.writable}
                onChange={(e) => updateTag(idx, { writable: e.target.checked })}
              />
              Write
            </label>
            <button
              style={S.btnXs}
              onClick={() => { if (tm.tag) onCreateTag({ id: tm.tag, data_type: "float", description: "", history: false }); }}
              title={t("cfg.createTag")}
            >+var</button>
            <button style={S.btnXs} onClick={() => removeTag(idx)}>✕</button>
          </div>
        ))}
        <button style={S.btn("ghost")} onClick={addTag}>+ Tag</button>
      </div>
    </div>
  );
}

// ── EtherNet/IP ───────────────────────────────────────────────────────────────

function emptyEnIp(): EnIpSource {
  return {
    kind: "en_ip",
    id: `enip-${genId()}`,
    ip: "192.168.1.10",
    slot: 0,
    poll_interval_ms: 500,
    tags: [],
  };
}

function emptyEnIpTag(): EnIpTagMapping {
  return { tag: "", plc_tag: "", data_type: "real", writable: false };
}

function EnIpSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: EnIpSource;
  onChange: (s: EnIpSource) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  function upd(patch: Partial<EnIpSource>) { onChange({ ...source, ...patch }); }
  function updateTag(idx: number, patch: Partial<EnIpTagMapping>) {
    upd({ tags: source.tags.map((t, i) => i === idx ? { ...t, ...patch } : t) });
  }

  const headerRow = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
      onClick={() => setCollapsed((c) => !c)}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-warning, #f59e0b)" }}>EtherNet/IP</span>
      <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
        {source.id} — {source.ip} slot {source.slot} ({source.tags.length} tag)
      </span>
      <span style={{ marginLeft: "auto", color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>{collapsed ? "▶" : "▼"}</span>
      <button style={S.btnXs} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
    </div>
  );

  if (collapsed) return <div style={{ ...S.card, padding: "10px 16px" }}>{headerRow}</div>;

  const inp = (label: string, val: string | number, set: (v: string) => void, type = "text") => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{label}</span>
      <input
        type={type} value={val} onChange={(e) => set(e.target.value)}
        style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 120 }}
      />
    </label>
  );

  return (
    <div style={S.card}>
      {headerRow}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {inp("ID sorgente", source.id, (v) => upd({ id: v }))}
        {inp("IP PLC", source.ip, (v) => upd({ ip: v }))}
        {inp("Slot CIP", source.slot, (v) => upd({ slot: Number(v) }), "number")}
        {inp("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8 }}>TAG ({source.tags.length})</div>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag} onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.swsTagIdPh")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 150 }}
            />
            <input
              value={tm.plc_tag} onChange={(e) => updateTag(idx, { plc_tag: e.target.value })}
              placeholder={t("cfg.plcTag")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 180 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as EnIpDataType })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="real">REAL (f32)</option>
              <option value="dint">DINT (i32)</option>
              <option value="int">INT (i16)</option>
              <option value="lint">LINT (i64)</option>
              <option value="sint">SINT (i8)</option>
              <option value="bool">BOOL</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              <input type="checkbox" checked={tm.writable} onChange={(e) => updateTag(idx, { writable: e.target.checked })} />
              Write
            </label>
            <button
              style={S.btnXs}
              onClick={() => { if (tm.tag) onCreateTag({ id: tm.tag, data_type: "float", description: "", history: false }); }}
              title={t("cfg.createTag")}
            >+var</button>
            <button style={S.btnXs} onClick={() => upd({ tags: source.tags.filter((_, i) => i !== idx) })}>✕</button>
          </div>
        ))}
        <button style={S.btn("ghost")} onClick={() => upd({ tags: [...source.tags, emptyEnIpTag()] })}>+ Tag</button>
      </div>
    </div>
  );
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
  const { t } = useTranslation();
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
        background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--brand-surface-2, #334155)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-warning, #f59e0b)", letterSpacing: 0.5 }}>
            SFOGLIA ENTITÀ HOME ASSISTANT
          </span>
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", flex: 1 }}>
            {target.field === "attribute" ? "Seleziona entità poi attributo" : "Seleziona entità"}
          </span>
          <button style={S.btn("ghost")} onClick={onClose}>✕</button>
        </div>

        {/* Filters */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e3a5f", display: "flex", gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder={t("cfg.searchEntity")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <select
            style={{ ...S.input, minWidth: 140 }}
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="">{t("cfg.allDomains")}</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "6px 0" }}>
          {loading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--brand-text-subtle, #64748b)" }}>Caricamento entità…</div>
          )}
          {error && (
            <div style={{ padding: 16, color: "var(--brand-danger, #ef4444)", fontSize: 12 }}>
              Errore: {error}. Verifica che l'URL e il token siano corretti e salva il progetto prima di sfogliare.
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--brand-border, #475569)" }}>Nessuna entità trovata.</div>
          )}
          {!loading && !error && filtered.map((ent) => (
            <div key={ent.entity_id} style={{ borderBottom: "1px solid var(--brand-bg, #0f172a)" }}>
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 2 }}>
                    {ent.entity_id}
                  </div>
                  {ent.friendly_name && ent.friendly_name !== ent.entity_id && (
                    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{ent.friendly_name}</div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", minWidth: 80, textAlign: "right" }}>
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
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--brand-surface-2, #334155)", fontSize: 11, color: "var(--brand-border, #475569)" }}>
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
  const { t } = useTranslation();
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
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            HOME ASSISTANT
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
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
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.haUrl")}</label>
              <input style={S.input} placeholder="http://homeassistant.local:8123"
                value={source.url}
                onChange={(e) => setField("url", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                Token accesso{" "}
                <span style={{ fontWeight: 400, color: "var(--brand-border, #475569)" }}>(oppure usa token_env)</span>
              </label>
              <input style={S.input} type="password" placeholder="long-lived access token"
                value={source.token ?? ""}
                onChange={(e) => setField("token", e.target.value || undefined)} />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
              Variabile env per il token (opzionale — prevale su "Token accesso")
            </label>
            <input style={{ ...S.input, maxWidth: 240 }} placeholder="HA_TOKEN"
              value={source.token_env ?? ""}
              onChange={(e) => setField("token_env", e.target.value || undefined)}
              spellCheck={false} />
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            ENTITÀ HA → TAG SWS
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>{t("cfg.swsTag")}</th>
                <th style={{ ...S.th, width: "25%" }}>{t("cfg.haEntityId")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.attribute")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.writeDomain")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.writeService")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.entities.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                    Nessuna entità — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.entities.map((e, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="sala.temp"
                        value={e.tag} onChange={(v) => setEntity(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
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
                        title={t("cfg.browseEntities")}
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
                        title={t("cfg.browseAttributes")}
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
  const { t } = useTranslation();
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
          <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>{open ? "▼" : "▶"}</span>
          <span style={{ fontWeight: 600 }}>OPC-UA · {source.id}</span>
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{source.endpoint_url}</span>
        </div>
        <button
          style={S.btn("danger")}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >{t("common.delete")}</button>
      </div>

      {open && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={S.label}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>{t("cfg.endpointUrl")}</label>
              <input
                style={S.input}
                placeholder="opc.tcp://192.168.1.100:4840"
                value={source.endpoint_url}
                onChange={(e) => setField("endpoint_url", e.target.value)}
              />
            </div>
            <div>
              <label style={S.label}>{t("cfg.securityPolicy")}</label>
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
              <label style={S.label}>{t("cfg.subInterval")}</label>
              <input
                type="number" min={50} step={50} style={S.input}
                value={source.subscription_interval_ms}
                onChange={(e) => setField("subscription_interval_ms", Number(e.target.value) || 500)}
              />
            </div>
          </div>

          {/* Auth ------------------------------------------------------- */}
          <div style={{ marginTop: 12, marginBottom: 6, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
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
                <label style={S.label}>{t("cfg.username")}</label>
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
                <label style={S.label}>{t("cfg.password")}</label>
                <input
                  type="password"
                  style={S.input}
                  placeholder={t("cfg.emptyIfPwdEnv")}
                  value={source.auth.password ?? ""}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    password: e.target.value || undefined,
                  })}
                />
              </div>
              <div>
                <label style={S.label}>{t("cfg.passwordEnvVar")}</label>
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
          <div style={{ marginTop: 12, marginBottom: 6, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
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
            <div style={{ background: "var(--brand-surface, #1e293b)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>TRUST STORE</span>
                <button style={S.btn("ghost")} onClick={loadCerts} disabled={certsLoading}>
                  {certsLoading ? "..." : "Aggiorna"}
                </button>
              </div>
              {certsError && (
                <div style={{ color: "var(--brand-danger-soft, #f87171)", fontSize: 11, marginBottom: 6 }}>{certsError}</div>
              )}
              {certs === null ? (
                <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>
                  Clicca "Aggiorna" per vedere i certificati nel trust store.
                </div>
              ) : certs.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>
                  Nessun certificato nel trust store. Abilita temporaneamente "Accetta qualsiasi" per
                  permettere la prima connessione, poi ricarica i certificati.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                      <th style={{ textAlign: "left", padding: "3px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.file")}</th>
                      <th style={{ textAlign: "left", padding: "3px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.state")}</th>
                      <th style={{ textAlign: "right", padding: "3px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>Byte</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {certs.map((c) => (
                      <tr key={c.filename} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                        <td style={{ padding: "3px 6px", fontFamily: "monospace", wordBreak: "break-all" }}>
                          {c.filename}
                        </td>
                        <td style={{ padding: "3px 6px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
                            background: c.status === "trusted" ? "#14532d" : "var(--brand-danger-bg, #7f1d1d)",
                            color: c.status === "trusted" ? "var(--brand-success-soft, #86efac)" : "var(--brand-danger-soft, #fca5a5)",
                          }}>
                            {c.status === "trusted" ? "TRUSTED" : "REJECTED"}
                          </span>
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--brand-text-muted, #94a3b8)" }}>
                          {c.size_bytes}
                        </td>
                        <td style={{ padding: "3px 6px", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          {c.status === "rejected" && (
                            <button
                              style={{ ...S.btn("ghost"), padding: "1px 6px", fontSize: 10 }}
                              onClick={() => handleTrustCert(c.filename)}
                            >{t("cfg.trust")}</button>
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
            <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
              NODI MONITORATI ({source.nodes.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                style={S.btn("ghost")}
                onClick={() => setBrowseOpen(true)}
                title={t("cfg.browseAddressSpace")}
              >🔍 Sfoglia server</button>
              <button
                style={S.btn("ghost")}
                onClick={() => setEuromapOpen(true)}
                title={t("cfg.detectEuromap")}
              >🤖 Rileva Euromap</button>
            </div>
          </div>
          {source.nodes.length === 0 ? (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, fontStyle: "italic", marginTop: 6 }}>
              Nessun nodo. Clicca "+ Nodo" per aggiungerne uno.
            </div>
          ) : (
            <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.tag")}</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.nodeId")}</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.description")}</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {source.nodes.map((n, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <TagInput
                          value={n.tag}
                          onChange={(v) => setNode(i, { tag: v })}
                          style={{ ...S.input, padding: "2px 6px", flex: 1 }}
                        />
                        <button
                          title={t("cfg.createNewTag")}
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
  const { t } = useTranslation();
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
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
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
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.tcpPort")}</label>
              <input style={S.input} type="number" min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.namespaceUri")}</label>
              <input style={S.input} value={source.namespace_uri}
                onChange={(e) => setField("namespace_uri", e.target.value)} spellCheck={false} />
            </div>
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            NODI ESPOSTI
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "45%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "45%" }}>{t("cfg.opcuaNodeIdOpt")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.nodes.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                    Nessun nodo — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.nodes.map((n, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="pump1.speed"
                        value={n.tag} onChange={(v) => setNode(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
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
  const { t } = useTranslation();
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
        <div style={{ paddingLeft: depth * 16 + 28, color: "var(--brand-text-subtle, #64748b)", fontSize: 11, fontStyle: "italic" }}>
          caricamento…
        </div>
      );
    }
    if (!lvl) return null;
    if (lvl.length === 0) {
      return (
        <div style={{ paddingLeft: depth * 16 + 28, color: "var(--brand-text-subtle, #64748b)", fontSize: 11, fontStyle: "italic" }}>
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
        ? (isImported ? "var(--brand-border, #475569)" : isPicked ? "#5eead4" : "var(--brand-text-2, #cbd5e1)")
        : isFolder ? "#fde68a"
        : "var(--brand-text-subtle, #64748b)";
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
              <span style={{ width: 12, color: "var(--brand-text-subtle, #64748b)" }}>{isExpanded ? "▼" : "▶"}</span>
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
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--brand-border, #475569)" }}>
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
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sfoglia server OPC-UA</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{source.endpoint_url}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", background: "#0a111e" }}>
          {renderLevel("@root", 0)}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: pickedList.length > 0 ? "#5eead4" : "var(--brand-text-subtle, #64748b)" }}>
            {pickedList.length === 0
              ? "Espandi un Object e seleziona le Variable da importare."
              : `${pickedList.length} nod${pickedList.length === 1 ? "o" : "i"} selezionat${pickedList.length === 1 ? "o" : "i"}.`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
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
  const { t } = useTranslation();
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
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          width: 760, maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              🤖 Auto-detect Euromap 77 / 83
            </div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>
              {source.endpoint_url}
              {result && (
                <> · {result.nodes_scanned} nodi scansionati
                  {result.truncated && " (limite raggiunto)"}</>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", background: "#0a111e" }}>
          {busy && (
            <div style={{ padding: "24px 18px", color: "var(--brand-text-muted, #94a3b8)", fontSize: 13 }}>
              Scansione address space in corso (max ~500 nodi)…
            </div>
          )}
          {!busy && result && result.variables.length === 0 && (
            <div style={{ padding: "24px 18px", color: "var(--brand-text-subtle, #64748b)", fontSize: 13, fontStyle: "italic" }}>
              Nessuna variabile Euromap 77 / 83 rilevata. Il server potrebbe non
              implementare le companion spec, oppure i nomi non corrispondono
              al match canonico. Usa "🔍 Sfoglia server" per esplorare manualmente.
            </div>
          )}
          {!busy && result && result.variables.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--brand-bg, #0f172a)", borderBottom: "1px solid var(--brand-surface, #1e293b)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600, width: 24 }}></th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600, width: 40 }}>{t("cfg.spec")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.variable")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.suggestedTag")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.nodeId")}</th>
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
                        borderBottom: "1px solid var(--brand-surface, #1e293b)",
                        cursor: imported ? "not-allowed" : "pointer",
                        background: checked ? "#0f2922" : "transparent",
                        color: imported ? "var(--brand-border, #475569)" : "var(--brand-text-2, #cbd5e1)",
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
                        fontFamily: "monospace", color: v.spec === "77" ? "var(--brand-warning-soft, #fbbf24)" : "#a78bfa" }}>
                        {v.spec}
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <div style={{ fontWeight: 600 }}>{v.canonical_name}</div>
                        <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>{v.description}</div>
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#5eead4" }}>
                        {source.id}.{v.suggested_tag_suffix}
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace",
                        fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
                        {v.node_id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
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
            <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
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
  const { t } = useTranslation();
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
          <span style={{ fontSize: 11, color: "var(--brand-primary, #3b82f6)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS TCP
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
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
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
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
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.hostIp")}</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.port")}</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.unitId")}</label>
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
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.pollInterval")}</label>
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
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA REGISTRI HOLDING
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "40%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.registerAddr")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.scale")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.dataType")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.registers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                    Nessun registro — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.registers.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
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
                        title={t("cfg.createTag")}
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
                  <td style={{ ...S.td, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>
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
  const { t } = useTranslation();
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
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS RTU
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
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
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
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
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.serialDevice")}</label>
              <input style={S.input} value={source.device}
                onChange={(e) => setField("device", e.target.value)} spellCheck={false}
                placeholder="/dev/ttyUSB0" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.baudRate")}</label>
              <input style={S.input} type="number" min={1200} max={921600} step={100}
                value={source.baud_rate}
                onChange={(e) => setField("baud_rate", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.parity")}</label>
              <select style={S.input} value={source.parity}
                onChange={(e) => setField("parity", e.target.value)}>
                <option value="N">Nessuna (N)</option>
                <option value="E">Pari (E)</option>
                <option value="O">Dispari (O)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.dataBits")}</label>
              <select style={S.input} value={source.data_bits}
                onChange={(e) => setField("data_bits", Number(e.target.value))}>
                <option value={8}>8</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.stopBits")}</label>
              <select style={S.input} value={source.stop_bits}
                onChange={(e) => setField("stop_bits", Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "80px 160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.unitId")}</label>
              <input style={S.input} type="number" min={0} max={255}
                value={source.unit_id}
                onChange={(e) => setField("unit_id", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.pollInterval")}</label>
              <input style={S.input} type="number" min={100}
                value={source.poll_interval_ms}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
            </div>
          </div>

          {/* Register mappings — shared structure with Modbus TCP */}
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA REGISTRI HOLDING
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "40%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.registerAddr")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.scale")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.dataType")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.registers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                    Nessun registro — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.registers.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
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
                        title={t("cfg.createTag")}
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
                  <td style={{ ...S.td, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>Float (×scala)</td>
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [jsonExtractOpen, setJsonExtractOpen] = useState(false);

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
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
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
          {!source.sparkplug && (
            <button
              style={S.btn("ghost")}
              onClick={(e) => { e.stopPropagation(); setJsonExtractOpen(true); }}
              title="Incolla un payload JSON ed estrai le variabili come righe di mappatura"
            >
              Estrai da JSON
            </button>
          )}
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Elimina
          </button>
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
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
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.hostIp")}</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.port")}</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.clientId")}</label>
              <input
                style={S.input}
                value={source.client_id}
                onChange={(e) => setField("client_id", e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <MqttRandomClientIdSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />

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

          <SparkplugSection
            spb={source.sparkplug}
            onChange={(spb) => onChange({ ...source, sparkplug: spb })}
            onCreateTag={onCreateTag}
          />

          {!source.sparkplug && (
          <><div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA TOPIC
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "32%" }}>{t("cfg.topicIn")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.jsonPathOpt")}</th>
                <th style={{ ...S.th, width: "22%" }}>{t("cfg.topicOut")}</th>
                <th style={{ ...S.th, width: "6%" }}>QoS</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.topics.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                    Nessun topic — aggiungi una mappatura.
                  </td>
                </tr>
              )}
              {source.topics.map((tp, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={tp.tag}
                        onChange={(v) => setTopic(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: tp.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="plant/floor1/temperature"
                      value={tp.topic}
                      onChange={(e) => setTopic(i, { topic: e.target.value })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. temperature"
                      value={tp.json_path ?? ""}
                      onChange={(e) => setTopic(i, { json_path: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. plant/floor1/cmd"
                      value={tp.publish_topic ?? ""}
                      onChange={(e) => setTopic(i, { publish_topic: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <select
                      style={{ ...S.inputSm, cursor: "pointer" }}
                      value={tp.qos ?? ""}
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
          </>)}
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
      {jsonExtractOpen && (
        <MqttJsonExtractModal
          source={source}
          onGenerate={(rows, tags) => {
            onChange({ ...source, topics: [...source.topics, ...rows] });
            tags.forEach(onCreateTag);
          }}
          onClose={() => setJsonExtractOpen(false)}
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
            {loading ? `Rilevamento… (${duration} s)` : result ? "Aggiorna" : "Avvia rilevamento"}
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
                      <td colSpan={4} style={{ ...S.td, textAlign: "center", color: "var(--brand-border, #475569)", padding: 12 }}>
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
                              <option value="">— nessuno —</option>
                              {keys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: "var(--brand-border, #475569)", fontSize: 11 }}>—</span>
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

function MqttJsonExtractModal({
  source,
  onGenerate,
  onClose,
}: {
  source: MqttSource;
  onGenerate: (rows: TopicMapping[], tags: TagDef[]) => void;
  onClose: () => void;
}) {
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
      setError("Il JSON deve essere un oggetto { … }."); setLeaves(null); return;
    }
    const ls = flattenJsonLeaves(parsed);
    if (ls.length === 0) { setError("Nessuna variabile estraibile dall'oggetto."); setLeaves([]); return; }
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
          <div style={{ fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>Estrai variabili da JSON</div>
          <button style={{ ...S.btn("ghost"), padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>Topic</label>
          <input style={S.input} placeholder="zigbee2mqtt/presa.sandokan" value={topic} onChange={(e) => setTopic(e.target.value)} spellCheck={false} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>JSON di esempio (payload del topic)</label>
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
            <input style={S.input} placeholder="Filtra variabili…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div style={{ overflow: "auto", flex: 1, minHeight: 0, maxHeight: "42vh" }}>
              <table style={{ ...S.table, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 32 }}>
                      <input type="checkbox" onChange={toggleAll} checked={visible.length > 0 && visible.every((l) => selected.has(l.path))} />
                    </th>
                    <th style={{ ...S.th, width: "32%" }}>Variabile (JSON path)</th>
                    <th style={{ ...S.th, width: "12%" }}>Tipo</th>
                    <th style={{ ...S.th, width: "18%" }}>Campione</th>
                    <th style={{ ...S.th }}>Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", color: "var(--brand-border, #475569)", padding: 12 }}>Nessuna variabile corrisponde al filtro.</td></tr>
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
              Crea anche i tag (con il tipo dedotto)
            </label>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>Chiudi</button>
          <button style={S.btn("primary")} onClick={generate} disabled={!canGenerate}>Genera righe ({selected.size})</button>
        </div>
      </div>
    </div>
  );
}

// ── MqttSourceCard sub-sections (auth / connection / TLS / last-will) ────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6, marginTop: 8, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
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
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <>
      <SectionHeader>AUTENTICAZIONE</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.username")}</label>
          <input
            style={S.input}
            value={source.username ?? ""}
            onChange={(e) => onChange({ username: e.target.value || undefined })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
            Password{" "}
            <span style={{ color: "var(--brand-border, #475569)" }}>(lascia "********" per non modificare)</span>
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
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
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
  const { t } = useTranslation();
  return (
    <>
      <SectionHeader>CONNESSIONE</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.keepAlive")}</label>
          <input
            style={S.input}
            type="number" min={1} max={3600}
            value={source.keep_alive_secs ?? ""}
            placeholder="10"
            onChange={(e) => onChange({ keep_alive_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.defaultQos")}</label>
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
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.cleanSession")}</label>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.maxSilenceSecs")}</label>
          <input
            style={{ ...S.input, maxWidth: 160 }}
            type="number" min={1}
            value={source.max_silence_secs ?? ""}
            placeholder={t("cfg.maxSilenceSecsPlaceholder")}
            onChange={(e) => onChange({ max_silence_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "4px 0 0" }}>
            {t("cfg.maxSilenceSecsHint")}
          </p>
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
  const { t } = useTranslation();
  const current: MqttTlsConfig = tls ?? { enabled: false };
  const setField = <K extends keyof MqttTlsConfig>(k: K, v: MqttTlsConfig[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SectionHeader>TLS</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
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
        <label style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)", cursor: "pointer" }} title={t("cfg.notImplemented")}>
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

/// Client ID MQTT: letterale (identico su ogni istanza che apre il progetto,
/// IDE compreso — rischio di collisione se lo stesso progetto gira anche su
/// uno o più device) oppure "Random" (ogni istanza glue un id persistente
/// univoco al client_id, usato come prefisso/suffisso). Le due modalità sono
/// alternative: quando Random è attivo l'invio manuale al device non ha
/// senso (il device si genera già il proprio id) e si nasconde.
function MqttRandomClientIdSection({
  source,
  onChange,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
}) {
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const enabled = source.random_client_id?.enabled ?? false;
  const position = source.random_client_id?.position ?? "suffix";

  const setRandom = (patch: Partial<{ enabled: boolean; position: "prefix" | "suffix" }>) =>
    onChange({ random_client_id: { enabled, position, ...patch } });

  const [pushValue, setPushValue] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const handlePush = async () => {
    const label = pushValue.trim() || "(vuoto = rimuove un eventuale override già impostato)";
    if (!window.confirm(
      `Impostare "${label}" come client_id di "${source.id}" sul dispositivo connesso?`
    )) return;
    setPushing(true); setPushMsg(null);
    try {
      await api.pushMqttClientIdOverride(source.id, pushValue.trim() || null);
      setPushMsg(pushValue.trim() ? "✓ Inviato al dispositivo." : "✓ Override rimosso dal dispositivo.");
    } catch (e: any) {
      setPushMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      <SectionHeader>CLIENT ID</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "auto 220px 1fr", gap: 12, marginBottom: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setRandom({ enabled: e.target.checked })}
            style={{ marginRight: 6 }}
          />
          Random Client ID
        </label>
        <select
          style={S.input}
          value={position}
          onChange={(e) => setRandom({ position: e.target.value as "prefix" | "suffix" })}
          disabled={!enabled}
        >
          <option value="suffix">client_id come suffisso</option>
          <option value="prefix">client_id come prefisso</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {enabled
            ? "Ogni istanza (IDE e ogni device) aggiunge un id univoco persistente — client_id resta solo l'etichetta."
            : "client_id letterale: identico su ogni istanza che apre questo progetto."}
        </span>
      </div>

      {!enabled && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="client_id da inviare al dispositivo connesso"
            value={pushValue}
            onChange={(e) => setPushValue(e.target.value)}
            disabled={!remoteConnected || pushing}
            spellCheck={false}
          />
          <button
            style={S.btn("ghost")}
            onClick={handlePush}
            disabled={!remoteConnected || pushing}
            title={remoteConnected ? "" : "Connettiti a un dispositivo da Configurazione → Runtime per usare questo pulsante"}
          >
            {pushing ? "Invio…" : "Invia Client ID al dispositivo connesso"}
          </button>
        </div>
      )}
      {pushMsg && (
        <div style={{
          fontSize: 12, marginBottom: 12,
          color: pushMsg.startsWith("✓") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)",
        }}>
          {pushMsg}
        </div>
      )}
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
  const { t } = useTranslation();
  const enabled = !!lw;
  const current: MqttLastWill = lw ?? { topic: "", payload: "", qos: 0, retain: false };
  const setField = <K extends keyof MqttLastWill>(k: K, v: MqttLastWill[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SectionHeader>LAST WILL</SectionHeader>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
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
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.topic")}</label>
            <input
              style={S.input}
              placeholder="plant/floor1/status"
              value={current.topic}
              onChange={(e) => setField("topic", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.payload")}</label>
            <input
              style={S.input}
              placeholder="es. offline"
              value={current.payload}
              onChange={(e) => setField("payload", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>QoS</label>
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
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>Retain</label>
            <input
              type="checkbox"
              checked={current.retain}
              onChange={(e) => setField("retain", e.target.checked)}
              style={{ accentColor: "var(--brand-primary, #3b82f6)", marginTop: 5 }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── Sparkplug B section (inside MqttSourceCard) ───────────────────────────────

function SparkplugSection({
  spb,
  onChange,
  onCreateTag,
}: {
  spb?: SparkplugConfig;
  onChange: (spb: SparkplugConfig | undefined) => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const enabled = !!spb;
  const current: SparkplugConfig = spb ?? { group_id: "", host_id: "SWS-SCADA", metrics: [] };

  function setField<K extends keyof SparkplugConfig>(k: K, v: SparkplugConfig[K]) {
    onChange({ ...current, [k]: v });
  }
  function addMetric() {
    setField("metrics", [...current.metrics, { metric_name: "", tag: "", writable: false }]);
  }
  function updateMetric(idx: number, patch: Partial<SparkplugMetricMapping>) {
    setField("metrics", current.metrics.map((m, i) => i === idx ? { ...m, ...patch } : m));
  }
  function removeMetric(idx: number) {
    setField("metrics", current.metrics.filter((_, i) => i !== idx));
  }

  return (
    <>
      <SectionHeader>SPARKPLUG B</SectionHeader>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? current : undefined)}
            style={{ marginRight: 6 }}
          />
          Modalità Sparkplug B (payloads protobuf — ignora topic normali)
        </label>
      </div>
      {enabled && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.groupId")}</label>
              <input
                style={S.input}
                placeholder="plant-a"
                value={current.group_id}
                onChange={(e) => setField("group_id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.scadaHostId")}</label>
              <input
                style={S.input}
                value={current.host_id}
                onChange={(e) => setField("host_id", e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 6 }}>
            METRICHE ({current.metrics.length})
          </div>
          {current.metrics.map((m, idx) => (
            <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <TagInput
                value={m.tag} onChange={(v) => updateMetric(idx, { tag: v })}
                placeholder={t("cfg.swsTagIdPh")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 160 }}
              />
              <input
                value={m.metric_name} onChange={(e) => updateMetric(idx, { metric_name: e.target.value })}
                placeholder={t("cfg.sparkplugMetric")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 200 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                <input type="checkbox" checked={m.writable} onChange={(e) => updateMetric(idx, { writable: e.target.checked })} />
                NCMD write
              </label>
              <button
                style={S.btnXs}
                onClick={() => { if (m.tag) onCreateTag({ id: m.tag, data_type: "float", description: "", history: false }); }}
                title={t("cfg.createTag")}
              >+var</button>
              <button style={S.btnXs} onClick={() => removeMetric(idx)}>✕</button>
            </div>
          ))}
          <button style={S.btn("ghost")} onClick={addMetric}>+ Metrica</button>
        </>
      )}
    </>
  );
}

// ── PROTOCOLS tab ─────────────────────────────────────────────────────────────

function ProtocolsTab() {
  const storeProject           = useAppStore((s) => s.project);
  const updateProjectSources   = useAppStore((s) => s.updateProjectSources);
  const updateProjectTags      = useAppStore((s) => s.updateProjectTags);
  const markSaveOk             = useAppStore((s) => s.markSaveOk);

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

  const addS7 = () =>
    setSources((prev) => [...prev, emptyS7()]);

  const addEnIp = () =>
    setSources((prev) => [...prev, emptyEnIp()]);

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
      // Vedi commento analogo in TagsTab: segnala il salvataggio riuscito
      // allo stato globale che alimenta la finestra "salvataggio nostro" del
      // watcher progetto, altrimenti il banner "cambiato esternamente"
      // scatta anche sulla sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
      <SaveBar
        onSave={handleSave}
        saving={saving}
        saved={saved}
        savedNotice="✓ Salvato — sorgenti ricollegate al volo."
      />
      <div style={S.sectionTitle}>SORGENTI DATI / PROTOCOLLI</div>
      <div style={S.notice}>
        Configura le connessioni ai dispositivi di campo. Supportati: <strong>Modbus TCP</strong>
        (lettura registri holding), <strong>Modbus RTU</strong> (RS-485/RS-232 seriale),
        <strong>MQTT</strong> (sottoscrizione topic),
        <strong>OPC-UA client</strong> (subscription, security None),
        <strong>OPC-UA server</strong> (espone tag SWS a SCADA/MES superiori),
        <strong>HomeAssistant</strong> (sensori e attuatori domotica via WebSocket),
        <strong>S7</strong> (Siemens S7-300/400/1200/1500 via ISO-on-TCP porta 102),
        <strong>EtherNet/IP</strong> (Allen-Bradley ControlLogix/CompactLogix via CIP porta 44818).
        Le sorgenti vengono ricollegate <strong>in tempo reale</strong> al salvataggio (niente
        riavvio del runtime).
      </div>

      {sources.length === 0 && (
        <div style={{ color: "var(--brand-border, #475569)", fontSize: 13, marginBottom: 16 }}>
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
        if (src.kind === "s7") {
          return (
            <S7SourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "en_ip") {
          return (
            <EnIpSourceCard
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
        <button style={S.btn("ghost")} onClick={addS7}>
          + Aggiungi S7 (Siemens)
        </button>
        <button style={S.btn("ghost")} onClick={addEnIp}>
          + Aggiungi EtherNet/IP (Allen-Bradley)
        </button>
      </div>

      {pendingTags.length > 0 && (
        <div style={{ ...S.notice, marginTop: 12 }}>
          {pendingTags.length} variabil{pendingTags.length === 1 ? "e" : "i"} nuov{pendingTags.length === 1 ? "a" : "e"} in attesa di salvataggio:{" "}
          {pendingTags.map(t => t.id).join(", ")}
        </div>
      )}
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
  const { t } = useTranslation();
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectAlarms = useAppStore((s) => s.updateProjectAlarms);
  const liveAlarms          = useAppStore((s) => s.alarms);
  const markSaveOk          = useAppStore((s) => s.markSaveOk);

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
      // Vedi commento analogo in TagsTab: segnala il salvataggio riuscito
      // allo stato globale che alimenta la finestra "salvataggio nostro" del
      // watcher progetto, altrimenti il banner "cambiato esternamente"
      // scatta anche sulla sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
{/* Volutamente NON registrata in `pendingSections`: un confronto strutturale
          bozza-vs-store non esprime l'intenzione dell'utente, e con "Salva tutto"
          che svuota le bozze una bozza momentaneamente disallineata veniva
          scritta su disco. Il 2026-07-28 questo ha azzerato le variabili di un
          progetto (audit: `{"count": 0, "what": "tags"}` contro 16 su disco).
          Questa tab si salva solo col proprio pulsante, come prima. Si potrà
          ri-abilitare quando traccerà l'intenzione reale, come fanno Notifiche
          (flag `touched`) e Datastore (flag `dirty` locale). */}
      <SaveBar onSave={handleSave} saving={saving} saved={saved} />
      <div style={S.sectionTitle}>ALLARMI</div>
      <div style={S.notice}>
        Ogni allarme osserva una variabile e si attiva quando la condizione è
        soddisfatta. Condizioni disponibili: <em>above</em> / <em>below</em>
        (soglia numerica) e <em>bool_equals</em> (per tag booleani). Lo stato
        attivo è mostrato nella barra in alto della UI. La colonna
        <em> Telegram</em> decide, per ogni allarme, se il messaggio va alle chat
        configurate in Notifiche, solo a chat proprie, o a nessuno.
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "16%" }}>ID</th>
            <th style={{ ...S.th, width: "18%" }}>{t("cfg.tag")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.condition")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.threshold")}</th>
            <th style={{ ...S.th, width: "8%" }} title={t("cfg.hysteresis2")}>{t("cfg.deadBand")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.severity")}</th>
            <th style={{ ...S.th, width: "20%" }}>{t("cfg.message")}</th>
            <th style={{ ...S.th, width: "12%" }} title={t("cfg.telegramColHint")}>Telegram</th>
            <th style={{ ...S.th, width: "6%" }}>{t("cfg.state")}</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {alarms.length === 0 && (
            <tr>
              <td colSpan={10} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                Nessun allarme definito.
              </td>
            </tr>
          )}
          {alarms.map((alm, i) => {
            const live = liveAlarms[alm.id];
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)" }}>
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
                  {(() => {
                    const isComposite = ["and", "or", "not"].includes(alm.condition.kind);
                    if (isComposite) {
                      return (
                        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}
                          title={t("cfg.compositeCondition")}>
                          {alm.condition.kind}
                        </span>
                      );
                    }
                    return (
                      <select
                        style={{ ...S.inputSm, cursor: "pointer" }}
                        value={alm.condition.kind}
                        onChange={(e) => {
                          const kind = e.target.value as AlarmCondition["kind"];
                          if (kind === "above" || kind === "below") {
                            updateCondition(i, { kind, threshold: 0 });
                          } else if (kind === "not") {
                            updateCondition(i, { kind: "not", condition: { kind: "bool_true" } });
                          } else {
                            updateCondition(i, { kind: "bool_equals", value: true });
                          }
                        }}
                      >
                        <option value="above">above</option>
                        <option value="below">below</option>
                        <option value="bool_equals">bool_equals</option>
                        <option value="not">not</option>
                      </select>
                    );
                  })()}
                </td>
                <td style={S.td}>
                  {(() => {
                    const cond = alm.condition;
                    const isBool = cond.kind === "bool_equals" || cond.kind === "bool_true" || cond.kind === "bool_false";
                    const isComposite = cond.kind === "and" || cond.kind === "or" || cond.kind === "not";
                    if (isComposite) return null;
                    if (isBool) {
                      const boolVal = cond.kind === "bool_true" ? "true"
                                    : cond.kind === "bool_false" ? "false"
                                    : (cond as { kind: "bool_equals"; value: boolean }).value ? "true" : "false";
                      return (
                        <select
                          style={{ ...S.inputSm, cursor: "pointer" }}
                          value={boolVal}
                          onChange={(e) =>
                            updateCondition(i, { kind: "bool_equals", value: e.target.value === "true" })
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      );
                    }
                    return (
                      <input
                        style={S.inputSm}
                        type="number"
                        step="any"
                        value={(cond as { kind: "above" | "below"; threshold: number }).threshold}
                        onChange={(e) =>
                          updateCondition(i, { kind: cond.kind as "above" | "below", threshold: Number(e.target.value) })
                        }
                      />
                    );
                  })()}
                </td>
                <td style={S.td}>
                  {/* dead_band: only for above/below atomic conditions */}
                  {(alm.condition.kind === "above" || alm.condition.kind === "below") && (
                    <input
                      style={S.inputSm}
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      title={t("cfg.hysteresis1")}
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
                    placeholder={t("cfg.webhookUrl")}
                    value={alm.notify_url ?? ""}
                    onChange={(e) => updateAlarm(i, { notify_url: e.target.value || undefined })}
                  />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      style={{ ...S.inputSm, width: "50%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.onDelayS")}
                      title={t("cfg.onDelayHint")}
                      value={alm.on_delay_s ?? ""}
                      onChange={(e) => updateAlarm(i, { on_delay_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                    <input
                      style={{ ...S.inputSm, width: "50%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.offDelayS")}
                      title={t("cfg.offDelayHint")}
                      value={alm.off_delay_s ?? ""}
                      onChange={(e) => updateAlarm(i, { off_delay_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                  </div>
                  <TagInput
                    style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                    placeholder={t("cfg.inhibitTag")}
                    value={alm.inhibit_tag ?? ""}
                    onChange={(v) => updateAlarm(i, { inhibit_tag: v || undefined })}
                  />
                  <input
                    style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                    placeholder={t("cfg.emailRecipients")}
                    title="notify_email: invia email su attivazione (separati da virgola)"
                    value={alm.notify_email?.join(", ") ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const emails = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
                      updateAlarm(i, { notify_email: emails?.length ? emails : undefined });
                    }}
                  />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      style={{ ...S.inputSm, width: "40%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.escalateS")}
                      title="escalate_after_s: secondi dopo cui inviare escalation se non ACKato"
                      value={alm.escalate_after_s ?? ""}
                      onChange={(e) => updateAlarm(i, { escalate_after_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                    <input
                      style={{ ...S.inputSm, width: "60%", fontSize: 11 }}
                      placeholder={t("cfg.emailEscalation")}
                      title="escalate_to: destinatari escalation (separati da virgola)"
                      value={alm.escalate_to?.join(", ") ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const emails = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
                        updateAlarm(i, { escalate_to: emails?.length ? emails : undefined });
                      }}
                    />
                  </div>
                </td>
                <td style={S.td}>
                  {/* Instradamento Telegram. L'assenza del campo vale "global":
                      è il comportamento che gli allarmi avevano prima che
                      l'impostazione esistesse, e leggerla come "off" spegnerebbe
                      in silenzio notifiche già in servizio. */}
                  <select
                    style={{ ...S.inputSm, cursor: "pointer", fontSize: 11 }}
                    title={t("cfg.telegramColHint")}
                    value={alm.telegram_mode ?? "global"}
                    onChange={(e) => {
                      const mode = e.target.value as AlarmTelegramMode;
                      updateAlarm(i, {
                        // "global" torna a essere assenza del campo: il YAML resta
                        // quello di prima per gli allarmi che non lo usano.
                        telegram_mode: mode === "global" ? undefined : mode,
                        // Le chat si conservano passando per "off" e tornando a
                        // "chats"; si buttano solo scegliendo "global", dove non
                        // hanno più significato.
                        telegram_chat_ids: mode === "global" ? undefined : alm.telegram_chat_ids,
                      });
                    }}
                  >
                    <option value="global">{t("cfg.tgModeGlobal")}</option>
                    <option value="chats">{t("cfg.tgModeChats")}</option>
                    <option value="off">{t("cfg.tgModeOff")}</option>
                  </select>
                  {alm.telegram_mode === "chats" && (
                    <>
                      <input
                        style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                        placeholder={t("cfg.tgChatIdsPh")}
                        title={t("cfg.tgChatIdsHint")}
                        value={alm.telegram_chat_ids?.join(", ") ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const ids = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
                          // Si tiene [] invece di undefined: con undefined la riga
                          // tornerebbe indistinguibile da "chat non ancora scritte"
                          // e il runtime non potrebbe segnalare l'impostazione
                          // incompleta.
                          updateAlarm(i, { telegram_chat_ids: ids });
                        }}
                      />
                      {!alm.telegram_chat_ids?.length && (
                        <div style={{ fontSize: 10, color: "var(--brand-warning, #eab308)", marginTop: 2 }}>
                          {t("cfg.tgChatIdsMissing")}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {live ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: live.active
                        ? (live.acknowledged ? "var(--brand-warning, #eab308)" : "var(--brand-danger, #ef4444)")
                        : "var(--brand-text-subtle, #64748b)",
                    }}>
                      {live.active ? (live.acknowledged ? "ACK" : "ON") : "—"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--brand-surface-2, #334155)", fontSize: 11 }}>—</span>
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
    </div>
  );
}

// ── SYSTEM tab ───────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", borderRadius: 4, height: 8, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{value}</div>
    </div>
  );
}

function GitOpsPanel() {
  const { t } = useTranslation();
  const [gitStatus, setGitStatus] = useState<import("../types").GitStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opMsg, setOpMsg] = useState<string | null>(null);
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  // Progetto non ancora agganciato a un repository: prima non c'era alcun
  // percorso per iniziare da qui (il pannello restava vuoto). `checkedRepo`
  // distingue "non ancora controllato" da "controllato, non è un repo" così
  // non si mostra il form di aggancio per uno sfarfallio durante il primo
  // caricamento.
  const [checkedRepo, setCheckedRepo] = useState(false);
  const [attachUrl, setAttachUrl] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  // Tag — elenco/crea/push/elimina, assente prima d'ora sia lato backend sia UI.
  const [tags, setTags] = useState<string[] | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMsg, setNewTagMsg] = useState("");

  const fetchGitStatus = async () => {
    try {
      const gs = await api.getGitStatus();
      setGitStatus(gs);
      setGitError(null);
    } catch (e: any) {
      if (e?.status === 404 || String(e?.message).includes("404")) {
        setGitStatus(null);
        setGitError(null);
      } else {
        setGitError(String(e?.message ?? e));
      }
    } finally {
      setCheckedRepo(true);
    }
  };

  useEffect(() => { void fetchGitStatus(); }, []);

  const fetchTags = async () => {
    try {
      setTags(await api.listGitTags());
      setTagErr(null);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    if (gitStatus) void fetchTags(); else setTags(null);
  }, [gitStatus]);

  const runOp = async (op: () => Promise<{ message: string }>, label: string) => {
    setBusy(true);
    setOpMsg(null);
    try {
      const r = await op();
      setOpMsg(`${label}: ${r.message || "ok"}`);
      await fetchGitStatus();
    } catch (e: any) {
      setOpMsg(`Errore ${label}: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const attachRepo = async () => {
    setAttaching(true);
    setAttachErr(null);
    try {
      await api.initProjectGit(attachUrl.trim() || undefined);
      setAttachUrl("");
      await fetchGitStatus();
    } catch (e: any) {
      setAttachErr(String(e?.message ?? e));
    } finally {
      setAttaching(false);
    }
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.createGitTag(name, newTagMsg.trim() || undefined);
      setShowTagForm(false);
      setNewTagName("");
      setNewTagMsg("");
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const pushTag = async (name: string) => {
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.pushGitTag(name);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const deleteTag = async (name: string) => {
    if (!window.confirm(`Eliminare il tag "${name}"? Verrà rimosso anche dal remote se già pubblicato.`)) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.deleteGitTag(name);
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const header = (
    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 6 }}>
      VERSIONAMENTO PROGETTO
    </div>
  );
  const intro = (
    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 10, lineHeight: 1.5 }}>
      Versiona <strong>questo progetto</strong> (project.yaml, synoptics, ricette, storico) in un
      repository git — non riguarda mai il codice di SWS stesso.
    </div>
  );

  if (gitError) {
    return (
      <div>{header}{intro}<div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>Git: {gitError}</div></div>
    );
  }

  if (!gitStatus) {
    if (!checkedRepo) return null; // primo caricamento, non ancora sappiamo
    return (
      <div>
        {header}
        {intro}
        <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
            Questo progetto non è ancora agganciato a un repository.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
              placeholder="URL del repository (opzionale — vuoto per un repository solo locale)"
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={attaching}
              onClick={attachRepo}
              style={{ padding: "5px 12px", background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4, color: "var(--brand-on-primary, #fff)", fontSize: 12, cursor: attaching ? "wait" : "pointer" }}
            >
              Aggancia a un repository
            </button>
          </div>
          {attachErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{attachErr}</div>}
        </div>
      </div>
    );
  }

  const dateStr = gitStatus.commit_date
    ? new Date(gitStatus.commit_date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "—";

  return (
    <div>
      {header}
      {intro}
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>Branch:</span>
          <span style={{ color: "#93c5fd", fontWeight: 700 }}>{gitStatus.branch}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>SHA:</span>
          <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace" }}>{gitStatus.sha}</span>
          <span style={{ color: gitStatus.clean ? "#34d399" : "#fb923c" }}>
            {gitStatus.clean ? "✓ clean" : "⚠ modificato"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{dateStr} — </span>
          {gitStatus.author}: {gitStatus.message}
        </div>
        {gitStatus.remote_url && (
          <div style={{ fontSize: 11, color: "var(--brand-border, #475569)", wordBreak: "break-all" }}>{gitStatus.remote_url}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <button
            disabled={busy}
            onClick={() => runOp(() => api.triggerDeploy(), "Deploy")}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#1e40af", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↑ Deploy (git pull)
          </button>
          <button
            disabled={busy}
            onClick={() => { if (confirm("Eseguire git reset --hard HEAD~1? Questa operazione non è reversibile.")) runOp(() => api.triggerRollback(), "Rollback"); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-danger, #ef4444)", border: "none", borderRadius: 4, color: "var(--brand-on-danger, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↓ Rollback (HEAD~1)
          </button>
          <button
            disabled={busy}
            onClick={() => { setShowCommitForm((v) => !v); setOpMsg(null); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            💾 Commit
          </button>
          {gitStatus?.remote_url && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("Pubblicare i commit locali sul remote?")) {
                  runOp(() => api.pushProject(), "Push");
                }
              }}
              style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#7c3aed", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              ↑ Push{gitStatus.unpushed_commits > 0 ? ` (${gitStatus.unpushed_commits})` : ""}
            </button>
          )}
        </div>
        {showCommitForm && (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commitMsg.trim()) {
                  setShowCommitForm(false);
                  runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                  setCommitMsg("");
                }
              }}
              placeholder={t("cfg.commitMessage")}
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
              autoFocus
            />
            <button
              disabled={busy || !commitMsg.trim()}
              onClick={() => {
                setShowCommitForm(false);
                runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                setCommitMsg("");
              }}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowCommitForm(false); setCommitMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {opMsg && (
          <div style={{ fontSize: 11, color: opMsg.startsWith("Errore") ? "var(--brand-danger-soft, #fca5a5)" : "#34d399", marginTop: 2, whiteSpace: "pre-wrap" }}>
            {opMsg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, flex: 1 }}>TAG</span>
          <button
            disabled={tagBusy}
            onClick={() => setShowTagForm((v) => !v)}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, cursor: tagBusy ? "wait" : "pointer", fontSize: 12 }}
          >
            + Nuovo tag
          </button>
        </div>
        {showTagForm && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="nome (es. v1.2.0)"
              style={{ flex: 1, minWidth: 120, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <input
              value={newTagMsg}
              onChange={(e) => setNewTagMsg(e.target.value)}
              placeholder="messaggio (opzionale)"
              style={{ flex: 2, minWidth: 160, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={tagBusy || !newTagName.trim()}
              onClick={createTag}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowTagForm(false); setNewTagName(""); setNewTagMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {tagErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{tagErr}</div>}
        {tags === null ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>Caricamento…</div>
        ) : tags.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>Nessun tag.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tags.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>{name}</code>
                {gitStatus.remote_url && (
                  <button
                    disabled={tagBusy}
                    onClick={() => pushTag(name)}
                    style={{ padding: "3px 10px", background: "#7c3aed", border: "none", borderRadius: 3, color: "#fff", fontSize: 11, cursor: tagBusy ? "wait" : "pointer" }}
                  >↑ Push</button>
                )}
                <button
                  disabled={tagBusy}
                  onClick={() => deleteTag(name)}
                  style={{ padding: "3px 10px", background: "transparent", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 3, cursor: tagBusy ? "wait" : "pointer", fontSize: 11 }}
                >{t("common.delete")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preferenze IDE ───────────────────────────────────────────────────────────
//
// Impostazioni di *questo browser/editor*, non del progetto: mai salvate in
// project.yaml, sempre in localStorage (ThemeToggle/UiLangSelect già
// esistenti, prima sparse fra la tab "Stato" — sezione ASPETTO — e il menu
// utente 👤). Le altre impostazioni IDE-locali censite (URL runtime override,
// larghezze pannelli, stato cassetto log, righelli/guide canvas...) restano
// dove sono: la prima precede l'apertura di un progetto (va scelta prima di
// arrivare qui), le altre sono stato di layout effimero, non "preferenze" nel
// senso in cui si cercherebbero in un pannello di configurazione.
function IdePreferencesTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.5 }}>
        Impostazioni di questo editor — non fanno parte del progetto e non si spostano su un
        altro dispositivo/browser.
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>Tema chiaro/scuro</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>"Sistema" segue le preferenze del browser. La scelta è ricordata su questo dispositivo.</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>Lingua interfaccia</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>Lingua dei menu e dei testi dell'editor — non la lingua dei contenuti del progetto (tab Lingue).</div>
        </div>
        <UiLangSelect />
      </div>
    </div>
  );
}

function SystemTab() {
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async (remote: boolean) => {
    try {
      const s = remote ? await api.remoteGetSystemStatus() : await api.getSystemStatus();
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  // "Il runtime" a cui riferirsi è quello connesso quando c'è una connessione
  // remota attiva — non un secondo riquadro affiancato come per Datastore/
  // Backup: qui è un concetto singolare. Azzera lo stato al cambio di
  // sorgente così non si vede per un istante il dato del backend sbagliato.
  useEffect(() => {
    setStatus(null);
    setError(null);
    void fetchStatus(remoteConnected);
    intervalRef.current = setInterval(() => void fetchStatus(remoteConnected), 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [remoteConnected]);

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
      <div style={{ color: "var(--brand-danger-soft, #fca5a5)", background: "#450a0a", border: "1px solid #991b1b", borderRadius: 6, padding: "12px 16px", fontSize: 13 }}>
        Errore caricamento stato sistema: {error}
      </div>
    );
  }

  if (!status) {
    return <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>Caricamento…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
          RUNTIME
          {remoteConnected && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--brand-primary, #3b82f6)" }}> — dispositivo remoto connesso</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MetricCard icon="🖥" label="Versione" value={status.runtime_version} />
          <MetricCard icon="📦" label="Progetto" value={status.active_project ?? "—"} />
          <MetricCard icon="⏱" label="Uptime" value={fmtUptime(status.uptime_s)} />
          <MetricCard icon="🏷" label="Tag" value={String(status.tag_count)} />
          <MetricCard icon="📡" label="Sorgenti" value={String(status.source_count)} />
          <MetricCard icon="🔔" label="Allarmi attivi" value={String(status.alarm_active_count)} />
        </div>
        <div style={{ marginTop: 8, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>📊 Storico</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{fmtSamples(status.historian_samples)}</div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
          SISTEMA
          {remoteConnected && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--brand-primary, #3b82f6)" }}> — dispositivo remoto connesso</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>⚙ CPU</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.cpu_usage_pct.toFixed(1)}%</span>
            </div>
            <ProgressBar value={status.cpu_usage_pct} max={100} color="#60a5fa" />
          </div>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>💾 RAM</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.mem_used_mb} MB / {status.mem_total_mb} MB</span>
            </div>
            <ProgressBar value={status.mem_used_mb} max={status.mem_total_mb} color="#34d399" />
          </div>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>💿 Disco</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.disk_used_gb} GB / {status.disk_total_gb} GB</span>
            </div>
            <ProgressBar value={status.disk_used_gb} max={status.disk_total_gb} color="#fb923c" />
          </div>
        </div>
      </div>
      <TlsSection />
      <GitOpsPanel />
      <AuditSection />
    </div>
  );
}

// ── Audit log section (inside SystemTab, Admin-only, OPEN_QUESTIONS Q8) ──────
// Read-only view of the append-only, hash-chained audit trail: who did what
// (login, tag writes, script exec, project config changes) + a one-click
// integrity check against the on-disk hash chain.

function AuditSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerifyReport | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { setEntries(await api.getAuditTail(200)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const runVerify = async () => {
    setVerifying(true); setVerify(null);
    try { setVerify(await api.getAuditVerify()); }
    catch (e: unknown) { setVerify({ ok: false, entries: 0, reason: e instanceof Error ? e.message : String(e) }); }
    finally { setVerifying(false); }
  };

  const fmtTs = (ms: number) => new Date(ms).toLocaleString();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, flex: 1 }}>
          AUDIT LOG
        </span>
        <button style={S.btn("ghost")} onClick={load} disabled={loading}>{loading ? "Aggiorno…" : "Aggiorna"}</button>
        <button style={S.btn("ghost")} onClick={runVerify} disabled={verifying}>{verifying ? "Verifico…" : "Verifica integrità"}</button>
      </div>

      {verify && (
        <div style={{
          marginBottom: 10, fontSize: 12, borderRadius: 6, padding: "8px 12px",
          background: verify.ok ? "var(--brand-success-bg, #166534)" : "#450a0a",
          border: `1px solid ${verify.ok ? "#15803d" : "#991b1b"}`,
          color: verify.ok ? "#bbf7d0" : "var(--brand-danger-soft, #fca5a5)",
        }}>
          {verify.ok
            ? `✓ Catena integra — ${verify.entries} entry verificate.`
            : `✗ Catena compromessa alla entry #${verify.broken_at ?? "?"} — ${verify.reason ?? "motivo sconosciuto"}`}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginBottom: 8 }}>Errore: {error}</div>
      )}

      <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6 }}>
        <table style={{ ...S.table, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 150 }}>Quando</th>
              <th style={{ ...S.th, width: 110 }}>Chi</th>
              <th style={{ ...S.th, width: 140 }}>Azione</th>
              <th style={S.th}>Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: "var(--brand-border, #475569)", padding: 16 }}>Nessuna entry.</td></tr>
            )}
            {[...entries].reverse().map((e) => (
              <tr key={e.seq}>
                <td style={{ ...S.td, fontSize: 11 }}>{fmtTs(e.ts_ms)}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace" }}>{e.actor ?? "—"}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace" }}>{e.action}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace", color: "var(--brand-text-muted, #94a3b8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={JSON.stringify(e.detail)}>
                  {JSON.stringify(e.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── TLS management section (inside SystemTab, Admin-only) ─────────────────────
function TlsSection() {
  const authRole = useAppStore((s) => s.authRole);
  const [tlsEnabled, setTlsEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");

  useEffect(() => {
    api.getTlsStatus().then(s => setTlsEnabled(s.enabled)).catch(() => setTlsEnabled(false));
  }, []);

  if (authRole !== "Admin") return null;
  if (tlsEnabled === null) return null;

  const handleGenerate = async () => {
    if (!confirm("Generare un nuovo certificato TLS self-signed?\n\nIl runtime si riavvierà in modalità HTTPS. Sarà necessario accettare il certificato nel browser.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.generateTlsCert();
      setMsg("Certificato generato — il runtime si sta riavviando in HTTPS…");
    } catch (e: any) {
      setMsg(`Errore: ${String(e?.message ?? e)}`);
      setBusy(false);
    }
  };

  const readFileInto = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(setter).catch(() => setMsg("Errore: impossibile leggere il file"));
  };

  const handleUpload = async () => {
    if (!certPem.trim() || !keyPem.trim()) {
      setMsg("Errore: incolla o carica sia il certificato sia la chiave privata (PEM).");
      return;
    }
    if (!confirm("Caricare il certificato fornito e attivare HTTPS?\n\nIl runtime si riavvierà. Dovrai riconnetterti su https://.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.uploadTlsCert(certPem, keyPem);
      setMsg("Certificato caricato — il runtime si sta riavviando in HTTPS…");
    } catch (e: any) {
      setMsg(`Errore: ${String(e?.message ?? e)}`);
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Disabilitare TLS e tornare a plain HTTP?\n\nIl runtime si riavvierà. Nessun certificato da accettare.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.removeTlsCert();
      setMsg("TLS disabilitato — il runtime si sta riavviando in HTTP…");
    } catch (e: any) {
      setMsg(`Errore: ${String(e?.message ?? e)}`);
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
        CERTIFICATO TLS
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: tlsEnabled ? "#34d399" : "var(--brand-text-subtle, #64748b)",
          }} />
          <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            {tlsEnabled ? "HTTPS attivo" : "HTTP plain (nessun certificato)"}
          </span>
        </div>
        {!tlsEnabled && (
          <div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              Genera un certificato self-signed per abilitare HTTPS. Richiesto per accesso da LAN (non localhost).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleGenerate}
                disabled={busy}
                style={{ padding: "6px 14px", background: "var(--brand-primary-hover, #2563eb)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
              >
                Genera certificato self-signed
              </button>
              <button
                onClick={() => setShowUpload(v => !v)}
                disabled={busy}
                style={{ padding: "6px 14px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
              >
                {showUpload ? "Annulla caricamento" : "Carica certificato (cert + key)"}
              </button>
            </div>
            {showUpload && (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                  Carica un certificato firmato da una CA (es. aziendale). Incolla il PEM o seleziona i file.
                </p>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 4 }}>
                    Certificato (tls.crt, PEM)
                  </label>
                  <input type="file" accept=".crt,.pem,.cer" onChange={readFileInto(setCertPem)}
                    style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }} />
                  <textarea value={certPem} onChange={(e) => setCertPem(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    rows={4} spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: 8 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 4 }}>
                    Chiave privata (tls.key, PEM)
                  </label>
                  <input type="file" accept=".key,.pem" onChange={readFileInto(setKeyPem)}
                    style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }} />
                  <textarea value={keyPem} onChange={(e) => setKeyPem(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    rows={4} spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: 8 }} />
                </div>
                <button
                  onClick={handleUpload}
                  disabled={busy}
                  style={{ justifySelf: "start", padding: "6px 14px", background: "var(--brand-primary-hover, #2563eb)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
                >
                  Carica e attiva HTTPS
                </button>
              </div>
            )}
          </div>
        )}
        {tlsEnabled && (
          <div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              Il runtime serve HTTPS. Per tornare a HTTP plain (es. per sviluppo localhost) rimuovi il certificato.
            </p>
            <button
              onClick={handleRemove}
              disabled={busy}
              style={{ padding: "6px 14px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
            >
              Disabilita TLS
            </button>
          </div>
        )}
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith("Errore") ? "var(--brand-danger-soft, #fca5a5)" : "#34d399" }}>
            {msg}
          </div>
        )}
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
  const { t } = useTranslation();
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
        <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, marginTop: 0 }}>
          Gli utenti sono salvati in <code>users.yaml</code> nella cartella del progetto.
          La password viene cifrata con Argon2id; il file non contiene mai testo in chiaro.
        </p>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", background: "#7f1d1d33", padding: "8px 10px", borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {users === null ? (
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>Caricamento…</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{t("cfg.user")}</th>
                <th style={S.th}>{t("cfg.role")}</th>
                <th style={S.th}>{t("cfg.changePwd")}</th>
                <th style={S.th}>{t("cfg.sessionExpiry")}</th>
                <th style={S.th} title={t("cfg.accessibleZones")}>{t("cfg.zones")}</th>
                <th style={S.th}>{t("cfg.updated")}</th>
                <th style={S.th}>{t("cfg.resetPassword")}</th>
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
                      {isSelf && <span style={{ marginLeft: 6, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>(tu)</span>}
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
                      <select
                        value={u.session_ttl_secs === null ? "default" : u.session_ttl_secs === 0 ? "never" : String(u.session_ttl_secs)}
                        disabled={busy}
                        style={{ ...S.inputSm, minWidth: 110 }}
                        onChange={(e) => {
                          const v = e.target.value;
                          const ttl: number | null =
                            v === "default" ? null :
                            v === "never"   ? 0    :
                            Number(v);
                          onPatch(u.username, { session_ttl_secs: ttl });
                        }}
                      >
                        <option value="default">{t("cfg.default")}</option>
                        <option value="never">{t("cfg.never")}</option>
                        <option value="1800">30 min</option>
                        <option value="3600">1 ora</option>
                        <option value="7200">2 ore</option>
                        <option value="28800">8 ore</option>
                        <option value="86400">24 ore</option>
                        <option value="604800">7 giorni</option>
                        {/* Preserve custom values not in the list */}
                        {u.session_ttl_secs !== null && u.session_ttl_secs !== 0 &&
                         ![1800, 3600, 7200, 28800, 86400, 604800].includes(u.session_ttl_secs) && (
                          <option value={String(u.session_ttl_secs)}>
                            {Math.round(u.session_ttl_secs / 60)} min
                          </option>
                        )}
                      </select>
                    </td>
                    <td style={S.td}>
                      <input
                        style={{ ...S.inputSm, fontSize: 11, minWidth: 120 }}
                        placeholder={t("cfg.zonesPlaceholder")}
                        title={t("cfg.accessibleZonesHint")}
                        value={(u.allowed_zones ?? []).join(", ")}
                        disabled={busy}
                        onChange={(e) => {
                          const zones = e.target.value ? e.target.value.split(",").map((z) => z.trim()).filter(Boolean) : [];
                          onPatch(u.username, { allowed_zones: zones });
                        }}
                      />
                    </td>
                    <td style={S.td}>
                      <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12 }}>{fmtDate(u.updated_at_ms)}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="password"
                          value={resetBuf[u.username] ?? ""}
                          placeholder={t("cfg.newPasswordPh")}
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
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.username")}</label>
            <input
              type="text"
              value={newUser.username}
              onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
              style={S.input}
              placeholder="es. operatore2"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.initialPassword")}</label>
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
              style={S.input}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.role")}</label>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginTop: 8 }}>
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
  const { t } = useTranslation();
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
    background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
    color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 2 };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 700 }}>

      {/* Simboli già aggiunti */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12 }}>
          SIMBOLI PROGETTO ({customSymbols.length})
        </div>
        {customSymbols.length === 0 ? (
          <div style={{ color: "var(--brand-border, #475569)", fontSize: 13 }}>Nessun simbolo custom aggiunto.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--brand-text-subtle, #64748b)", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                {["Etichetta", "URL", "Licenza", "Autore / fonte", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customSymbols.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text, #e2e8f0)" }}>{s.label}</td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand-primary, #3b82f6)" }}>{s.url}</a>
                  </td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)" }}>{s.attribution.license}</td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-subtle, #64748b)" }}>{s.attribution.author}{s.attribution.source ? ` / ${s.attribution.source}` : ""}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      onClick={() => remove(s.id)}
                      style={{ background: "transparent", border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 4, color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer", padding: "2px 8px", fontSize: 12 }}
                    >{t("props.remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Form aggiunta */}
      <section style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12 }}>
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
            <div style={lbl}>{t("cfg.author")}</div>
            <input style={inp} placeholder="es. Wikimedia Commons / Mario Rossi" value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={lbl}>URL fonte (per attribuzione CC-BY)</div>
            <input style={inp} placeholder="https://commons.wikimedia.org/wiki/…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          </div>
        </div>
        {error && <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={add}
            disabled={saving || !form.label.trim() || !form.url.trim()}
            style={{
              background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4, color: "var(--brand-on-primary, #fff)",
              cursor: saving ? "wait" : "pointer", padding: "6px 20px", fontSize: 13,
              opacity: (!form.label.trim() || !form.url.trim()) ? 0.5 : 1,
            }}
          >{saving ? "Salvataggio…" : "Aggiungi al progetto"}</button>
          <span style={{ fontSize: 11, color: "var(--brand-border, #475569)" }}>
            Confermando accetti di rispettare i termini della licenza selezionata.
          </span>
        </div>
      </section>
    </div>
  );
}

// ── DATASTORES tab ────────────────────────────────────────────────────────────

function newSqliteConfig(): DatastoreBackendConfig {
  return { kind: "sqlite", path: "history/historian.db" };
}
function newPostgresConfig(): DatastoreBackendConfig {
  return { kind: "postgres", host: "localhost", port: 5432, database: "sws", username: "sws", password: "", ssl_mode: "disable", schema: "public" };
}
function newOdbcConfig(): DatastoreBackendConfig {
  return { kind: "odbc", dsn: "", connection_string: "", table: "sws_samples", col_tag: "tag_id", col_value: "value", col_ts: "ts_ms" };
}

function DatastoresTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const [datastores, setDatastores] = useState<DatastoreConfig[]>(project?.datastores ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  // ── Gestione database ──────────────────────────────────────────────────────
  // `purge` ed `export` esistevano già nel backend e nel client da tempo, senza
  // che nessun pulsante li chiamasse. Qui vengono collegati, insieme ai due
  // nuovi (tag orfani, vacuum). Il backup completo NON si duplica: la tab
  // "Backup" già include `history/`.
  const [mgmtMsg, setMgmtMsg] = useState<Record<string, string>>({});
  const [tagsMap, setTagsMap] = useState<Record<string, { db_tags: string[]; orphan_tags: string[] } | null>>({});
  const [busyMgmt, setBusyMgmt] = useState<Record<string, boolean>>({});

  const withBusy = async (id: string, fn: () => Promise<string>) => {
    setBusyMgmt((m) => ({ ...m, [id]: true }));
    setMgmtMsg((m) => ({ ...m, [id]: "" }));
    try {
      const msg = await fn();
      setMgmtMsg((m) => ({ ...m, [id]: msg }));
    } catch (e: any) {
      setMgmtMsg((m) => ({ ...m, [id]: `✗ ${e?.message ?? String(e)}` }));
    } finally {
      setBusyMgmt((m) => ({ ...m, [id]: false }));
    }
  };

  const doPurge = (ds: DatastoreConfig) => {
    // Si riusa la retention già configurata per il backend: una pulizia manuale
    // che applicasse regole diverse da quelle automatiche sarebbe una sorpresa.
    const rows = ds.retention_rows, days = ds.retention_days;
    if (!rows && !days) {
      setMgmtMsg((m) => ({ ...m, [ds.id]: "✗ Nessuna retention configurata: imposta righe o giorni e salva, poi ripeti." }));
      return;
    }
    const desc = [rows ? `${rows} righe per tag` : null, days ? `${days} giorni` : null].filter(Boolean).join(" · ");
    if (!window.confirm(`Pulire ora "${ds.id}" mantenendo ${desc}?\n\nI campioni fuori da questi limiti vengono cancellati. Operazione irreversibile.`)) return;
    void withBusy(ds.id, async () => {
      const r = await api.purgeDatastore(ds.id, { retention_rows: rows, retention_days: days });
      await loadStats(ds.id);
      return `✓ ${r.deleted.toLocaleString()} campioni cancellati. Usa "Recupera spazio" per restringere il file.`;
    });
  };

  const doExport = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const tags = (await api.listDatastoreTags(ds.id)).db_tags;
      if (tags.length === 0) return "Nessun dato da esportare.";
      const data = await api.exportDatastore(ds.id, { tags });
      // CSV: una riga per campione. Formato scelto perché è quello che si apre
      // senza attrezzi, che è il punto di un export manuale.
      const rows = ["tag,timestamp_ms,value,quality"];
      for (const t of data) {
        for (const smp of t.samples) {
          rows.push(`${t.tag_id},${(smp as any).ts_ms ?? ""},${String((smp as any).value ?? "")},${(smp as any).quality ?? ""}`);
        }
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${ds.id}-storico.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      return `✓ Esportati ${rows.length - 1} campioni da ${data.length} tag.`;
    });

  const loadTags = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const r = await api.listDatastoreTags(ds.id);
      setTagsMap((m) => ({ ...m, [ds.id]: r }));
      return r.orphan_tags.length === 0
        ? `✓ Nessun tag orfano (${r.db_tags.length} tag nel database).`
        : `${r.orphan_tags.length} tag orfani su ${r.db_tags.length} nel database.`;
    });

  const doDeleteTag = (ds: DatastoreConfig, tag: string) => {
    if (!window.confirm(`Cancellare tutto lo storico del tag "${tag}"?\n\nOperazione irreversibile.`)) return;
    void withBusy(ds.id, async () => {
      const r = await api.deleteTagHistory(ds.id, tag);
      const fresh = await api.listDatastoreTags(ds.id);
      setTagsMap((m) => ({ ...m, [ds.id]: fresh }));
      await loadStats(ds.id);
      return `✓ "${tag}": ${r.deleted.toLocaleString()} campioni cancellati.`;
    });
  };

  const doVacuum = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const r = await api.vacuumDatastore(ds.id);
      await loadStats(ds.id);
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
      return r.bytes_freed > 0
        ? `✓ Liberati ${mb(r.bytes_freed)} MB (da ${mb(r.bytes_before)} a ${mb(r.bytes_after)} MB).`
        : `Nessuno spazio da liberare (file a ${mb(r.bytes_after)} MB).`;
    });

  // ── Download/upload del file database — locale (progetto a cui l'editor è
  // attaccato) o del dispositivo remoto connesso. Le altre azioni sopra
  // (purge/export/tags/vacuum) agiscono già solo sul backend corrente per
  // costruzione (`request()`/`getBaseUrl()`) — qui invece serve poter
  // scegliere esplicitamente, perché "il database del dispositivo" è
  // proprio il caso che ha motivato questa feature.
  const doDownloadDb = (ds: DatastoreConfig, remote: boolean) =>
    void withBusy(ds.id, async () => {
      const res = remote
        ? await api.remoteDownloadDatastoreDb(ds.id)
        : await api.downloadDatastoreDb(ds.id);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${ds.id}${remote ? "-remoto" : ""}.db`;
      a.click();
      URL.revokeObjectURL(a.href);
      return `✓ Database scaricato (${(blob.size / 1024 / 1024).toFixed(2)} MB)${remote ? " dal dispositivo remoto" : ""}.`;
    });

  const [uploadTarget, setUploadTarget] = useState<{ id: string; remote: boolean } | null>(null);
  const dbFileRef = useRef<HTMLInputElement | null>(null);

  const askUploadDb = (ds: DatastoreConfig, remote: boolean) => {
    if (!window.confirm(
      `Sostituire il database di "${ds.id}"${remote ? " sul dispositivo remoto connesso" : ""}?\n\n` +
      "Verrà creato un backup automatico del file precedente, ma il nuovo database NON sarà usato " +
      "finché il runtime non viene riavviato: la connessione già aperta continua a scrivere sul " +
      "vecchio file fino al riavvio. Operazione delicata."
    )) return;
    setUploadTarget({ id: ds.id, remote });
    dbFileRef.current?.click();
  };

  const doUploadDb = (file: File) => {
    const target = uploadTarget;
    setUploadTarget(null);
    if (!target) return;
    void withBusy(target.id, async () => {
      const r = target.remote
        ? await api.remoteUploadDatastoreDb(target.id, file)
        : await api.uploadDatastoreDb(target.id, file);
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
      return `✓ Caricati ${mb(r.bytes_written)} MB${target.remote ? " sul dispositivo remoto" : ""}. ` +
        `Backup del precedente: ${r.backup_path}. Riavvia il runtime perché il nuovo database venga usato.`;
    });
  };

  const cellStyle: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--brand-surface, #1e293b)", verticalAlign: "top" };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 2 };
  const inputStyle: React.CSSProperties = { width: "100%", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "#f1f5f9", borderRadius: 4, padding: "3px 6px", fontSize: 12 };

  return (
    <div style={{ padding: 16 }}>
      <SaveBar onSave={save} saving={saving} saved={saved} disabled={!dirty}
        section="datastores" dirty={dirty} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
          Configura i backend di persistenza dati storici. Ogni variabile con &quot;history&quot; attivo
          viene scritta nel datastore assegnato.
        </span>
        <button onClick={addDatastore} style={{ background: "#0ea5e9", color: "#0f172a", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
          + Aggiungi
        </button>
      </div>
      {saveError && <div style={{ color: "var(--brand-danger-soft, #f87171)", fontSize: 12, marginBottom: 8 }}>{saveError}</div>}

      {datastores.length === 0 && (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 24, textAlign: "center" }}>
          Nessun datastore configurato. Usa il pulsante + per aggiungerne uno.
        </div>
      )}

      {datastores.map((ds) => {
        const status = statusMap[ds.id];
        const stats  = statsMap[ds.id];
        return (
          <div key={ds.id} style={{ background: "var(--brand-surface, #1e293b)", borderRadius: 6, padding: 12, marginBottom: 12, border: "1px solid var(--brand-surface-2, #334155)" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input
                value={ds.label}
                onChange={(e) => patchDs(ds.id, { label: e.target.value })}
                placeholder={t("cfg.labelField")}
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
              <button onClick={() => testDs(ds.id)} style={{ background: "#0ea5e9", color: "#0f172a", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>{t("common.test")}</button>
              <button onClick={() => loadStats(ds.id)} style={{ background: "var(--brand-border, #475569)", color: "var(--brand-text, #e2e8f0)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>{t("common.stats")}</button>
              <button onClick={() => removeDatastore(ds.id)} style={{ background: "var(--brand-danger, #ef4444)", color: "var(--brand-on-danger, #fff)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>X</button>
            </div>

            {/* Status + stats row */}
            {status && (
              <div style={{ fontSize: 11, color: status.ok ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)", marginBottom: 8 }}>
                {status.msg}
              </div>
            )}
            {stats !== undefined && (
              <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, display: "flex", gap: 16 }}>
                {stats === null ? "Caricamento stats…" : (
                  <>
                    <span>Campioni: {stats.sample_count.toLocaleString()}</span>
                    <span>Tag: {stats.tag_count}</span>
                    {stats.size_bytes != null && <span>Dim: {(stats.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                    <span style={{ color: stats.connected ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)" }}>{stats.connected ? "Connesso" : stats.error ?? "Disconnesso"}</span>
                  </>
                )}
              </div>
            )}

            {/* ── Gestione database ────────────────────────────────────────
                Purge ed export esistevano nel backend da tempo senza che nessun
                pulsante li chiamasse; tag orfani e recupero spazio sono nuovi.
                Il backup completo non si duplica qui: la tab "Backup" include
                già `history/`. */}
            <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }}>
                GESTIONE DATABASE
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => doPurge(ds)} disabled={busyMgmt[ds.id]}
                  title="Applica ora la retention configurata sopra, senza aspettare la pulizia automatica."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Pulisci ora
                </button>
                <button onClick={() => doExport(ds)} disabled={busyMgmt[ds.id]}
                  title="Scarica tutto lo storico in CSV (una riga per campione)."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Esporta CSV
                </button>
                <button onClick={() => loadTags(ds)} disabled={busyMgmt[ds.id]}
                  title="Tag che hanno storico nel database ma che il runtime non conosce più (rinominati o rimossi dal progetto)."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Cerca tag orfani
                </button>
                <button onClick={() => doVacuum(ds)} disabled={busyMgmt[ds.id]}
                  title="VACUUM + checkpoint WAL: restringe il file dopo una cancellazione. SQLite non libera lo spazio da sé."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Recupera spazio
                </button>
                <button onClick={() => doDownloadDb(ds, false)} disabled={busyMgmt[ds.id]}
                  title="Scarica il file database grezzo (copia consistente), per archiviarlo."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Scarica database
                </button>
                <button onClick={() => askUploadDb(ds, false)} disabled={busyMgmt[ds.id]}
                  title="Sostituisce il file database con uno caricato da qui (backup automatico del precedente, serve un riavvio del runtime)."
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Carica database
                </button>
                {remoteConnected && (
                  <>
                    <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>· dispositivo remoto:</span>
                    <button onClick={() => doDownloadDb(ds, true)} disabled={busyMgmt[ds.id]}
                      title="Scarica il database dello stesso datastore, ma dal dispositivo remoto connesso (non da questo progetto locale)."
                      style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                      Scarica (remoto)
                    </button>
                    <button onClick={() => askUploadDb(ds, true)} disabled={busyMgmt[ds.id]}
                      title="Sostituisce il database sul dispositivo remoto connesso (backup automatico del precedente, serve un riavvio del runtime remoto)."
                      style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                      Carica (remoto)
                    </button>
                  </>
                )}
                {busyMgmt[ds.id] && <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>in corso…</span>}
              </div>

              {mgmtMsg[ds.id] && (
                <div style={{ fontSize: 11, marginTop: 6, color: mgmtMsg[ds.id].startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-muted, #94a3b8)" }}>
                  {mgmtMsg[ds.id]}
                </div>
              )}

              {tagsMap[ds.id] && tagsMap[ds.id]!.orphan_tags.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--brand-warning, #eab308)", marginBottom: 4 }}>
                    Tag orfani — hanno storico ma non esistono più nel progetto:
                  </div>
                  {tagsMap[ds.id]!.orphan_tags.map((tag) => (
                    <div key={tag} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                      <code style={{ fontSize: 11, color: "var(--brand-text, #e2e8f0)" }}>{tag}</code>
                      <button onClick={() => doDeleteTag(ds, tag)} disabled={busyMgmt[ds.id]}
                        style={{ background: "var(--brand-danger, #ef4444)", color: "var(--brand-on-danger, #fff)", border: "none", borderRadius: 4, padding: "1px 6px", cursor: "pointer", fontSize: 10 }}>
                        Elimina storico
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
                Il backup completo del database è nella tab <strong>Backup</strong>: include già <code>history/</code>.
              </div>
            </div>

            {/* Backend-specific fields */}
            {ds.backend.kind === "sqlite" && (
              <div style={cellStyle}>
                <span style={labelStyle}>{t("cfg.filePath")}</span>
                <input value={ds.backend.path} onChange={(e) => patchBackend(ds.id, { path: e.target.value })} style={inputStyle} placeholder="history/historian.db" />
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
                <span style={labelStyle}>{t("cfg.maxRowsPerTag")}</span>
                <input type="number" min={0}
                  value={ds.retention_rows ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_rows: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder={t("cfg.unlimited")} />
              </div>
              <div>
                <span style={labelStyle}>{t("cfg.retentionDays")}</span>
                <input type="number" min={0}
                  value={ds.retention_days ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_days: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder={t("cfg.unlimited")} />
              </div>
            </div>
          </div>
        );
      })}

      <input ref={dbFileRef} type="file" accept=".db,application/octet-stream" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) doUploadDb(f); }} />
    </div>
  );
}

// ── GlobalScriptsTab ──────────────────────────────────────────────────────────

function newScript(): GlobalScriptDef {
  return {
    id: `script_${Date.now()}`,
    trigger: { kind: "startup" },
    code: "# Script avviato all'apertura del progetto\nlog('Hello from global script!')\n",
    enabled: true,
  };
}

function triggerLabel(t: ScriptTriggerKind): string {
  switch (t.kind) {
    case "startup":    return "Avvio";
    case "interval":   return `Ogni ${t.interval_s}s`;
    case "cron":       return `Cron: ${t.schedule}`;
    case "tag_change": return `Tag: ${t.tag}`;
  }
}

function GlobalScriptsTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const [scripts, setScripts] = useState<GlobalScriptDef[]>(
    () => project?.global_scripts ?? []
  );
  const [selected, setSelected] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const editorRef = useRef<PythonEditorHandle | null>(null);

  // Sync when project reloads
  useEffect(() => {
    setScripts(project?.global_scripts ?? []);
  }, [project]);

  const cur = scripts[selected] ?? null;

  function update(idx: number, patch: Partial<GlobalScriptDef>) {
    setScripts((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function updateTrigger(idx: number, patch: Partial<ScriptTriggerKind>) {
    const s = scripts[idx];
    if (!s) return;
    update(idx, { trigger: { ...s.trigger, ...patch } as ScriptTriggerKind });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await api.saveGlobalScripts(scripts);
      setMsg("Salvato.");
    } catch (e) {
      setMsg(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function addScript() {
    const s = newScript();
    setScripts((prev) => [...prev, s]);
    setSelected(scripts.length);
  }

  function removeScript(idx: number) {
    setScripts((prev) => prev.filter((_, i) => i !== idx));
    setSelected((prev) => Math.max(0, prev > idx ? prev - 1 : prev));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
      <SaveBar onSave={handleSave} saving={saving} saved={false} label="Salva tutti" notice={msg} />
      <div style={{ display: "flex", gap: 16, flex: 1, overflow: "hidden" }}>
      {/* Left: script list */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>SCRIPT</span>
          <button
            onClick={addScript}
            style={{ background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}
          >+ Nuovo</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {scripts.length === 0 && (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 8 }}>Nessuno script.</div>
          )}
          {scripts.map((s, idx) => (
            <div
              key={s.id}
              onClick={() => setSelected(idx)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: selected === idx ? "#1e40af" : "var(--brand-surface, #1e293b)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeScript(idx); }}
                  style={{ background: "none", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
                >✕</button>
              </div>
              <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{triggerLabel(s.trigger)}</span>
              <span style={{ fontSize: 11, color: s.enabled ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)" }}>{s.enabled ? "Abilitato" : "Disabilitato"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: editor */}
      {cur ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          {/* ID + enabled */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>ID</label>
            <input
              value={cur.id}
              onChange={(e) => update(selected, { id: e.target.value })}
              style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 200 }}
            />
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={cur.enabled}
                onChange={(e) => update(selected, { enabled: e.target.checked })}
              />
              Abilitato
            </label>
          </div>

          {/* Trigger type */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.trigger")}</label>
            <select
              value={cur.trigger.kind}
              onChange={(e) => {
                const kind = e.target.value as ScriptTriggerKind["kind"];
                const base: ScriptTriggerKind =
                  kind === "startup"    ? { kind } :
                  kind === "interval"   ? { kind, interval_s: 60 } :
                  kind === "cron"       ? { kind, schedule: "0 * * * *" } :
                  /* tag_change */        { kind, tag: "", edge: "any" };
                update(selected, { trigger: base });
              }}
              style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13 }}
            >
              <option value="startup">{t("cfg.projectStart")}</option>
              <option value="interval">Intervallo (secondi)</option>
              <option value="cron">Cron (5 campi)</option>
              <option value="tag_change">{t("cfg.tagChange")}</option>
            </select>

            {cur.trigger.kind === "interval" && (
              <input
                type="number"
                min={1}
                value={cur.trigger.interval_s}
                onChange={(e) => updateTrigger(selected, { interval_s: Number(e.target.value) })}
                style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 80 }}
              />
            )}
            {cur.trigger.kind === "cron" && (
              <input
                value={cur.trigger.schedule}
                onChange={(e) => updateTrigger(selected, { schedule: e.target.value })}
                placeholder="0 * * * *"
                style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 160 }}
              />
            )}
            {cur.trigger.kind === "tag_change" && (
              <>
                <TagInput
                  value={cur.trigger.tag}
                  onChange={(v) => updateTrigger(selected, { tag: v })}
                  placeholder="es. pump1.running"
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 200 }}
                />
                <select
                  value={cur.trigger.edge}
                  onChange={(e) => updateTrigger(selected, { edge: e.target.value as "rising" | "falling" | "any" })}
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13 }}
                >
                  <option value="any">{t("cfg.any")}</option>
                  <option value="rising">Rising (0→1)</option>
                  <option value="falling">Falling (1→0)</option>
                </select>
              </>
            )}
          </div>

          {/* Code editor */}
          <div style={{ flex: 1, minHeight: 0, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, overflow: "hidden" }}>
            <PythonEditor
              ref={editorRef}
              value={cur.code}
              onChange={(code) => update(selected, { code })}
              height="100%"
            />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-text-subtle, #64748b)", fontSize: 14 }}>
          Seleziona o crea uno script
        </div>
      )}
      </div>
    </div>
  );
}

// ── Faceplate live preview ──────────────────────────────────────────────────
//
// Renders a faceplate DEFINITION's `objects` the same way a placed `faceplate`
// instance renders them (SvgCanvas.tsx's `faceplate` branch) — same
// `substituteFaceplateParams` + `SvgObject` per child — but with no real
// instance params (there is none here, we're editing the definition itself),
// so each declared param substitutes to its own name as a visible placeholder
// (e.g. `{tag_prefix}` → "tag_prefix"), and no live tag data (`tagValues={}}`).
function FaceplatePreview({
  objects, params, faceplates,
}: { objects: SynopticObject[]; params: string[]; faceplates: FaceplateDef[] }) {
  const dummyParams = Object.fromEntries(params.map((p) => [p, p]));

  const PADDING = 12;
  const bbox = objects.reduce((acc, o) => {
    const w = o.width ?? 60, h = o.height ?? 40;
    return {
      minX: Math.min(acc.minX, o.x), minY: Math.min(acc.minY, o.y),
      maxX: Math.max(acc.maxX, o.x + w), maxY: Math.max(acc.maxY, o.y + h),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const hasObjects = Number.isFinite(bbox.minX);
  const viewBox = hasObjects
    ? `${bbox.minX - PADDING} ${bbox.minY - PADDING} ${bbox.maxX - bbox.minX + 2 * PADDING} ${bbox.maxY - bbox.minY + 2 * PADDING}`
    : "0 0 300 220";

  if (!hasObjects) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", height: 200,
        border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 4,
        color: "var(--brand-text-subtle, #64748b)", fontSize: 12,
      }}>
        Nessun oggetto
      </div>
    );
  }

  return (
    <svg
      width="100%" height={240} viewBox={viewBox}
      style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}
    >
      {objects.map((child, i) => (
        <SvgObject
          key={child.id ?? i}
          obj={substituteFaceplateParams(child, dummyParams)}
          objects={objects}
          tagValues={{}}
          selected={false}
          isEditMode={false}
          customSymbols={[]}
          faceplates={faceplates}
        />
      ))}
    </svg>
  );
}

// ── FACEPLATES tab ────────────────────────────────────────────────────────────

function FaceplatesTab() {
  const { t } = useTranslation();
  const storeFaceplates   = useAppStore((s) => s.faceplates);
  const setFaceplates     = useAppStore((s) => s.setFaceplates);
  const [faceplates, setLocal] = useState<FaceplateDef[]>(storeFaceplates);
  const [selected, setSelected] = useState<string | null>(
    storeFaceplates[0]?.id ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Load all faceplates (including built-ins from the API) on mount.
  useEffect(() => {
    api.listFaceplates()
      .then(async (ids) => {
        const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
        setLocal(loaded);
        setFaceplates(loaded);
        if (!selected && loaded.length > 0) setSelected(loaded[0].id);
      })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  const current = faceplates.find((f) => f.id === selected) ?? null;

  function updateCurrent(patch: Partial<FaceplateDef>) {
    if (!current) return;
    setLocal((prev) => prev.map((f) => f.id === current.id ? { ...f, ...patch } : f));
  }

  function addFaceplate() {
    const id = genId("fp-");
    const fp: FaceplateDef = { id, label: "Nuovo faceplate", params: ["tag_prefix", "label"], objects: [] };
    setLocal((prev) => [...prev, fp]);
    setSelected(id);
  }

  async function saveCurrent() {
    if (!current) return;
    setSaving(true);
    try {
      await api.saveFaceplate(current);
      setFaceplates(faceplates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!window.confirm(`Eliminare il faceplate "${current.label}"?`)) return;
    try {
      await api.deleteFaceplate(current.id);
      const updated = faceplates.filter((f) => f.id !== current.id);
      setLocal(updated);
      setFaceplates(updated);
      setSelected(updated[0]?.id ?? null);
    } catch (e) {
      setLoadErr(String(e));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", height: "100%" }}>
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
        color: "var(--brand-text-muted, #94a3b8)", fontSize: 12.5, lineHeight: 1.5, flexShrink: 0,
      }}>
        Un <strong>faceplate</strong> è un blocco grafico riutilizzabile e parametrico: lo definisci
        una volta qui (con parametri come <code>tag_prefix</code>), poi lo piazzi come oggetto sulle
        pagine — quante volte vuoi, ognuna con i propri valori (es. un blocco "motore" riusato per
        motore1/motore2 cambiando solo il prefisso tag). A differenza di un oggetto normale, cambiare
        il faceplate qui aggiorna tutte le istanze che lo usano.
      </div>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left: faceplate list */}
      <div style={{ width: 220, borderRight: "1px solid var(--brand-surface, #1e293b)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", letterSpacing: 0.5 }}>FACEPLATES</span>
          <button style={S.btn("ghost")} onClick={addFaceplate}>+ Nuovo</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {faceplates.map((fp) => (
            <div
              key={fp.id}
              onClick={() => setSelected(fp.id)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: selected === fp.id ? "var(--brand-surface, #1e293b)" : "transparent",
                borderLeft: selected === fp.id ? "2px solid var(--brand-warning, #f59e0b)" : "2px solid transparent",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", fontWeight: selected === fp.id ? 600 : 400 }}>{fp.label}</div>
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{fp.id}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: faceplate editor */}
      {current ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-warning, #f59e0b)" }}>{current.label}</span>
            <span style={{ flex: 1 }} />
            {loadErr && <span style={{ fontSize: 12, color: "var(--brand-danger, #ef4444)" }}>{loadErr}</span>}
            {saved && <span style={{ fontSize: 12, color: "var(--brand-success, #22c55e)" }}>✓ Salvato</span>}
            <button style={S.btn("danger")} onClick={deleteCurrent}>{t("common.delete")}</button>
            <button style={S.btn("success")} onClick={saveCurrent} disabled={saving}>
              {saving ? "Salvataggio…" : "Salva"}
            </button>
          </div>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>ID</label>
                  <input
                    style={S.input}
                    value={current.id}
                    onChange={(e) => updateCurrent({ id: e.target.value })}
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.labelWord")}</label>
                  <input
                    style={S.input}
                    value={current.label}
                    onChange={(e) => updateCurrent({ label: e.target.value })}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                  Parametri (uno per riga, es. <code>tag_prefix</code>, <code>label</code>)
                </label>
                <textarea
                  value={current.params.join("\n")}
                  onChange={(e) => updateCurrent({ params: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                  style={{ ...S.input, height: 80, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                  spellCheck={false}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                  Oggetti template (JSON array — usa <code>{"{tag_prefix}"}</code> come placeholder nei campi tag/label)
                </label>
                <textarea
                  value={JSON.stringify(current.objects, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (Array.isArray(parsed)) updateCurrent({ objects: parsed });
                    } catch { /* invalid JSON — ignore until valid */ }
                  }}
                  style={{ ...S.input, height: 340, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                  spellCheck={false}
                />
              </div>
            </div>
            {/* Anteprima live: legge current.objects/current.params, gli stessi
                dati che la textarea "Oggetti" scrive a ogni tasto valido —
                nessuno stato nuovo, si aggiorna da sé prima ancora di Salva. */}
            <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--brand-surface, #1e293b)", padding: "16px", overflow: "auto" }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 6 }}>
                Anteprima
              </label>
              <FaceplatePreview objects={current.objects} params={current.params} faceplates={faceplates} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-text-subtle, #64748b)", fontSize: 14 }}>
          Seleziona o crea un faceplate. I faceplate built-in sono motor_basic, valve_basic, tank_level.
        </div>
      )}
      </div>
    </div>
  );
}

// ── RECIPES tab ───────────────────────────────────────────────────────────────

function genRecipeId() {
  return "recipe-" + Math.random().toString(36).slice(2, 8);
}

function RecipesTab() {
  const { t } = useTranslation();
  const [recipes, setRecipes]     = useState<RecipeSummary[]>([]);
  const [selected, setSelected]   = useState<RecipeDef | null>(null);
  const [loading, setLoading]     = useState(false);
  const [saved, setSaved]         = useState(false);
  const [newId, setNewId]         = useState("");
  const [newName, setNewName]     = useState("");

  const loadList = async () => {
    try { setRecipes(await api.listRecipes()); } catch { /* no project open */ }
  };

  useEffect(() => { void loadList(); }, []);

  const selectRecipe = async (id: string) => {
    try {
      const r = await api.getRecipe(id);
      setSelected(r);
    } catch { /* ignore */ }
  };

  const saveSelected = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await api.saveRecipe(selected);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await loadList();
    } finally { setLoading(false); }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    await api.deleteRecipe(selected.id);
    setSelected(null);
    await loadList();
  };

  const createRecipe = async () => {
    const id = newId.trim() || genRecipeId();
    const name = newName.trim() || id;
    const r: RecipeDef = { id, name, setpoints: [] };
    await api.saveRecipe(r);
    setNewId(""); setNewName("");
    await loadList();
    await selectRecipe(id);
  };

  const updateSetpoint = (idx: number, patch: Partial<{ tag: string; value: boolean | number | string }>) =>
    setSelected((prev) => prev ? {
      ...prev,
      setpoints: prev.setpoints.map((sp, i) => i === idx ? { ...sp, ...patch } : sp),
    } : null);

  const addSetpoint = () =>
    setSelected((prev) => prev ? {
      ...prev,
      setpoints: [...prev.setpoints, { tag: "", value: 0 }],
    } : null);

  const removeSetpoint = (idx: number) =>
    setSelected((prev) => prev ? {
      ...prev,
      setpoints: prev.setpoints.filter((_, i) => i !== idx),
    } : null);

  const recipeColumns: DataTableColumn<RecipeSummary>[] = [
    { key: "name", header: t("cfg.name"), accessor: (r) => r.name },
    { key: "id", header: t("cfg.recipeId"), accessor: (r) => r.id },
    { key: "setpoints_count", header: t("cfg.setpointsCount"), accessor: (r) => r.setpoints_count, filterable: false, align: "right", width: 60 },
  ];

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>RICETTE (ISA-88)</div>
      <div style={S.notice}>
        Una ricetta è un insieme nominato di setpoint che vengono scritti atomicamente sui tag
        selezionati. Usata per cambiare configurazione impianto (cambio prodotto, turno, avvio).
        Le ricette possono essere applicate anche dalla Runtime View.
      </div>

      <div style={{ display: "flex", gap: 12, height: 500 }}>
        {/* Left: recipe list */}
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              style={{ ...S.inputSm, flex: 1 }}
              placeholder={t("cfg.idExample")}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              spellCheck={false}
            />
            <input
              style={{ ...S.inputSm, flex: 1 }}
              placeholder={t("cfg.name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              spellCheck={false}
            />
            <button style={S.btn("primary")} onClick={createRecipe}>+</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <DataTable<RecipeSummary>
              columns={recipeColumns}
              rows={recipes}
              rowKey={(r) => r.id}
              onRowClick={(r) => selectRecipe(r.id)}
              selectedRowKey={selected?.id}
              emptyLabel="Nessuna ricetta."
              compact
            />
          </div>
        </div>

        {/* Right: recipe editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {!selected ? (
            <div style={{ color: "var(--brand-border, #475569)", fontSize: 12, padding: 20 }}>
              Seleziona o crea una ricetta per modificarla.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...S.inputSm, flex: 1 }}
                  value={selected.name}
                  onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                  placeholder={t("cfg.recipeName")}
                  spellCheck={false}
                />
                <button style={S.btn("success")} onClick={saveSelected} disabled={loading}>
                  {loading ? "…" : saved ? "✓ Salvato" : "Salva"}
                </button>
                <button style={S.btn("danger")} onClick={deleteSelected} title={t("cfg.deleteRecipe")}>✕</button>
              </div>

              <table style={{ ...S.table, flex: 1 }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: "45%" }}>{t("cfg.tag")}</th>
                    <th style={{ ...S.th, width: "40%" }}>{t("cfg.setpointValue")}</th>
                    <th style={S.th} />
                  </tr>
                </thead>
                <tbody>
                  {selected.setpoints.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...S.td, color: "var(--brand-border, #475569)", textAlign: "center", padding: 12 }}>
                        Nessun setpoint. Clicca "+ Aggiungi" per iniziare.
                      </td>
                    </tr>
                  )}
                  {selected.setpoints.map((sp, i) => (
                    <tr key={i}>
                      <td style={S.td}>
                        <TagInput
                          style={S.inputSm}
                          value={sp.tag}
                          onChange={(v) => updateSetpoint(i, { tag: v })}
                          placeholder="tag.path"
                        />
                      </td>
                      <td style={S.td}>
                        <input
                          style={S.inputSm}
                          value={String(sp.value)}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = Number(v);
                            updateSetpoint(i, { value: v === "true" ? true : v === "false" ? false : isNaN(n) ? v : n });
                          }}
                          placeholder="0 / true / false / testo"
                          spellCheck={false}
                        />
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <button style={S.btn("danger")} onClick={() => removeSetpoint(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button style={{ ...S.btn("ghost"), alignSelf: "flex-start" }} onClick={addSetpoint}>
                + Aggiungi setpoint
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

function emptySmtp(): SmtpConfig {
  return { host: "", from: "", port: 587, starttls: true };
}

function NotificationsTab() {
  const { t } = useTranslation();
  const storeProject = useAppStore((s) => s.project);
  const updateProjectNotifications = useAppStore((s) => s.updateProjectNotifications);
  const initial = storeProject?.notifications ?? null;

  const [enabled, setEnabled] = useState<boolean>(initial?.smtp != null);
  const [smtp, setSmtp] = useState<SmtpConfig>(initial?.smtp ?? emptySmtp());
  const [tgEnabled, setTgEnabled] = useState<boolean>(initial?.telegram != null);
  const [tg, setTg] = useState<TelegramConfig>(initial?.telegram ?? { bot_token: "", chat_ids: [] });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<{ id: string; label: string; type: string }[]>([]);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "L'utente ha toccato qualcosa in questa tab".
  //
  // NON si usa un confronto strutturale bozza-vs-store per decidere se la
  // sezione è da salvare: il token Telegram arriva mascherato dalle GET, quindi
  // una bozza appena montata può risultare "diversa" dallo store senza che
  // nessuno abbia modificato nulla — e da quando "Salva tutto" svuota le bozze
  // pendenti, quel disallineamento veniva scritto su disco. Con `tgEnabled`
  // falso il payload esce SENZA la sezione telegram e il backend cancella il
  // token salvato. È il bug per cui il token "spariva" dopo Salva tutto.
  const [touched, setTouched] = useState(false);

  // Il server rimanda il token come "********" quando ne ha uno salvato: è il
  // segnale che c'è, non un valore da riscrivere.
  const tokenSaved = tg.bot_token === MASKED;

  const patchSmtp = (patch: Partial<SmtpConfig>) => {
    setTouched(true);
    setSmtp((prev) => ({ ...prev, ...patch }));
  };
  const patchTg = (patch: Partial<TelegramConfig>) => {
    setTouched(true);
    setTg((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config: NotificationConfig | null = (enabled || tgEnabled)
        ? { smtp: enabled ? smtp : undefined, telegram: tgEnabled ? tg : undefined }
        : null;
      await api.saveNotifications(config);
      setTouched(false);
      // Keep the store in sync so switching tabs and returning shows the saved
      // config (the tab re-initialises from storeProject.notifications).
      updateProjectNotifications(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Test chiamando DIRETTAMENTE la Bot API di Telegram dal browser (invia header
  // CORS permissivi): così la prova funziona dal solo editor, senza dipendere da
  // un runtime attivo/raggiungibile. Richiede il token in chiaro (non mascherato).
  const handleTestTelegram = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (tg.chat_ids.length === 0) {
        setTestMsg("✗ Inserisci almeno una chat ID.");
        return;
      }
      // Il token va al server così com'è: se è il placeholder (o vuoto) usa
      // quello salvato. Così la prova percorre la stessa catena degli allarmi.
      await api.testTelegram({ bot_token: tg.bot_token, chat_ids: tg.chat_ids });
      setTestMsg("✓ Messaggio inviato dal runtime.");
    } catch (e: unknown) {
      setTestMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  };

  // Rileva le chat che hanno scritto al bot, e invia il messaggio di prova,
  // passando **dal runtime**: il server risolve il token salvato quando la UI
  // non lo ha in chiaro (dopo un cambio di tab non lo ha mai, perché un
  // segreto non viene mai rimandato al browser).
  //
  // Prima entrambe le operazioni chiamavano l'API di Telegram dal browser.
  // Funzionavano solo appena dopo aver digitato il token — da cui il "perdo il
  // token" — e soprattutto provavano un percorso che non è quello di
  // produzione: gli allarmi partono dal runtime, non dal browser. È il motivo
  // per cui un test poteva passare mentre il dispositivo non aveva alcuna
  // configurazione.
  //
  // Auto-retry perché subito dopo un messaggio l'update può tardare qualche
  // secondo a comparire in getUpdates.
  const handleDetectChats = async () => {
    setDetecting(true);
    setDetectMsg(null);
    setDetected([]);
    try {
      const attempts = 5;
      for (let i = 0; i < attempts; i++) {
        const chats = await api.detectTelegramChats(tg.bot_token);
        if (chats.length > 0) { setDetected(chats); return; }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
      }
      setDetectMsg("Nessuna chat trovata. Scrivi /start al bot (o aggiungilo al gruppo e manda un messaggio), poi premi Rileva di nuovo.");
    } catch (e: unknown) {
      setDetectMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDetecting(false);
    }
  };

  const addChatId = (id: string) =>
    patchTg({ chat_ids: tg.chat_ids.includes(id) ? tg.chat_ids : [...tg.chat_ids, id] });

  return (
    <div style={S.section}>
      <SaveBar onSave={handleSave} saving={saving} saved={saved}
        section="notifications"
        dirty={touched} />
      <div style={S.sectionTitle}>NOTIFICHE EMAIL</div>
      <div style={S.notice}>
        Configura un server SMTP per inviare email al momento dell'attivazione di
        un allarme. I campi <em>notify_email</em> e <em>escalate_to</em> sono
        configurabili per ogni allarme nella tab Allarmi.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setTouched(true); setEnabled(e.target.checked); }}
          />
          Abilita notifiche SMTP
        </label>
      </div>

      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 640 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Host SMTP *</div>
            <input
              style={S.input}
              placeholder="smtp.example.com"
              value={smtp.host}
              onChange={(e) => patchSmtp({ host: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>{t("cfg.port")}</div>
            <input
              style={S.input}
              type="number"
              placeholder="587"
              value={smtp.port ?? ""}
              onChange={(e) => patchSmtp({ port: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Indirizzo From *</div>
            <input
              style={S.input}
              placeholder="allarmi@example.com"
              value={smtp.from}
              onChange={(e) => patchSmtp({ from: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Username SMTP</div>
            <input
              style={S.input}
              placeholder={t("cfg.optional")}
              value={smtp.username ?? ""}
              onChange={(e) => patchSmtp({ username: e.target.value || undefined })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Password SMTP</div>
            <input
              style={S.input}
              type="password"
              placeholder={t("cfg.optional")}
              value={smtp.password ?? ""}
              onChange={(e) => patchSmtp({ password: e.target.value || undefined })}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={smtp.starttls ?? true}
                onChange={(e) => patchSmtp({ starttls: e.target.checked })}
              />
              STARTTLS (raccomandato su porta 587)
            </label>
          </div>
        </div>
      )}

      <div style={{ ...S.sectionTitle, marginTop: 24 }}>NOTIFICHE TELEGRAM</div>
      <div style={S.notice}>
        Invia un messaggio Telegram all'attivazione degli allarmi e, dagli script,
        con <em>send_telegram("testo")</em>. Crea un bot con <em>@BotFather</em>, poi
        incolla il token e le chat ID di destinazione. Queste sono le chat
        <em> predefinite</em>: nella tab Allarmi ogni allarme può usarne di proprie
        o non notificare affatto.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={tgEnabled}
            onChange={(e) => { setTouched(true); setTgEnabled(e.target.checked); }}
          />
          Abilita notifiche Telegram
        </label>
      </div>

      {tgEnabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, maxWidth: 640 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Bot token *</span>
              {tokenSaved && (
                <span style={{ color: "var(--brand-success, #22c55e)", fontSize: 11 }}>
                  ✓ salvato sul server
                </span>
              )}
            </div>
            {/* Il token arriva mascherato dalle GET: mostrare "********" nel
                campo faceva sembrare che il dato fosse andato perso. Meglio un
                campo vuoto che dice esplicitamente com'è la situazione. */}
            <input
              style={S.input}
              type="password"
              placeholder={tokenSaved ? "già salvato — scrivi qui solo per sostituirlo" : "123456789:ABCdef..."}
              value={tokenSaved && tg.bot_token === MASKED ? "" : tg.bot_token}
              onChange={(e) => patchTg({ bot_token: e.target.value })}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <button
                style={S.btn("ghost")}
                onClick={handleDetectChats}
                disabled={detecting || (tg.bot_token.trim() === "" && !tokenSaved)}
                title="Chiama getUpdates e mostra le chat che hanno scritto al bot"
              >
                {detecting ? "Rilevamento…" : "Rileva chat"}
              </button>
              {detectMsg && (
                <span style={{ fontSize: 11, color: detectMsg.startsWith("✗") ? "var(--brand-danger, #ef4444)" : "var(--brand-text-muted, #94a3b8)" }}>
                  {detectMsg}
                </span>
              )}
            </div>
            {detected.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, overflow: "hidden" }}>
                {detected.map((c) => {
                  const added = tg.chat_ids.includes(c.id);
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                      <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)", flex: 1 }}>
                        {c.label} <span style={{ color: "var(--brand-text-subtle, #64748b)", fontFamily: "monospace" }}>· {c.id} · {c.type}</span>
                      </span>
                      <button
                        style={{ ...S.btn("ghost"), padding: "2px 10px", fontSize: 12 }}
                        onClick={() => addChatId(c.id)}
                        disabled={added}
                      >
                        {added ? "✓ aggiunta" : "Aggiungi"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Chat ID — una per riga *</div>
            <textarea
              style={{ ...S.input, minHeight: 60, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
              placeholder={"-1001234567890\n123456789"}
              value={tg.chat_ids.join("\n")}
              onChange={(e) => patchTg({ chat_ids: e.target.value.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean) })}
              spellCheck={false}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={S.btn("ghost")}
              onClick={handleTestTelegram}
              disabled={testing || (tg.bot_token.trim() === "" && !tokenSaved) || tg.chat_ids.length === 0}
            >
              {testing ? "Invio…" : "Invia test"}
            </button>
            {testMsg && (
              <span style={{ fontSize: 12, color: testMsg.startsWith("✓") ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
                {testMsg}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.7, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: "10px 12px" }}>
            <strong style={{ color: "var(--brand-text-2, #cbd5e1)" }}>Come configurare</strong>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>Su Telegram apri <em>@BotFather</em> → <code>/newbot</code>, segui le istruzioni e copia il <em>token</em> del bot. Incollalo qui sopra.</li>
              <li>Scrivi <code>/start</code> (o un messaggio) al bot; per un gruppo/canale, aggiungilo e manda un messaggio lì.</li>
              <li>Premi <em>Rileva chat</em> e <em>Aggiungi</em> le chat trovate (i gruppi hanno ID negativo <code>-100…</code>). In alternativa inserisci manualmente le chat ID.</li>
              <li>Premi <em>Invia test</em> per verificare, poi <em>Salva</em>.</li>
            </ol>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger, #ef4444)", fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}

// ── RuntimeConnectionTab ─────────────────────────────────────────────────────

const RT_URL_KEY  = "sws.runtime.targetUrl";
const RT_USER_KEY = "sws.runtime.targetUser";
const RT_PASS_KEY = "sws.runtime.targetPass";
const RT_CONN_KEY = "sws.runtime.connected";

/** URL admin di un device scoperto, con l'host sostituito dall'hostname mDNS
 *  quando disponibile (stabile nel tempo, a differenza dell'IP che può
 *  cambiare per DHCP) — scheme/porta restano quelli di `r.admin_url`, così
 *  non li si duplica/hardcoda qui. Nota: risolto dal browser (fetch/WS), non
 *  dal backend come "Host SSH" — l'affidabilità di `.local` qui dipende dal
 *  sistema dell'utente, non è garantita come lato server. */
function discoveredAdminUrl(r: DiscoveredRuntime): string {
  if (!r.hostname) return r.admin_url;
  try {
    const u = new URL(r.admin_url);
    return `${u.protocol}//${r.hostname}:${u.port}`;
  } catch {
    return r.admin_url;
  }
}

function RuntimeConnectionTab() {
  const { t } = useTranslation();
  const authToken = useAppStore((s) => s.authToken);
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);
  const remoteConnectedStore = useAppStore((s) => s.remoteConnected);

  const [targetUrl,  setTargetUrl]  = useState(() => localStorage.getItem(RT_URL_KEY)  ?? "");
  const [targetUser, setTargetUser] = useState(() => localStorage.getItem(RT_USER_KEY) ?? "");
  const [targetPass, setTargetPass] = useState(() => localStorage.getItem(RT_PASS_KEY) ?? "");
  const [status, setStatus]         = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [statusMsg, setStatusMsg]   = useState<string | null>(null);
  const [deployLog, setDeployLog]   = useState<string[]>([]);
  const [deploying, setDeploying]   = useState(false);
  const [deployDone, setDeployDone] = useState(false);
  const [deletingRemote, setDeletingRemote] = useState(false);
  const [pushingUsers, setPushingUsers] = useState(false);
  const [remoteMsg, setRemoteMsg]   = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered]   = useState<DiscoveredRuntime[] | null>(null);

  // On mount: remove stale localStorage key, sync actual state from server.
  useEffect(() => {
    localStorage.removeItem(RT_CONN_KEY);
    api.remoteStatus().then((s) => {
      if (s.connected && s.url) {
        setStatus("connected");
        setRemoteConnected(true, s.url);
      }
    }).catch(() => { /* not critical — start as idle */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Risincronizza lo stato locale quando la connessione cambia da FUORI
  // questo componente — es. il pulsante Deploy nell'header (App.tsx) che
  // riconnette/disconnette all'ultimo dispositivo agendo solo sullo store.
  // Senza questo, se la tab è già montata quando succede, `status` resta
  // bloccato sul valore di quando aveva montato (il suo unico sync è
  // l'effetto one-shot sopra), mentre il pulsante Deploy (che legge lo
  // store direttamente) mostra già lo stato corretto — da qui il
  // disallineamento fra i due.
  useEffect(() => {
    if (remoteConnectedStore && status !== "connected") {
      setStatus("connected"); setStatusMsg(null);
    } else if (!remoteConnectedStore && status === "connected") {
      setStatus("idle");
    }
  }, [remoteConnectedStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live tag panel: tag-id → {value, quality, ts} from /ws/remote/tags relay.
  type LiveTagEntry = { value: unknown; quality: string; ts: number };
  const [liveTags, setLiveTags] = useState<Map<string, LiveTagEntry>>(new Map());
  const liveWsRef = useRef<WebSocket | null>(null);

  // T-28: package build
  const [buildLog, setBuildLog]         = useState<string[]>([]);
  const [building, setBuilding]         = useState(false);
  const [packages, setPackages]         = useState<PackageFile[]>([]);
  const [selectedPkg, setSelectedPkg]   = useState("");
  // T-28: device deploy via SSH
  const [deviceHost, setDeviceHost]     = useState("");
  const [devicePort, setDevicePort]     = useState(22);
  const [deviceUser, setDeviceUser]     = useState("root");
  const [devicePass, setDevicePass]     = useState("");
  const [deviceTmpDir, setDeviceTmpDir] = useState("/tmp/sws-deploy");
  const [deviceLog, setDeviceLog]       = useState<string[]>([]);
  const [deviceDeploying, setDeviceDeploying] = useState(false);
  // Installazione container (Podman) via SSH — stessi campi host/porta/utente/
  // password/remote_dir sopra, riusati identici; cambia solo cosa si spedisce
  // e quale comando gira sul device (install-container.sh, nessun sudo).
  const [deployMode, setDeployMode]           = useState<"binary" | "container">("binary");
  const [containerPackages, setContainerPackages] = useState<ContainerPackage[]>([]);
  const [selectedContainerPkg, setSelectedContainerPkg] = useState("");
  const [containerLog, setContainerLog]       = useState<string[]>([]);
  const [containerDeploying, setContainerDeploying] = useState(false);
  // Percorso dati sul device (install-container.sh --data): vuoto = default
  // dello script. Il modello scelto dal dropdown brand-aware pre-compila
  // questo campo, che resta comunque sempre editabile — è anche il "modello
  // custom" richiesto, senza bisogno di uno stato separato.
  const [dataPath, setDataPath] = useState("");
  // Registry per default: è la strada documentata come normale dal 2026-07-30 e
  // trasferisce solo i layer cambiati. L'archivio resta per i dispositivi che il
  // registry non lo raggiungono, che in campo sono il caso normale.
  const [containerSource, setContainerSource] = useState<ContainerSource>("registry");
  // Vuoto = il tag lo compone il dispositivo da `uname -m`. Si riempie solo per
  // inchiodare una versione precisa.
  const [imageRef, setImageRef] = useState("");
  const [cleanInstall, setCleanInstall] = useState(false);
  // Gestione di un container già installato: stato/avvia/ferma/riavvia/
  // abilita-disabilita al boot/policy di restart/disinstalla. Locale (default)
  // = comandi diretti sul host che esegue il backend, niente SSH — risolve il
  // caso più comune: un container installato per test sulla stessa macchina
  // che esegue l'IDE, che collide con `start_runtime.sh` sulle stesse porte.
  // Remoto riusa gli stessi campi host/porta/utente/password del pannello di
  // installazione sopra.
  const [manageLocal, setManageLocal]     = useState(true);
  const [manageLog, setManageLog]         = useState<string[]>([]);
  const [managing, setManaging]           = useState(false);
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicy>("always");
  const [uninstallPurge, setUninstallPurge] = useState(false);

  const target = targetUrl.trim().replace(/\/$/, "");

  const saveForm = () => {
    localStorage.setItem(RT_URL_KEY,  target);
    localStorage.setItem(RT_USER_KEY, targetUser.trim());
    localStorage.setItem(RT_PASS_KEY, targetPass);
  };

  const handleDisconnect = useCallback(() => {
    void api.remoteDisconnect().catch(() => {});
    setStatus("idle"); setStatusMsg(null); setDeployLog([]); setDeployDone(false);
    setRemoteConnected(false);
    window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
  }, [setRemoteConnected]);

  const handleConnect = async () => {
    if (!target) { setStatusMsg("Inserisci l'URL del runtime."); return; }
    saveForm();
    setStatus("connecting"); setStatusMsg(null);
    try {
      // Credentials are optional: if the remote has no users defined it
      // accepts connections without authentication.
      const user = targetUser.trim() || undefined;
      const pass = targetPass || undefined;
      const result = await api.remoteConnect(target, user, pass);
      if (!result.ok) throw new Error(result.error ?? "Connessione fallita");
      setStatus("connected");
      setStatusMsg(null);
      setRemoteConnected(true, target);
      window.dispatchEvent(new CustomEvent("sws:runtime-connected", { detail: { url: target } }));
    } catch (e: any) {
      setStatus("error");
      setStatusMsg(String(e?.message ?? e));
      setRemoteConnected(false);
      window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
    }
  };

  // Poll /api/remote/status every 5 s while connected. Clears state if the
  // local runtime loses the session (restart, token expiry).
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      try {
        const s = await api.remoteStatus();
        if (!s.connected) handleDisconnect();
      } catch { /* network error — keep current state, will retry */ }
    }, 5000);
    return () => clearInterval(id);
  }, [status, handleDisconnect]);

  // Open the /ws/remote/tags relay when connected; close on disconnect.
  useEffect(() => {
    if (status !== "connected") {
      liveWsRef.current?.close();
      liveWsRef.current = null;
      setLiveTags(new Map());
      return;
    }
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const token  = getAuthToken();
    const url    = `${scheme}://${window.location.host}/ws/remote/tags${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    liveWsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", tags: ["*"] }));
    ws.onmessage = (ev) => {
      try {
        type WireEntry = { id: string; value: unknown; quality: string; ts: number };
        type WireMsg = { type: string; tags?: WireEntry[]; changed?: WireEntry[] };
        const msg = JSON.parse(ev.data as string) as WireMsg;
        if (msg.type === "snapshot" && msg.tags) {
          const m = new Map<string, LiveTagEntry>();
          for (const t of msg.tags) m.set(t.id, { value: t.value, quality: t.quality, ts: t.ts });
          setLiveTags(m);
        } else if (msg.type === "delta" && msg.changed) {
          setLiveTags((prev) => {
            const m = new Map(prev);
            for (const t of msg.changed!) m.set(t.id, { value: t.value, quality: t.quality, ts: t.ts });
            return m;
          });
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => { ws.close(); };
    return () => { ws.close(); liveWsRef.current = null; };
  }, [status]);

  const handleDownloadCert = async () => {
    const certUrl = `${target}/cert`;
    try {
      const res = await fetch(certUrl);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sws.crt";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setStatusMsg(`Non riesco a scaricare il cert. Se il target usa TLS self-signed non ancora accettato, esegui:\n  curl -k ${certUrl} -o sws.crt\npoi importalo nel browser.`);
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscovered(null);
    try {
      const found = await api.discoverRuntimes();
      setDiscovered(found);
    } catch {
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  };

  const fetchPackages = useCallback(async () => {
    try { const pkgs = await api.listPackages(); setPackages(pkgs); if (pkgs.length > 0 && !selectedPkg) setSelectedPkg(pkgs[0].name); }
    catch { /* ignore */ }
  }, [selectedPkg]);

  useEffect(() => { void fetchPackages(); }, []);

  const fetchContainerPackages = useCallback(async () => {
    try {
      const pkgs = await api.listContainerPackages();
      setContainerPackages(pkgs);
      if (pkgs.length > 0 && !selectedContainerPkg) setSelectedContainerPkg(pkgs[0].image_tarball);
    } catch { /* ignore */ }
  }, [selectedContainerPkg]);

  useEffect(() => { void fetchContainerPackages(); }, []);

  const handleBuild = async (noRust = false, noSpa = false) => {
    setBuilding(true);
    setBuildLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/build/package", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ no_rust: noRust, no_spa: noSpa }),
      });
      if (!res.ok) { setBuildLog([`ERROR: ${res.status} ${res.statusText}`]); return; }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => {
          setBuildLog((l) => [...l, line]);
          if (line === "DONE") void fetchPackages();
        });
      }
    } catch (e: unknown) {
      setBuildLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setBuilding(false);
    }
  };

  const handleDeviceDeploy = async () => {
    if (!selectedPkg || !deviceHost || !deviceUser) return;
    setDeviceDeploying(true);
    setDeviceLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tarball: selectedPkg, host: deviceHost, port: devicePort,
          user: deviceUser, password: devicePass, remote_dir: deviceTmpDir,
        }),
      });
      if (!res.ok) { setDeviceLog([`ERROR: ${res.status} ${res.statusText}`]); return; }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => setDeviceLog((l) => [...l, line]));
      }
    } catch (e: unknown) {
      setDeviceLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setDeviceDeploying(false);
    }
  };

  const handleContainerDeploy = async () => {
    if (!deviceHost || !deviceUser) return;
    if (containerSource === "archive" && !selectedContainerPkg) return;
    // Conferma prima di qualunque cosa, e nominando la cartella: è l'unico
    // punto della UI in cui un clic cancella i progetti di un dispositivo.
    if (cleanInstall &&
        !window.confirm(t("cfg.cleanInstallConfirm", { path: effectiveDataPath(dataPath) }))) return;
    setContainerDeploying(true);
    setContainerLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device-container", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(containerDeployPayload({
          source: containerSource,
          imageTarball: selectedContainerPkg,
          imageRef,
          cleanInstall,
          host: deviceHost, port: devicePort,
          user: deviceUser, password: devicePass, remoteDir: deviceTmpDir,
          dataPath,
        })),
      });
      if (!res.ok) {
        // Il corpo porta il messaggio in italiano del backend ("riferimento
        // immagine non valido: …"); mostrare solo lo status lo buttava via.
        const detail = await res.text().catch(() => "");
        setContainerLog([`ERROR: ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => setContainerLog((l) => [...l, line]));
      }
    } catch (e: unknown) {
      setContainerLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setContainerDeploying(false);
      // La spunta non sopravvive all'uso: una seconda installazione fatta di
      // fretta non deve azzerare il dispositivo perché la casella era rimasta.
      setCleanInstall(false);
    }
  };

  const handleManage = async (action: ManageAction) => {
    if (!manageLocal && (!deviceHost || !deviceUser)) return;
    // Stessa cautela di handleContainerDeploy: l'unica azione qui distruttiva
    // è la disinstallazione, e solo con la cancellazione dati merita un
    // secondo avviso che nomini il percorso.
    if (action === "uninstall") {
      const msg = uninstallPurge
        ? t("cfg.uninstallPurgeConfirm", { path: effectiveDataPath(dataPath) })
        : t("cfg.uninstallConfirm", { path: effectiveDataPath(dataPath) });
      if (!window.confirm(msg)) return;
    }
    setManaging(true);
    setManageLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device-container/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(containerManagePayload({
          local: manageLocal,
          host: deviceHost, port: devicePort, user: deviceUser, password: devicePass,
          action,
          restartPolicy,
          purge: uninstallPurge,
          dataPath,
        })),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setManageLog([`ERROR: ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => setManageLog((l) => [...l, line]));
      }
    } catch (e: unknown) {
      setManageLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setManaging(false);
      if (action === "uninstall") setUninstallPurge(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true); setDeployLog([]); setDeployDone(false);
    try {
      const ok = await flushBeforeDeploy((m) => setDeployLog((l) => [...l, m]));
      if (!ok) { setDeploying(false); return; }

      const res = await fetch("/api/remote/deploy", {
        method: "POST",
        headers: authToken ? { "Authorization": `Bearer ${authToken}` } : {},
      });
      if (!res.ok || !res.body) {
        throw new Error(`Deploy fallito: ${res.status} ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) =>
          setDeployLog((l) => [...l, line])
        );
      }
      setDeployDone(true);
    } catch (e: any) {
      setDeployLog((l) => [...l, `✗ ${e?.message ?? String(e)}`]);
    } finally {
      setDeploying(false);
    }
  };

  const handleDeleteRemoteProject = async () => {
    if (!window.confirm(
      "Eliminare il progetto attualmente attivo sul runtime? L'operazione non è reversibile."
    )) return;
    setDeletingRemote(true); setRemoteMsg(null);
    try {
      await api.remoteDeleteProject();
      setRemoteMsg("✓ Progetto eliminato dal runtime.");
    } catch (e: any) {
      setRemoteMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setDeletingRemote(false);
    }
  };

  // Allineamento esplicito degli account. Il deploy non li tocca — cambiare chi
  // entra in un pannello in servizio non deve essere un effetto collaterale —
  // quindi questo è l'unico percorso. Chiede conferma perché invalida le
  // sessioni aperte sul dispositivo.
  const handlePushUsers = async () => {
    if (!window.confirm(
      "Sostituire gli utenti del dispositivo con quelli di questo progetto?\n\n" +
      "Chi è collegato al dispositivo dovrà rifare il login. Le password vengono " +
      "trasferite già cifrate, quindi gli account restano validi."
    )) return;
    setPushingUsers(true); setRemoteMsg(null);
    try {
      const res = await api.pushUsersToRuntime();
      setRemoteMsg(`✓ ${res.users} utente(i) inviati al dispositivo.${res.note ? " " + res.note : ""}`);
    } catch (e: any) {
      setRemoteMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setPushingUsers(false);
    }
  };

  const INPUT: React.CSSProperties = {
    background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4, padding: "6px 8px", fontSize: 13,
  };
  const BTN: React.CSSProperties = {
    padding: "6px 14px", borderRadius: 5, cursor: "pointer", fontSize: 13,
    border: "1px solid var(--brand-surface-2, #334155)", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  };
  const BTN_PRIMARY: React.CSSProperties = {
    ...BTN, background: "#1d4ed8", border: "1px solid var(--brand-primary-hover, #2563eb)", color: "#fff", fontWeight: 600,
  };
  const BTN_RED: React.CSSProperties = {
    ...BTN, background: "#450a0a", border: "1px solid #dc2626", color: "var(--brand-danger-soft, #fca5a5)",
  };

  const connected = status === "connected";
  let hostLabel = target;
  try { hostLabel = new URL(target).host; } catch { /* keep raw */ }

  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Connection config */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Connessione runtime remoto
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.targetRuntimeUrl")}</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input style={{ ...INPUT, flex: 1, boxSizing: "border-box" }}
              placeholder="https://192.168.1.10:8444"
              value={targetUrl}
              onChange={(e) => { setTargetUrl(e.target.value); if (connected) handleDisconnect(); }}
            />
            <button
              style={{ ...BTN, whiteSpace: "nowrap", flexShrink: 0 }}
              title={t("cfg.openHealthTls")}
              disabled={!target}
              onClick={() => { if (target) window.open(`${target}/health`, "_blank"); }}
            >Accetta cert TLS ↗</button>
            <button
              style={{ ...BTN, whiteSpace: "nowrap", flexShrink: 0 }}
              title={t("cfg.discoverMdns")}
              disabled={discovering}
              onClick={handleDiscover}
            >{discovering ? "Cerco…" : "Cerca runtime"}</button>
          </div>
          {discovered !== null && (
            <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "6px 8px" }}>
              {discovered.length === 0
                ? <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>Nessun runtime trovato sulla rete locale.</span>
                : discovered.map((r) => (
                    <div
                      key={r.admin_url}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        borderBottom: "1px solid var(--brand-surface, #1e293b)", cursor: "pointer" }}
                      onClick={() => {
                        setTargetUrl(discoveredAdminUrl(r));
                        // L'hostname mDNS (stabile, a differenza dell'IP che può
                        // cambiare per DHCP) va bene per Host SSH — risolto dal
                        // resolver del sistema operativo del backend, non dal
                        // browser. Se assente (runtime più vecchio di questo
                        // campo), ripiega sull'IP come prima.
                        if (r.hostname) {
                          setDeviceHost(r.hostname);
                        } else {
                          try { setDeviceHost(new URL(r.admin_url).hostname); } catch { /* invalid URL — leave Host SSH untouched */ }
                        }
                        if (connected) handleDisconnect();
                        setDiscovered(null);
                      }}
                    >
                      <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
                        {r.hostname || r.name}{r.version ? ` v${r.version}` : ""}
                      </span>
                      {/* Pill solo sui runtime in container: dice quale procedura
                          di aggiornamento usare (install-container.sh / immagine)
                          invece del deploy del binario nudo. Un runtime nativo
                          non ha pill — e nemmeno uno più vecchio di questo
                          campo, che non lo annuncia: l'assenza non afferma
                          niente. */}
                      {r.container && (
                        <span
                          title={`Runtime in container (${r.container}) — si aggiorna con install-container.sh, non col deploy del binario`}
                          style={{
                            fontSize: 10, lineHeight: 1.6, padding: "0 6px", borderRadius: 999,
                            whiteSpace: "nowrap", flexShrink: 0,
                            color: "var(--brand-primary, #38bdf8)",
                            background: "var(--brand-surface, #1e293b)",
                            border: "1px solid var(--brand-surface-2, #334155)",
                          }}
                        >📦 {r.container}</span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--brand-border, #475569)" }}>{discoveredAdminUrl(r)}</span>
                    </div>
                  ))
              }
            </div>
          )}
          <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>
            Porta 8444 = accesso admin (deploy). Porta 8443 = viewer operatori.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.user")} <span style={{ color: "var(--brand-border, #475569)" }}>(opzionale)</span></label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" }}
                placeholder={t("cfg.emptyIfNoUsers")} value={targetUser}
                onChange={(e) => setTargetUser(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.password")} <span style={{ color: "var(--brand-border, #475569)" }}>(opzionale)</span></label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" }}
                type="password" placeholder="••••••••" value={targetPass}
                onChange={(e) => setTargetPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !connected && handleConnect()} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!connected && (
              <button style={BTN_PRIMARY} onClick={handleConnect} disabled={status === "connecting"}>
                {status === "connecting" ? "Connessione…" : "Connetti"}
              </button>
            )}
            {connected && (
              <button style={BTN_RED} onClick={handleDisconnect}>{t("cfg.disconnect")}</button>
            )}
            <button style={BTN} onClick={handleDownloadCert} disabled={!target} title={t("cfg.downloadTargetCert")}>
              Scarica cert TLS
            </button>
          </div>
        </div>
      </section>

      {/* Status */}
      <section style={{
        padding: "10px 14px", borderRadius: 6,
        background: connected ? "#052e16" : status === "error" ? "#1c0a0a" : "var(--brand-bg, #0f172a)",
        border: `1px solid ${connected ? "#16a34a" : status === "error" ? "#dc2626" : "var(--brand-surface, #1e293b)"}`,
      }}>
        {connected && (
          <span style={{ color: "var(--brand-success-soft, #4ade80)", fontWeight: 600, fontSize: 13 }}>
            ● Connesso a {hostLabel}
          </span>
        )}
        {status === "idle" && (
          <span style={{ color: "var(--brand-border, #475569)", fontSize: 13 }}>{t("cfg.notConnected")}</span>
        )}
        {status === "connecting" && (
          <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13 }}>Connessione in corso…</span>
        )}
        {status === "error" && (
          <span style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 13, whiteSpace: "pre-wrap" }}>✗ {statusMsg}</span>
        )}
        {status !== "error" && statusMsg && (
          <span style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, display: "block", marginTop: 4, whiteSpace: "pre-wrap" }}>{statusMsg}</span>
        )}
      </section>

      {/* Deploy */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Deploy progetto
          </div>
          <p style={{ fontSize: 12, color: "var(--brand-border, #475569)", margin: "0 0 10px" }}>
            Esporta il progetto attivo e lo attiva sul runtime target.
          </p>
          {!deployDone && (
            <button style={{ ...BTN_PRIMARY, opacity: deploying ? 0.6 : 1 }}
              onClick={handleDeploy} disabled={deploying}>
              {deploying ? "Deploy in corso…" : "Deploy progetto attivo ▸"}
            </button>
          )}
          {deployLog.length > 0 && (
            <div style={{
              marginTop: 10, background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)",
              borderRadius: 4, padding: "8px 10px", maxHeight: 180, overflowY: "auto",
              fontFamily: "monospace", fontSize: 12,
            }}>
              {deployLog.map((l, i) => (
                <div key={i} style={{ color: l.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : l.startsWith("🚀") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
              ))}
            </div>
          )}
          {deployDone && (
            <button style={{ ...BTN, marginTop: 8 }} onClick={() => { setDeployLog([]); setDeployDone(false); }}>
              Nuovo deploy
            </button>
          )}

          {/* Danger: rimuovi il progetto attivo dal runtime */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--brand-surface, #1e293b)" }}>
            <p style={{ fontSize: 12, color: "var(--brand-border, #475569)", margin: "0 0 8px" }}>
              Elimina il progetto attualmente attivo sul runtime (es. per ripartire pulito).
            </p>
            <button style={{ ...BTN, opacity: pushingUsers ? 0.6 : 1 }}
              title="Sostituisce gli utenti del dispositivo con quelli di questo progetto. Il deploy, da solo, non li modifica."
              onClick={handlePushUsers} disabled={pushingUsers}>
              {pushingUsers ? "Invio…" : "Aggiorna utenti sul dispositivo"}
            </button>
            <button style={{ ...BTN_RED, opacity: deletingRemote ? 0.6 : 1 }}
              onClick={handleDeleteRemoteProject} disabled={deletingRemote}>
              {deletingRemote ? "Eliminazione…" : "Elimina progetto sul runtime"}
            </button>
            {remoteMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: remoteMsg.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : "var(--brand-success-soft, #4ade80)" }}>
                {remoteMsg}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Remote logs: non più un pannello a parte — confluiscono nello stesso
          log viewer dei log locali (cassetto in basso, ☰ Menu → Log), con
          target prefissato "remote:" così il filtro esistente li isola. Vedi
          useRemoteLogStream (sws-editor/src/ws/remoteLogStream.ts). */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Log remoti
          </div>
          <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
            I log del runtime connesso appaiono nel cassetto log dell'IDE (☰ Menu → Log) —
            filtrali scrivendo <code>remote:</code> nel campo di ricerca per tag.
          </span>
        </section>
      )}

      {/* Live tag panel via /ws/remote/tags relay */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Variabili live ({liveTags.size})
          </div>
          <div style={{
            background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
            padding: "6px 8px", maxHeight: 220, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11,
          }}>
            {liveTags.size === 0
              ? <span style={{ color: "var(--brand-border, #475569)" }}>Nessuna variabile ricevuta…</span>
              : Array.from(liveTags.entries()).slice(0, 50).map(([id, t]) => {
                  const qColor = t.quality === "Good" ? "var(--brand-success-soft, #4ade80)" : t.quality === "Bad" ? "var(--brand-danger-soft, #f87171)" : "#fb923c";
                  return (
                    <div key={id} style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--brand-bg, #0f172a)", padding: "1px 0" }}>
                      <span style={{ color: "var(--brand-text-subtle, #64748b)", width: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={id}>{id}</span>
                      <span style={{ color: "var(--brand-text, #e2e8f0)", flex: 1 }}>{JSON.stringify(t.value)}</span>
                      <span style={{ color: qColor, width: 36, textAlign: "right", flexShrink: 0 }}>{t.quality === "Good" ? "OK" : t.quality === "Bad" ? "BAD" : "UNC"}</span>
                    </div>
                  );
                })
            }
          </div>
        </section>
      )}

      {/* Package build */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          Pacchetto runtime
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button style={{ ...BTN_PRIMARY, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(false, false)}>
            {building ? "Build in corso…" : "Build completo"}
          </button>
          <button style={{ ...BTN, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(true, false)} title={t("cfg.skipCargo")}>
            ⚡ Solo UI
          </button>
          <button style={{ ...BTN, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(false, true)} title={t("cfg.skipPnpm")}>
            ⚡ Solo Rust
          </button>
        </div>
        {buildLog.length > 0 && (
          <div style={{
            background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
            padding: "8px 10px", maxHeight: 150, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, marginBottom: 8,
          }}>
            {buildLog.map((l, i) => (
              <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
            ))}
          </div>
        )}
        {packages.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>Pacchetti disponibili:</div>
            {packages.map((p) => (
              <div key={p.name}
                onClick={() => setSelectedPkg(p.name)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
                  borderRadius: 4, cursor: "pointer", marginBottom: 2,
                  background: selectedPkg === p.name ? "#1e3a5f" : "transparent",
                  border: `1px solid ${selectedPkg === p.name ? "var(--brand-primary, #3b82f6)" : "transparent"}`,
                }}>
                <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)", flex: 1, fontFamily: "monospace" }}>{p.name}</span>
                <span style={{ fontSize: 11, color: "var(--brand-border, #475569)" }}>
                  {(p.size_bytes / 1024 / 1024).toFixed(1)} MB
                </span>
                <span style={{ fontSize: 10, color: "var(--brand-surface-2, #334155)" }}>
                  {new Date(p.mtime_ms).toLocaleDateString("it-IT")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Device SSH deploy — binario nativo o container Podman, stesse credenziali.
          Sempre visibile: col registry l'installazione container non dipende più
          da cosa c'è in dist/, quindi una dist/ vuota non deve far sparire il
          pannello proprio a chi non ha ancora costruito niente. */}
      {(
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Installa su dispositivo
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <button
              style={{ ...(deployMode === "binary" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
              onClick={() => setDeployMode("binary")}>
              Binario nativo
            </button>
            <button
              style={{ ...(deployMode === "container" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
              onClick={() => setDeployMode("container")}>
              Container (Podman)
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {deployMode === "binary" ? (
              <div>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                  Pacchetto selezionato
                </label>
                <select
                  value={selectedPkg}
                  onChange={(e) => setSelectedPkg(e.target.value)}
                  style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}>
                  {packages.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                    {t("cfg.imageSource")}
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={{ ...(containerSource === "registry" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
                      onClick={() => setContainerSource("registry")}>
                      {t("cfg.imageSourceRegistry")}
                    </button>
                    <button
                      style={{ ...(containerSource === "archive" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
                      disabled={containerPackages.length === 0}
                      title={containerPackages.length === 0 ? t("cfg.noContainerImages") : undefined}
                      onClick={() => setContainerSource("archive")}>
                      {t("cfg.imageSourceArchive")}
                    </button>
                  </div>
                </div>
                {containerSource === "archive" ? (
                  <div>
                    <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                      Immagine selezionata
                    </label>
                    {/* L'elenco si legge al montaggio della tab. Le immagini si
                        costruiscono da shell, quindi una appena prodotta non
                        compare finché non si ricarica la pagina: è così che il
                        2026-07-31 è finito su un dispositivo un archivio del
                        giorno prima, l'unico che c'era. */}
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        value={selectedContainerPkg}
                        onChange={(e) => setSelectedContainerPkg(e.target.value)}
                        style={{ ...INPUT, flex: 1, boxSizing: "border-box" as const }}>
                        {containerPackages.map((p) => (
                          <option key={p.image_tarball} value={p.image_tarball}>
                            {p.image_tarball} ({p.arch})
                          </option>
                        ))}
                      </select>
                      <button style={{ ...BTN, flexShrink: 0 }}
                        title={t("cfg.reloadImages")}
                        onClick={() => void fetchContainerPackages()}>↻</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Su aarch64 esistono due immagini distinte e mantenute
                        separatamente (generic via QEMU, SDK-tuned Pixsys) —
                        un image_ref vuoto lascia decidere al device via
                        `uname -m`, che sceglie sempre la SDK-tuned (vedi
                        install-container.sh): un rebuild della sola generic
                        installava così, senza errori né avvisi, l'immagine
                        SDK vecchia. Questi due bottoni precompilano il campo
                        con il tag esplicito, così il campo non resta mai
                        vuoto per un'installazione aarch64 fatta da qui —
                        resta comunque modificabile per pinare una versione
                        specifica invece di "latest".  */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <button
                        style={{ ...BTN, padding: "4px 10px", fontSize: 11 }}
                        title={t("cfg.imageVariantGenericTitle")}
                        onClick={() => setImageRef("ghcr.io/soligolab/sws-runtime:latest-arm64-generic")}>
                        {t("cfg.imageVariantGeneric")}
                      </button>
                      <button
                        style={{ ...BTN, padding: "4px 10px", fontSize: 11 }}
                        title={t("cfg.imageVariantSdkTitle")}
                        onClick={() => setImageRef("ghcr.io/soligolab/sws-runtime:latest-arm64")}>
                        {t("cfg.imageVariantSdk")}
                      </button>
                    </div>
                    <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                      {t("cfg.imageRef")}
                    </label>
                    <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                      placeholder="ghcr.io/soligolab/sws-runtime:2026.7.0-arm64"
                      value={imageRef}
                      onChange={(e) => setImageRef(e.target.value)} />
                    <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>
                      {t("cfg.imageRefHint")}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.sshHost")}</label>
                <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                  placeholder="192.168.1.50" value={deviceHost}
                  onChange={(e) => setDeviceHost(e.target.value)} />
              </div>
              <div style={{ width: 70 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.port")}</label>
                <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                  type="number" value={devicePort}
                  onChange={(e) => setDevicePort(Number(e.target.value))} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.sshUser")}</label>
                <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                  placeholder="root" value={deviceUser}
                  onChange={(e) => setDeviceUser(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.sshPassword")}</label>
                <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                  type="password" placeholder="••••••••" value={devicePass}
                  onChange={(e) => setDevicePass(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.remoteTmpDir")}</label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                value={deviceTmpDir}
                onChange={(e) => setDeviceTmpDir(e.target.value)} />
            </div>
            {deployMode === "container" && (
              <div>
                {getBrand().dataPathPresets.length > 0 && (
                  <>
                    <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                      Modello dispositivo
                    </label>
                    <select
                      value=""
                      style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const, marginBottom: 8 }}
                      onChange={(e) => {
                        const preset = getBrand().dataPathPresets.find((d) => d.label === e.target.value);
                        if (preset) setDataPath(preset.path);
                      }}>
                      <option value="">Scegli un modello…</option>
                      <optgroup label={getBrand().shortName}>
                        {getBrand().dataPathPresets.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
                      </optgroup>
                    </select>
                  </>
                )}
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>
                  Percorso dati sul device
                </label>
                <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                  placeholder="/data/user/sws (default dello script)"
                  value={dataPath}
                  onChange={(e) => setDataPath(e.target.value)} />
              </div>
            )}
            {deployMode === "binary" ? (
              <>
                <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>
                  Richiede <code>sshpass</code> e <code>scp</code> sul sistema locale. Il dispositivo deve avere accesso SSH e <code>sudo</code>.
                </span>
                <button
                  style={{ ...BTN_PRIMARY, opacity: (deviceDeploying || !deviceHost || !selectedPkg) ? 0.6 : 1 }}
                  disabled={deviceDeploying || !deviceHost || !selectedPkg}
                  onClick={() => void handleDeviceDeploy()}>
                  {deviceDeploying ? "Deploy in corso…" : "🚀 Installa / Aggiorna"}
                </button>
                {deviceLog.length > 0 && (
                  <div style={{
                    background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                    padding: "8px 10px", maxHeight: 150, overflowY: "auto",
                    fontFamily: "monospace", fontSize: 11,
                  }}>
                    {deviceLog.map((l, i) => (
                      <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>
                  Richiede <code>sshpass</code> e <code>scp</code> sul sistema locale. Podman rootless sul dispositivo — <strong>nessun <code>sudo</code> richiesto</strong>, a differenza del binario nativo.
                </span>
                {/* Vale per entrambe le sorgenti: agisce sui dati del
                    dispositivo, non sull'immagine. Stile del blocco "danger"
                    già usato per l'eliminazione del progetto remoto. */}
                <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 8 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={cleanInstall}
                      onChange={(e) => setCleanInstall(e.target.checked)} />
                    <span style={{ fontSize: 12, color: cleanInstall ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-2, #cbd5e1)" }}>
                      {t("cfg.cleanInstall")}
                      <span style={{ display: "block", fontSize: 10, color: "var(--brand-border, #475569)" }}>
                        {t("cfg.cleanInstallHint", { path: effectiveDataPath(dataPath) })}
                      </span>
                    </span>
                  </label>
                </div>
                <button
                  style={{ ...(cleanInstall ? BTN_RED : BTN_PRIMARY), opacity: (containerDeploying || !deviceHost || !deviceUser || (containerSource === "archive" && !selectedContainerPkg)) ? 0.6 : 1 }}
                  disabled={containerDeploying || !deviceHost || !deviceUser || (containerSource === "archive" && !selectedContainerPkg)}
                  onClick={() => void handleContainerDeploy()}>
                  {containerDeploying
                    ? "Deploy in corso…"
                    : cleanInstall ? t("cfg.cleanInstallBtn") : "🐳 Installa / Aggiorna container"}
                </button>
                {containerLog.length > 0 && (
                  <div style={{
                    background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                    padding: "8px 10px", maxHeight: 150, overflowY: "auto",
                    fontFamily: "monospace", fontSize: 11,
                  }}>
                    {containerLog.map((l, i) => (
                      <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                    ))}
                  </div>
                )}

                {/* Gestione di un container già installato — indipendente da
                    remote_dir: agisce sulla unit già sul dispositivo (o su
                    questa macchina), non su quanto appena installato sopra. */}
                <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 8 }}>
                    {t("cfg.manageTitle")}
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={manageLocal}
                      onChange={(e) => setManageLocal(e.target.checked)} />
                    {manageLocal ? t("cfg.manageLocal") : t("cfg.manageRemote")}
                  </label>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("status")}>{t("cfg.manageStatus")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("start")}>{t("cfg.manageStart")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("stop")}>{t("cfg.manageStop")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("restart")}>{t("cfg.manageRestart")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("enable")}>{t("cfg.manageEnableBoot")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("disable")}>{t("cfg.manageDisableBoot")}</button>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("prune_images")}>{t("cfg.managePruneImages")}</button>
                    <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 3, maxWidth: 480 }}>
                      {t("cfg.managePruneImagesHint")}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.restartPolicy")}</label>
                    <select
                      value={restartPolicy}
                      style={{ ...INPUT, width: 140 }}
                      onChange={(e) => setRestartPolicy(e.target.value as RestartPolicy)}
                    >
                      <option value="always">{t("cfg.restartPolicyAlways")}</option>
                      <option value="on-failure">{t("cfg.restartPolicyOnFailure")}</option>
                      <option value="no">{t("cfg.restartPolicyNo")}</option>
                    </select>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("set_restart_policy")}>
                      {t("cfg.manageApplyPolicy")}
                    </button>
                  </div>

                  <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={uninstallPurge}
                        onChange={(e) => setUninstallPurge(e.target.checked)} />
                      <span style={{ fontSize: 12, color: uninstallPurge ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-2, #cbd5e1)" }}>
                        {t("cfg.uninstallPurge")}
                        <span style={{ display: "block", fontSize: 10, color: "var(--brand-border, #475569)" }}>
                          {t("cfg.uninstallPurgeHint", { path: effectiveDataPath(dataPath) })}
                        </span>
                      </span>
                    </label>
                    <button
                      style={{ ...BTN_RED, opacity: (managing || (!manageLocal && (!deviceHost || !deviceUser))) ? 0.6 : 1, marginTop: 6 }}
                      disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("uninstall")}>
                      {t("cfg.uninstallBtn")}
                    </button>
                  </div>

                  {manageLog.length > 0 && (
                    <div style={{
                      background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                      padding: "8px 10px", maxHeight: 150, overflowY: "auto", marginTop: 8,
                      fontFamily: "monospace", fontSize: 11,
                    }}>
                      {manageLog.map((l, i) => (
                        <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ── T-24 DevicesTab ───────────────────────────────────────────────────────────

const DEVICES_KEY = "sws.saved-devices";

/** Core deploy logic, reusable from RuntimeConnectionTab and DevicesTab. */
/**
 * Svuota le modifiche non salvate prima di un deploy.
 *
 * Entrambi i percorsi di deploy costruiscono lo ZIP leggendo il progetto **da
 * disco** (`/api/project/export` lato server), quindi senza questo passaggio un
 * deploy con modifiche pendenti spedisce lo stato precedente: i log dicono
 * "completato" e sul dispositivo si continua a vedere la versione vecchia.
 *
 * Ritorna false se il salvataggio è fallito: in quel caso il deploy va annullato
 * invece di pubblicare qualcosa di diverso da ciò che l'autore vede.
 */
async function flushBeforeDeploy(onLog: (msg: string) => void): Promise<boolean> {
  if (!selectIsDirty(useAppStore.getState())) return true;
  onLog("Salvataggio modifiche non salvate…");
  await useAppStore.getState().saveAll();
  const st = useAppStore.getState();
  if (st.saveStatus === "error") {
    onLog(`✗ Salvataggio fallito, deploy annullato: ${st.saveError ?? "errore sconosciuto"}`);
    return false;
  }
  onLog("✓ Salvato");
  return true;
}

async function deployToTarget(
  target: string,
  user: string,
  pass: string,
  onLog: (msg: string) => void,
): Promise<boolean> {
  try {
    if (!await flushBeforeDeploy(onLog)) return false;
    onLog("Esportazione progetto dal runtime locale…");
    const exportRes = await api.exportProjectZip();
    const cd = exportRes.headers.get("content-disposition") ?? "";
    const nameMatch = cd.match(/filename="([^"]+)"/);
    const zipName = nameMatch?.[1] ?? "project.zip";
    const projectName = zipName.replace(/\.zip$/, "");
    const zipBlob = await exportRes.blob();
    onLog(`✓ Esportato: ${zipName} (${(zipBlob.size / 1024).toFixed(1)} KB)`);

    onLog("Login al target…");
    const loginRes = await fetch(`${target}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!loginRes.ok) throw new Error(`Login target fallito: ${loginRes.status} ${loginRes.statusText}`);
    const { token: remoteToken } = await loginRes.json();
    onLog("✓ Login OK");

    onLog("Upload ZIP al target…");
    let uploadRes = await fetch(`${target}/api/projects/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", "Authorization": `Bearer ${remoteToken}` },
      body: zipBlob,
    });
    if (uploadRes.status === 409) {
      const conflict = await uploadRes.json().catch(() => ({}));
      const realName = (conflict as any).name ?? projectName;
      const ok = window.confirm(`Sul target esiste già il progetto "${realName}".\nSostituirlo con la versione corrente?`);
      if (!ok) throw new Error("Deploy annullato dall'utente.");
      onLog(`Rimozione di "${realName}" dal target…`);
      await fetch(`${target}/api/projects/close`, { method: "POST", headers: { "Authorization": `Bearer ${remoteToken}` } }).catch(() => {});
      const delRes = await fetch(`${target}/api/projects/${encodeURIComponent(realName)}`,
        { method: "DELETE", headers: { "Authorization": `Bearer ${remoteToken}` } });
      if (!delRes.ok) {
        const body = await delRes.text().catch(() => "");
        throw new Error(`Impossibile rimuovere "${realName}": ${delRes.status}${body ? ` — ${body}` : ""}`);
      }
      onLog(`✓ Rimosso "${realName}"`);
      uploadRes = await fetch(`${target}/api/projects/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/zip", "Authorization": `Bearer ${remoteToken}` },
        body: zipBlob,
      });
    }
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => "");
      throw new Error(`Upload fallito: ${uploadRes.status}${body ? ` — ${body}` : ""}`);
    }
    const { name: uploadedName } = await uploadRes.json();
    onLog(`✓ Caricato come "${uploadedName}"`);

    onLog("Attivazione progetto…");
    const openRes = await fetch(`${target}/api/projects/${encodeURIComponent(uploadedName)}/open`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${remoteToken}` },
    });
    if (!openRes.ok) {
      const body = await openRes.text().catch(() => "");
      throw new Error(`Attivazione fallita: ${openRes.status}${body ? ` — ${body}` : ""}`);
    }
    onLog(`✓ "${uploadedName}" attivo sul runtime`);
    onLog("🚀 Deploy completato!");
    return true;
  } catch (e: any) {
    onLog(`✗ ${e?.message ?? String(e)}`);
    return false;
  }
}

interface DeviceState {
  checking: boolean;
  online: boolean;
  fingerprint: string | null;
}

function DevicesTab() {
  const { t } = useTranslation();
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);
  const [devices, setDevices] = useState<SavedDevice[]>(() => {
    try { return JSON.parse(localStorage.getItem(DEVICES_KEY) ?? "[]"); }
    catch { return []; }
  });
  const [states, setStates] = useState<Record<string, DeviceState>>({});
  const [localFp, setLocalFp] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ label: "", url: "", user: "admin", pass: "" });
  const [deployingUrl, setDeployingUrl] = useState<string | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);

  const saveDevices = (list: SavedDevice[]) => {
    setDevices(list);
    localStorage.setItem(DEVICES_KEY, JSON.stringify(list));
  };

  const checkDevice = useCallback(async (device: SavedDevice) => {
    const url = device.url;
    setStates((s) => ({ ...s, [url]: { ...s[url], checking: true, online: s[url]?.online ?? false, fingerprint: s[url]?.fingerprint ?? null } }));
    let online = false;
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      online = r.ok;
    } catch { /* offline */ }

    if (!online) {
      setStates((s) => ({ ...s, [url]: { checking: false, online: false, fingerprint: null } }));
      return;
    }

    let fingerprint: string | null = null;
    try {
      const loginR = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: device.user, password: device.pass }),
        signal: AbortSignal.timeout(5000),
      });
      if (loginR.ok) {
        const { token } = await loginR.json();
        const fpR = await fetch(`${url}/api/project/fingerprint`, {
          headers: { "Authorization": `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (fpR.ok) {
          const fp = await fpR.json();
          fingerprint = fp.sha256 ?? null;
        }
      }
    } catch { /* auth failed or no project */ }

    setStates((s) => ({ ...s, [url]: { checking: false, online: true, fingerprint } }));
  }, []);

  const checkAll = useCallback((list: SavedDevice[]) => {
    list.forEach((d) => void checkDevice(d));
  }, [checkDevice]);

  useEffect(() => {
    api.getProjectFingerprint().then((fp) => setLocalFp(fp.sha256)).catch(() => {});
  }, []);

  useEffect(() => {
    if (devices.length > 0) checkAll(devices);
    const timer = setInterval(() => checkAll(devices), 30_000);
    return () => clearInterval(timer);
  }, [devices, checkAll]);

  const handleConnect = async (device: SavedDevice) => {
    localStorage.setItem(RT_URL_KEY, device.url);
    localStorage.setItem(RT_USER_KEY, device.user);
    localStorage.setItem(RT_PASS_KEY, device.pass);
    // Prima non chiamava mai l'API di connessione — scriveva solo le
    // credenziali in localStorage e sparava l'evento, quindi "Connetti" non
    // connetteva davvero nulla (vedi anche RuntimeConnectionTab.handleConnect,
    // stesso schema).
    try {
      const result = await api.remoteConnect(device.url, device.user || undefined, device.pass || undefined);
      if (!result.ok) throw new Error(result.error ?? "Connessione fallita");
      setRemoteConnected(true, device.url);
      window.dispatchEvent(new CustomEvent("sws:runtime-connected", { detail: { url: device.url } }));
    } catch (e) {
      console.warn("DevicesTab: connessione fallita", e);
    }
  };

  const handleDeploy = async (device: SavedDevice) => {
    setDeployingUrl(device.url);
    setDeployLog([]);
    await deployToTarget(device.url, device.user, device.pass, (msg) =>
      setDeployLog((l) => [...l, msg])
    );
    setDeployingUrl(null);
    // Refresh fingerprint after deploy
    setTimeout(() => void checkDevice(device), 1500);
  };

  const INPUT: React.CSSProperties = {
    background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4, padding: "5px 8px", fontSize: 12,
  };
  const BTN: React.CSSProperties = {
    padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12,
    border: "1px solid var(--brand-surface-2, #334155)", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: 1 }}>
        Device registrati
      </div>

      {/* Device table */}
      {devices.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--brand-border, #475569)", margin: 0 }}>Nessun device salvato. Aggiungine uno qui sotto.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-subtle, #64748b)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>{t("cfg.labelWord")}</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>URL</th>
                <th style={{ textAlign: "center", padding: "6px 8px" }}>{t("cfg.state")}</th>
                <th style={{ textAlign: "center", padding: "6px 8px" }}>{t("cfg.fingerprint")}</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>{t("cfg.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const st = states[d.url];
                const checking = st?.checking ?? false;
                const online = st?.online ?? null;
                const fp = st?.fingerprint ?? null;
                const match = localFp && fp ? (localFp === fp ? "sync" : "diff") : "unknown";
                return (
                  <tr key={d.url} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                    <td style={{ padding: "8px", color: "var(--brand-text, #e2e8f0)", fontWeight: 600 }}>{d.label}</td>
                    <td style={{ padding: "8px", color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace", fontSize: 11 }}>{d.url}</td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {online === null || checking
                        ? <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>…</span>
                        : online
                          ? <span style={{ color: "#34d399" }}>● online</span>
                          : <span style={{ color: "var(--brand-danger-soft, #f87171)" }}>● offline</span>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {!online ? <span style={{ color: "var(--brand-border, #475569)" }}>—</span>
                        : match === "sync"    ? <span style={{ color: "#34d399" }}>✓ in sync</span>
                        : match === "diff"    ? <span style={{ color: "#fb923c" }}>✗ diff. versione</span>
                        : <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>? n/d</span>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button style={BTN} onClick={() => handleConnect(d)} title={t("cfg.setTargetConnect")}>{t("cfg.connect")}</button>
                        <button style={{ ...BTN, background: "#1e3a5f", borderColor: "var(--brand-primary-hover, #2563eb)", color: "#93c5fd" }}
                          disabled={deployingUrl === d.url}
                          onClick={() => void handleDeploy(d)}>
                          {deployingUrl === d.url ? "Deploy…" : "Deploy"}
                        </button>
                        <button style={{ ...BTN, color: "var(--brand-danger-soft, #f87171)", borderColor: "var(--brand-danger-bg, #7f1d1d)" }}
                          onClick={() => saveDevices(devices.filter((x) => x.url !== d.url))}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Deploy log */}
      {deployLog.length > 0 && (
        <div style={{ background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
          padding: "8px 10px", maxHeight: 150, overflowY: "auto", fontFamily: "monospace", fontSize: 11 }}>
          {deployLog.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : l.startsWith("🚀") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
          ))}
        </div>
      )}

      {/* Add device form */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          Aggiungi device
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.labelWord")}</label>
            <input style={{ ...INPUT, width: 120 }} placeholder="PLC-01"
              value={addForm.label} onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.adminUrl")}</label>
            <input style={{ ...INPUT, width: 200 }} placeholder="https://192.168.1.10:8444"
              value={addForm.url} onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value.trim() }))} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.user")}</label>
            <input style={{ ...INPUT, width: 90 }} placeholder="admin"
              value={addForm.user} onChange={(e) => setAddForm((f) => ({ ...f, user: e.target.value }))} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.password")}</label>
            <input style={{ ...INPUT, width: 110 }} type="password" placeholder="••••••••"
              value={addForm.pass} onChange={(e) => setAddForm((f) => ({ ...f, pass: e.target.value }))} />
          </div>
          <button
            style={{ ...BTN, background: "#1e3a5f", borderColor: "var(--brand-primary-hover, #2563eb)", color: "#93c5fd", padding: "5px 14px" }}
            disabled={!addForm.url || !addForm.user}
            onClick={() => {
              const label = addForm.label.trim() || addForm.url;
              const newDevice: SavedDevice = { label, url: addForm.url, user: addForm.user, pass: addForm.pass };
              const updated = [...devices.filter((d) => d.url !== newDevice.url), newDevice];
              saveDevices(updated);
              setAddForm({ label: "", url: "", user: "admin", pass: "" });
              void checkDevice(newDevice);
            }}
          >{t("cfg.add")}</button>
        </div>
        {localFp && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--brand-border, #475569)" }}>
            Firma locale: <span style={{ fontFamily: "monospace", color: "var(--brand-text-subtle, #64748b)" }}>{localFp.substring(0, 16)}…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConfigView root ───────────────────────────────────────────────────────────

// ── Languages tab (T-40): project message translation table ─────────────────
function LanguagesTab() {
  const { t } = useTranslation();
  const storeTable       = useAppStore((s) => s.project?.languages);
  const updateLanguages  = useAppStore((s) => s.updateProjectLanguages);
  const editorPreviewLang = useAppStore((s) => s.editorPreviewLang);
  const setEditorPreviewLang = useAppStore((s) => s.setEditorPreviewLang);
  const [table, setTable] = useState<LanguageTable>(() => storeTable ?? { default: "", langs: [], entries: [] });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Filtro (per colonna: "key" o codice lingua) + ordinamento (solo visuale).
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);

  useEffect(() => { if (storeTable) setTable(storeTable); }, [storeTable]);

  const patch = (p: Partial<LanguageTable>) => setTable((tb) => ({ ...tb, ...p }));

  const cellText = (e: LangEntry, col: string) => (col === "key" ? e.key : e.values[col] ?? "");
  const setFilter = (col: string, q: string) => setFilters((f) => ({ ...f, [col]: q }));
  const toggleSort = (col: string) =>
    setSort((s) => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  // Vista filtrata+ordinata che CONSERVA l'indice originale in table.entries:
  // gli handler di modifica lavorano su quell'indice, non sulla posizione a video.
  const view = (() => {
    const rows = table.entries
      .map((e, origIdx) => ({ e, origIdx }))
      .filter(({ e }) =>
        Object.entries(filters).every(([col, q]) =>
          !q.trim() || cellText(e, col).toLowerCase().includes(q.trim().toLowerCase())));
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      rows.sort((a, b) => cellText(a.e, sort.col).localeCompare(cellText(b.e, sort.col), undefined, { numeric: true }) * dir);
    }
    return rows;
  })();

  const addLang = () => {
    const code = window.prompt(t("langtab.langCodePrompt"))?.trim().toLowerCase();
    if (!code || table.langs.includes(code)) return;
    patch({ langs: [...table.langs, code], default: table.default || code });
  };
  const removeLang = (code: string) => {
    // Ripulisci filtro/ordinamento riferiti alla colonna rimossa, altrimenti un
    // filtro stale su una lingua sparita nasconderebbe righe.
    setFilters((f) => { const n = { ...f }; delete n[code]; return n; });
    setSort((s) => (s?.col === code ? null : s));
    setTable((tb) => ({
      default: tb.default === code ? (tb.langs.find((l) => l !== code) ?? "") : tb.default,
      langs: tb.langs.filter((l) => l !== code),
      entries: tb.entries.map((e) => { const v = { ...e.values }; delete v[code]; return { ...e, values: v }; }),
    }));
  };
  const addRow = () => { setFilters({}); setSort(null); patch({ entries: [...table.entries, { key: "", values: {} }] }); };
  const removeRow = (idx: number) => patch({ entries: table.entries.filter((_, i) => i !== idx) });
  const setKey = (idx: number, key: string) =>
    patch({ entries: table.entries.map((e, i) => (i === idx ? { ...e, key } : e)) });
  const setVal = (idx: number, code: string, val: string) =>
    patch({ entries: table.entries.map((e, i) => (i === idx ? { ...e, values: { ...e.values, [code]: val } } : e)) });

  const handleSave = async () => {
    const clean: LanguageTable = { ...table, entries: table.entries.filter((e) => e.key.trim() !== "") };
    setSaving(true);
    try { await api.updateLanguages(clean); updateLanguages(clean); setTable(clean); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const exportCsv = () => {
    const cols = ["key", ...table.langs];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = table.entries.map((e) => [e.key, ...table.langs.map((l) => e.values[l] ?? "")].map(esc).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "languages.csv" });
    a.click(); URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 1) return;
    // parser CSV minimale con supporto virgolette
    const parse = (line: string): string[] => {
      const out: string[] = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++) { const c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
      out.push(cur); return out;
    };
    const header = parse(lines[0]).map((h) => h.trim());
    const langs = header.slice(1).filter(Boolean);
    const entries: LangEntry[] = lines.slice(1).map((l) => {
      const cells = parse(l); const values: Record<string, string> = {};
      langs.forEach((lang, i) => { if (cells[i + 1] !== undefined) values[lang] = cells[i + 1]; });
      return { key: (cells[0] ?? "").trim(), values };
    }).filter((e) => e.key !== "");
    setFilters({}); setSort(null); // le lingue cambiano: filtro/ordinamento vecchi non valgono più
    setTable((tb) => ({ default: tb.default || langs[0] || "", langs, entries }));
  };

  const CELL: React.CSSProperties = { border: "1px solid var(--brand-surface-2, #334155)", padding: 0 };
  const IN: React.CSSProperties = { width: "100%", background: "transparent", border: "none", color: "var(--brand-text, #e2e8f0)", padding: "5px 8px", fontSize: 12, boxSizing: "border-box" };

  return (
    <div style={S.section}>
      <SaveBar onSave={handleSave} saving={saving} saved={saved} label={t("langtab.save")} savedNotice={t("langtab.saved")} />
      <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, lineHeight: 1.5 }}>{t("langtab.intro")}</div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>{t("langtab.projectLang")}:</span>
        <select value={table.default} onChange={(e) => patch({ default: e.target.value })}
          title={t("langtab.projectLangHint")}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}>
          {table.langs.length === 0 && <option value="">—</option>}
          {table.langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginLeft: 6 }}>{t("langtab.editorLang")}:</span>
        <select value={table.langs.includes(editorPreviewLang) ? editorPreviewLang : table.default}
          onChange={(e) => setEditorPreviewLang(e.target.value)}
          title={t("langtab.editorLangHint")}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}>
          {table.langs.length === 0 && <option value="">—</option>}
          {table.langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={addLang} style={S.btn("primary")}>{t("langtab.addLang")}</button>
        <div style={{ flex: 1 }} />
        <button onClick={exportCsv} style={S.btn("ghost")} disabled={table.entries.length === 0}>{t("langtab.exportCsv")}</button>
        <button onClick={() => fileRef.current?.click()} style={S.btn("ghost")}>{t("langtab.importCsv")}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importCsv(f); }} />
      </div>

      {table.langs.length === 0 ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 20 }}>{t("langtab.noLangs")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: "24%" }}>
                <span onClick={() => toggleSort("key")} title={t("langtab.sortHint")} style={{ cursor: "pointer", userSelect: "none" }}>
                  {t("langtab.key")}{sort?.col === "key" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </span>
              </th>
              {table.langs.map((l) => (
                <th key={l} style={{ ...S.th }}>
                  <span onClick={() => toggleSort(l)} title={t("langtab.sortHint")} style={{ cursor: "pointer", userSelect: "none" }}>
                    {l}{l === table.default ? " ★" : ""}{sort?.col === l ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </span>
                  <button onClick={() => removeLang(l)} title={t("langtab.removeLang")}
                    style={{ marginLeft: 6, background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer" }}>✕</button>
                </th>
              ))}
              <th style={{ ...S.th, width: 32 }} />
            </tr>
            <tr>
              <th style={{ ...CELL, padding: 0 }}>
                <input value={filters["key"] ?? ""} onChange={(ev) => setFilter("key", ev.target.value)}
                  placeholder={t("langtab.filterPlaceholder")} style={{ ...IN, fontFamily: "monospace" }} spellCheck={false} />
              </th>
              {table.langs.map((l) => (
                <th key={l} style={{ ...CELL, padding: 0 }}>
                  <input value={filters[l] ?? ""} onChange={(ev) => setFilter(l, ev.target.value)}
                    placeholder={t("langtab.filterPlaceholder")} style={IN} />
                </th>
              ))}
              <th style={{ ...CELL, padding: 0 }} />
            </tr>
          </thead>
          <tbody>
            {view.map(({ e, origIdx }) => (
              <tr key={origIdx}>
                <td style={CELL}>
                  <input value={e.key} onChange={(ev) => setKey(origIdx, ev.target.value)} placeholder="start_pompa"
                    style={{ ...IN, fontFamily: "monospace" }} spellCheck={false} />
                </td>
                {table.langs.map((l) => (
                  <td key={l} style={CELL}>
                    <input value={e.values[l] ?? ""} onChange={(ev) => setVal(origIdx, l, ev.target.value)} style={IN} />
                  </td>
                ))}
                <td style={{ ...CELL, textAlign: "center" }}>
                  <button onClick={() => removeRow(origIdx)} style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14 }}>✕</button>
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={table.langs.length + 2} style={{ ...CELL, color: "var(--brand-text-subtle, #64748b)", padding: 16, textAlign: "center" }}>
                {table.entries.length === 0 ? t("langtab.empty") : t("langtab.noMatch")}
              </td></tr>
            )}
          </tbody>
        </table>
      )}
      <button onClick={addRow} style={{ ...S.btn("ghost"), marginTop: 10 }} disabled={table.langs.length === 0}>{t("langtab.addRow")}</button>
    </div>
  );
}

type ConfigTab = "tags" | "protocols" | "alarms" | "datastores" | "scripts" | "faceplates" | "recipes" | "notifications" | "languages" | "users" | "resources" | "system" | "backups" | "devices" | "runtime" | "ide";

export function ConfigView() {
  const { t } = useTranslation();
  const storeTab    = useAppStore((s) => s.configTab) as ConfigTab;
  const setStoreTab = useAppStore((s) => s.setConfigTab);
  const [tab, setTab] = useState<ConfigTab>(storeTab);
  const authRole = useAppStore((s) => s.authRole);
  const isAdmin = authRole === "Admin";
  const project          = useAppStore((s) => s.project);
  const projectLoadError = useAppStore((s) => s.projectLoadError);

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
    ? ["tags", "protocols", "alarms", "scripts", "faceplates", "recipes", "notifications", "languages", "datastores", "users", "resources", "backups", "system", "devices", "runtime", "ide"]
    : ["tags", "protocols", "alarms", "scripts", "faceplates", "recipes", "notifications", "languages", "resources", "system", "ide"];

  // Bounce non-admins off the backups, datastores, devices tabs.
  useEffect(() => {
    if (tab === "backups"    && !isAdmin) handleSetTab("tags");
    if (tab === "datastores" && !isAdmin) handleSetTab("tags");
    if (tab === "devices"    && !isAdmin) handleSetTab("tags");
  }, [tab, isAdmin]);

  // Guard: tags/protocols/alarms tabs all initialise their local state from
  // store.project. If project hasn't loaded yet, rendering them would show
  // empty inputs over a populated YAML and a subsequent save would wipe the
  // file. The other tabs are independent so they stay available.
  const projectLoading = project === null
    && tab !== "users" && tab !== "resources" && tab !== "system"
    && tab !== "backups" && tab !== "datastores" && tab !== "scripts"
    && tab !== "faceplates" && tab !== "recipes" && tab !== "notifications"
    && tab !== "devices" && tab !== "runtime" && tab !== "ide";

  // Belt-and-braces: App.tsx already gates mode="config" via effectiveMode,
  // so this is unreachable for non-Supervisor+ today. Kept so a future
  // direct mount can't slip past the role check. Placed after all hooks
  // to keep React's rules-of-hooks invariant intact across role changes.
  if (!canConfigureProject(authRole)) return null;

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {visibleTabs.map((tb) => (
          <button key={tb} style={S.tab(tab === tb)} onClick={() => handleSetTab(tb)}>
            {t(`config.tabs.${tb}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {projectLoading ? (
          projectLoadError ? (
            <div style={{ color: "#dc2626", fontSize: 13, padding: 24, whiteSpace: "pre-wrap" }}>
              <strong>Errore caricamento progetto:</strong><br />{projectLoadError}
            </div>
          ) : (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 24 }}>
              Caricamento progetto…
            </div>
          )
        ) : (
          <>
            {tab === "tags"        && <TagsTab />}
            {tab === "protocols"   && <ProtocolsTab />}
            {tab === "alarms"      && <AlarmsTab />}
            {tab === "scripts"     && <GlobalScriptsTab />}
            {tab === "faceplates"  && <FaceplatesTab />}
            {tab === "recipes"        && <RecipesTab />}
            {tab === "notifications"  && <NotificationsTab />}
            {tab === "languages"      && <LanguagesTab />}
            {tab === "datastores"     && isAdmin && <DatastoresTab />}
            {tab === "users"       && isAdmin && <UsersTab />}
            {tab === "resources"   && <ResourcesTab />}
            {tab === "system"      && <SystemTab />}
            {tab === "backups"     && isAdmin && <BackupsTab />}
            {tab === "devices"    && isAdmin && <DevicesTab />}
            {tab === "runtime"    && isAdmin && <RuntimeConnectionTab />}
            {tab === "ide"        && <IdePreferencesTab />}
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
// `<project>/backups/<UTC-timestamp>/`. The runtime also takes them
// automatically when `--auto-backup-interval-minutes` is set.

type BackupInfo = { name: string; created_at_ms: number; size_bytes: number };

function fmtBackupSize(b: number) {
  return b < 1024 ? `${b} B`
    : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function fmtBackupDate(ms: number) {
  return ms > 0 ? new Date(ms).toLocaleString() : "—";
}
function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Riquadro elenco+azioni per un set di backup — usato due volte in
 *  `BackupsTab` (progetto locale, dispositivo remoto connesso): stesso set
 *  di azioni per entrambi (Backup adesso/Aggiorna/Ripristina/Scarica/
 *  Elimina), la logica/i confirm restano nel chiamante. */
function BackupSection({
  title, list, busy, err, emptyHint,
  onRefresh, onCreate, onDownload, onRestore, onDelete,
}: {
  title: string;
  list: BackupInfo[] | null;
  busy: boolean;
  err: string | null;
  emptyHint: string;
  onRefresh: () => void;
  onCreate: () => void;
  onDownload: (name: string) => void;
  onRestore: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
          {title}
        </span>
        <button
          onClick={onCreate}
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
          onClick={onRefresh}
          disabled={busy}
          style={{
            padding: "6px 14px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)",
            border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
            cursor: busy ? "wait" : "pointer", fontSize: 13,
          }}
        >
          ↻ Aggiorna
        </button>
      </div>
      {err && (
        <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 12px", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Errore: {err}
        </div>
      )}
      {list === null ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>Caricamento…</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, fontStyle: "italic", padding: "16px 0" }}>
          {emptyHint}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.name")}</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.created")}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.size")}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-2, #cbd5e1)", fontFamily: "monospace" }}>{b.name}</td>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)" }}>{fmtBackupDate(b.created_at_ms)}</td>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", textAlign: "right" }}>{fmtBackupSize(b.size_bytes)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button
                    onClick={() => onRestore(b.name)}
                    disabled={busy}
                    style={{
                      marginRight: 4, padding: "3px 10px",
                      background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)",
                      border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer",
                      fontSize: 12,
                    }}
                  >Ripristina</button>
                  <button
                    onClick={() => onDownload(b.name)}
                    disabled={busy}
                    style={{
                      marginRight: 4, padding: "3px 10px",
                      background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
                      border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3,
                      cursor: busy ? "wait" : "pointer", fontSize: 12,
                    }}
                  >Scarica</button>
                  <button
                    onClick={() => onDelete(b.name)}
                    disabled={busy}
                    style={{
                      padding: "3px 10px",
                      background: "transparent", color: "var(--brand-danger-soft, #fca5a5)",
                      border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 3,
                      cursor: busy ? "wait" : "pointer", fontSize: 12,
                    }}
                  >{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BackupsTab() {
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);

  // ── Backup locali (progetto in editing in questo editor) ──────────────────
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const refresh = async () => {
    setErr(null);
    try {
      setList(await api.listBackups());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { refresh(); }, []);

  const createNow = async () => {
    setBusy(true); setErr(null);
    try {
      await api.createBackup();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (name: string) => {
    setBusy(true); setErr(null);
    try {
      triggerBlobDownload(await (await api.downloadBackup(name)).blob(), `${name}.zip`);
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
    setBusy(true); setErr(null);
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
    setBusy(true); setErr(null);
    try {
      await api.deleteBackup(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Backup sul dispositivo remoto connesso — cartella backups/ distinta da
  // quella locale; un ripristino/eliminazione qui non tocca il progetto
  // aperto in questo editor, solo lo stato del device connesso.
  const [remoteList, setRemoteList] = useState<BackupInfo[] | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteErr, setRemoteErr]   = useState<string | null>(null);

  const refreshRemote = async () => {
    setRemoteErr(null);
    try {
      setRemoteList(await api.remoteListBackups());
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (remoteConnected) void refreshRemote(); else setRemoteList(null);
  }, [remoteConnected]);

  const createRemote = async () => {
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteCreateBackup();
      await refreshRemote();
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const downloadRemote = async (name: string) => {
    setRemoteBusy(true); setRemoteErr(null);
    try {
      triggerBlobDownload(await (await api.remoteDownloadBackup(name)).blob(), `${name}-remoto.zip`);
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const restoreRemote = async (name: string) => {
    if (!window.confirm(
      `Ripristinare il backup "${name}" sul dispositivo remoto connesso?\n\n` +
      `Sovrascrive project.yaml, synoptics, users.yaml e lo storico sul device.\n` +
      `Non tocca il progetto locale aperto in questo editor.`
    )) return;
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteRestoreBackup(name);
      await refreshRemote();
      window.alert(`Backup "${name}" ripristinato sul dispositivo remoto.`);
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const dropRemote = async (name: string) => {
    if (!window.confirm(`Eliminare il backup "${name}" sul dispositivo remoto connesso? L'azione è definitiva.`)) return;
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteDeleteBackup(name);
      await refreshRemote();
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  // Override per-progetto dell'intervallo/retention di auto-backup (prima
  // era solo un flag di avvio --auto-backup-interval-minutes, non
  // controllabile a progetto). Campo vuoto = eredita il default di processo.
  const [intervalMin, setIntervalMin] = useState("");
  const [retention, setRetention]     = useState("");
  const [cfgSaving, setCfgSaving]     = useState(false);
  const [cfgSaved, setCfgSaved]       = useState(false);
  const [cfgErr, setCfgErr]           = useState<string | null>(null);

  useEffect(() => {
    setIntervalMin(project?.auto_backup_interval_minutes != null ? String(project.auto_backup_interval_minutes) : "");
    setRetention(project?.auto_backup_retention != null ? String(project.auto_backup_retention) : "");
  }, [project]);

  const saveBackupConfig = async () => {
    setCfgSaving(true);
    setCfgErr(null);
    try {
      await api.updateBackupConfig({
        interval_minutes: intervalMin.trim() === "" ? null : Number(intervalMin),
        retention: retention.trim() === "" ? null : Number(retention),
      });
      const p = await api.getProject();
      useAppStore.getState().setProject(p);
      setCfgSaved(true);
      setTimeout(() => setCfgSaved(false), 2000);
    } catch (e) {
      setCfgErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCfgSaving(false);
    }
  };

  const labelStyleBak: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 2 };
  const inputStyleBak: React.CSSProperties = { background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "#f1f5f9", borderRadius: 4, padding: "5px 8px", fontSize: 13 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.5 }}>
        Snapshot point-in-time del progetto (project.yaml + synoptics + users.yaml + history +
        recipes) salvati sotto <code>{`<project>/backups/`}</code>. Il runtime ne crea uno
        automaticamente ogni N minuti — di default secondo il flag di avvio
        <code> --auto-backup-interval-minutes</code>, ma questo progetto può avere il proprio
        intervallo (sotto), a prescindere da come è stato avviato il runtime.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 8 }}>
        <div>
          <span style={labelStyleBak}>Intervallo auto-backup (minuti)</span>
          <input type="number" min={0} value={intervalMin}
            onChange={(e) => setIntervalMin(e.target.value)}
            placeholder="eredita dal runtime"
            style={{ ...inputStyleBak, width: 160 }} />
        </div>
        <div>
          <span style={labelStyleBak}>Backup da tenere</span>
          <input type="number" min={0} value={retention}
            onChange={(e) => setRetention(e.target.value)}
            placeholder="eredita dal runtime"
            style={{ ...inputStyleBak, width: 140 }} />
        </div>
        <button onClick={saveBackupConfig} disabled={cfgSaving}
          style={{ padding: "6px 14px", background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4, cursor: cfgSaving ? "wait" : "pointer", fontSize: 13 }}>
          {cfgSaved ? "✓ Salvato" : "Salva"}
        </button>
        {cfgErr && <span style={{ fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{cfgErr}</span>}
      </div>

      <BackupSection
        title="BACKUP LOCALI (progetto in editing)"
        list={list} busy={busy} err={err}
        emptyHint='Nessun backup. Click "+ Backup adesso" per crearne uno.'
        onRefresh={refresh} onCreate={createNow}
        onDownload={download} onRestore={restore} onDelete={drop}
      />

      {remoteConnected && (
        <BackupSection
          title="BACKUP SUL DISPOSITIVO REMOTO CONNESSO"
          list={remoteList} busy={remoteBusy} err={remoteErr}
          emptyHint="Nessun backup sul dispositivo remoto."
          onRefresh={refreshRemote} onCreate={createRemote}
          onDownload={downloadRemote} onRestore={restoreRemote} onDelete={dropRemote}
        />
      )}
    </div>
  );
}
