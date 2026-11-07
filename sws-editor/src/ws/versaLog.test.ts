import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEvent } from "@/types";
import { creaVersatore, OGNI_MS } from "./versaLog";

const riga = (ts: number, message: string, fields: Record<string, unknown> = {}): LogEvent =>
  ({ ts_ms: ts, level: "INFO", target: "t", message, fields } as LogEvent);

describe("versatore del log (07-11-2026)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("versa mille righe in un blocco solo, non mille volte", () => {
    const versa = vi.fn();
    const v = creaVersatore(versa, () => {});
    for (let i = 0; i < 1000; i++) v.metti(riga(i, `r${i}`));
    expect(versa).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OGNI_MS);
    expect(versa).toHaveBeenCalledTimes(1);
    expect(versa.mock.calls[0][0]).toHaveLength(1000);
  });

  it("scarta l'anello rimandato a una riconnessione, tiene le righe nuove", () => {
    const versate: LogEvent[] = [];
    const v = creaVersatore((evs) => versate.push(...evs), () => {});
    v.metti(riga(1, "a"));
    v.metti(riga(2, "b"));
    v.metti(riga(2, "c"));
    // Il socket si riapre: il server rimanda tutto, poi una riga nuova.
    v.metti(riga(1, "a"));
    v.metti(riga(2, "b"));
    v.metti(riga(2, "c"));
    v.metti(riga(2, "d"));
    v.metti(riga(3, "e"));
    v.ferma();
    expect(versate.map((e) => e.message)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("una riga registro_riparte svuota l'elenco e il blocco riparte da lei", () => {
    const versate: LogEvent[] = [];
    const azzera = vi.fn(() => { versate.length = 0; });
    const v = creaVersatore((evs) => versate.push(...evs), azzera);
    v.metti(riga(10, "vecchio"));
    vi.advanceTimersByTime(OGNI_MS);
    v.metti(riga(11, "ancora vecchio"));
    v.metti(riga(5, "— progetto aperto —", { registro_riparte: true }));
    v.metti(riga(6, "nuovo"));
    vi.advanceTimersByTime(OGNI_MS);
    expect(azzera).toHaveBeenCalledTimes(1);
    expect(versate.map((e) => e.message)).toEqual(["— progetto aperto —", "nuovo"]);
  });
});

describe("il filtro del log che esclude (07-11-2026)", async () => {
  const { filtroLog } = await import("@/components/LogPanel");
  it("-parola toglie le righe che la contengono, il resto si cerca come prima", () => {
    const f = filtroLog("salva -modbus");
    expect(f.cerca).toBe("salva");
    expect(f.passa("progetto salvato")).toBe(true);
    expect(f.passa("modbus: salvato")).toBe(false);
    const solo = filtroLog("-inverter-zcs");
    expect(solo.passa("tc620:sws_plugin_modbus")).toBe(true);
    expect(solo.passa("inverter-zcs non risponde")).toBe(false);
    expect(filtroLog("  ").vuoto).toBe(true);
    expect(filtroLog("-").passa("-")).toBe(true);
  });
});
