import { describe, it, expect } from "vitest";
import { prefissoGateway, progettoDalPercorso } from "@/api/prefisso";

describe("prefissoGateway", () => {
  it("riconosce un progetto servito dal gateway", () => {
    expect(prefissoGateway("/p/acme/impianto/")).toBe("/p/acme/impianto");
    expect(prefissoGateway("/p/acme/impianto")).toBe("/p/acme/impianto");
    expect(prefissoGateway("/p/acme/impianto/index-admin.html")).toBe("/p/acme/impianto");
  });

  it("fuori dal gateway non inventa prefissi", () => {
    // La console, il viewer e l'IDE locale: tutti alla radice.
    expect(prefissoGateway("/")).toBe("");
    expect(prefissoGateway("/index-console.html")).toBe("");
    expect(prefissoGateway("/assets/index-abc123.js")).toBe("");
    // Il prefisso senza progetto non apre niente: lo dice anche il gateway.
    expect(prefissoGateway("/p/acme")).toBe("");
  });

  it("dice azienda e progetto", () => {
    expect(progettoDalPercorso("/p/acme/impianto/api/x")).toEqual({
      azienda: "acme",
      progetto: "impianto",
    });
    expect(progettoDalPercorso("/")).toBeNull();
  });

  it("decodifica i nomi con caratteri da URL", () => {
    expect(progettoDalPercorso("/p/acme/linea%20uno/")).toEqual({
      azienda: "acme",
      progetto: "linea uno",
    });
  });
});
