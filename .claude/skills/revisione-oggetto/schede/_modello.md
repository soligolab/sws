# Scheda: <tipo>

Modello da copiare in `schede/<tipo>.md` (passo 0 di `SKILL.md`). Il nome del file è il tipo
come compare nello YAML: `button.md`, `symbol.md`, `progress_bar.md`.

Scritta il <data>. I fatti qui sotto sono stati misurati quel giorno: **riverificali al passo 1**
e correggi la scheda, con la data, se qualcosa è cambiato.

## Cosa vuole il maintainer

L'appunto o la richiesta da cui nasce la revisione, citata parola per parola. Cerca in
`docs/plans/Appunti.txt` e in `docs/plans/`. Se non c'è niente, chiedi al maintainer cosa vuole
ottenere da questo oggetto.

## File da leggere

Per nome di funzione o di blocco, non per riga.

| Dove | Cosa cercare |
|---|---|
| `sws-editor/src/canvas/SvgCanvas.tsx` | il ramo `obj.type === "<tipo>"` |
| `sws-editor/src/editor/EditorShell.tsx` | il blocco del tipo nel pannello proprietà |
| `sws-editor/src/editor/oggettiNuovi.ts` | i valori alla creazione |
| `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs` | `render_<tipo>` e gli helper |
| `sws-runtime/crates/sws-web/src/validate.rs` | le regole sul tipo |
| `sws-runtime/crates/sws-web/src/synoptic_schema.rs` | `TYPE_USAGE` del tipo |
| `tests/fixtures/` | i default e le fixture del tipo |
| `docs/manual/05_widget_reference.md` | la voce del tipo |
| `examples/templates/demo-items-{web,lvgl}/` | l'oggetto gemello |

Storia utile: cerca il tipo in `docs/archive/` e in `docs/history/`.

## Campi di oggi

| Campo | Default | Note |
|---|---|---|

E cosa **non** c'è.

## Fatti noti al <data>, da riverificare

Divisi in: pannello proprietà, web, LVGL, altro (validatore, manuale, gemelli, CasaDomotica).

## La domanda tecnica centrale

La scelta da cui dipende tutto il resto, se c'è. Va portata al maintainer per prima, con il
costo.

## Anatomia obiettivo

Le parti dell'oggetto, ciascuna col campo che la governa oggi o che la governerebbe. Per ogni
parte, se un altro tipo ha già un campo con lo stesso significato, si riusa quello.

## Varianti da valutare

## Stati specifici

Oltre agli stati della lista di controllo in `SKILL.md`.

## Oggetti vicini

Tipi che condividono codice, campi o significato con questo.

---

## Note per tipo, da usare quando si scrive la scheda

**`button`**
- Parti dal piano archiviato `docs/archive/2026-10-14-bottone-come-nella-realta.md`. Allora il
  bottone era solo un rettangolo, senza aspetto premuto. La decisione fu «il simbolo impara a
  comandare».
- Poi `docs/archive/2026-10-14-strumenti-simboli-comandi.md`: i 7 modi del bottone funzionano
  anche sui simboli, e c'è la famiglia «Comandi da quadro».
- Il confine tra bottone e simbolo-comando va chiarito prima di proporre stili.
- Sul web i bottoni usano gli eventi mouse, non pointer/touch.

**`symbol`**
- Parti da `project.symbol_style` (`sws-editor/src/symbols/stileProgetto.ts`,
  `sws-runtime/crates/sws-core/src/stile_simboli.rs`): è già lo «stile di progetto con override
  per oggetto» che `SKILL.md` prende a modello.
- La libreria: 154 simboli in `sws-editor/public/symbols/lib/manifest.json`, generati da
  `scripts/simboli/genera.py`.
- Le fixture `tests/fixtures/stato-simbolo.json`, `stile-simboli.json`, `stile-effettivo.json`.
- Le 21 decisioni grafiche del piano archiviato `docs/archive/2026-10-14-libreria-simboli-scada.md`
  (2.5D, colore per famiglia, volume da 0 piatto a 100). E `2026-10-14-motore-simboli-lib.md`.
- Guardie: `check_libreria_simboli.sh`, `check_simboli_lvgl.sh`.
