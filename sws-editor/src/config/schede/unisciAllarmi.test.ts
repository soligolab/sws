import { describe, expect, it } from "vitest";
import { unisciAllarmi } from "./unisciAllarmi";
import type { AlarmDef } from "@/types";

// Il caso di CasaDomotica: due allarmi vecchi sullo stesso tag.
const on: AlarmDef = { id: "sandokan_power_on", tag: "sandokan.power", condition: { kind: "above", threshold: 1 }, message: "acceso", severity: "Info", dead_band: 0.3 };
const off: AlarmDef = { id: "sandokan_power_off", tag: "sandokan.power", condition: { kind: "below", threshold: 0.1 }, message: "spento", severity: "Info", dead_band: 0.05 };

describe("unisciAllarmi", () => {
  it("le soglie dell'altro diventano livelli, ognuna con i suoi campi", () => {
    const { unito, perse } = unisciAllarmi(on, [off]);
    expect(unito.id).toBe("sandokan_power_on");
    expect(unito.condition).toBeUndefined();
    expect(unito.levels).toEqual([
      { condition: { kind: "above", threshold: 1 }, severity: "Info", message: "acceso", dead_band: 0.3 },
      { condition: { kind: "below", threshold: 0.1 }, severity: "Info", message: "spento", dead_band: 0.05 },
    ]);
    expect(perse).toEqual([]);
  });

  it("dice quali impostazioni dell'allarme tolto si perdono", () => {
    const { perse } = unisciAllarmi(on, [{ ...off, on_delay_s: 5, telegram_mode: "off" }]);
    expect(perse).toEqual([{ id: "sandokan_power_off", campi: ["on_delay_s", "telegram_mode"] }]);
  });

  it("un allarme già a livelli tiene i suoi", () => {
    const nuovo: AlarmDef = { id: "a", tag: "t", levels: [{ condition: { kind: "above", threshold: 9 }, severity: "Critical" }] };
    expect(unisciAllarmi(nuovo, [off]).unito.levels?.length).toBe(2);
  });
});
