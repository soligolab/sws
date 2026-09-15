// Il campo di testo del pannello proprietà per ciò che l'operatore legge.
//
// Chi scrive un sinottico scrive **testo**, non chiavi: qui si digita «Avvio
// pompa» e nel progetto finisce `{{t0001}}`, con «Avvio pompa» nella colonna
// della lingua principale. Il pannello continua a mostrare il testo, perché la
// chiave è un id opaco e mostrarla renderebbe il pannello illeggibile.
//
// **Si scrive alla conferma, non a ogni tasto.** Un `onChange` per battuta
// creerebbe una voce per ogni stato intermedio della parola: «A», «Av», «Avv»…
// Finché si digita il valore resta locale; alla perdita del fuoco (o con Invio)
// si decide.
//
// Se il testo esiste già nella colonna principale si **propone** il riuso, non
// si impone: due «Avvio» identici in italiano possono diventare parole diverse
// in tedesco a seconda di cosa avviano. La proposta dice anche quante volte
// quella chiave è già in uso, così la scelta si fa sapendo cosa si condivide.

import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { api } from "@/api/client";
import {
  conTesto, contaUsi, decidiChiave, prossimaChiave, testoSorgente,
} from "@/i18n/chiaviAutomatiche";
import type { LanguageTable } from "@/types";

export function CampoTestoTradotto({
  valore,
  placeholder,
  stile,
  onChange,
}: {
  /** Il valore grezzo dal progetto: testo libero, oppure `{{chiave}}`. */
  valore: string | undefined;
  placeholder?: string;
  stile?: React.CSSProperties;
  /** Riceve il valore da scrivere nel campo dell'oggetto. */
  onChange: (nuovo: string) => void;
}) {
  const project = useAppStore((s) => s.project);
  const setProject = useAppStore((s) => s.setProject);
  const tabella = project?.languages;

  const mostrato = testoSorgente(valore, tabella);
  const [bozza, setBozza] = useState(mostrato);
  // Il progetto può cambiare sotto (altro oggetto selezionato, ricarica): la
  // bozza segue, ma solo quando NON si sta digitando — altrimenti sparirebbe
  // il testo a metà parola.
  const [attivo, setAttivo] = useState(false);
  useEffect(() => {
    if (!attivo) setBozza(mostrato);
  }, [mostrato, attivo]);

  const salvaTabella = (nuova: LanguageTable) => {
    if (!project) return;
    setProject({ ...project, languages: nuova });
    api.updateLanguages(nuova).catch(console.error);
  };

  const creaNuova = (testo: string) => {
    const key = prossimaChiave(tabella);
    salvaTabella(conTesto(tabella, key, testo));
    onChange(`{{${key}}}`);
  };

  const conferma = () => {
    setAttivo(false);
    const testo = bozza;
    if (testo === mostrato) return;

    const usiDi = (k: string) => {
      const pagine = useAppStore.getState().pages ?? [];
      return contaUsi(k, JSON.stringify(pagine));
    };
    const d = decidiChiave(testo, tabella, usiDi);

    if (d.azione === "lascia") {
      onChange(testo);
      return;
    }
    if (d.azione === "proponi-riuso") {
      const dove =
        d.usiEsistenti > 0
          ? `\n\nQuella voce è già usata ${d.usiEsistenti} volta/e: tradurla una volta le cambia tutte.`
          : "";
      const riusa = window.confirm(
        `«${testo}» esiste già nella tabella lingue (${d.key}).${dove}\n\n` +
          "OK = riusa quella voce\n" +
          "Annulla = creane una nuova (giusto se in un'altra lingua le due frasi divergono)",
      );
      if (riusa) onChange(`{{${d.key}}}`);
      else creaNuova(testo);
      return;
    }
    creaNuova(testo);
  };

  return (
    <input
      type="text"
      style={stile}
      placeholder={placeholder}
      value={bozza}
      onFocus={() => setAttivo(true)}
      onChange={(e) => setBozza(e.target.value)}
      onBlur={conferma}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setBozza(mostrato);
          setAttivo(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
