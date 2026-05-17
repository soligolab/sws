import React, { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { ObjectGroup, ProjectInfo, SynopticObject } from "@/types";

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
  const renamePage    = useAppStore((s) => s.renamePage);
  const reorderPage   = useAppStore((s) => s.reorderPage);
  const duplicatePage = useAppStore((s) => s.duplicatePage);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const beginRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingValue(name);
  };
  const commitRename = () => {
    if (editingId) {
      const v = editingValue.trim();
      if (v) renamePage(editingId, v);
    }
    setEditingId(null);
    setEditingValue("");
  };

  return (
    <Section title="PAGINE">
      <div style={S.body}>
        {pages.map((p, pi) => (
          <div
            key={p.id}
            style={{ ...S.row(p.id === currentPageId), justifyContent: "space-between" }}
            onClick={() => editingId !== p.id && setCurrentPage(p.id)}
            onDoubleClick={() => beginRename(p.id, p.name)}
            title="Doppio click per rinominare"
          >
            {editingId === p.id ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") { setEditingId(null); setEditingValue(""); }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  background: "#0f172a",
                  color: "#e2e8f0",
                  border: "1px solid #475569",
                  borderRadius: 3,
                  padding: "1px 4px",
                  fontSize: 12,
                }}
              />
            ) : (
              <>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {p.name}
                </span>
                <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  {pi > 0 && (
                    <button style={S.iconBtn} title="Sposta su"
                      onClick={(e) => { e.stopPropagation(); reorderPage(p.id, "up"); }}>↑</button>
                  )}
                  {pi < pages.length - 1 && (
                    <button style={S.iconBtn} title="Sposta giù"
                      onClick={(e) => { e.stopPropagation(); reorderPage(p.id, "down"); }}>↓</button>
                  )}
                  <button style={S.iconBtn} title="Duplica pagina"
                    onClick={(e) => { e.stopPropagation(); duplicatePage(p.id); }}>⧉</button>
                  <button
                    style={S.iconBtn}
                    title="Rinomina"
                    onClick={(e) => { e.stopPropagation(); beginRename(p.id, p.name); }}
                  >✎</button>
                  {pages.length > 1 && (
                    <button
                      style={S.iconBtn}
                      title="Elimina pagina"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Eliminare la pagina "${p.name}"? L'azione è annullabile con Ctrl-Z.`)) {
                          deletePage(p.id);
                        }
                      }}
                    >×</button>
                  )}
                </span>
              </>
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
  { type: "trend",        label: "Trend" },
  { type: "symbol",       label: "Simbolo" },
  { type: "image",        label: "Immagine" },
  { type: "grid",         label: "Griglia" },
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

// ── Objects-on-page section ──────────────────────────────────────────────────

type TreeNode =
  | { kind: "group"; group: ObjectGroup; members: SynopticObject[] }
  | { kind: "object"; obj: SynopticObject };

function ObjectsSection() {
  const pages               = useAppStore((s) => s.pages);
  const currentPageId       = useAppStore((s) => s.currentPageId);
  const selectedId          = useAppStore((s) => s.selectedObjectId);
  const selectedIds         = useAppStore((s) => s.selectedObjectIds);
  const selectObject        = useAppStore((s) => s.selectObject);
  const selectMany          = useAppStore((s) => s.selectMany);
  const updateObject        = useAppStore((s) => s.updateObject);
  const duplicateObject     = useAppStore((s) => s.duplicateObject);
  const deleteObject        = useAppStore((s) => s.deleteObject);
  const groupObjects        = useAppStore((s) => s.groupObjects);
  const ungroupObjects      = useAppStore((s) => s.ungroupObjects);
  const renameGroup         = useAppStore((s) => s.renameGroup);
  const selectedCellChild    = useAppStore((s) => s.selectedCellChild);
  const setSelectedCell      = useAppStore((s) => s.setSelectedCell);
  const setSelectedCellChild = useAppStore((s) => s.setSelectedCellChild);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft]       = useState("");
  const [expandedGrids, setExpandedGrids] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [filter, setFilter]     = useState("");

  const currentPage = pages.find((p) => p.id === currentPageId);
  const allObjects = currentPage?.objects ?? [];
  const groups = currentPage?.groups ?? [];
  const fq = filter.trim().toLowerCase();
  const filteredObjects = fq
    ? allObjects.filter((o) =>
        (o.name ?? "").toLowerCase().includes(fq) ||
        o.type.toLowerCase().includes(fq) ||
        o.id.toLowerCase().includes(fq)
      )
    : allObjects;

  const buildTree = (): TreeNode[] => {
    if (fq) {
      return filteredObjects.map((obj) => ({ kind: "object", obj }));
    }
    const tree: TreeNode[] = [];
    const grouped = new Map<string, SynopticObject[]>();
    for (const o of allObjects) {
      if (o.group_id && groups.some((g) => g.id === o.group_id)) {
        const arr = grouped.get(o.group_id) ?? [];
        arr.push(o);
        grouped.set(o.group_id, arr);
      }
    }
    const ungrouped = allObjects.filter(
      (o) => !o.group_id || !groups.some((g) => g.id === o.group_id)
    );
    for (const g of groups) {
      tree.push({ kind: "group", group: g, members: grouped.get(g.id) ?? [] });
    }
    for (const o of ungrouped) {
      tree.push({ kind: "object", obj: o });
    }
    return tree;
  };

  useEffect(() => {
    if (selectedCellChild) {
      setExpandedGrids((prev) =>
        prev.has(selectedCellChild.objectId)
          ? prev
          : new Set([...prev, selectedCellChild.objectId])
      );
    }
  }, [selectedCellChild?.objectId]);

  // Auto-expand group when a member is selected
  useEffect(() => {
    if (selectedId) {
      const obj = allObjects.find((o) => o.id === selectedId);
      if (obj?.group_id) {
        setExpandedGroups((prev) =>
          prev.has(obj.group_id!) ? prev : new Set([...prev, obj.group_id!])
        );
      }
    }
  }, [selectedId]);

  const toggleExpandGrid = (id: string) =>
    setExpandedGrids((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleExpandGroup = (id: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const commitRename = () => {
    if (renaming) {
      updateObject(renaming, { name: draft.trim() || undefined });
    }
    setRenaming(null);
    setDraft("");
  };

  const startRenameGroup = (id: string, name: string) => {
    setRenamingGroup(id);
    setGroupDraft(name);
  };
  const commitRenameGroup = () => {
    if (renamingGroup) {
      const v = groupDraft.trim();
      if (v) renameGroup(renamingGroup, v);
    }
    setRenamingGroup(null);
    setGroupDraft("");
  };

  const renderObjectRow = (o: SynopticObject, indent = 0) => {
    const isSel = o.id === selectedId;
    const isRen = o.id === renaming;
    const label = o.name?.trim() || `${o.type}·${o.id.slice(-4)}`;
    const isGrid = o.type === "grid";
    const isExpanded = isGrid && expandedGrids.has(o.id);
    const cellsWithChildren = isGrid ? (o.grid_cells ?? []).filter((c) => !!c.child) : [];

    return (
      <React.Fragment key={o.id}>
        <div
          onClick={() => !isRen && selectObject(o.id)}
          style={{ ...S.row(isSel), gap: 4, paddingRight: 4, paddingLeft: 4 + indent }}
        >
          {isGrid ? (
            <button
              style={{ ...S.iconBtn, width: 14, fontSize: 8, color: cellsWithChildren.length > 0 ? "#94a3b8" : "#334155", flexShrink: 0 }}
              title={isExpanded ? "Comprimi" : "Espandi"}
              onClick={(e) => { e.stopPropagation(); if (cellsWithChildren.length > 0) toggleExpandGrid(o.id); }}
            >
              {cellsWithChildren.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}
            </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          {o.locked && (
            <span title="Bloccato" style={{ fontSize: 10, flexShrink: 0, opacity: 0.7 }}>🔒</span>
          )}
          <span style={{ fontSize: 9, color: "#475569", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {o.type.slice(0, 5)}
          </span>
          {isRen ? (
            <input
              type="text" value={draft} autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") { setRenaming(null); setDraft(""); }
              }}
              style={{ flex: 1, minWidth: 0, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
            />
          ) : (
            <span
              onDoubleClick={(e) => { e.stopPropagation(); startRename(o.id, o.name ?? ""); }}
              title="Doppio click per rinominare"
              style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
            >
              {label}
            </span>
          )}
          <button style={S.iconBtn} title="Rinomina" onClick={(e) => { e.stopPropagation(); startRename(o.id, o.name ?? ""); }}>✎</button>
          <button style={S.iconBtn} title="Duplica" onClick={(e) => { e.stopPropagation(); duplicateObject(o.id); }}>⧉</button>
          <button style={{ ...S.iconBtn, color: "#ef4444" }} title="Elimina" onClick={(e) => { e.stopPropagation(); deleteObject(o.id); }}>×</button>
        </div>
        {isExpanded && cellsWithChildren.map((c) => {
          const isChildSel = selectedCellChild?.objectId === o.id && selectedCellChild.row === c.row && selectedCellChild.col === c.col;
          const childLabel = c.child!.type + (c.child!.name ? ` — ${c.child!.name}` : "");
          return (
            <div
              key={`${o.id}-${c.row}-${c.col}`}
              onClick={() => { selectObject(o.id); setSelectedCell({ objectId: o.id, row: c.row, col: c.col }); setSelectedCellChild({ objectId: o.id, row: c.row, col: c.col }); }}
              style={{ ...S.row(isChildSel), paddingLeft: indent + 24, paddingRight: 4, gap: 4, color: isChildSel ? "#5eead4" : "#64748b", background: isChildSel ? "#0f2922" : "transparent" }}
              title={`Cella R${c.row + 1}, C${c.col + 1}`}
            >
              <span style={{ fontSize: 10, flexShrink: 0, color: "#475569" }}>↳</span>
              <span style={{ fontSize: 9, color: "#475569", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {c.child!.type.slice(0, 5)}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                {childLabel}
              </span>
              <span style={{ fontSize: 9, color: "#334155", flexShrink: 0 }}>R{c.row + 1},{c.col + 1}</span>
            </div>
          );
        })}
      </React.Fragment>
    );
  };

  const tree = buildTree();

  return (
    <Section title={`OGGETTI PAGINA (${allObjects.length})`} defaultOpen={false}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #1e293b" }}>
        <input
          type="text"
          placeholder="Filtra per nome / tipo…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 3, padding: "3px 6px", fontSize: 11 }}
        />
      </div>
      {selectedIds.length >= 2 && (
        <div style={{ padding: "3px 8px", borderBottom: "1px solid #1e293b" }}>
          <button
            onClick={() => groupObjects(selectedIds)}
            style={{ ...S.objBtn, flex: "none", width: "100%", borderStyle: "dashed", color: "#38bdf8", borderColor: "#0ea5e9", fontSize: 11 }}
          >
            + Raggruppa selezionati ({selectedIds.length})
          </button>
        </div>
      )}
      <div style={{ ...S.body, maxHeight: 280 }}>
        {tree.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "#475569", margin: 0 }}>
            {fq ? "Nessun oggetto corrisponde al filtro." : "Nessun oggetto su questa pagina. Aggiungili dalla palette qui sopra."}
          </p>
        )}
        {tree.map((node) => {
          if (node.kind === "group") {
            const { group, members } = node;
            const isExpanded = expandedGroups.has(group.id);
            const allMembersSel = members.length > 0 && members.every((m) => selectedIds.includes(m.id));
            const isRenamingThis = renamingGroup === group.id;
            return (
              <React.Fragment key={group.id}>
                {/* Group row */}
                <div
                  onClick={() => members.length > 0 && selectMany(members.map((m) => m.id))}
                  style={{
                    ...S.row(allMembersSel),
                    gap: 4, paddingRight: 4,
                    background: allMembersSel ? "#1e3a5f" : "#172033",
                    color: allMembersSel ? "#93c5fd" : "#64748b",
                    borderBottom: "1px solid #1e293b",
                  }}
                  title="Click per selezionare tutti i membri"
                >
                  <button
                    style={{ ...S.iconBtn, width: 14, fontSize: 8, flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); toggleExpandGroup(group.id); }}
                    title={isExpanded ? "Comprimi" : "Espandi"}
                  >
                    {isExpanded ? "▼" : "▶"}
                  </button>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                  {isRenamingThis ? (
                    <input
                      type="text" value={groupDraft} autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setGroupDraft(e.target.value)}
                      onBlur={commitRenameGroup}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenameGroup();
                        else if (e.key === "Escape") { setRenamingGroup(null); setGroupDraft(""); }
                      }}
                      style={{ flex: 1, minWidth: 0, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => { e.stopPropagation(); startRenameGroup(group.id, group.name); }}
                      title="Doppio click per rinominare"
                      style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
                    >
                      {group.name} ({members.length})
                    </span>
                  )}
                  <button
                    style={S.iconBtn} title="Rinomina gruppo"
                    onClick={(e) => { e.stopPropagation(); startRenameGroup(group.id, group.name); }}
                  >✎</button>
                  <button
                    style={{ ...S.iconBtn, color: "#f59e0b" }} title="Separa gruppo"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Separare il gruppo "${group.name}"? Gli oggetti torneranno alla radice.`)) {
                        ungroupObjects(group.id);
                      }
                    }}
                  >⊔</button>
                </div>
                {/* Group members */}
                {isExpanded && members.map((o) => renderObjectRow(o, 12))}
              </React.Fragment>
            );
          }
          return renderObjectRow(node.obj);
        })}
      </div>
    </Section>
  );
}

// ── Functions section ─────────────────────────────────────────────────────────
//
// Lists every project-level Python function. Click a row to open its editor
// in the right-side properties panel. Each row has inline rename, duplicate,
// and delete. After every CRUD verb we call `onFunctionsChanged()` so the
// host can persist the new list to PUT /api/project/functions.

function FunctionsSection({ onFunctionsChanged }: { onFunctionsChanged: () => void }) {
  const project          = useAppStore((s) => s.project);
  const selectedFnId     = useAppStore((s) => s.selectedFunctionId);
  const selectFunction   = useAppStore((s) => s.selectFunction);
  const addFunction      = useAppStore((s) => s.addFunction);
  const duplicateFunction = useAppStore((s) => s.duplicateFunction);
  const renameFunction   = useAppStore((s) => s.renameFunction);
  const deleteFunction   = useAppStore((s) => s.deleteFunction);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft]       = useState("");

  const functions = project?.functions ?? [];

  const handleAdd = () => {
    addFunction();
    onFunctionsChanged();
  };
  const handleDuplicate = (id: string) => {
    duplicateFunction(id);
    onFunctionsChanged();
  };
  const handleDelete = (id: string) => {
    deleteFunction(id);
    onFunctionsChanged();
  };
  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const commitRename = () => {
    if (renaming) {
      const next = draft.trim();
      if (next) renameFunction(renaming, next);
      onFunctionsChanged();
    }
    setRenaming(null);
    setDraft("");
  };

  return (
    <Section title={`FUNZIONI (${functions.length})`} defaultOpen={false}>
      <div style={{ ...S.body, maxHeight: 240 }}>
        {functions.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "#475569", margin: 0 }}>
            Nessuna funzione. Crea una funzione qui sotto e collegala agli
            eventi degli oggetti.
          </p>
        )}
        {functions.map((f) => {
          const isSel = f.id === selectedFnId;
          const isRen = f.id === renaming;
          return (
            <div
              key={f.id}
              onClick={() => !isRen && selectFunction(f.id)}
              style={{ ...S.row(isSel), gap: 4, paddingRight: 4 }}
              title={f.description ?? f.name}
            >
              <span style={{
                fontSize: 9, color: "#22c55e", width: 24, flexShrink: 0,
                textTransform: "uppercase", letterSpacing: 0.5,
              }}>
                fn
              </span>
              {isRen ? (
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") { setRenaming(null); setDraft(""); }
                  }}
                  style={{
                    flex: 1, minWidth: 0,
                    background: "#0f172a", color: "#e2e8f0",
                    border: "1px solid #334155", borderRadius: 3,
                    padding: "1px 4px", fontSize: 11,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(f.id, f.name); }}
                  style={{
                    flex: 1, minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontSize: 11,
                  }}
                >
                  {f.name}
                </span>
              )}
              <button
                style={S.iconBtn}
                title="Rinomina"
                onClick={(e) => { e.stopPropagation(); startRename(f.id, f.name); }}
              >✎</button>
              <button
                style={S.iconBtn}
                title="Duplica"
                onClick={(e) => { e.stopPropagation(); handleDuplicate(f.id); }}
              >⧉</button>
              <button
                style={{ ...S.iconBtn, color: "#ef4444" }}
                title="Elimina"
                onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
              >×</button>
            </div>
          );
        })}
        <div style={{ padding: "4px 8px" }}>
          <button
            onClick={handleAdd}
            style={{
              ...S.objBtn,
              flex: "none",
              width: "100%",
              borderStyle: "dashed",
              color: "#64748b",
            }}
          >
            + Nuova funzione
          </button>
        </div>
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

// ── Main LeftPanel export ─────────────────────────────────────────────────────

interface LeftPanelProps {
  onAddObject: (type: SynopticObject["type"]) => void;
  onFunctionsChanged: () => void;
}

export function LeftPanel({ onAddObject, onFunctionsChanged }: LeftPanelProps) {
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
        <ObjectsSection />
        <FunctionsSection onFunctionsChanged={onFunctionsChanged} />
        <TagsSection />
        <SourcesSection project={project} />
      </div>

      <HistorySection />
    </div>
  );
}

// ── History section (cronologia visuale) ──────────────────────────────────────

function HistorySection() {
  const past         = useAppStore((s) => s.past);
  const future       = useAppStore((s) => s.future);
  const undo         = useAppStore((s) => s.undo);
  const redo         = useAppStore((s) => s.redo);
  const jumpToPast   = useAppStore((s) => s.jumpToPast);
  const jumpToFuture = useAppStore((s) => s.jumpToFuture);

  const currentRef = useRef<HTMLDivElement>(null);
  const totalSteps = past.length + future.length;

  const [open, setOpen] = useState(true);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [past.length, future.length]);

  const btn = (enabled: boolean): React.CSSProperties => ({
    flex: 1,
    background: enabled ? "#0f172a" : "#1e293b",
    color: enabled ? "#cbd5e1" : "#475569",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "3px 0",
    cursor: enabled ? "pointer" : "not-allowed",
    fontSize: 11,
  });

  return (
    <div style={{ borderTop: "1px solid #334155", flexShrink: 0 }}>
      <div style={S.sectionHead(open)} onClick={() => setOpen((v) => !v)}>
        <span>CRONOLOGIA ({totalSteps} step)</span>
        <span style={S.chevron(open)}>▶</span>
      </div>
      {open && (
        <>
          <div style={{ overflowY: "auto", maxHeight: 180 }}>
            {/* Stato iniziale */}
            <div style={{ ...S.row(false), fontSize: 11, color: "#475569", fontStyle: "italic" }}>
              Stato iniziale
            </div>
            {/* Past entries — oldest to newest, clicking jumps to that state */}
            {past.map((entry, idx) => (
              <div
                key={idx}
                onClick={() => jumpToPast(idx)}
                style={{ ...S.row(false), fontSize: 11, paddingLeft: 16, cursor: "pointer" }}
                title={`Torna a: ${entry.label}`}
              >
                {entry.label}
              </div>
            ))}
            {/* Current marker */}
            <div
              ref={currentRef}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "3px 12px",
                background: "#134e4a",
                color: "#5eead4",
                fontSize: 11,
                fontWeight: 700,
                borderTop: "1px solid #0f3d38",
                borderBottom: "1px solid #0f3d38",
              }}
            >
              ▶ CORRENTE
            </div>
            {/* Future entries — next redo target first */}
            {future.map((entry, idx) => (
              <div
                key={idx}
                onClick={() => jumpToFuture(idx)}
                style={{
                  ...S.row(false),
                  fontSize: 11,
                  paddingLeft: 16,
                  cursor: "pointer",
                  opacity: 0.5,
                  fontStyle: "italic",
                }}
                title={`Ripristina: ${entry.label}`}
              >
                {entry.label}
              </div>
            ))}
          </div>
          <div style={{ padding: "5px 8px", display: "flex", gap: 5 }}>
            <button style={btn(past.length > 0)} onClick={undo} disabled={past.length === 0} title="Ctrl-Z">
              ↶ Annulla
            </button>
            <button style={btn(future.length > 0)} onClick={redo} disabled={future.length === 0} title="Ctrl-Y">
              ↷ Rifai
            </button>
          </div>
        </>
      )}
    </div>
  );
}
