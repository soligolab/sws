import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { api } from "../src/api/client";
import { rispondi, type Richiesta } from "../src/finestraAvviso/finestraAvviso";
import { askCopyRepository, branchName } from "../src/components/copyRepository";

/** «Save as…» on a repository (plan 2026-11-21, branch 3). */
describe("what a copy does with the repository", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a project that is not a repository asks nothing", async () => {
    vi.spyOn(api, "getGitStatus").mockRejectedValue(new Error("404"));
    const auto = rispondi("branch");
    try {
      expect(await askCopyRepository("Copia")).toBeUndefined();
      expect(auto.chiamate).toHaveLength(0);
    } finally { auto.ferma(); }
  });

  it("a branch: the name comes from the copy and can be changed", async () => {
    vi.spyOn(api, "getGitStatus").mockResolvedValue({ branch: "main" } as never);
    const auto = rispondi((r: Richiesta) => r.tipo === "scegli" ? "branch" : `${(r as { iniziale?: string }).iniziale}-b`);
    try {
      expect(await askCopyRepository("Casa Montagna (copia)")).toEqual({ mode: "branch", name: "casa-montagna-copia-b" });
      expect((auto.chiamate[0] as { testo?: string }).testo).toContain("main");
    } finally { auto.ferma(); }
  });

  it("a new repository, or none, or cancelled", async () => {
    vi.spyOn(api, "getGitStatus").mockResolvedValue({ branch: "main" } as never);
    for (const [risposta, atteso] of [["new_repository", { mode: "new_repository" }], ["no_repository", { mode: "no_repository" }], [null, null]] as const) {
      const auto = rispondi(risposta);
      try { expect(await askCopyRepository("x")).toEqual(atteso); } finally { auto.ferma(); }
    }
  });

  it("branch names git accepts", () => {
    expect(branchName("Città Alta / prova..2")).toBe("citta-alta-prova.2");
    expect(branchName("---")).toBe("copy");
  });
});
