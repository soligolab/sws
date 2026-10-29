import { describe, it, expect } from "vitest";
import { prefissoGateway, prefissoSchermo, progettoDalPercorso } from "@/api/prefisso";
import { pannelloDelTunnel } from "@/components/ViewerLink";

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

/** Lo schermo di un pannello aperto dal cloud (29-10-2026). */
describe("prefissoSchermo", () => {
  it("riconosce lo schermo di un pannello", () => {
    expect(prefissoSchermo("/schermo/tc620-garage/")).toBe("/schermo/tc620-garage");
    expect(prefissoSchermo("/schermo/tc620-garage")).toBe("/schermo/tc620-garage");
    expect(prefissoSchermo("/schermo/tc620-garage/assets/main.js")).toBe("/schermo/tc620-garage");
  });

  it("non si confonde col gateway né con la radice", () => {
    expect(prefissoSchermo("/")).toBe("");
    expect(prefissoSchermo("/p/acme/impianto/")).toBe("");
    expect(prefissoSchermo("/schermo/")).toBe("");
    expect(prefissoSchermo("/schermi/x/")).toBe("");
    // Il viewer servito dal pannello in rete locale non ha prefisso.
    expect(prefissoGateway("/schermo/tc620-garage/")).toBe("");
  });
});

describe("pannelloDelTunnel", () => {
  const origine = "https://sws.soligo.net";
  it("riconosce un pannello raggiunto attraverso questo stesso sito", () => {
    expect(pannelloDelTunnel("https://sws.soligo.net/dev/tc620-garage", origine)).toBe("tc620-garage");
    expect(pannelloDelTunnel("https://sws.soligo.net/dev/tc620-garage/", origine)).toBe("tc620-garage");
  });

  it("un runtime con la sua porta non è uno schermo remoto", () => {
    expect(pannelloDelTunnel("https://192.168.1.50:7444", origine)).toBeNull();
    expect(pannelloDelTunnel("https://altro.example/dev/x", origine)).toBeNull();
    expect(pannelloDelTunnel("https://sws.soligo.net/dev/x/api", origine)).toBeNull();
    expect(pannelloDelTunnel(null, origine)).toBeNull();
    expect(pannelloDelTunnel("non un indirizzo", origine)).toBeNull();
  });
});
