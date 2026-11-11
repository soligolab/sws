# Selezione sul canvas, gruppi veri, chat che «pensa»

## Contesto

Nel collaudo dell'11-11-2026 sull'IDE 8460, progetto Montagna, sono venuti fuori tre problemi:

1. **La selezione col riquadro prende lo sfondo.** Le pagine hanno immagini a tutta area
   (`image`, il ciclo giorno/notte) sotto gli oggetti. Il riquadro seleziona tutto quello che
   tocca anche solo in parte, e salta anche il controllo `locked`
   (`SvgCanvas.tsx:1733-1739`). Così «Bilancio di oggi» non si può prendere e spostare da solo.
2. **«Raggruppa» esiste solo a metà.** Ctrl+G e il pulsante nell'elenco Oggetti mettono
   `group_id` sugli oggetti e la voce in `page.groups`, e sul disco sopravvive. Ma sul canvas un
   clic seleziona il singolo oggetto, e il gruppo non si vede (`types/index.ts:943`: «UI-only,
   no canvas effect»).
3. **La chat sembra ferma mentre il modello ragiona.** Fra uno strumento e l'altro mostra
   «…» immobili. Il server manda già gli eventi `pensiero`, e la chat li butta
   (`ChatPanel.tsx:166`).

Decisioni del maintainer (11-11-2026):
- riquadro = **oggetti dentro per intero**, e gli oggetti bloccati restano fuori;
- gruppo = **un clic seleziona tutto il gruppo, il doppio clic entra nel gruppo**;
- **ramo annidato** su `fix/collaudo-rc12`: `feat/selezione-e-gruppi`.

Niente tipo nuovo: il gruppo resta `group_id` più `page.groups`, che esistono già. I viewer (web
e LVGL) non cambiano, perché il gruppo serve solo a chi disegna.

## 1. Il riquadro di selezione

`sws-editor/src/canvas/SvgCanvas.tsx`, `endDrag` (~1719-1744):
- il test diventa **contenimento**: `bb.x1 >= x1 && bb.x2 <= x2 && bb.y1 >= y1 && bb.y2 <= y2`;
- salta gli oggetti con `locked`;
- con Shift **aggiunge** alla selezione invece di sostituirla;
- un gruppo entra solo se **tutti** i suoi membri sono dentro, e allora entra intero (la stessa
  funzione del punto 2).

`EditorShell.tsx:1019-1023` (Ctrl+A): salta gli oggetti bloccati.

La logica va in una funzione pura, `canvas/selezioneRiquadro.ts`, con i bbox da `objBBox`, così
si prova con vitest senza canvas.

## 2. Il gruppo sul canvas

Funzione pura nuova, `editor/gruppiSelezione.ts`:
- `espandiAlGruppo(ids, objects, gruppoAperto)`: ogni id che ha un `group_id` porta con sé
  tutti i membri del gruppo, tranne che nel gruppo aperto;
- `bboxDelGruppo(...)`: l'unione dei bbox, da `objBBox` / `objectBBox` (`pageLayout.ts:254`).

Store (`store/index.ts`):
- nuovo stato `gruppoAperto: string | null`, non salvato e fuori da undo;
- `selectObject` / `toggleSelection` / `selectMany` passano da `espandiAlGruppo`;
- `gruppoAperto` si azzera quando cambia la pagina, con Esc, e con un clic fuori dal gruppo;
- `pasteClipboard` (~2364): gli oggetti incollati prendono un `group_id` **nuovo**, con la
  voce in `page.groups`, invece di entrare nel gruppo dell'originale. Stessa cosa per
  `duplicateSelection` (~2218).

Canvas (`SvgCanvas.tsx`):
- `handleMouseDown` (~4040): il clic passa già da `onSelect`, quindi l'espansione la fa lo store.
  Il trascinamento usa già tutta la selezione (`startDrag` ~1747), e il gruppo si sposta intero;
- doppio clic su un membro di un gruppo: `gruppoAperto = group_id`, e si seleziona il solo
  oggetto. Prima va controllato che il doppio clic non serva già a qualcosa, per esempio alla
  modifica del testo; se sì, quella ha la precedenza solo dentro il gruppo aperto;
- quando la selezione è un gruppo intero: un **riquadro tratteggiato** attorno al bbox del
  gruppo, con il nome del gruppo in piccolo. Con il gruppo aperto: un riquadro più tenue
  attorno al gruppo, e la selezione normale sul singolo oggetto.

Elenco Oggetti (`editor/LeftPanel.tsx`):
- **lucchetto per riga** (attiva e disattiva `locked`), accanto al 🔒 che oggi è solo un'icona
  (~1634);
- il pulsante «+ Raggruppa selezionati (N)» (~1759) passa a i18n (oggi è italiano fisso);
- un clic su un oggetto di un gruppo nell'elenco seleziona il **solo** oggetto e apre il gruppo
  (l'elenco è il posto dove si lavora sul singolo).

Pannello multiselezione (`EditorShell.tsx` ~3015): pulsanti **Raggruppa** e **Separa**, accanto
a «Crea faceplate» (~3102), con le azioni esistenti `groupObjects` / `ungroupObjects`.

## 3. L'assistente e gli sfondi

`sws-runtime/crates/sws-web/src/ai/prompt.rs`: una riga. Le immagini a tutta area usate come
sfondo (ciclo giorno/notte) vanno con `locked: true`, così il riquadro e i clic non le prendono.
E se basta un'immagine sola, si preferisce `sfondo_immagine` della pagina, che non si seleziona
mai. `locked` è già nello schema (`synoptic_schema.rs:238`).

## 4. La chat che pensa

- `ChatPanel.tsx`, `case "pensiero"`: non mostra il testo, ma segna l'ora dell'ultimo pensiero
  e il suo inizio;
- al posto dei «…» fissi (`{attesa && …}` ~458): «sta pensando · 0:12» quando arrivano
  pensieri, altrimenti «in attesa del modello · 0:05», con un timer al secondo;
- la riga dello strumento attivo (`…` e «scrivo · kB · tempo») ha un **puntino che pulsa**
  (animazione CSS), così si vede che è viva anche quando i kB crescono piano;
- i18n `chat.thinking` e `chat.waitingModel`, in it e en.

## File toccati

- `sws-editor/src/canvas/SvgCanvas.tsx`, nuovo `canvas/selezioneRiquadro.ts`
- nuovo `sws-editor/src/editor/gruppiSelezione.ts`
- `sws-editor/src/store/index.ts`
- `sws-editor/src/EditorShell.tsx`, `sws-editor/src/editor/LeftPanel.tsx`
- `sws-editor/src/components/ChatPanel.tsx`, `src/i18n/it.json`, `src/i18n/en.json`
- `sws-runtime/crates/sws-web/src/ai/prompt.rs`
- test: `tests/selezioneRiquadro.test.ts`, `tests/gruppiSelezione.test.ts`, più un test della
  chat che pensa se resta una funzione pura

## Documenti

- appena approvato, il piano va in `docs/plans/2026-11-11-selezione-e-gruppi.md`, con la riga
  in `docs/plans/README.md`, e si committa sul ramo;
- `docs/TESTING_GUIDE.md` 4.14-4.23 (gruppi): aggiornare i passi;
- `CHANGELOG.md` [Unreleased]. `NOVITA.yaml`: il blocco 2.26.0 è pieno (15 voci). Se la voce
  non ci sta, la si mette nel blocco della versione successiva;
- CasaDomotica (regola di `CLAUDE.md`): un gruppo in una pagina, quando la funzione entra in
  `main`.

## Verifica

1. `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`;
   la guardia Playwright `scripts/check_multiselect_drag.sh` deve restare verde;
2. IDE 8460 ricompilato, poi il maintainer prova su Montagna, «Impianto — Opus 5.5»:
   - un riquadro attorno a «Bilancio di oggi» prende solo i suoi oggetti, non lo sfondo;
   - Ctrl+G sulle tre tessere, poi un clic su una tessera seleziona tutto il gruppo con il
     riquadro tratteggiato, e il trascinamento sposta il gruppo intero;
   - doppio clic su una tessera: si sposta solo quella; Esc chiude il gruppo;
   - copia e incolla del gruppo: due gruppi distinti;
   - il lucchetto per riga nell'elenco blocca lo sfondo, e un clic sullo sfondo non lo seleziona;
   - una richiesta all'assistente: la chat mostra «sta pensando · m:ss» fra uno strumento e
     l'altro, e il puntino pulsa durante «scrivo».
