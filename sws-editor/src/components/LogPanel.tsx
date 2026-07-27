import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { LogEvent, LogFileEntry, LogLevel } from "@/types";

const LEVELS: LogLevel[] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

const LEVEL_COLOR: Record<LogLevel, string> = {
  TRACE: "var(--brand-text-subtle, #64748b)",
  DEBUG: "#0ea5e9",
  INFO:  "var(--brand-success, #22c55e)",
  WARN:  "var(--brand-warning, #f59e0b)",
  ERROR: "var(--brand-danger, #ef4444)",
};

/** Default-enabled levels. TRACE/DEBUG off by default — too chatty. */
const DEFAULT_LEVELS = new Set<LogLevel>(["INFO", "WARN", "ERROR"]);

interface LogPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bottom-drawer log console. Streams via useLogStream() (registered in App).
 * Operator+ only. Filters are client-side: level checkboxes, target
 * substring, free-text search with `<mark>` highlight in messages.
 */
export function LogPanel({ open, onClose }: LogPanelProps) {
  const { t } = useTranslation();
  const authRole  = useAppStore((s) => s.authRole);
  const logs      = useAppStore((s) => s.logs);
  const clearLogs = useAppStore((s) => s.clearLogs);

  const [paused,       setPaused]       = useState(false);
  const [search,       setSearch]       = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [levels,       setLevels]       = useState<Set<LogLevel>>(DEFAULT_LEVELS);
  /** Frozen snapshot used while paused so the visible list stays still. */
  const [pausedSnapshot, setPausedSnapshot] = useState<LogEvent[]>([]);

  // ── Historical log browser ──────────────────────────────────────────
  const [logFiles,     setLogFiles]     = useState<LogFileEntry[]>([]);
  const [selDate,      setSelDate]      = useState<string>("");
  const [histEvents,   setHistEvents]   = useState<LogEvent[] | null>(null);
  const [histLoading,  setHistLoading]  = useState(false);
  const [histError,    setHistError]    = useState<string | null>(null);

  const isHistMode = histEvents !== null;

  useEffect(() => {
    if (!open) return;
    api.listLogFiles().then(setLogFiles).catch(() => setLogFiles([]));
  }, [open]);

  // Refresh file list whenever we switch back to live mode (a new file may
  // have been rotated in since the panel opened).
  const switchToLive = () => {
    setHistEvents(null);
    setHistError(null);
    api.listLogFiles().then(setLogFiles).catch(() => {});
  };

  const loadHistFile = async () => {
    if (!selDate) return;
    setHistLoading(true); setHistError(null);
    try {
      const events = await api.getLogFile(selDate);
      setHistEvents(events);
    } catch (e: any) {
      setHistError(e?.message ?? "Errore caricamento storico.");
    } finally {
      setHistLoading(false);
    }
  };

  useEffect(() => {
    if (paused) setPausedSnapshot(logs);
    // When un-paused we drop the snapshot — the visible list catches up
    // to whatever `logs` looks like now.
  }, [paused]);  // eslint-disable-line react-hooks/exhaustive-deps

  const source = isHistMode ? histEvents! : (paused ? pausedSnapshot : logs);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const t = targetFilter.trim().toLowerCase();
    return source.filter((ev) => {
      if (!levels.has(ev.level)) return false;
      if (t && !ev.target.toLowerCase().includes(t)) return false;
      if (s) {
        const hay =
          ev.message.toLowerCase() +
          "\n" +
          (ev.fields
            ? Object.entries(ev.fields)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")
                .toLowerCase()
            : "");
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [source, levels, search, targetFilter]);

  // Auto-scroll: only stick to the bottom when the user hasn't scrolled up.
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<boolean>(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickRef.current = nearBottom;
  };

  if (!open) return null;

  const isViewer = authRole === "Viewer";

  return (
    <div style={panelStyle}>
      {/* ── Header bar ───────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <strong style={{ fontSize: 12, color: isHistMode ? "var(--brand-warning, #f59e0b)" : "var(--brand-text, #e2e8f0)", letterSpacing: 0.5 }}>
          {isHistMode ? `LOG ${selDate}` : "LOG"}
        </strong>
        <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>
          {filtered.length}/{source.length}
        </span>

        {/* Historical file picker */}
        {logFiles.length > 0 && !isHistMode && (
          <>
            <select
              value={selDate}
              onChange={(e) => setSelDate(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer", maxWidth: 140 }}
            >
              <option value="">{t("logs.history")}</option>
              {logFiles.map((f) => (
                <option key={f.date} value={f.date}>
                  {f.date} ({(f.size_bytes / 1024).toFixed(0)} KB)
                </option>
              ))}
            </select>
            <button
              onClick={loadHistFile}
              disabled={!selDate || histLoading}
              style={btn("var(--brand-surface-2, #334155)")}
            >
              {histLoading ? "…" : t("logs.load")}
            </button>
          </>
        )}
        {isHistMode && (
          <button onClick={switchToLive} style={btn("#0f766e")}>
            ← Live
          </button>
        )}
        {histError && (
          <span style={{ color: "var(--brand-danger, #ef4444)", fontSize: 11 }}>{histError}</span>
        )}

        {!isHistMode && (
          <>
            <button onClick={() => setPaused((p) => !p)} style={btn(paused ? "#7e22ce" : "var(--brand-surface-2, #334155)")}>
              {paused ? "▶ Riprendi" : "⏸ Pausa"}
            </button>
            <button onClick={clearLogs} style={btn("var(--brand-surface-2, #334155)")}>
              Cancella
            </button>
          </>
        )}

        <button
          onClick={() => downloadAsJsonl(filtered, isHistMode ? selDate : todayLocalIso())}
          disabled={filtered.length === 0}
          title={t("logs.downloadTitle")}
          style={{ ...btn("var(--brand-surface-2, #334155)"), opacity: filtered.length === 0 ? 0.5 : 1 }}
        >
          ⬇ Scarica
        </button>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("logs.searchPlaceholder")}
          style={{ ...inputStyle, flex: 1, minWidth: 120 }}
        />
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder={t("logs.targetPlaceholder")}
          style={{ ...inputStyle, width: 160 }}
        />

        <div style={{ display: "flex", gap: 4 }}>
          {LEVELS.map((lv) => {
            const on = levels.has(lv);
            return (
              <button
                key={lv}
                onClick={() => {
                  const next = new Set(levels);
                  if (on) next.delete(lv); else next.add(lv);
                  setLevels(next);
                }}
                style={{
                  ...btn(on ? LEVEL_COLOR[lv] : "var(--brand-surface-2, #334155)"),
                  fontSize: 10,
                  padding: "3px 6px",
                  fontWeight: on ? 700 : 400,
                  color: on ? "var(--brand-bg, #0f172a)" : "var(--brand-text-muted, #94a3b8)",
                  opacity: on ? 1 : 0.7,
                }}
              >
                {lv}
              </button>
            );
          })}
        </div>

        <button onClick={onClose} title={t("logs.closeTitle")} style={btn("var(--brand-surface-2, #334155)")}>
          ✕
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      {isViewer ? (
        <div style={bodyEmpty}>
          Permesso insufficiente: il pannello log è disponibile da Operator in su.
        </div>
      ) : filtered.length === 0 ? (
        <div style={bodyEmpty}>
          {source.length === 0
            ? t("logs.empty")
            : t("logs.noMatch")}
        </div>
      ) : (
        <div ref={listRef} onScroll={onScroll} style={listStyle}>
          {filtered.map((ev, i) => (
            <LogRow key={`${ev.ts_ms}-${i}`} ev={ev} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRow({ ev, search }: { ev: LogEvent; search: string }) {
  const fieldEntries = ev.fields ? Object.entries(ev.fields) : [];
  return (
    <div style={rowStyle}>
      <span style={tsCell}>{formatTs(ev.ts_ms)}</span>
      <span style={{ ...lvCell, color: LEVEL_COLOR[ev.level] }}>{ev.level.padEnd(5)}</span>
      <span style={tgtCell}>{ev.target}</span>
      <span style={msgCell}>
        {highlight(ev.message, search)}
        {fieldEntries.length > 0 && (
          <span style={fieldsStyle}>
            {fieldEntries.map(([k, v]) => (
              <span key={k} style={fieldChip}>
                <span style={fieldKey}>{k}</span>
                <span style={fieldEq}>=</span>
                <span style={fieldVal}>{highlight(String(v), search)}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/** Wrap matches in <mark>. Empty search → return plain string. */
function highlight(text: string, search: string): React.ReactNode {
  const s = search.trim();
  if (!s) return text;
  const re = new RegExp(escapeRegex(s), "ig");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={parts.length} style={{ background: "#fde047", color: "#0f172a", padding: "0 1px" }}>
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) break;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const mmm = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

/** Current date as `YYYY-MM-DD` in the user's local timezone. Used as the
 *  filename hint when downloading live logs (the server's JSONL files
 *  are named `runtime-YYYY-MM-DD.jsonl` so we match that shape). */
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Serialise the given events as JSONL (one JSON object per line) and
 *  trigger a browser download. Uses Blob + an ephemeral anchor — no
 *  external library, no popup. */
function downloadAsJsonl(events: LogEvent[], dateTag: string): void {
  if (events.length === 0) return;
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sws-logs-${dateTag || "export"}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL once the browser has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Styles ────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  height: 240,
  flexShrink: 0,
  background: "var(--brand-bg, #0b1220)",
  borderTop: "1px solid var(--brand-surface-2, #334155)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  background: "var(--brand-bg, #0f172a)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
  flexShrink: 0,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.4,
  padding: "4px 0",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "1px 8px",
  whiteSpace: "nowrap",
  color: "var(--brand-text-2, #cbd5e1)",
};

const tsCell: React.CSSProperties = {
  color: "var(--brand-text-subtle, #64748b)",
  width: 92,
  flexShrink: 0,
};

const lvCell: React.CSSProperties = {
  width: 48,
  flexShrink: 0,
  fontWeight: 700,
};

const tgtCell: React.CSSProperties = {
  color: "var(--brand-text-muted, #94a3b8)",
  width: 180,
  flexShrink: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const msgCell: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  flex: 1,
};

const fieldsStyle: React.CSSProperties = {
  marginLeft: 8,
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 6,
};

const fieldChip: React.CSSProperties = {
  fontSize: 11,
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 3,
  padding: "0 5px",
  whiteSpace: "nowrap",
};

const fieldKey: React.CSSProperties = {
  color: "var(--brand-text-muted, #94a3b8)",
};

const fieldEq: React.CSSProperties = {
  color: "var(--brand-text-subtle, #64748b)",
  margin: "0 2px",
};

const fieldVal: React.CSSProperties = {
  color: "var(--brand-text, #e2e8f0)",
};

const bodyEmpty: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--brand-text-subtle, #64748b)",
  fontSize: 12,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 12,
  fontFamily: "inherit",
};

function btn(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 11,
    whiteSpace: "nowrap",
  };
}
