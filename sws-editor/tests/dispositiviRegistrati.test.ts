import { describe, expect, it } from "vitest";
import type { DiscoveredRuntime, DispositivoRete } from "../src/api/client";
import {
  chiaveUrl, dispositivoDaRete, dispositivoDaRuntime, eGiaInLista, leggiListaLegacy, preferisciMdns, unisciDispositivo,
} from "../src/config/dispositiviRegistrati";

describe("unisciDispositivo", () => {
  it("aggiunge in coda un URL nuovo e ripulisce spazi e slash", () => {
    const l = unisciDispositivo([], { label: " WP630 ", url: "https://wp630.local:8444/ ", user: " user " });
    expect(l).toEqual([{ label: "WP630", url: "https://wp630.local:8444", user: "user" }]);
  });
  it("sostituisce al suo posto lo stesso URL, maiuscole e slash a parte", () => {
    const base = [{ label: "a", url: "https://A:8444", user: "" }, { label: "b", url: "https://b:8444", user: "" }];
    const l = unisciDispositivo(base, { label: "A nuovo", url: "https://a:8444/", user: "x" });
    expect(l.map((d) => d.label)).toEqual(["A nuovo", "b"]);
    expect(eGiaInLista(base, "https://a:8444/")).toBe(true);
    expect(eGiaInLista(base, "https://c:8444")).toBe(false);
  });
  it("con etichetta vuota usa l'URL", () => {
    expect(unisciDispositivo([], { label: "", url: "https://h:8444", user: "" })[0].label).toBe("https://h:8444");
  });
  it("chiaveUrl normalizza", () => {
    expect(chiaveUrl("HTTPS://H:8444//")).toBe("https://h:8444");
  });
});

describe("dal discovery a un dispositivo", () => {
  const rete = (p: Partial<DispositivoRete>): DispositivoRete => ({
    hostname: "wp630.local", indirizzo: "192.168.1.50", servizi: ["ssh"],
    sws: { presente: false, versione: null, container: null, admin_url: null }, ...p,
  });
  it("con SWS presente prende l'URL annunciato, senza propone la 8444; in entrambi i casi col nome mDNS", () => {
    // L'indirizzo lo assegna il DHCP e cambia; il nome `.local` segue il
    // dispositivo. Una lista registrata per indirizzo invecchia da sola.
    expect(dispositivoDaRete(rete({ sws: { presente: true, versione: "2.7.1", container: "podman", admin_url: "http://192.168.1.50:8444" } })))
      .toEqual({ label: "wp630", url: "http://wp630.local:8444", user: "" });
    expect(dispositivoDaRete(rete({}))).toEqual({ label: "wp630", url: "https://wp630.local:8444", user: "" });
  });
  it("senza nome mDNS resta l'indirizzo, che è meglio di niente", () => {
    expect(dispositivoDaRete(rete({ hostname: "" }))).toEqual({ label: "192.168.1.50", url: "https://192.168.1.50:8444", user: "" });
  });
  it("da un runtime trovato da «Cerca runtime»", () => {
    const r: DiscoveredRuntime = { name: "x", hostname: "tc620.local", admin_url: "https://192.168.0.20:8444", viewer_url: "", version: "2.7.1", container: null };
    expect(dispositivoDaRuntime(r, "https://192.168.0.20:8444")).toEqual({ label: "tc620", url: "https://tc620.local:8444", user: "" });
  });
});

describe("leggiListaLegacy", () => {
  it("toglie il campo pass e tiene il resto", () => {
    const l = leggiListaLegacy(JSON.stringify([{ label: "PLC", url: "https://a:8444", user: "admin", pass: "segreta" }]));
    expect(l).toEqual([{ label: "PLC", url: "https://a:8444", user: "admin" }]);
    expect(JSON.stringify(l)).not.toContain("segreta");
  });
  it("con niente, o con spazzatura, lista vuota", () => {
    expect(leggiListaLegacy(null)).toEqual([]);
    expect(leggiListaLegacy("non json")).toEqual([]);
    expect(leggiListaLegacy(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(leggiListaLegacy(JSON.stringify([{ label: "senza url" }]))).toEqual([]);
  });
});

describe("preferisciMdns", () => {
  it("sostituisce l'indirizzo numerico col nome, tenendo schema e porta", () => {
    expect(preferisciMdns("http://192.168.1.61:8444", "wp630.local")).toBe("http://wp630.local:8444");
    expect(preferisciMdns("https://10.0.0.7:8444", "tc620.local")).toBe("https://tc620.local:8444");
  });

  it("un host che è già un nome non si tocca", () => {
    // Se il dispositivo annuncia un nome suo, quello è il suo: sovrascriverlo
    // col nome mDNS significherebbe decidere al posto di chi l'ha configurato.
    expect(preferisciMdns("https://pannello.azienda.lan:8444", "wp630.local"))
      .toBe("https://pannello.azienda.lan:8444");
  });

  it("senza nome, o con un URL che non si legge, resta tutto com'è", () => {
    expect(preferisciMdns("http://192.168.1.61:8444", "")).toBe("http://192.168.1.61:8444");
    expect(preferisciMdns("http://192.168.1.61:8444", null)).toBe("http://192.168.1.61:8444");
    expect(preferisciMdns("non-un-url", "wp630.local")).toBe("non-un-url");
  });

  it("non lascia lo slash finale che URL aggiunge da sé", () => {
    expect(preferisciMdns("http://192.168.1.61:8444", "wp630.local")).not.toMatch(/\/$/);
  });
});
