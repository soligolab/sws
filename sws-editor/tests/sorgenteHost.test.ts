import { describe, it, expect } from "vitest";
import { metricheSenzaParametro, parametroRichiesto, senzaParametro, suggerimentiPer, HOST_METRICS } from "../src/config/sorgenteHost";
import type { HostSource } from "../src/types";

/** Una metrica Host senza il suo parametro resta Bad sul dispositivo, e fino
 *  al 21-09-2026 l'editor non lo diceva (due `temp` senza zona termica sul
 *  WP630, tag a 0 e Bad). Qui la regola che lo segnala. */
describe("sorgente Host — il parametro che manca", () => {
  it("sa quali metriche vogliono un parametro, come il plugin Rust", () => {
    expect(parametroRichiesto("temp")).toBe("temp");
    expect(parametroRichiesto("disk_used_pct")).toBe("mount");
    expect(parametroRichiesto("net_rx_bps")).toBe("iface");
    expect(parametroRichiesto("cpu_core_pct")).toBe("core");
    expect(parametroRichiesto("cpu_pct")).toBeUndefined();
    expect(parametroRichiesto("hostname")).toBeUndefined();
  });

  it("una temp senza zona è senza parametro; uno spazio non conta", () => {
    expect(senzaParametro({ tag: "t", metric: "temp" })).toBe(true);
    expect(senzaParametro({ tag: "t", metric: "temp", param: "  " })).toBe(true);
    expect(senzaParametro({ tag: "t", metric: "temp", param: "soc-thermal" })).toBe(false);
    expect(senzaParametro({ tag: "t", metric: "cpu_pct" })).toBe(false);
  });

  it("conta le metriche che resteranno Bad", () => {
    const s: HostSource = {
      kind: "host", id: "h", poll_interval_ms: 1000,
      metrics: [
        { tag: "host.Temeprature1", metric: "temp" },
        { tag: "host.Temeprature2", metric: "temp" },
        { tag: "host.cpu", metric: "cpu_pct" },
        { tag: "host.disk", metric: "disk_used_pct", param: "/" },
      ],
    };
    expect(metricheSenzaParametro(s)).toBe(2);
  });

  it("i suggerimenti vengono dal catalogo della macchina giusta", () => {
    const c = { temperature: ["soc-thermal", "gpu-thermal"], mount: ["/"], interfacce: ["eth0"], core: 2 };
    expect(suggerimentiPer(c, "temp")).toEqual(["soc-thermal", "gpu-thermal"]);
    expect(suggerimentiPer(c, "core")).toEqual(["0", "1"]);
    expect(suggerimentiPer(null, "temp")).toEqual([]);
    expect(suggerimentiPer(c, undefined)).toEqual([]);
  });

  it("ogni metrica dichiarata è una sola volta", () => {
    const nomi = HOST_METRICS.map((m) => m.metric);
    expect(new Set(nomi).size).toBe(nomi.length);
  });
});
