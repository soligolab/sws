import { describe, expect, it } from "vitest";
import { worstSeverity } from "../src/alarmSound";

// F7.5 — quale tono suona quando ci sono più allarmi insieme: deve vincere il
// più grave, altrimenti un Critical arrivato dopo due Info suonerebbe come
// un'informazione.

describe("worstSeverity (F7.5)", () => {
  it("Critical vince su tutto", () => {
    expect(worstSeverity(["Info", "Critical", "Warning"])).toBe("Critical");
  });

  it("Warning vince su Info", () => {
    expect(worstSeverity(["Info", "Warning", "Info"])).toBe("Warning");
  });

  it("solo Info → Info", () => {
    expect(worstSeverity(["Info"])).toBe("Info");
  });

  it("elenco vuoto o severità assenti → nessun suono", () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([undefined, undefined])).toBeNull();
  });
});
