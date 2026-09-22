// La **forma** di una variabile composita, lato editor: date le definizioni
// dei tipi e un tag che le istanzia, quali foglie esistono, con che percorso e
// con che tipo.
//
// È il gemello di `sws_core::percorso::Forma`. **I casi sono condivisi**:
// `tests/fixtures/forme-tag.json`, letta da questo test e dal test Rust. Due
// calcoli separati della stessa cosa divergono in silenzio, e qui la
// divergenza si vedrebbe come un percorso che l'IDE offre e il runtime non ha
// — o, peggio, come un tag piatto creato al salvataggio accanto a un'istanza,
// che è la collisione che il validatore rifiuta.
//
// L'ordine delle foglie è quello di dichiarazione dei membri, e per gli array
// row-major (l'ultimo indice è il più veloce): lo storico e la lettura a
// blocco dei protocolli ci si appoggiano.

import i18n from "i18next";
import type { Membro, TagDef, TypeDef } from "@/types";
import { normalizzaTipo } from "./tipiScalari";

export interface FogliaTag {
  /** Percorso assoluto: `motore1.velocita`, `valvole[1].stato`, `m[0][2]`. */
  percorso: string;
  /** Il tipo scritto (`u16`, `string(16)`), non normalizzato: è ciò che il
   *  runtime mette nella mappa dei tipi e che la coercizione userà. */
  tipo: string;
  /** Il membro che descrive la foglia: unità, scala, limiti, storico.
   *  Assente per gli elementi di un array dichiarato sul tag. */
  membro?: Membro;
}

/** Perché una forma non è valida. Etichetta **stabile e senza lingua**: il
 *  messaggio passa dal catalogo e cambia con la lingua dell'interfaccia,
 *  quindi non è una cosa su cui un test possa appoggiarsi. I casi stanno
 *  nella fixture condivisa, sotto `codice`. */
export type CodiceForma =
  | "tipo-non-dichiarato"
  | "ciclo"
  | "dimensione-zero"
  | "membro-senza-nome"
  | "membro-senza-tipo"
  | "tipo-non-valido";

/** Errore di forma: un messaggio già tradotto, da mostrare, e un codice, da
 *  confrontare. */
export class FormaNonValida extends Error {
  constructor(
    message: string,
    readonly codice: CodiceForma,
  ) {
    super(message);
    this.name = "FormaNonValida";
  }
}

function conArray(
  percorsoBase: string,
  dims: number[] | undefined,
  foglia: (percorso: string) => FogliaTag[],
): FogliaTag[] {
  if (!dims || dims.length === 0) return foglia(percorsoBase);
  if (dims.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new FormaNonValida(i18n.t("forma.dimensioneZero"), "dimensione-zero");
  }
  const [primo, ...resto] = dims;
  const out: FogliaTag[] = [];
  for (let i = 0; i < primo; i++) {
    out.push(...conArray(`${percorsoBase}[${i}]`, resto.length ? resto : undefined, foglia));
  }
  return out;
}

function foglieDelTipo(
  id: string,
  percorsoBase: string,
  types: readonly TypeDef[],
  pila: string[],
): FogliaTag[] {
  if (pila.includes(id)) {
    throw new FormaNonValida(i18n.t("forma.ciclo", { id, pila: pila.join(" → ") }), "ciclo");
  }
  const td = types.find((t) => t.id === id);
  if (!td) throw new FormaNonValida(i18n.t("forma.tipoNonDichiarato", { id }), "tipo-non-dichiarato");
  pila.push(id);
  const out: FogliaTag[] = [];
  for (const m of td.members ?? []) {
    if (!m.name?.trim()) throw new FormaNonValida(i18n.t("forma.membroSenzaNome"), "membro-senza-nome");
    const base = `${percorsoBase}.${m.name}`;
    const espandi = (p: string): FogliaTag[] => {
      if (m.type_ref) return foglieDelTipo(m.type_ref, p, types, pila);
      if (!m.data_type) throw new FormaNonValida(i18n.t("forma.membroSenzaTipo", { name: m.name }), "membro-senza-tipo");
      if (!normalizzaTipo(m.data_type)) {
        throw new FormaNonValida(i18n.t("forma.membroTipoNonValido", { name: m.name, tipo: m.data_type }), "tipo-non-valido");
      }
      return [{ percorso: p, tipo: m.data_type, membro: m }];
    };
    out.push(...conArray(base, m.array, espandi));
  }
  pila.pop();
  return out;
}

/** Le foglie di un tag. Vuoto per un tag piatto (nessun `type_ref`, nessun
 *  `array`). Lancia `FormaNonValida` se il tipo non esiste, si contiene, o un
 *  membro è dichiarato male — gli stessi casi che il validatore segnala. */
export function foglieDi(tag: TagDef, types: readonly TypeDef[] = []): FogliaTag[] {
  if (!tag.type_ref && !tag.array) return [];
  const espandi = (p: string): FogliaTag[] => {
    if (tag.type_ref) return foglieDelTipo(tag.type_ref, p, types, []);
    if (!normalizzaTipo(tag.data_type)) {
      throw new FormaNonValida(i18n.t("forma.tipoNonValido", { tipo: tag.data_type ?? "" }), "tipo-non-valido");
    }
    return [{ percorso: p, tipo: tag.data_type ?? "f64" }];
  };
  return conArray(tag.id, tag.array, espandi);
}

/** Come `foglieDi`, ma un tipo malformato dà un elenco vuoto invece di
 *  lanciare: l'interfaccia deve continuare a disegnarsi mentre qualcuno sta
 *  scrivendo un tipo a metà, e il rilievo lo dà il validatore. */
export function foglieDiTolleranti(tag: TagDef, types: readonly TypeDef[] = []): FogliaTag[] {
  try {
    return foglieDi(tag, types);
  } catch {
    return [];
  }
}

/** Tutte le foglie del progetto, in ordine di dichiarazione dei tag. */
export function foglieDelProgetto(
  tags: readonly TagDef[],
  types: readonly TypeDef[] = [],
): FogliaTag[] {
  return tags.flatMap((t) => foglieDiTolleranti(t, types));
}
