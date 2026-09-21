# Gestione dei tag: un oggetto unico, creato dove serve

> **Stato**: seme — decisione (21-09-2026). Materiale, non piano d'esecuzione.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, in Plan mode, per
> sviscerarne tutti i dettagli.** Non si progetta qui: fra la domanda e il lavoro cambia troppo.

## L'idea (maintainer, 21-09-2026)

I tag oggi vivono in due posti che non si parlano: la **tabella variabili** (il registro: tipo, unità,
storico, allarmi, scala) e i **riferimenti** sparsi nel resto del progetto (mappature delle sorgenti,
oggetti sinottici, allarmi, trend…), che citano un id in un campo di testo libero. Il maintainer li
vorrebbe un **oggetto unico**, usato e **creato dove serve**, con la creazione che avviene **al
salvataggio** del progetto. Parole sue: «la gestione attuale mi lascia molto perplesso».

## Misurato nel codice (21-09-2026, `sws-editor/src/config/ConfigView.tsx`)

- Il campo tag di una mappatura è **testo libero** (`TagInput`) e non crea niente da solo.
- Il tag si crea a mano col pulsante **«+var»** accanto alla riga (`:1547` Host, `:1415`, `:1660`,
  `:4538` altre sorgenti): default `float`/`string`, `history: false`.
- I wizard di importazione hanno la casella **«crea i tag»** attiva di default (`:2824`, `:3943`).
- Una riga con un id inesistente **non dà avvisi**: il tag non arriva e il valore non compare. Non è
  stato verificato se un altro punto dell'editor lo segnali.
- Motivi plausibili dello stato attuale (**non documentati**, ipotesi): il campo si modifica a ogni
  tasto (creazione a raffica di tag spuri), `history` pesa sul database, l'id può puntare a un tag già
  esistente.

## Domande che la sessione di plan dovrà chiudere

- Quali sono **tutti i punti** che citano un tag (sorgenti, oggetti, allarmi, trend, azioni, IA)?
- **Chi possiede** la definizione quando due riferimenti chiedono cose diverse (tipo, unità, storico)?
- Creazione **al salvataggio**: con quali default, e che succede a un id **rinominato** o **tolto**
  (tag orfani: il pannello database ne conta già)?
- Effetti su import/deploy, sull'IA che scrive progetti, sui template, sul viewer LVGL e sui progetti
  già esistenti (migrazione: «Migra i testi…» è il precedente).
