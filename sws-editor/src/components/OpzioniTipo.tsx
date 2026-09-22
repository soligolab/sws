// Le voci di una `<select>` dei tipi di variabile, raggruppate: una sola
// definizione per le tre select della scheda Variabili e per il modale
// rapido, che prima ripetevano quattro `<option>` a mano ciascuna.

import { useTranslation } from "react-i18next";
import { TIPI_SCALARI } from "@/tag/tipiScalari";

const GRUPPI = ["bool", "signed", "unsigned", "reali", "testo", "tempo"] as const;

export function OpzioniTipo() {
  const { t } = useTranslation();
  return (
    <>
      {GRUPPI.map((g) => (
        <optgroup key={g} label={t(`tipi.gruppo.${g}`)}>
          {TIPI_SCALARI.filter((x) => x.gruppo === g).map((x) => (
            <option key={x.nome} value={x.nome}>
              {x.nome}{x.alias ? ` (${x.alias.join(", ")})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
