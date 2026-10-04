/** Un dispositivo completo dal catalogo dei dispositivi noti (04-10-2026,
 *  piano `docs/archive/2026-10-04-catalogo-dispositivi.md`).
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
  /** Riprende una variabile esistente (e il suo tipo) invece di crearne una:
   *  la riassociazione dopo aver eliminato il dispositivo e tenuto le variabili. */
  esistente?: { tag: TagDef; tipo: TypeDef };
}

export interface Avviso {
  chiave: string;
  valori?: Record<string, string | number>;
}

export interface DaCatalogo {
  /** Il tipo della variabile: un membro per gruppo, ognuno istanza del suo
   *  sotto-tipo (tipi annidati, 04-10-2026). */
  tipo: TypeDef;
  /** Tutti i tipi in gioco: i sotto-tipi dei gruppi e il tipo della variabile. */
  tipi: TypeDef[];
  /** I tipi da salvare (quelli che non c'erano già uguali). */
  tipiNuovi: TypeDef[];
  /** Nessun tipo da salvare. */
  riusaTipo: boolean;
  /** Quante variabili foglia avrà l'istanza. */
  foglie: number;
  tag: TagDef;
  /** La variabile c'era già (riassociazione): non va salvata. */
  riusaVariabile?: boolean;
  /** La variabile c'era già ma cambia tipo (riassociazione con gruppi in più):
   *  va salvata al posto della vecchia. */
  sostituisciVariabile?: boolean;
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

function membri(voce: VoceCatalogo, lingua: "it" | "en", gruppi?: ReadonlySet<string>): Membro[] {
  const out: Membro[] = [];
  for (const r of voce.registri) {
    if (gruppi && !gruppi.has(gruppoDi(r))) continue;
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

function mappature(voce: VoceCatalogo, istanza: string, gruppi: ReadonlySet<string>, membriDisponibili?: ReadonlySet<string>, piatto = false): RegisterMapping[] {
  const out: RegisterMapping[] = [];
  const ce = (nome: string) => !membriDisponibili || membriDisponibili.has(nome);
  for (const r of voce.registri) {
    if (!gruppi.has(gruppoDi(r))) continue;
    // Annidato: `istanza.gruppo.membro`; piatto (i tipi di prima): `istanza.membro`.
    const radice = piatto ? istanza : `${istanza}.${gruppoDi(r)}`;
    const base = {
      address: r.indirizzo,
      ...(r.area && r.area !== "holding" ? { area: r.area } : {}),
      ...(r.accesso === "r" ? { sola_lettura: true } : {}),
    };
    if (r.bit) {
      for (const b of r.bit) if (ce(b.nome)) out.push({ tag: `${radice}.${b.nome}`, scale: 1, bit: b.bit, ...base });
    } else if (ce(r.nome)) {
      out.push({ tag: `${radice}.${r.nome}`, scale: r.scala ?? 1, formato: r.formato ?? "u16", ...base });
    }
  }
  return out;
}

const uguali = (a: Membro[], b: Membro[]) => JSON.stringify(a) === JSON.stringify(b);

/** Un tipo per `id` con questi membri: riusato se c'è già uguale; se c'è
 *  diverso (una voce corretta dopo, o modificato a mano) se ne crea uno
 *  accanto (`_v<versione>`), per non cambiare sotto i piedi le variabili che
 *  già lo usano. */
function tipoDaRiusare(voce: VoceCatalogo, base: string, members: Membro[], description: string, tipiEsistenti: readonly TypeDef[]) {
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}_v${voce.versione ?? 1}${n > 2 ? `_${n - 1}` : ""}`;
    const esiste = tipiEsistenti.find((t) => t.id === id);
    if (!esiste) return { tipo: { id, description, members } as TypeDef, nuovo: true };
    if (uguali(esiste.members, members)) return { tipo: esiste, nuovo: false };
  }
}

/** I tipi per una scelta di gruppi (04-10-2026, scelte del maintainer: la
 *  variabile ha **solo** i gruppi spuntati, e i gruppi sono **tipi annidati**).
 *  Ogni gruppo è un sotto-tipo del modello, uguale per qualunque scelta
 *  (`pixsys_mcm260x_9ad__ingressi`); il tipo della variabile ha un membro per
 *  gruppo e il nome dice la scelta: `pixsys_mcm260x_9ad` con tutti i gruppi,
 *  `pixsys_mcm260x_9ad_ingressi` con i soli ingressi. Due dispositivi con la
 *  stessa scelta condividono il tipo. */
export function tipoPerGruppi(voce: VoceCatalogo, gruppi: ReadonlySet<string>, lingua: "it" | "en", tipiEsistenti: readonly TypeDef[]) {
  const avvisi: Avviso[] = [];
  const tutti = gruppiDi(voce).map((g) => g.nome);
  const scelti = tutti.filter((g) => gruppi.has(g));
  const modello = idTipoDaVoce(voce.id);
  const nomeModello = `${voce.marca} ${voce.modello}`;
  const sotto: TypeDef[] = [];
  const nuovi: TypeDef[] = [];
  const membriTop: Membro[] = [];
  let foglie = 0;
  for (const g of scelti) {
    const ms = membri(voce, lingua, new Set([g]));
    foglie += ms.length;
    const r = tipoDaRiusare(voce, `${modello}__${g}`, ms, `${nomeModello} — ${g}`, [...tipiEsistenti, ...nuovi]);
    sotto.push(r.tipo);
    if (r.nuovo) nuovi.push(r.tipo);
    if (r.tipo.id !== `${modello}__${g}`) avvisi.push({ chiave: "catalogo.avvisoTipoNuovo", valori: { tipo: r.tipo.id, base: `${modello}__${g}` } });
    membriTop.push({ name: g, type_ref: r.tipo.id });
  }
  const base = scelti.length === tutti.length ? modello : `${modello}_${scelti.join("_")}`;
  const descr = `${nomeModello}${testo(voce.descrizione, lingua) ? ` — ${testo(voce.descrizione, lingua)}` : ""}`
    + (scelti.length < tutti.length ? ` (${scelti.join(", ")})` : "");
  const top = tipoDaRiusare(voce, base, membriTop, descr, [...tipiEsistenti, ...nuovi]);
  if (top.nuovo) nuovi.push(top.tipo);
  if (top.tipo.id !== base) avvisi.push({ chiave: "catalogo.avvisoTipoNuovo", valori: { tipo: top.tipo.id, base } });
  return { tipo: top.tipo, tipi: [...sotto, top.tipo], tipiNuovi: nuovi, riusaTipo: nuovi.length === 0, foglie, avvisi };
}

function dispositivoDa(voce: VoceCatalogo, bus: BusModbus, nome: string, unit: number, registers: RegisterMapping[]): DispositivoModbus {
  const d = nuovoDispositivo(bus, {
    nome,
    modello: `${voce.id}@${voce.versione ?? 1}`,
    ...(voce.modbus?.ordine && voce.modbus.ordine !== "abcd" ? { ordine: voce.modbus.ordine } : {}),
    ...(voce.modbus?.timeout_ms ? { timeout_ms: voce.modbus.timeout_ms } : {}),
    registers,
  });
  return { ...d, unit_id: unit };
}

function avvisiLinea(voce: VoceCatalogo, bus: BusModbus): Avviso[] {
  const avvisi: Avviso[] = [];
  // Su una linea seriale: il modello che non è seriale, o parametri diversi.
  if (bus.kind === "modbus_rtu") {
    const s = voce.modbus?.seriale;
    if (!s) avvisi.push({ chiave: "catalogo.avvisoNonSeriale" });
    else if (s.baud_rate !== bus.baud_rate || s.parity !== bus.parity || s.data_bits !== bus.data_bits || s.stop_bits !== bus.stop_bits) {
      avvisi.push({ chiave: "catalogo.avvisoSeriale", valori: { voce: `${s.baud_rate} ${s.data_bits}${s.parity}${s.stop_bits}`, bus: `${bus.baud_rate} ${bus.data_bits}${bus.parity}${bus.stop_bits}` } });
    }
  }
  if (voce.fuori_produzione) avvisi.push({ chiave: "catalogo.avvisoFuoriProduzione" });
  return avvisi;
}

export function daCatalogo(voce: VoceCatalogo, bus: BusModbus, o: OpzioniCatalogo, tipiEsistenti: readonly TypeDef[]): DaCatalogo {
  if (o.esistente) return riassocia(voce, bus, o, o.esistente, tipiEsistenti);
  const t = tipoPerGruppi(voce, o.gruppi, o.lingua, tipiEsistenti);
  const tag: TagDef = { id: o.nome, description: `${voce.marca} ${voce.modello}`, type_ref: t.tipo.id, history: false } as TagDef;
  const dispositivo = dispositivoDa(voce, bus, o.nome, o.unit, mappature(voce, o.nome, o.gruppi));
  return { tipo: t.tipo, tipi: t.tipi, tipiNuovi: t.tipiNuovi, riusaTipo: t.riusaTipo, foglie: t.foglie, tag, dispositivo, avvisi: [...t.avvisi, ...avvisiLinea(voce, bus)] };
}

/** Un dispositivo nuovo sopra una variabile che c'è già.
 *  - Tipo annidato che ha già tutti i gruppi scelti: niente da salvare.
 *  - Tipo annidato con meno gruppi: la variabile passa al tipo coi gruppi di
 *    prima **più** quelli scelti; i percorsi di prima non cambiano.
 *  - Tipo **piatto** (dispositivi aggiunti prima dei tipi annidati) che ha già
 *    tutti i membri: si mappa piatto, i percorsi restano quelli di prima. Se
 *    gliene mancano passa alla struttura annidata, e i percorsi cambiano: lo
 *    dice un avviso. */
function riassocia(voce: VoceCatalogo, bus: BusModbus, o: OpzioniCatalogo, e: { tag: TagDef; tipo: TypeDef }, tipiEsistenti: readonly TypeDef[]): DaCatalogo {
  const avvisi: Avviso[] = [];
  const gruppiVoce = new Set(gruppiDi(voce).map((g) => g.nome));
  const annidato = e.tipo.members.some((m) => m.type_ref && gruppiVoce.has(m.name));
  const fine = (tipo: TypeDef, tipi: TypeDef[], tipiNuovi: TypeDef[], tag: TagDef, registers: RegisterMapping[], foglie: number, cambia: boolean): DaCatalogo => ({
    tipo, tipi, tipiNuovi, riusaTipo: tipiNuovi.length === 0, foglie, tag,
    riusaVariabile: !cambia, sostituisciVariabile: cambia,
    dispositivo: dispositivoDa(voce, bus, e.tag.id, o.unit, registers),
    avvisi: [...avvisi, ...avvisiLinea(voce, bus)],
  });
  if (!annidato) {
    const presenti = new Set(e.tipo.members.map((m) => m.name));
    const servono = membri(voce, o.lingua, o.gruppi).map((m) => m.name);
    if (servono.every((n) => presenti.has(n))) {
      return fine(e.tipo, [e.tipo], [], e.tag, mappature(voce, e.tag.id, o.gruppi, presenti, true), presenti.size, false);
    }
    const t = tipoPerGruppi(voce, o.gruppi, o.lingua, tipiEsistenti);
    avvisi.push(...t.avvisi, { chiave: "catalogo.avvisoPercorsiCambiano", valori: { nome: e.tag.id, tipo: t.tipo.id } });
    return fine(t.tipo, t.tipi, t.tipiNuovi, { ...e.tag, type_ref: t.tipo.id }, mappature(voce, e.tag.id, o.gruppi), t.foglie, true);
  }
  const haGia = new Set(e.tipo.members.filter((m) => gruppiVoce.has(m.name)).map((m) => m.name));
  const unione = new Set([...haGia, ...o.gruppi]);
  const t = tipoPerGruppi(voce, unione, o.lingua, tipiEsistenti);
  const cambia = t.tipo.id !== e.tipo.id;
  if (cambia) avvisi.push(...t.avvisi, { chiave: "catalogo.avvisoTipoAllargato", valori: { da: e.tipo.id, a: t.tipo.id } });
  return fine(t.tipo, t.tipi, t.tipiNuovi, cambia ? { ...e.tag, type_ref: t.tipo.id } : e.tag, mappature(voce, e.tag.id, o.gruppi), t.foglie, cambia);
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
