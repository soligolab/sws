/** Un dispositivo completo dal catalogo dei dispositivi noti (04-10-2026,
 *  piano `docs/plans/2026-10-04-catalogo-dispositivi.md`).
 *
 *  Una voce del catalogo (un modello, es. Pixsys ATR244) diventa tre cose:
 *  - un **tipo** per il modello (`pixsys_atr244`), un membro per registro e un
 *    membro bool per ogni bit delle word: due ATR244 lo condividono;
 *  - una **variabile** istanza di quel tipo (`atr244_3`);
 *  - un **dispositivo** del bus con una mappatura per membro (`atr244_3.pv1` →
 *    registro 1000, formato i16, scala 0.1), l'ordine e il timeout della voce.
 *
 *  Il tipo ha **tutti** i registri del modello; i gruppi scelti dicono solo
 *  quali si leggono. Così il tipo è lo stesso per ogni dispositivo di quel
 *  modello, qualunque cosa si sia spuntato.
 */
import type {
  DispositivoModbus, Membro, RegisterMapping, RegistroCatalogo, TagDataType, TagDef, TestoIt, TypeDef, VoceCatalogo,
} from "@/types";
import { type BusModbus, nuovoDispositivo } from "@/config/sorgenti/modbusDispositivi";
import { api } from "@/api/client";

export interface OpzioniCatalogo {
  unit: number;
  /** Il nome della variabile istanza. */
  nome: string;
  /** I gruppi di registri da leggere. */
  gruppi: ReadonlySet<string>;
  lingua: "it" | "en";
}

export interface Avviso {
  chiave: string;
  valori?: Record<string, string | number>;
}

export interface DaCatalogo {
  tipo: TypeDef;
  /** Il tipo c'era già, uguale: non va salvato di nuovo. */
  riusaTipo: boolean;
  tag: TagDef;
  dispositivo: DispositivoModbus;
  avvisi: Avviso[];
}

export const GRUPPO_SENZA_NOME = "altro";

export const gruppoDi = (r: RegistroCatalogo) => r.gruppo || GRUPPO_SENZA_NOME;

/** I gruppi della voce, nell'ordine in cui compaiono, con lo stato iniziale
 *  della spunta: un gruppo è spuntato se almeno un suo registro non dice
 *  `predefinito: false`. */
export function gruppiDi(voce: VoceCatalogo): { nome: string; predefinito: boolean; n: number }[] {
  const out: { nome: string; predefinito: boolean; n: number }[] = [];
  for (const r of voce.registri) {
    const g = gruppoDi(r);
    let v = out.find((x) => x.nome === g);
    if (!v) out.push((v = { nome: g, predefinito: false, n: 0 }));
    v.n += r.bit ? r.bit.length : 1;
    if (r.predefinito !== false) v.predefinito = true;
  }
  return out;
}

/** `pixsys/atr244` → `pixsys_atr244`. */
export function idTipoDaVoce(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

/** `pixsys/atr244` → `atr244`, la base del nome dell'istanza. */
export function baseIstanza(id: string): string {
  return idTipoDaVoce(id.split("/").pop() ?? id);
}

const testo = (t: TestoIt | undefined, lingua: "it" | "en") => (t ? t[lingua] || t.it : undefined);

/** Il tipo del membro: quello dichiarato, o `f32` se c'è una scala, o il formato. */
function tipoMembro(r: RegistroCatalogo): string {
  if (r.tipo) return r.tipo;
  if (r.scala !== undefined && r.scala !== 1) return "f32";
  return r.formato ?? "u16";
}

/** I decimali da mostrare, dalla scala (0.1 → 1, 0.01 → 2). */
function decimaliDa(scala: number | undefined): number | undefined {
  if (scala === undefined || scala >= 1 || scala <= 0) return undefined;
  return Math.min(6, Math.round(-Math.log10(scala)));
}

function membri(voce: VoceCatalogo, lingua: "it" | "en"): Membro[] {
  const out: Membro[] = [];
  for (const r of voce.registri) {
    if (r.bit) {
      for (const b of r.bit) {
        out.push({ name: b.nome, data_type: "bool" as TagDataType, description: testo(b.descrizione, lingua) });
      }
      continue;
    }
    const m: Membro = { name: r.nome, data_type: tipoMembro(r) as TagDataType };
    const d = testo(r.descrizione, lingua);
    if (d) m.description = d;
    if (r.unita) m.unit = r.unita;
    const dec = decimaliDa(r.scala);
    if (dec !== undefined) m.decimals = dec;
    out.push(m);
  }
  return out;
}

function mappature(voce: VoceCatalogo, istanza: string, gruppi: ReadonlySet<string>): RegisterMapping[] {
  const out: RegisterMapping[] = [];
  for (const r of voce.registri) {
    if (!gruppi.has(gruppoDi(r))) continue;
    const base = {
      address: r.indirizzo,
      ...(r.area && r.area !== "holding" ? { area: r.area } : {}),
      ...(r.accesso === "r" ? { sola_lettura: true } : {}),
    };
    if (r.bit) {
      for (const b of r.bit) out.push({ tag: `${istanza}.${b.nome}`, scale: 1, bit: b.bit, ...base });
    } else {
      out.push({ tag: `${istanza}.${r.nome}`, scale: r.scala ?? 1, formato: r.formato ?? "u16", ...base });
    }
  }
  return out;
}

const uguali = (a: Membro[], b: Membro[]) => JSON.stringify(a) === JSON.stringify(b);

export function daCatalogo(voce: VoceCatalogo, bus: BusModbus, o: OpzioniCatalogo, tipiEsistenti: readonly TypeDef[]): DaCatalogo {
  const avvisi: Avviso[] = [];
  const ms = membri(voce, o.lingua);
  const base = idTipoDaVoce(voce.id);
  // Il tipo del modello: riusato se c'è già uguale; se c'è diverso (una voce
  // corretta dopo, o modificato a mano) se ne crea uno accanto, per non
  // cambiare sotto i piedi i dispositivi che già lo usano.
  let tipoId = base;
  let riusaTipo = false;
  for (let n = 1; ; n++) {
    const c = n === 1 ? base : `${base}_v${voce.versione ?? 1}${n > 2 ? `_${n - 1}` : ""}`;
    const esiste = tipiEsistenti.find((t) => t.id === c);
    if (!esiste) { tipoId = c; break; }
    if (uguali(esiste.members, ms)) { tipoId = c; riusaTipo = true; break; }
  }
  if (tipoId !== base) avvisi.push({ chiave: "catalogo.avvisoTipoNuovo", valori: { tipo: tipoId, base } });

  const tipo: TypeDef = {
    id: tipoId,
    description: `${voce.marca} ${voce.modello}${testo(voce.descrizione, o.lingua) ? ` — ${testo(voce.descrizione, o.lingua)}` : ""}`,
    members: ms,
  };
  const tag: TagDef = { id: o.nome, description: `${voce.marca} ${voce.modello}`, type_ref: tipoId, history: false } as TagDef;

  const d = nuovoDispositivo(bus, {
    nome: o.nome,
    modello: `${voce.id}@${voce.versione ?? 1}`,
    ...(voce.modbus?.ordine && voce.modbus.ordine !== "abcd" ? { ordine: voce.modbus.ordine } : {}),
    ...(voce.modbus?.timeout_ms ? { timeout_ms: voce.modbus.timeout_ms } : {}),
    registers: mappature(voce, o.nome, o.gruppi),
  });
  const dispositivo: DispositivoModbus = { ...d, unit_id: o.unit };

  // Su una linea seriale: il modello che non è seriale, o parametri diversi.
  if (bus.kind === "modbus_rtu") {
    const s = voce.modbus?.seriale;
    if (!s) avvisi.push({ chiave: "catalogo.avvisoNonSeriale" });
    else if (s.baud_rate !== bus.baud_rate || s.parity !== bus.parity || s.data_bits !== bus.data_bits || s.stop_bits !== bus.stop_bits) {
      avvisi.push({ chiave: "catalogo.avvisoSeriale", valori: { voce: `${s.baud_rate} ${s.data_bits}${s.parity}${s.stop_bits}`, bus: `${bus.baud_rate} ${bus.data_bits}${bus.parity}${bus.stop_bits}` } });
    }
  }
  if (voce.fuori_produzione) avvisi.push({ chiave: "catalogo.avvisoFuoriProduzione" });
  return { tipo, riusaTipo, tag, dispositivo, avvisi };
}

/** Il nome proposto per la variabile: `atr244_3` (modello e unit id); se c'è
 *  già, `atr244_3_2`, `_3`… — mai `atr244_32`, che sembrerebbe l'unit 32. */
export function nomeProposto(id: string, unit: number, esistenti: readonly string[]): string {
  const base = `${baseIstanza(id)}_${unit}`;
  if (!esistenti.includes(base)) return base;
  let n = 2;
  while (esistenti.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** L'URL dell'icona di una voce, o `null`. */
export function urlImmagine(voce: { id: string; immagine?: string }): string | null {
  if (!voce.immagine) return null;
  return api.urlFileCatalogo(voce.id.split("/")[0], voce.immagine);
}
