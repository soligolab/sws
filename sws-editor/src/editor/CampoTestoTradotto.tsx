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

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { api } from "@/api/client";
import {
  conTesto, contaUsi, decidiChiave, prossimaChiave, testoSorgente,
} from "@/i18n/chiaviAutomatiche";
import { CharacterPickerModal } from "@/editor/CharacterPickerModal";
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
  const { t } = useTranslation();
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

  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerAperto, setPickerAperto] = useState(false);

  const salvaTabella = (nuova: LanguageTable) => {
    if (!project) return;
    setProject({ ...project, languages: nuova });
    api
      .updateLanguages(nuova)
      // **Dichiarare che il salvataggio è nostro.** Il watcher del progetto
      // confronta un'impronta di `project.yaml` ogni tre secondi e non ha modo
      // di sapere chi l'ha cambiato: senza questa riga, ogni etichetta digitata
      // faceva comparire la barra «il progetto sul runtime è cambiato», e
      // premere «Ricarica» lì butta via le pagine non salvate. Il maintainer ci
      // ha perso degli oggetti appena inseriti, il 15-09-2026.
      .then(() => useAppStore.getState().markSaveOk())
      .catch(console.error);
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

  const inserisciCarattere = (carattere: string) => {
    const el = inputRef.current;
    const inizio = el?.selectionStart ?? bozza.length;
    const fine = el?.selectionEnd ?? bozza.length;
    setAttivo(true);
    setBozza(bozza.slice(0, inizio) + carattere + bozza.slice(fine));
    setPickerAperto(false);
    // Il cursore torna subito dopo il carattere appena inserito, non in
    // coda: chi lo sceglie a metà frase se lo aspetta lì.
    requestAnimationFrame(() => {
      el?.focus();
      const pos = inizio + carattere.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input
        ref={inputRef}
        type="text"
        style={{ ...stile, flex: 1, minWidth: 0 }}
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
      <button
        type="button"
        title={t("characterPicker.open")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPickerAperto(true)}
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          fontSize: 13,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--brand-surface, #1e293b)",
          border: "1px solid var(--brand-surface-2, #334155)",
          borderRadius: 4,
          color: "var(--brand-text-muted, #94a3b8)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        🔣
      </button>
      {pickerAperto && (
        <CharacterPickerModal onPick={inserisciCarattere} onCancel={() => setPickerAperto(false)} />
      )}
    </div>
  );
}
