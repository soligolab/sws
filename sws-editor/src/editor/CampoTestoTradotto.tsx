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
import { scegli } from "@/finestraAvviso/finestraAvviso";
import {
  chiaveDi, conSorgenteCambiata, conTesto, contaUsi, decidiChiave, prossimaChiave, testoSorgente,
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

  // Esc vuol dire «lascia com'era»: il `blur` che segue chiama `conferma` di
  // questo stesso render, che ha ancora la bozza digitata. Senza questo segno
  // Esc salvava il testo invece di buttarlo (visto nella revisione di F2).
  const annullato = useRef(false);

  const conferma = async () => {
    const testo = bozza;
    if (annullato.current) { annullato.current = false; setAttivo(false); return; }
    if (testo === mostrato) { setAttivo(false); return; }

    const usiDi = (k: string) => {
      const pagine = useAppStore.getState().pages ?? [];
      return contaUsi(k, JSON.stringify(pagine));
    };
    // La chiave che il campo ha adesso: senza, modificare un testo già tradotto
    // è indistinguibile dallo scriverne uno nuovo.
    const corrente = chiaveDi(valore);
    const d = decidiChiave(testo, tabella, usiDi, corrente);
    // Mentre la finestra chiede, il campo mostra ancora il testo nuovo: la
    // domanda è su quello. Il campo torna a seguire il progetto dopo la risposta.
    const chiede = d.azione === "proponi-scissione" || d.azione === "proponi-riuso";
    if (!chiede) setAttivo(false);

    if (d.azione === "lascia") {
      onChange(testo);
      return;
    }
    if (d.azione === "aggiorna") {
      // Il campo continua a puntare alla stessa chiave: cambia il testo dentro.
      salvaTabella(conSorgenteCambiata(tabella, d.key, testo));
      return;
    }
    // Due strade, e Annulla (o Esc) che non ne prende nessuna: il campo torna
    // com'era. Con `confirm` Annulla era una delle due strade, e un Esc dato per
    // tirarsi indietro cambiava il testo dappertutto (F2, 05-11-2026).
    if (d.azione === "proponi-scissione") {
      const dove = await scegli({
        testo: t("campoTradotto.scissione", { key: d.key, altri: d.altriUsi }),
        scelte: [
          { valore: "ovunque", etichetta: t("campoTradotto.scissioneOvunque") },
          { valore: "qui", etichetta: t("campoTradotto.scissioneQui") },
        ],
      });
      setAttivo(false);
      if (dove === "qui") creaNuova(testo);
      else if (dove === "ovunque") salvaTabella(conSorgenteCambiata(tabella, d.key, testo));
      return;
    }
    if (d.azione === "proponi-riuso") {
      const dove = d.usiEsistenti > 0 ? t("campoTradotto.riusoDove", { usi: d.usiEsistenti }) : "";
      const scelta = await scegli({
        testo: t("campoTradotto.riusoTitolo", { testo, key: d.key }) + dove + t("campoTradotto.riusoNuovaQuando"),
        scelte: [
          { valore: "nuova", etichetta: t("campoTradotto.riusoNo") },
          { valore: "riusa", etichetta: t("campoTradotto.riusoSi") },
        ],
      });
      setAttivo(false);
      if (scelta === "riusa") onChange(`{{${d.key}}}`);
      else if (scelta === "nuova") creaNuova(testo);
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
            annullato.current = true;
            setBozza(mostrato);
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
