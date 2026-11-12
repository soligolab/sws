/** Un valore «mai ricevuto» (12-11-2026): seminato dal runtime, incerto e con
 *  `timestamp_ms` a 0. Vale come nessun valore per chi disegna. */
import { describe, expect, it } from "vitest";
import { maiRicevuto } from "../src/canvas/maiRicevuto";

describe("mai ricevuto", () => {
  it("è la semina: incerto e ts 0", () => {
    expect(maiRicevuto({ value: false, quality: "Uncertain", timestamp_ms: 0 })).toBe(true);
    expect(maiRicevuto({ value: false, quality: "Uncertain", timestamp_ms: 5 })).toBe(false);
    expect(maiRicevuto({ value: true, quality: "Good", timestamp_ms: 0 })).toBe(false);
    expect(maiRicevuto(undefined)).toBe(false);
  });
});
