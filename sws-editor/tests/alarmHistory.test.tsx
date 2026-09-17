import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stesso schema di campoTestoTradotto.test.tsx: la spia va creata dentro la
// fabbrica di vi.mock, issata in cima al file prima delle costanti.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      getAlarmHistory: vi.fn(),
      getAuditTail: vi.fn(),
    },
  };
});

import { api, setForceLocalApi } from "@/api/client";
import { AlarmHistory } from "../src/components/AlarmHistory";
import { useAppStore } from "../src/store";
import type { AlarmEvent, AuditEntry } from "../src/types";

const getAlarmHistory = api.getAlarmHistory as unknown as ReturnType<typeof vi.fn>;
const getAuditTail = api.getAuditTail as unknown as ReturnType<typeof vi.fn>;

/** Un evento confermato — il caso che F7 parte B riguarda: `ts_acked_ms`
 *  impostato, quindi c'è qualcosa da cercare nell'audit. */
function eventoConfermato(overrides: Partial<AlarmEvent> = {}): AlarmEvent {
  return {
    alarm_id: "pompa_guasta",
    alarm_message: "Pompa guasta",
    severity: "Critical",
    ts_activated_ms: 1_000,
    ts_acked_ms: 2_000,
    ts_normalized_ms: null,
    duration_s: null,
    acked_by: "admin",
    ...overrides,
  };
}

function entryAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 1,
    ts_ms: 2_000,
    actor: "admin",
    action: "alarm.ack",
    detail: { alarm: "pompa_guasta", reason: "Guasto meccanico noto" },
    prev_hash: "0",
    hash: "1",
    ...overrides,
  };
}

beforeEach(() => {
  getAlarmHistory.mockReset();
  getAuditTail.mockReset();
  getAlarmHistory.mockResolvedValue([eventoConfermato()]);
  getAuditTail.mockResolvedValue([entryAudit()]);
  // Di default niente bundle IDE: chi non lo imposta esplicitamente sta
  // testando il caso "viewer operatori", quello dove /api/audit non esiste.
  setForceLocalApi(false);
});

afterEach(() => {
  setForceLocalApi(false);
});

describe("il rimando al motivo dell'ACK è per Admin, non per chiunque veda lo storico (F7 parte B)", () => {
  it("un Operator non vede nessuna icona: /api/audit è Admin-only, la campanella no", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Operator" });
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    expect(screen.queryByTitle("alarmHist.viewReason")).toBeNull();
  });

  it("un Admin sul viewer operatori non vede l'icona: /api/audit sta su un'altra porta", async () => {
    // Caso scoperto dal vivo (F7 parte B, 17-09-2026): AlarmHistory vive
    // anche sul viewer, che non forza mai il local API — anche un Admin lì
    // non può raggiungere /api/audit (404, non 401).
    useAppStore.setState({ authRole: "Admin" });
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    expect(screen.queryByTitle("alarmHist.viewReason")).toBeNull();
  });

  it("un Admin nel bundle IDE vede l'icona e, cliccandola, il motivo trovato nell'audit", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Admin" });
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());

    const bottone = screen.getByTitle("alarmHist.viewReason");
    fireEvent.click(bottone);

    await waitFor(() => expect(getAuditTail).toHaveBeenCalled());
    expect(await screen.findByText(/Guasto meccanico noto/)).toBeTruthy();
  });

  it("un evento non confermato non ha icona neanche per Admin: niente da cercare", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Admin" });
    getAlarmHistory.mockResolvedValue([
      eventoConfermato({ ts_acked_ms: null, acked_by: null }),
    ]);
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    expect(screen.queryByTitle("alarmHist.viewReason")).toBeNull();
  });

  it("nessuna entry nel tail: si dichiara non trovato, non un motivo vuoto per sbaglio", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Admin" });
    getAuditTail.mockResolvedValue([]);
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("alarmHist.viewReason"));
    expect(await screen.findByText("alarmHist.reasonNotFound")).toBeTruthy();
  });

  it("un ACK senza motivo registrato si distingue da un ACK non trovato affatto", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Admin" });
    getAuditTail.mockResolvedValue([entryAudit({ detail: { alarm: "pompa_guasta", reason: null } })]);
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("alarmHist.viewReason"));
    expect(await screen.findByText(/alarmHist.reasonLabel: alarmHist.noReason/)).toBeTruthy();
  });

  it("fra due ACK dello stesso allarme sceglie quello con il timestamp più vicino", async () => {
    setForceLocalApi(true);
    useAppStore.setState({ authRole: "Admin" });
    getAuditTail.mockResolvedValue([
      entryAudit({ seq: 1, ts_ms: 500, detail: { alarm: "pompa_guasta", reason: "vecchio" } }),
      entryAudit({ seq: 2, ts_ms: 2_000, detail: { alarm: "pompa_guasta", reason: "quello giusto" } }),
    ]);
    render(<AlarmHistory />);
    await waitFor(() => expect(getAlarmHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("alarmHist.viewReason"));
    expect(await screen.findByText(/quello giusto/)).toBeTruthy();
  });
});
