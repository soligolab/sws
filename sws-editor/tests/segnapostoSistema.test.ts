/** `{{sys:nome}}` (12-11-2026): la parola di sistema nella lingua dei
 *  contenuti, anche in un progetto senza tabella delle lingue. */
import { describe, expect, it } from "vitest";
import { resolveMsg } from "../src/i18n/projectI18n";

describe("segnaposto di sistema", () => {
  it("si risolve con o senza tabella; un nome sconosciuto resta", () => {
    expect(resolveMsg("{{sys:velocita}}:", "it", null)).toBe("Velocità:");
    expect(resolveMsg("{{sys:guasto}}:", "en", null)).toBe("Fault:");
    expect(resolveMsg("{{sys:nonesiste}}", "it", null)).toBe("{{sys:nonesiste}}");
    expect(resolveMsg("{{t1}}", "it", null)).toBe("{{t1}}");
  });
});
