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

**FATTO e mergiato in `main` (`bd773d4`, 13-09-2026).** Confermato dal vivo dal maintainer
nell'editor (bordo rosso su una cella, bordo ciano su una sotto-cella, entrambi indipendenti da
`grid_show_borders`) più il fix del bug scorrelato sulla barra dei gruppi del pannello proprietà.
Resta solo la Parte B qui sotto.

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

**Ridotta dal maintainer il 13-09-2026**: niente `ack_reason` su `AlarmEvent`, niente migrazione
di schema. Il motivo dell'ACK è **già** scritto nell'audit da prima di questo piano —
`POST /api/alarms/:id/ack` (`router.rs:2461-2497`) accetta già `reason` e logga
`s.audit.log("alarm.ack", by, {"alarm": id, "reason": reason})`. Manca solo un modo di
**vederlo** da dove si guarda lo storico allarmi, senza duplicare il dato.

### Il vincolo che decide la forma: `/api/audit` è Admin-only, `AlarmHistory` no

`/api/audit` sta dentro `admin_routes` (`router.rs:299` e dintorni) — solo Admin. Ma
`AlarmHistory.tsx` è visto anche da Operator/Viewer: la campanella allarmi
(`AlarmBellPanel.tsx:264`) e l'oggetto sinottico `alarm_history` (`SvgCanvas.tsx:5644`) non hanno
restrizioni di ruolo. Il rimando quindi si mostra **solo quando `authRole === "Admin"`** — stesso
pattern già in uso altrove (`ConfigView.tsx:10865`, `MainMenu.tsx:196`), non un meccanismo nuovo.

### Disegno confermato

- In `AlarmHistory.tsx`, nella cella "Confermato da" (righe 110-118), un'icona visibile solo per
  Admin e solo sugli eventi con `ts_acked_ms` impostato (c'è qualcosa da cercare).
- Al click: `api.getAuditTail(2000)` (esiste già, nessuna modifica al client/backend), filtrato
  client-side su `action === "alarm.ack" && detail.alarm === ev.alarm_id`, scegliendo la entry con
  `ts_ms` più vicino a `ev.ts_acked_ms` (non c'è un id univoco di evento da correlare — verificato,
  `AlarmEvent` non ne ha uno). Fetch pigro, un colpo per click, non al caricamento della tabella.
- Riga espansa sotto quella cliccata: il motivo se presente, "nessun motivo registrato" se
  `reason` è `null`, "non trovato nell'audit recente" se il tail da 2000 non basta a coprirlo.
- **LVGL resta fuori scope**: `render_alarm_history` è dichiarato *read-only per disegno*
  ("qui si guarda cosa è successo, non si agisce... per questo non c'è nessun pulsante",
  `lvgl_render.rs:5803-5809`) — un pannello fisico senza browser non ha un audit da aprire.

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
