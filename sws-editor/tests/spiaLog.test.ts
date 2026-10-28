/** La spia degli errori del log: cosa conta, e quando torna a zero.
 *
 *  Nasce il 28-10-2026 dal 401 del relay verso `wp630-ufficio`, che è rimasto
 *  per ore in un cassetto che nessuno apre. Si provano i contatori, non il
 *  disegno: è lì che sta la regola. */
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";

const riga = (level: LogEvent["level"], ts_ms: number): LogEvent =>
  ({ ts_ms, level, target: "sws_web::remote", message: "x" });

describe("spia del log", () => {
  beforeEach(() => {
    useAppStore.getState().clearLogs();
  });

  it("conta errori e avvisi che arrivano dal vivo", () => {
    const { appendLog } = useAppStore.getState();
    appendLog(riga("ERROR", 1000));
    appendLog(riga("WARN", 1100));
    appendLog(riga("WARN", 1200));
    const v = useAppStore.getState().logNonVisti;
    expect(v.errori).toBe(1);
    expect(v.avvisi).toBe(2);
  });

  it("non conta INFO, DEBUG e TRACE — e non tocca nemmeno l'oggetto", () => {
    const { appendLog } = useAppStore.getState();
    const prima = useAppStore.getState().logNonVisti;
    appendLog(riga("INFO", 1000));
    appendLog(riga("DEBUG", 1100));
    appendLog(riga("TRACE", 1200));
    // Stessa identità: la spia lo osserva così, e un oggetto nuovo a ogni
    // riga INFO la farebbe ridisegnare a ogni riga di log.
    expect(useAppStore.getState().logNonVisti).toBe(prima);
    expect(useAppStore.getState().logs).toHaveLength(3);
  });

  it("tiene il `ts` della **prima** riga non vista, per aprirci sopra il log", () => {
    const { appendLog } = useAppStore.getState();
    appendLog(riga("WARN", 500));
    appendLog(riga("ERROR", 1000));
    appendLog(riga("ERROR", 2000));
    const v = useAppStore.getState().logNonVisti;
    expect(v.primoErroreTs).toBe(1000);
    expect(v.primoAvvisoTs).toBe(500);
  });

  it("guardare il log azzera la spia ma non cancella le righe", () => {
    const { appendLog, segnaLogVisti } = useAppStore.getState();
    appendLog(riga("ERROR", 1000));
    segnaLogVisti();
    expect(useAppStore.getState().logNonVisti).toEqual({
      errori: 0, avvisi: 0, primoErroreTs: null, primoAvvisoTs: null,
    });
    expect(useAppStore.getState().logs).toHaveLength(1);
  });

  it("l'istantanea iniziale non accende la spia: è la storia di prima", () => {
    useAppStore.getState().setLogs([riga("ERROR", 10), riga("WARN", 20)]);
    expect(useAppStore.getState().logNonVisti.errori).toBe(0);
    expect(useAppStore.getState().logs).toHaveLength(2);
  });
});
