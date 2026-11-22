// A refusal with a code is shown in the user's language (collaudo of
// 2.26.0-rc.23: a function parameter called `state` came back as the raw
// «API /api/project/functions: 422 — …» in English).
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { erroreTradotto } from "@/api/client";

describe("erroreTradotto", () => {
  it("translates a known code with its fields, and leaves the rest alone", async () => {
    await i18n.changeLanguage("it");
    const m = erroreTradotto(JSON.stringify({
      error: "function 'f': param 'state' has the name…", code: "function_param_reserved", function: "f", param: "state",
    }));
    expect(m).toContain("«f»");
    expect(m).toContain("«state»");
    expect(m).toContain("Scegli un altro nome");
    expect(erroreTradotto(JSON.stringify({ code: "nessun_codice_cosi" }))).toBeNull();
    expect(erroreTradotto("testo semplice")).toBeNull();
    await i18n.changeLanguage("en");
    expect(erroreTradotto(JSON.stringify({ code: "function_param_underscore", function: "f", param: "_x" }))).toContain("reserved for the sandbox");
    await i18n.changeLanguage("it");
  });
});
