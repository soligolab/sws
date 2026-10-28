/** Quanto spesso un trend ricarica lo storico (28-10-2026).
 *
 *  Misura che ha prodotto la regola: ~17 richieste `/api/history` al secondo
 *  da una sola scheda del browser, alcune da 24 ore di storico, ogni due
 *  secondi, per sempre. */
import { describe, expect, it } from "vitest";
import { periodoPolling } from "@/canvas/TrendCanvas";

describe("periodo di polling di un trend", () => {
  it("una finestra breve resta al `pollMs` chiesto", () => {
    // 60 s su 600 px: un pixel vale 100 ms, molto meno dei 2 s.
    expect(periodoPolling(2000, 60, 600)).toBe(2000);
  });

  it("24 ore su 600 px non si ricaricano ogni due secondi", () => {
    // Un pixel vale 144 s; il tetto di un minuto vince.
    expect(periodoPolling(2000, 86400, 600)).toBe(60_000);
  });

  it("il tetto è un minuto, anche su trenta giorni", () => {
    expect(periodoPolling(2000, 30 * 86400, 600)).toBe(60_000);
  });

  it("non scende mai sotto il `pollMs` chiesto", () => {
    expect(periodoPolling(5000, 10, 600)).toBe(5000);
  });

  it("una larghezza assurda non fa dividere per zero", () => {
    expect(periodoPolling(2000, 3600, 0)).toBe(30_000);
  });
});
