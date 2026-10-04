/** Bus e dispositivi Modbus (04-10-2026).
 *
 *  Una sorgente Modbus è un **bus** (una porta seriale, un indirizzo TCP) con
 *  dentro i suoi **dispositivi** (`devices`, uno per unit id). Il formato di
 *  prima — `unit_id`, `ordine` e `registers` sulla sorgente — si legge come un
 *  bus con un dispositivo, con la stessa regola del runtime
 *  (`ModbusTcpConfig::dispositivi` in `sws-core/src/project.rs`): con `devices`
 *  i campi di prima sono ignorati. La bozza passa al formato nuovo alla prima
 *  modifica di un dispositivo, non all'apertura: aprire un progetto vecchio non
 *  lo segna «modificato».
 */
import type { DispositivoModbus, ModbusRtuSource, ModbusTcpSource, SourceDef } from "@/types";

export type BusModbus = ModbusTcpSource | ModbusRtuSource;

export const TIMEOUT_MODBUS_MS = 3000;

export function eBusModbus(s: SourceDef): s is BusModbus {
  return s.kind === "modbus_tcp" || s.kind === "modbus_rtu";
}

/** I dispositivi del bus, col formato di prima letto come un dispositivo. */
export function dispositiviDi(bus: BusModbus): DispositivoModbus[] {
  // Un dispositivo senza mappature arriva dal server **senza** `registers` (il
  // runtime omette le liste vuote): l'IDE lo vuole sempre come lista. Senza,
  // riaprire un progetto con un dispositivo appena aggiunto mandava in bianco
  // la pagina (collaudo del 04-10-2026).
  if (bus.devices && bus.devices.length > 0) {
    return bus.devices.every((d) => Array.isArray(d.registers))
      ? bus.devices
      : bus.devices.map((d) => (Array.isArray(d.registers) ? d : { ...d, registers: [] }));
  }
  const registers = bus.registers ?? [];
  if (registers.length === 0) return [];
  const d: DispositivoModbus = { unit_id: bus.unit_id ?? 1, registers };
  if (bus.ordine && bus.ordine !== "abcd") d.ordine = bus.ordine;
  return [d];
}

/** Il bus con questi dispositivi, nel formato nuovo: i campi di prima
 *  (`registers`, `ordine`) se ne vanno. */
export function conDispositivi<B extends BusModbus>(bus: B, devices: DispositivoModbus[]): B {
  const { registers: _r, ordine: _o, ...resto } = bus;
  return { ...resto, devices } as B;
}

/** Il più piccolo unit id libero nel bus (1..247, gli indirizzi Modbus validi). */
export function prossimoUnitId(bus: BusModbus): number {
  const usati = new Set(dispositiviDi(bus).map((d) => d.unit_id));
  for (let u = 1; u <= 247; u++) if (!usati.has(u)) return u;
  return 1;
}

/** Un dispositivo nuovo per il bus. `base` è il punto d'aggancio del futuro
 *  catalogo dei dispositivi noti (seme `docs/archive/2026-10-04-catalogo-dispositivi.md`):
 *  la voce scelta, senza unit id. Oggi è vuoto. */
export function nuovoDispositivo(bus: BusModbus, base?: Omit<DispositivoModbus, "unit_id">): DispositivoModbus {
  return {
    ...(base ?? {}),
    unit_id: prossimoUnitId(bus),
    registers: (base?.registers ?? []).map((r) => ({ ...r })),
  };
}

/** «inverter · 3», o «unit 3» senza nome. */
export function etichettaDispositivo(d: DispositivoModbus): string {
  return d.nome ? `${d.nome} · ${d.unit_id}` : `unit ${d.unit_id}`;
}

/** L'id di un dispositivo nell'albero della Configurazione: `<bus>/<unit>`. */
export function focusDispositivo(bus: string, unit: number): string {
  return `${bus}/${unit}`;
}

/** Il focus dell'albero letto contro le sorgenti: un bus, un dispositivo di
 *  un bus, o niente. Un id di sorgente vince sempre: una sorgente può
 *  chiamarsi `linea/2` senza che diventi il dispositivo 2 di `linea`. */
export function leggiFocus(
  focus: string | null,
  sources: readonly SourceDef[],
): { bus: string; unit: number | null } | null {
  if (focus === null) return null;
  if (sources.some((s) => s.id === focus)) return { bus: focus, unit: null };
  const i = focus.lastIndexOf("/");
  if (i <= 0) return null;
  const bus = focus.slice(0, i);
  const unit = Number(focus.slice(i + 1));
  const s = sources.find((x) => x.id === bus);
  if (!s || !eBusModbus(s) || !Number.isInteger(unit)) return null;
  return dispositiviDi(s).some((d) => d.unit_id === unit) ? { bus, unit } : null;
}

/** Tutti gli id che l'albero può scegliere nella scheda Protocolli: le
 *  sorgenti e i dispositivi dei bus Modbus. */
export function idElementiProtocolli(sources: readonly SourceDef[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    out.push(s.id);
    if (eBusModbus(s)) for (const d of dispositiviDi(s)) out.push(focusDispositivo(s.id, d.unit_id));
  }
  return out;
}
