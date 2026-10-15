/** Il viewer tiene una sessione vera all'apertura (15-10-2026): prima la
 *  sostituiva sempre col sentinella `"no-auth"`, e un operatore che ricaricava
 *  la pagina non poteva più scrivere. */
import { describe, it, expect } from "vitest";
import { tokenDelViewer } from "../src/auth/sessioneViewer";

describe("tokenDelViewer", () => {
  it("una sessione vera riconosciuta si tiene", () => {
    expect(tokenDelViewer("eb9d81c8-a3c5", "admin")).toBe("eb9d81c8-a3c5");
  });
  it("una sessione che il server non riconosce più torna al sentinella", () => {
    expect(tokenDelViewer("eb9d81c8-a3c5", "")).toBe("no-auth");
  });
  it("senza sessione, o col sentinella, resta il sentinella", () => {
    expect(tokenDelViewer(null, "admin")).toBe("no-auth");
    expect(tokenDelViewer("no-auth", "admin")).toBe("no-auth");
    expect(tokenDelViewer(null, "")).toBe("no-auth");
  });
});
