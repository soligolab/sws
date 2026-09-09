// it.json ed en.json devono avere le STESSE chiavi.
//
// Le stringhe si aggiungono quasi sempre prima in italiano, perché è la lingua
// del maintainer, e l'inglese arriva dopo — o non arriva. i18next ripiega
// sull'inglese quando manca l'italiano, ma non viceversa: una chiave solo in
// it.json fa comparire il NOME DELLA CHIAVE a chi usa l'editor in inglese
// («cfg.probeRun» al posto di «Check device»). Nessuno lo vede finché non cambia
// lingua. Questo test lo vede.
import { describe, expect, it } from "vitest";
import it_ from "../src/i18n/it.json";
import en from "../src/i18n/en.json";

function chiavi(o: unknown, prefisso = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefisso];
  return Object.entries(o).flatMap(([k, v]) => chiavi(v, prefisso ? `${prefisso}.${k}` : k));
}

describe("parità it/en", () => {
  const a = new Set(chiavi(it_));
  const b = new Set(chiavi(en));

  it("nessuna chiave solo in italiano", () => {
    expect([...a].filter((k) => !b.has(k)).sort()).toEqual([]);
  });

  it("nessuna chiave solo in inglese", () => {
    expect([...b].filter((k) => !a.has(k)).sort()).toEqual([]);
  });
});
