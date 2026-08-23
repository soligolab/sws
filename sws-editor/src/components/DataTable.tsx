import { useMemo, useState } from "react";

// ── DataTable ──────────────────────────────────────────────────────────────
//
// Componente tabella generico: sort per colonna (click sull'header, tre stati
// asc/desc/nessuno) + filtro per colonna (riga sotto l'header, testo o
// select). Nessuna virtualizzazione/paginazione: pensato per dataset piccoli
// (allarmi, ricette) — coerente con `AlarmHistory.tsx` che già pagina a 50.

export interface DataTableColumn<T> {
  key: string;
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
  render?: (row: T) => React.ReactNode;
  /** default true */
  sortable?: boolean;
  /** default true */
  filterable?: boolean;
  /** default "text" */
  filterType?: "text" | "select";
  filterOptions?: { value: string; label: string }[];
  width?: number | string;
  align?: "left" | "center" | "right";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  maxHeight?: number | string;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string;
  /** font/padding più stretti, per uso embedded nel canvas SCADA */
  compact?: boolean;
  /** F7.1 — corpo del testo esplicito (vince sul default di `compact`):
   *  la tabella del sinottico lo espone come proprietà dell'oggetto. */
  fontSize?: number;
  /** F7.1 — nasconde la riga dei filtri anche su colonne filtrabili (in una
   *  tabella piccola sul sinottico due righe di intestazione sono troppe). */
  hideFilters?: boolean;
}

type SortDir = "asc" | "desc";

export function DataTable<T>({
  columns, rows, rowKey, emptyLabel = "Nessun dato.", maxHeight, onRowClick, selectedRowKey, compact = false,
  fontSize: fontSizeProp, hideFilters = false,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); setSortDir("asc");
  };

  const filtered = useMemo(() => {
    let out = rows;
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      out = out.filter((r) => {
        const v = col.accessor(r);
        if (col.filterType === "select") return String(v ?? "") === f;
        return String(v ?? "").toLowerCase().includes(f.toLowerCase());
      });
    }
    return out;
  }, [rows, filters, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.accessor(a);
      const vb = col.accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const pad = compact ? "3px 6px" : "6px 10px";
  const fontSize = fontSizeProp ?? (compact ? 11 : 12);
  const hasFilters = !hideFilters && columns.some((c) => c.filterable !== false);

  return (
    <div style={{ overflow: "auto", maxHeight, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize }}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = col.sortable !== false;
              return (
                <th
                  key={col.key}
                  onClick={() => sortable && toggleSort(col.key)}
                  style={{
                    position: "sticky", top: 0, background: "var(--brand-surface, #1e293b)",
                    padding: pad, textAlign: col.align ?? "left", fontWeight: 600,
                    color: "var(--brand-text-muted, #94a3b8)", borderBottom: "1px solid var(--brand-surface-2, #334155)",
                    cursor: sortable ? "pointer" : "default",
                    width: col.width, whiteSpace: "nowrap", userSelect: "none",
                  }}
                >
                  {col.header}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              );
            })}
          </tr>
          {hasFilters && (
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ padding: "2px 4px", background: "var(--brand-bg, #0f172a)", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                  {col.filterable === false ? null : col.filterType === "select" ? (
                    <select
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      style={{ width: "100%", fontSize: fontSize - 1, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "1px 2px", boxSizing: "border-box" }}
                    >
                      <option value="">—</option>
                      {(col.filterOptions ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      style={{ width: "100%", fontSize: fontSize - 1, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "1px 4px", boxSizing: "border-box" }}
                    />
                  )}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 16, textAlign: "center", color: "var(--brand-border, #475569)" }}>
                {emptyLabel}
              </td>
            </tr>
          ) : sorted.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(row)}
                style={{
                  cursor: onRowClick ? "pointer" : "default",
                  background: selectedRowKey === key ? "#1e3a5f" : "transparent",
                  borderBottom: "1px solid var(--brand-surface, #1e293b)",
                }}
              >
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: pad, textAlign: col.align ?? "left", color: "var(--brand-text-2, #cbd5e1)" }}>
                    {col.render ? col.render(row) : String(col.accessor(row) ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
