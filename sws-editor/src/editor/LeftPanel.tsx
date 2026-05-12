import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { ProjectInfo, SynopticObject } from "@/types";

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  panel: {
    background: "#1e293b",
    color: "#cbd5e1",
    display: "flex" as const,
    flexDirection: "column" as const,
    width: 220,
    borderRight: "1px solid #334155",
    overflow: "hidden" as const,
    flexShrink: 0,
  },
  sectionHead: (_open: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    background: "#0f172a",
    borderBottom: "1px solid #334155",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: 1,
    userSelect: "none",
    flexShrink: 0,
  }),
  chevron: (open: boolean): React.CSSProperties => ({
    display: "inline-block",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform 0.15s",
    fontSize: 10,
    color: "#475569",
  }),
  body: {
    overflowY: "auto" as const,
    maxHeight: 220,
    padding: "4px 0",
  },
  row: (active?: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 12px",
    cursor: "pointer",
    fontSize: 12,
    background: active ? "#334155" : "transparent",
    color: active ? "#e2e8f0" : "#94a3b8",
  }),
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#475569",
    cursor: "pointer",
    fontSize: 12,
    padding: "0 2px",
    lineHeight: 1,
    flexShrink: 0,
  } as React.CSSProperties,
  objBtn: {
    background: "#0f172a",
    color: "#cbd5e1",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "4px 6px",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left" as const,
    flex: "1 1 calc(50% - 4px)",
    minWidth: 0,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
  } as React.CSSProperties,
};

// ── Section accordion ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={S.sectionHead(open)} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span style={S.chevron(open)}>▶</span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Pages section ─────────────────────────────────────────────────────────────

function PagesSection() {
  const pages         = useAppStore((s) => s.pages);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const addPage       = useAppStore((s) => s.addPage);
  const deletePage    = useAppStore((s) => s.deletePage);

  return (
    <Section title="PAGINE">
      <div style={S.body}>
        {pages.map((p) => (
          <div
            key={p.id}
            style={{ ...S.row(p.id === currentPageId), justifyContent: "space-between" }}
            onClick={() => setCurrentPage(p.id)}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </span>
            {pages.length > 1 && (
              <button
                style={S.iconBtn}
                title="Elimina pagina"
                onClick={(e) => { e.stopPropagation(); deletePage(p.id); }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div style={{ padding: "4px 8px" }}>
          <button
            onClick={addPage}
            style={{
              ...S.objBtn,
              flex: "none",
              width: "100%",
              borderStyle: "dashed",
              color: "#64748b",
            }}
          >
            + Nuova pagina
          </button>
        </div>
      </div>
    </Section>
  );
}

// ── Objects palette section ───────────────────────────────────────────────────

const OBJECT_TYPES: { type: SynopticObject["type"]; label: string; disabled?: boolean }[] = [
  { type: "rect",         label: "Rettangolo" },
  { type: "ellipse",      label: "Ellisse" },
  { type: "line",         label: "Linea" },
  { type: "text",         label: "Testo" },
  { type: "button",       label: "Bottone" },
  { type: "navbutton",    label: "Nav page" },
  { type: "checkbox",     label: "Checkbox" },
  { type: "radio",        label: "Radio" },
  { type: "slider",       label: "Slider" },
  { type: "gauge",        label: "Gauge" },
  { type: "led",          label: "LED" },
  { type: "progress_bar", label: "Progress" },
  { type: "table",        label: "Tabella" },
  { type: "image",        label: "Immagine", disabled: true },
];

function ObjectPalette({ onAdd }: { onAdd: (type: SynopticObject["type"]) => void }) {
  return (
    <Section title="OGGETTI">
      <div style={{ padding: "6px 8px", display: "flex", flexWrap: "wrap", gap: 4 }}>
        {OBJECT_TYPES.map(({ type, label, disabled }) => (
          <button
            key={type}
            disabled={disabled}
            onClick={() => onAdd(type)}
            title={disabled ? "Prossimamente" : undefined}
            style={{
              ...S.objBtn,
              color: disabled ? "#334155" : "#cbd5e1",
              borderColor: disabled ? "#1e293b" : "#334155",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            + {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Tags section ──────────────────────────────────────────────────────────────

function TagsSection() {
  const project   = useAppStore((s) => s.project);
  const tagValues = useAppStore((s) => s.tagValues);

  const tags = project?.tags ?? [];

  const dot = (q: string) => {
    const color = q === "Good" ? "#22c55e" : q === "Bad" ? "#ef4444" : "#eab308";
    return (
      <span
        style={{
          display: "inline-block",
          width: 6, height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
    );
  };

  if (tags.length === 0) {
    return (
      <Section title="TAG" defaultOpen={false}>
        <p style={{ padding: "8px 12px", fontSize: 11, color: "#475569", margin: 0 }}>
          Nessun tag — carica un progetto.
        </p>
      </Section>
    );
  }

  return (
    <Section title={`TAG (${tags.length})`} defaultOpen={false}>
      <div style={S.body}>
        {tags.map((t) => {
          const tv = tagValues[t.id];
          return (
            <div key={t.id} style={{ ...S.row(), gap: 6, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                {tv ? dot(tv.quality) : (
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#334155", flexShrink: 0 }} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                  {t.id}
                </span>
              </div>
              {tv != null && (
                <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>
                  {String(tv.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Sources section ───────────────────────────────────────────────────────────

function SourcesSection({ project }: { project: ProjectInfo | null }) {
  const sources = project?.sources ?? [];

  if (sources.length === 0) {
    return (
      <Section title="SORGENTI" defaultOpen={false}>
        <p style={{ padding: "8px 12px", fontSize: 11, color: "#475569", margin: 0 }}>
          Nessuna sorgente configurata.
        </p>
      </Section>
    );
  }

  return (
    <Section title={`SORGENTI (${sources.length})`} defaultOpen={false}>
      <div style={{ ...S.body, maxHeight: 300 }}>
        {sources.map((src) => (
          <div key={src.id} style={{ padding: "4px 10px" }}>
            <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>
              {src.id}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>
              {src.kind === "modbus_tcp"
                ? `Modbus TCP — ${src.host}:${src.port} | unit ${src.unit_id}`
                : `MQTT — ${src.host}:${src.port}`}
            </div>
            {src.kind === "modbus_tcp" && src.registers.map((r) => (
              <div key={r.tag} style={{ fontSize: 10, color: "#475569", paddingLeft: 8 }}>
                {r.tag} @ reg {r.address}
                {r.scale !== 1 ? ` × ${r.scale}` : ""}
              </div>
            ))}
            {src.kind === "mqtt" && src.topics.map((t, i) => (
              <div key={`${t.tag}-${i}`} style={{ fontSize: 10, color: "#475569", paddingLeft: 8 }}>
                {t.tag} ← {t.topic}
                {t.json_path ? ` ($.${t.json_path})` : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Canvas settings ───────────────────────────────────────────────────────────

function CanvasSettings() {
  const gridSize    = useAppStore((s) => s.gridSize);
  const snapEnabled = useAppStore((s) => s.snapEnabled);
  const setGridSize = useAppStore((s) => s.setGridSize);
  const setSnap     = useAppStore((s) => s.setSnapEnabled);

  return (
    <div style={{ padding: "8px 10px", borderTop: "1px solid #334155", flexShrink: 0 }}>
      <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
        GRIGLIA
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ fontSize: 11, color: "#64748b", flex: 1 }}>
          Dimensione
        </label>
        <select
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          style={{
            background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155",
            borderRadius: 4, padding: "2px 4px", fontSize: 12, width: 60,
          }}
        >
          {[0, 5, 10, 20, 40].map((n) => (
            <option key={n} value={n}>{n === 0 ? "Off" : `${n}px`}</option>
          ))}
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(e) => setSnap(e.target.checked)}
          style={{ accentColor: "#3b82f6" }}
        />
        <span style={{ fontSize: 11, color: "#64748b" }}>Snap alla griglia</span>
      </label>
    </div>
  );
}

// ── Main LeftPanel export ─────────────────────────────────────────────────────

interface LeftPanelProps {
  onAddObject: (type: SynopticObject["type"]) => void;
  onSave: () => void;
}

export function LeftPanel({ onAddObject, onSave }: LeftPanelProps) {
  const project    = useAppStore((s) => s.project);
  const setProject = useAppStore((s) => s.setProject);

  useEffect(() => {
    api.getProject()
      .then((p) => setProject(p))
      .catch(() => {});
  }, []);

  return (
    <div style={S.panel}>
      <div style={{ overflowY: "auto" as const, flex: 1 }}>
        <PagesSection />
        <ObjectPalette onAdd={onAddObject} />
        <TagsSection />
        <SourcesSection project={project} />
      </div>

      <CanvasSettings />

      <div style={{ padding: "8px 10px", borderTop: "1px solid #334155", flexShrink: 0 }}>
        <button
          onClick={onSave}
          style={{
            width: "100%",
            background: "#166534", color: "#bbf7d0",
            border: "1px solid #15803d", borderRadius: 4,
            padding: "6px 0", cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}
        >
          Salva
        </button>
      </div>
    </div>
  );
}
