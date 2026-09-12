# F7 — due residui minori dal debito d'inventario

## Contesto

Da `STATUS.md` "Da fare, dalle sessioni precedenti", punto 5: due rifiniture rimaste indietro
rispetto al resto di F7 (Table/bar/pie 2.0), entrambe verificate nel codice il 2026-09-12, non
solo assunte dal testo dello STATUS:

1. **Bordi per-cella nella griglia.** `grid_show_borders`/`grid_border_color` esistono
   (`types/index.ts:572-573`) ma sono proprietà **dell'intera griglia**: non c'è un campo per
   dare un bordo a una singola cella. `grid_gap`/`grid_padding` (spaziatura) sono già fatti — è
   solo il bordo per-cella a mancare.
2. **Il motivo dell'ACK non è nello storico degli allarmi.** `AlarmEvent`
   (`sws-core/src/alarm.rs:269-278`) ha `acked_by` ma **non** un campo motivo/commento — il testo
   di un ACK commentato oggi vive solo nel journal di audit (`/api/audit`), non nel record
   storico dell'allarme stesso. Chi guarda lo storico allarmi non vede perché è stato confermato,
   deve andare a cercarlo nell'audit.

Due lavori scorrelati, in un piano solo perché entrambi piccoli.

## Parte A — Bordo per-cella nella griglia

### Disegno

- Nuovo campo su `GridCell` (non su `SynopticObject`): `border_color?: string` (assente = nessun
  bordo per quella cella, comportamento invariato). Aggiungere accanto a `visible_tag` nella
  stessa interfaccia, in `types/index.ts`.
- Mirror nei tre posti d'obbligo: `sws-web/src/synoptic.rs` (il tipo `GridCell` lì, o dentro il
  `Value` di `grid_cells` se non è già tipizzato — verificare prima di assumere), e
  `sws-lvgl-viewer/src/model.rs` (struct `GridCell` già esistente per `visible_tag`/`child`/`sub`
  — aggiungere il campo o dichiarare il gap se il rendering a celle di LVGL non lo supporta
  facilmente).
- Web (`SvgCanvas.tsx`, rendering grid): un `<rect>` di contorno per cella quando
  `cell.border_color` è impostato, sullo stesso livello del contenuto della cella.
- Pannello proprietà: nell'editor delle celle della griglia (dove si impostano `visible_tag`/
  figlio), aggiungere un color picker per il bordo — verificare prima dove vive quell'editor in
  `EditorShell.tsx` (cercare dove si modifica `grid_cells`).

### Verifica

1. `cargo check`/`pnpm build` verdi, round-trip di persistenza del campo nuovo.
2. Verifica visiva: una griglia con bordi diversi su celle diverse, browser e (se il motore lo
   supporta) istantanea LVGL.

## Parte B — Il motivo dell'ACK nello storico allarmi

### Perché costa più della Parte A

Aggiungere un campo a `AlarmEvent` è una **migrazione di schema**, non solo un campo nuovo:
`AlarmEvent` è persistito nello storico allarmi (verificare dove: SQLite via `sws-historian` o
un file a parte — leggere `sws-core/src/alarm.rs` e chi scrive/legge `AlarmEvent` prima di
stimare il lavoro). Un evento vecchio non ha il campo nuovo: va deciso se retrocompatibile
(`Option<String>`, assente per gli eventi già scritti) o se serve un passaggio di migrazione.

### Disegno proposto (da confermare col maintainer prima di scrivere codice)

- `AlarmEvent.ack_reason: Option<String>`, popolato quando l'endpoint di ACK riceve un motivo
  (verificare se `POST /api/alarms/:id/ack` già accetta un campo motivo per scriverlo
  nell'audit — se sì, lo stesso valore va anche qui invece di introdurre un secondo canale).
- Nessuna migrazione dei dati vecchi: `Option<String>` assente = "nessun motivo registrato",
  onesto per gli eventi pre-esistenti.
- UI: dove lo storico allarmi mostra un evento confermato, aggiungere il motivo se presente
  (cercare il componente che mostra `AlarmEvent`, probabilmente in `AlarmHistory`/`alarm_history`
  lato web e `render_alarm_history` lato LVGL — quest'ultimo potrebbe restare un gap dichiarato
  se aggiunge complessità sproporzionata a un widget già scritto per una tabella semplice).

### Domanda da fare al maintainer prima di questa parte

Vale il costo (schema + retrocompatibilità + due rendering) rispetto al fatto che il motivo è
già raggiungibile da `/api/audit`? Se la risposta è "basta un link/rimando all'audit dallo
storico allarmi", il lavoro si riduce parecchio (un link, non un campo duplicato).

## File coinvolti (di massima, da confermare in fase di implementazione)

- Parte A: `sws-editor/src/types/index.ts`, `sws-editor/src/canvas/SvgCanvas.tsx`,
  `sws-editor/src/editor/EditorShell.tsx`, `sws-runtime/crates/sws-web/src/synoptic.rs`,
  `sws-runtime/crates/sws-lvgl-viewer/src/model.rs`
- Parte B: `sws-runtime/crates/sws-core/src/alarm.rs`, il modulo che scrive/legge lo storico
  allarmi (da individuare), il componente che lo mostra lato web e LVGL

## Verifica complessiva

`cargo check --workspace` + `pnpm build` verdi, test del round-trip per ciascun campo nuovo,
conferma del maintainer prima di qualunque squash-merge — come da `CLAUDE.md`.

Branch: `feat/f7-bordo-cella-griglia` (Parte A) e `feat/f7-ack-reason-storico` (Parte B), separati
perché scorrelati.
