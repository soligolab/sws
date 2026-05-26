import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AlarmEvent, AlarmSeverity } from "@/types";

const SEV_COLOR: Record<AlarmSeverity, string> = {
  Info:     "#3b82f6",
  Warning:  "#eab308",
  Critical: "#ef4444",
};

function fmtTs(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

interface AlarmHistoryProps {
  /** Narrow to a single alarm_id, or show all. */
  alarmId?: string;
}

const PAGE_SIZE = 50;

export function AlarmHistory({ alarmId }: AlarmHistoryProps) {
  const [events, setEvents] = useState<AlarmEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getAlarmHistory({
        alarm_id: alarmId,
        limit: PAGE_SIZE * (page + 1) + 1,
      });
      setEvents(data);
    } catch {
      // keep last data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [alarmId, page]);

  const visible = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasMore = events.length > (page + 1) * PAGE_SIZE;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.5 }}>
          STORICO ALLARMI {alarmId ? `— ${alarmId}` : ""}
        </span>
        <button
          onClick={() => { setPage(0); load(); }}
          style={{ fontSize: 10, background: "#1e293b", border: "1px solid #334155", color: "#64748b", borderRadius: 3, padding: "2px 8px", cursor: "pointer" }}
        >
          ↺ Aggiorna
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 16 }}>Caricamento…</div>
      ) : events.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 16 }}>Nessun evento registrato</div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#0f172a", color: "#64748b" }}>
                  {["Allarme", "Severità", "Attivato", "Confermato da", "Rientrato", "Durata"].map((h) => (
                    <th key={h} style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((ev, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#0f172a" : "#0a1120" }}>
                    <td style={{ padding: "3px 8px", color: "#cbd5e1" }}>
                      <div style={{ fontWeight: 600 }}>{ev.alarm_id}</div>
                      <div style={{ color: "#64748b", fontSize: 10 }}>{ev.alarm_message}</div>
                    </td>
                    <td style={{ padding: "3px 8px" }}>
                      <span style={{
                        background: SEV_COLOR[ev.severity] + "33",
                        color: SEV_COLOR[ev.severity],
                        padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600,
                      }}>
                        {ev.severity}
                      </span>
                    </td>
                    <td style={{ padding: "3px 8px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtTs(ev.ts_activated_ms)}</td>
                    <td style={{ padding: "3px 8px", color: "#94a3b8" }}>
                      {ev.ts_acked_ms ? (
                        <span>
                          <span style={{ color: "#22c55e" }}>{ev.acked_by ?? "—"}</span>
                          <span style={{ color: "#475569", fontSize: 10 }}> {fmtTs(ev.ts_acked_ms)}</span>
                        </span>
                      ) : (
                        <span style={{ color: "#ef4444" }}>Non confermato</span>
                      )}
                    </td>
                    <td style={{ padding: "3px 8px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {ev.ts_normalized_ms ? fmtTs(ev.ts_normalized_ms) : <span style={{ color: "#eab308" }}>Attivo</span>}
                    </td>
                    <td style={{ padding: "3px 8px", color: "#94a3b8" }}>{fmtDuration(ev.duration_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ fontSize: 11, padding: "2px 10px", background: "#1e293b", border: "1px solid #334155", color: page === 0 ? "#334155" : "#94a3b8", borderRadius: 3, cursor: page === 0 ? "default" : "pointer" }}
            >◀ Prec</button>
            <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>Pag. {page + 1}</span>
            <button
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
              style={{ fontSize: 11, padding: "2px 10px", background: "#1e293b", border: "1px solid #334155", color: !hasMore ? "#334155" : "#94a3b8", borderRadius: 3, cursor: !hasMore ? "default" : "pointer" }}
            >Succ ▶</button>
          </div>
        </>
      )}
    </div>
  );
}
