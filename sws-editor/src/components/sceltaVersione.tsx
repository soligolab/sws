// The choice of a version in a drop-down list (27-11-2026, collaudo of the
// dev.5 on the WP630; the maintainer, on the version cap of the console:
// «l'elenco delle versioni organizzalo in modo più ordinato o con un menù a
// tendina dove sia chiaro l'ordine di "vecchiaia"»). Before, every version was
// a button, and the buttons wrapped in rows with no visible order.
//
// The list starts from the newest. The newest, the running one and the current
// choice carry a mark, and a line under the list says the order. Used by the
// version cap of the console and by «Fix a version…» of the IDE.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { campoAmpio, pulsantePrimario, pulsanteSecondario } from "@/ui/base";

export interface OpzioniSceltaVersione {
  titolo: string;
  testo: string;
  /** The versions, from the oldest to the newest (the order of the APIs). */
  versioni: string[];
  /** The version selected at the start (the current cap, for example). */
  iniziale?: string | null;
  /** The version that runs on the panel, marked in the list. */
  inUso?: string | null;
  /** The label of an extra first entry with the value `""` («No cap»). */
  nessuna?: string;
}

/** The labels of the list, newest first. Pure, for the tests. */
export function vociVersione(
  versioni: string[],
  mark: { inUso?: string | null; recente: string; attuale: string },
): { valore: string; etichetta: string }[] {
  const newestFirst = [...versioni].reverse();
  return newestFirst.map((v, i) => {
    const notes: string[] = [];
    if (i === 0) notes.push(mark.recente);
    if (mark.inUso && v === mark.inUso) notes.push(mark.attuale);
    return { valore: v, etichetta: notes.length > 0 ? `${v} — ${notes.join(", ")}` : v };
  });
}

function Modulo({ o, fine }: { o: OpzioniSceltaVersione; fine: (v: string | null) => void }) {
  const { t } = useTranslation();
  const voci = vociVersione(o.versioni, {
    inUso: o.inUso, recente: t("sceltaVersione.recente"), attuale: t("sceltaVersione.inUso"),
  });
  const start = o.iniziale ?? (o.nessuna !== undefined ? "" : voci[0]?.valore ?? "");
  const [value, setValue] = useState(start);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 340 }}>
      <div style={{ fontSize: 13, color: "var(--brand-text-2, #cbd5e1)" }}>{o.testo}</div>
      <select data-testid="scelta-versione" style={campoAmpio} value={value}
        onChange={(e) => setValue(e.target.value)}>
        {o.nessuna !== undefined && <option value="">{o.nessuna}</option>}
        {voci.map((v) => <option key={v.valore} value={v.valore}>{v.etichetta}</option>)}
      </select>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>
        {t("sceltaVersione.ordine", { n: voci.length })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" style={pulsanteSecondario} onClick={() => fine(null)}>{t("common.cancel")}</button>
        <button type="button" data-testid="scelta-versione-ok" style={pulsantePrimario}
          onClick={() => fine(value)}>{t("sceltaVersione.applica")}</button>
      </div>
    </div>
  );
}

/** Asks for a version. `null` = cancelled; `""` = the `nessuna` entry. */
export function scegliVersione(o: OpzioniSceltaVersione): Promise<string | null> {
  return modulo<string>({ titolo: o.titolo, corpo: (fine) => <Modulo o={o} fine={fine} /> });
}
