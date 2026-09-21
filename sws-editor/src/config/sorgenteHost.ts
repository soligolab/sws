// La sorgente «host»: quali metriche esistono, quali vogliono un parametro, e
// cosa succede se manca.
//
// Il 21-09-2026 due metriche `temp` sono state salvate senza zona termica: il
// plugin non sa quale `thermal_zone` leggere, marca il tag Bad e lo dice solo
// con un `warn` nel registro del dispositivo. Nell'editor niente lo segnalava:
// il parametro era un campo libero con un suggerimento. Da qui la regola sta
// in un modulo suo, provabile senza montare il pannello.

import type { HostMetric, HostMetricMapping, HostSource } from "@/types";
import { genId } from "@/id";

export type ParametroHost = "core" | "temp" | "mount" | "iface";

export const HOST_METRICS: { metric: HostMetric; param?: ParametroHost; testo?: boolean; unit?: string }[] = [
  { metric: "cpu_pct", unit: "%" },
  { metric: "cpu_core_pct", param: "core", unit: "%" },
  { metric: "load1" }, { metric: "load5" }, { metric: "load15" },
  { metric: "mem_used_pct", unit: "%" }, { metric: "mem_used_mb", unit: "MB" },
  { metric: "mem_available_mb", unit: "MB" }, { metric: "mem_total_mb", unit: "MB" },
  { metric: "swap_used_pct", unit: "%" },
  { metric: "temp", param: "temp", unit: "°C" },
  { metric: "disk_used_pct", param: "mount", unit: "%" }, { metric: "disk_free_gb", param: "mount", unit: "GB" },
  { metric: "net_rx_bps", param: "iface", unit: "B/s" }, { metric: "net_tx_bps", param: "iface", unit: "B/s" },
  { metric: "uptime_s", unit: "s" },
  { metric: "hostname", testo: true }, { metric: "serial_number", testo: true }, { metric: "model", testo: true },
];

export function definizioneMetrica(m: HostMetric) {
  return HOST_METRICS.find((x) => x.metric === m);
}

/** Il parametro che questa metrica vuole (zona, mount, interfaccia, core), o
 *  `undefined` se non ne ha bisogno. Specchio di `leggi()` nel plugin Rust:
 *  lì `Temp`, `DiskUsedPct`, `DiskFreeGb`, `NetRxBps`, `NetTxBps` e
 *  `CpuCorePct` fanno `param?` e senza restituiscono `None` → tag Bad. */
export function parametroRichiesto(m: HostMetric): ParametroHost | undefined {
  return definizioneMetrica(m)?.param;
}

/** Vero se a questa metrica manca il parametro che le serve: il suo tag sul
 *  dispositivo resterà Bad. Uno spazio non è un parametro. */
export function senzaParametro(m: HostMetricMapping): boolean {
  return parametroRichiesto(m.metric) !== undefined && !(m.param ?? "").trim();
}

/** Quante metriche della sorgente resterebbero Bad per parametro mancante. */
export function metricheSenzaParametro(s: HostSource): number {
  return s.metrics.filter(senzaParametro).length;
}

export function emptyHost(): HostSource {
  return { kind: "host", id: `host-${genId()}`, poll_interval_ms: 2000, metrics: [] };
}

/** Il catalogo di una macchina: cosa si può mettere nel parametro. È la
 *  risposta di `/api/host/catalog` (questa macchina) e di
 *  `/api/remote/host/catalog` (il dispositivo connesso). */
export interface CatalogoHost {
  temperature: string[];
  mount: string[];
  interfacce: string[];
  core: number;
}

/** I valori da suggerire per un parametro, dal catalogo. */
export function suggerimentiPer(c: CatalogoHost | null, k: ParametroHost | undefined): string[] {
  if (!c || !k) return [];
  if (k === "temp") return c.temperature;
  if (k === "mount") return c.mount;
  if (k === "iface") return c.interfacce;
  return Array.from({ length: c.core }, (_, i) => String(i));
}
