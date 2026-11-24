# Il navigatore delle pagine su più righe (seme, 24-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi.

## L'idea

Il maintainer, 24-11-2026, chiedendo una copia verticale di CasaDomotica per il TC620: «con il menù in basso su due
righe». Poi: «Per ora un navigatore unico, crea un seme per il multi riga».

Un progetto verticale (800×1280) ha poco spazio in larghezza: con una decina di pagine radice, i bottoni di un
navigatore orizzontale su una riga sola diventano stretti e i nomi si tagliano.

## Le misure di oggi

- `page_navigator` (`sws-editor/src/types/index.ts`, campi `nav_*`): `nav_orientation` orizzontale o verticale,
  `nav_fill` (i bottoni si dividono lo spazio) o `nav_btn_size` fisso, `nav_align`, `nav_gap`, le voci da
  `nav_source` o `nav_items`. **Nessuna opzione per andare a capo** o per un numero di righe.
- Due motori: il web (`PageNavigatorView.tsx`) e LVGL (`lvgl_render.rs`). La regola di parità
  (`check_lvgl_parity`) vuole la funzione su tutti e due.
- Ripiego possibile senza codice: due navigatori nella cornice, ciascuno con il suo `nav_items`.

## Le domande per la sessione di plan

1. **La forma**: un numero di righe fisso (`nav_rows`), oppure l'andare a capo automatico quando i bottoni scendono
   sotto una larghezza minima?
2. **L'ordine**: le voci riempiono una riga e poi la successiva, o si dividono a metà?
3. **La riga dell'attiva**: la voce attiva resta dov'è, o la sua riga passa vicino al contenuto?
4. **LVGL**: un flex con wrap (`LV_FLEX_FLOW_ROW_WRAP`) basta, o serve una griglia per allineare le colonne?
5. **Verticale**: vale anche per `nav_orientation: vertical` (più colonne)?
6. **CasaDomotica**: la copia verticale per il TC620 è il caso di prova naturale.
