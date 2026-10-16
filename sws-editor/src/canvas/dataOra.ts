/** La data e l'ora scritte dall'oggetto «Data e ora» (`clock`, 15-10-2026, piano
 *  docs/plans/2026-10-15-cornici-di-pagina.md, ramo 1). Gemello di
 *  `sws-core/src/data_ora.rs`; casi in `tests/fixtures/data-ora.json`. */

export interface Componenti {
  anno: number;
  /** 1…12 */
  mese: number;
  giorno: number;
  ore: number;
  minuti: number;
  secondi: number;
  /** 0 = domenica … 6 = sabato, come `Date.getDay()`. */
  giornoSettimana: number;
}

export const FORMATI_OROLOGIO = ["ora", "data", "data_ora", "giorno", "personalizzato"] as const;
export type FormatoOrologio = (typeof FORMATI_OROLOGIO)[number];

export function modelloDi(formato: string, secondi: boolean): string | null {
  switch (formato) {
    case "ora": return secondi ? "%H:%M:%S" : "%H:%M";
    case "data": return "%d/%m/%Y";
    case "data_ora": return secondi ? "%d/%m/%Y %H:%M:%S" : "%d/%m/%Y %H:%M";
    case "giorno": return "%A %d %B %Y";
    default: return null;
  }
}

const GIORNI: Record<string, string[]> = {
  it: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const MESI: Record<string, string[]> = {
  it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const due = (n: number) => String(n).padStart(2, "0");
const breve = (s: string) => Array.from(s).slice(0, 3).join("");

/** Scrive `c` secondo `modello`: vedi i segnaposti in `data_ora.rs`. */
export function formatta(c: Componenti, modello: string, lingua: string): string {
  const g = GIORNI[lingua] ?? GIORNI.en;
  const m = MESI[lingua] ?? MESI.en;
  const ch = Array.from(modello);
  let out = "";
  for (let i = 0; i < ch.length; i++) {
    if (ch[i] !== "%") { out += ch[i]; continue; }
    const s = ch[++i];
    switch (s) {
      case "d": out += due(c.giorno); break;
      case "m": out += due(c.mese); break;
      case "Y": out += String(c.anno); break;
      case "y": out += due(((c.anno % 100) + 100) % 100); break;
      case "H": out += due(c.ore); break;
      case "M": out += due(c.minuti); break;
      case "S": out += due(c.secondi); break;
      case "A": out += g[c.giornoSettimana % 7]; break;
      case "a": out += breve(g[c.giornoSettimana % 7]); break;
      case "B": out += m[(c.mese + 11) % 12]; break;
      case "b": out += breve(m[(c.mese + 11) % 12]); break;
      case "%": out += "%"; break;
      case undefined: out += "%"; break;
      default: out += "%" + s;
    }
  }
  return out;
}

/** Il testo di un oggetto `clock`: formato pronto o modello personalizzato. */
export function testoOrologio(c: Componenti, formato: string | undefined, secondi: boolean,
  modello: string | undefined, lingua: string): string {
  const f = formato ?? "ora";
  const m = f === "personalizzato" ? (modello || "%H:%M") : (modelloDi(f, secondi) ?? "%H:%M");
  return formatta(c, m, lingua);
}

export function componentiDi(d: Date): Componenti {
  return {
    anno: d.getFullYear(), mese: d.getMonth() + 1, giorno: d.getDate(),
    ore: d.getHours(), minuti: d.getMinutes(), secondi: d.getSeconds(), giornoSettimana: d.getDay(),
  };
}
