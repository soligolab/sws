/** Il campo numerico dell'editor (31-10-2026, piano
 *  `docs/archive/2026-10-31-campi-numerici.md`).
 *
 *  Un `<input type="number">` controllato non sapeva tenere un testo a metà:
 *  con «-» il browser riporta `value === ""`, il gestore scriveva «non
 *  impostato» (o uno 0, dove faceva `Number(…)`), e React rimetteva il
 *  ripiego nel campo. Un numero negativo si scriveva solo con le freccette.
 *
 *  Qui il testo a metà (`validity.badInput`: «-», «1e», «-.») non arriva al
 *  gestore e resta a schermo; un campo svuotato davvero arriva come `""`, come
 *  prima, ma resta vuoto finché ci si scrive. All'uscita torna il valore del
 *  progetto. `onTesto` riceve la stringa, così i gestori restano quelli di
 *  prima: cambia solo da dove la prendono. */
import { useState, type InputHTMLAttributes } from "react";

export function CampoNumero({ value, onTesto, onBlur, ...resto }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange">
  & { value: number | string | undefined; onTesto: (v: string) => void }) {
  // `null` = si mostra il valore del progetto; una stringa = quello che si sta
  // scrivendo e che il progetto non può ancora rappresentare.
  const [bozza, setBozza] = useState<string | null>(null);
  return (
    <input
      {...resto}
      type="number"
      value={bozza ?? value ?? ""}
      onChange={(e) => {
        if (e.target.validity.badInput) { setBozza(""); return; }
        const v = e.target.value;
        setBozza(v === "" ? "" : null);
        onTesto(v);
      }}
      onBlur={(e) => { setBozza(null); onBlur?.(e); }}
    />
  );
}
