// Il marchio «tradotta dalla macchina» sulla tabella lingue, e cosa gli succede
// quando una persona tocca la cella.
//
// `LangEntry.auto` elenca le lingue che una passata di traduzione automatica ha
// riempito. La promessa dichiarata dalla 2.8.0 è che **una traduzione umana non
// si sovrascrive mai**: «ritraduci tutto» rifà solo le automatiche. Lato Rust la
// promessa era mantenuta (`marca_come_umana` in `sws-core::traduzione`); lato web
// **no**: `setVal` scriveva il testo e lasciava il marchio, quindi una cella
// corretta a mano restava «automatica» e la passata successiva poteva
// riscriverla. E il marchio non si vedeva da nessuna parte: una cella riempita
// dalla macchina era identica a una scritta a mano. Misurato il 18-09-2026,
// F4 del piano multilingua-chiusura.
//
// Qui non c'è React: decisioni pure, provate in `tests/tabellaLingue.test.ts`.

import type { LangEntry, LanguageTable } from "@/types";

/** La cella (`entry`, `code`) è stata riempita dalla macchina e nessuno l'ha
 *  ancora toccata? */
export function eAutomatica(entry: LangEntry, code: string): boolean {
  return (entry.auto ?? []).includes(code);
}

/** La voce dopo che una persona ha scritto nella cella `code`: il marchio
 *  automatico per quella lingua sparisce. Gemello di `marca_come_umana` in
 *  Rust. `auto` vuoto diventa assente, così il YAML non porta `auto: []` su
 *  ogni voce.
 *
 *  Vale anche quando il testo nuovo è vuoto: cancellare a mano è lavoro umano
 *  quanto scrivere. */
export function marcaComeUmana(entry: LangEntry, code: string): LangEntry {
  if (!eAutomatica(entry, code)) return entry;
  const auto = (entry.auto ?? []).filter((l) => l !== code);
  const { auto: _via, ...resto } = entry;
  return auto.length ? { ...resto, auto } : resto;
}

/** Quante celle della tabella sono ancora «automatiche», cioè da rileggere.
 *  Conta solo le lingue che la tabella dichiara: un marchio su una lingua tolta
 *  dal progetto non è una cella che qualcuno vedrà. */
export function contaAutomatiche(table: LanguageTable): number {
  const lingue = new Set(table.langs);
  let n = 0;
  for (const e of table.entries) {
    for (const l of e.auto ?? []) if (lingue.has(l)) n += 1;
  }
  return n;
}
