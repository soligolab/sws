# Albero delle pagine, pannello sinistro sempre visibile, navigatore di pagine

Sessione di plan del 20-09-2026 (misure sul codice di quel giorno). Due rami annidati: **F1 `feat/albero-pagine`** (albero + pannello) e
**F2 `feat/page-navigator`** (oggetto navigatore, web + LVGL). F1 è utile da solo.

## Richieste del maintainer
1. L'albero delle pagine sempre visibile a sinistra (dopo T-56 il pannello mostra una vista alla volta: le pagine spariscono aprendo la palette).
2. Gerarchia + ordine delle pagine, rappresentati visivamente e modificabili (trascinamento).
3. Un oggetto navigatore che mostri un bottone per pagina, orizzontale/verticale, pagina corrente evidenziata, nome/ordine sovrascrivibili, con pagine
   escludibili e sorgenti: tutte / figli di un nodo / figli della pagina corrente / radici + percorso (briciole). Web **e** LVGL.

## Misurato (codice del 20-09-2026)
- **L'ordine delle pagine non è mai persistito.** `list_synoptics` (`router.rs:4575`) ordina alfabeticamente i nomi dei file; `reorderPage`/`movePage`
  (`store/index.ts:1039/1052`) toccano solo l'array in memoria e a ogni ricarica torna l'alfabeto. Nessun campo `order`/`position` né nel TS né in Rust.
- `PageLayoutConfig` (`types/index.ts:1340`, `sws-core/src/project.rs:1366`) ha `home_page_id`, `boot_page_id`… Il DTO di scrittura `PageLayoutBody`
  (`router.rs:7075`) ha `deny_unknown_fields`: un campo nuovo va aggiunto a TS, `PageLayoutConfig`, `PageLayoutBody` + `From` e ai test, o si perde/si rifiuta.
  `ProjectPageLayoutSettings.costruisciCfg` (`EditorShell.tsx:2061`) ricostruisce il layout campo per campo: deve preservare `page_tree` (come `boot_page_id`).
- Nessun codice ripulisce id di pagina orfani (`home_page_id`, `boot_page_id` tollerano id stantii): l'albero ha bisogno di una riconciliazione propria.
- `PagesSection` (`LeftPanel.tsx:126-490`): elenco piatto con drag&drop già presente (payload `application/x-sws-page`), ↑/↓, duplica, esporta, rinomina, elimina, blocca,
  miniatura, 🏠/⚠️, «nuova pagina», import YAML; sezione a parte per le immagini di boot (`boot/…`, ordinabili? no). Nessun menu contestuale.
- Pannello sinistro: barra icone `VISTE` (6 viste, una alla volta, `ModoVista`), larghezza persistita (`LEFT_PANEL_WIDTH_KEY`), memorie sotto `PREFISSO_MEMORIA`.
  `tests/pannelloSinistro.test.tsx` asserisce 6 tab e la sezione Pagine: va aggiornato.
- Viewer LVGL: `list_synoptics` (`client.rs:204`) dà solo i nomi dei file; `resolve_page_by_id` scansiona tutte le pagine; nessuna lista con id.

## Decisioni (F1)
- **Dove**: `page_layout.page_tree` in `project.yaml`, un solo posto: `[{ id, children: [...] }]` (ordine = ordine dell'array; nodi annidati). Campo assente = albero piatto in ordine alfabetico
  (comportamento di oggi: nessuna migrazione).
- **Riconciliazione** (funzione pura, ovunque si legga l'albero): scarta id inesistenti e duplicati, appende in coda alla radice le pagine mancanti (nell'ordine in cui arrivano), mai le boot.
- **Ordine effettivo**: `appiattisci(riconcilia(tree, pagine))` in profondità. Lo store riordina `pages` con quell'ordine ogni volta che cambiano pagine o albero, così barra del viewer, PageTabs,
  auto-rotate, swipe e `pickInitialPageId` lo seguono senza altre modifiche. `movePage`/`reorderPage` diventano operazioni sull'albero.
- **Scrittura**: come le altre impostazioni di pagina — `api.updatePageLayout` subito (fuori da `saveAll`), poi `updateProjectPageLayout`; il segnale al sorvegliante è ora centrale in `request()`.
  Una pagina nuova non ancora salvata può essere nell'albero: se non arriva su disco l'id viene scartato alla riconciliazione.
- **Elimina un nodo**: i figli salgono al livello del genitore, nella stessa posizione. **Sposta**: rifiutato se genera un ciclo (nodo dentro un suo discendente).
- **Pannello sinistro**: l'albero in alto, fisso; sotto le altre 5 viste (palette, struttura, funzioni, tag, sorgenti) con la barra icone; separatore orizzontale trascinabile fra i due
  (altezza ricordata `PREFISSO_MEMORIA + "sinistra.altezzaAlbero"`), pulsante per comprimere l'albero (stato ricordato). La voce «Pagine» esce da `VISTE`.
- **Albero interattivo**: rientri, chevron espandi/comprimi (stato ricordato per id), riga della pagina corrente evidenziata, drag&drop con tre zone per riga (prima / dentro / dopo, indicatore
  a linea o a contorno), pulsante «+» per aggiungere una pagina figlia, le azioni esistenti per riga (rinomina, duplica, esporta, blocca, elimina). Le immagini di boot restano una sezione sotto l'albero.
- **Fuori scope F1**: mappa grafica dell'albero, menu contestuale.

## Decisioni (F2)
- Tipo `page_navigator`; campi piatti su `SynopticObject` (TS, `sws-web/src/synoptic.rs`, `sws-lvgl-viewer/src/model.rs`): `nav_orientation`, `nav_fill`, `nav_btn_size`, `nav_align`, `nav_gap`,
  `nav_active_fill`, `nav_active_color`, `nav_source` (`all|children_of|children_of_current|roots`), `nav_node`, `nav_breadcrumb`, `nav_items` (`{page_id,label?,order?,hidden?}[]`).
- Logica pura condivisa `vociNavigatore(...)` (TS) + gemella Rust con fixture JSON comune. Web: componente dedicato letto dallo store, contenuto reale + hit-rect in edit (regola WYSIWYG).
- LVGL: endpoint `GET /api/pages/nav` → `{pages:[{id,name}], tree}`, cache `SharedPages`, `render_page_navigator` a coordinate assolute, click → `nav_tx.send(id)`.
- i18n: `nav_items[].label` risolto come `options[].label` in `localizeObject` e in `resolve_msg` LVGL; «Migra i testi» esteso.
- Guardie: `LVGL_SUPPORTED_TYPES`, `check_lvgl_parity.sh`, schema IA rigenerato, manuale 05, `pageLayout.ts` (orfani: un navigatore `all` raggiunge tutto).

## Verifica
Test puri (`pageTree`, `vociNavigatore`) con fixture condivise TS/Rust; `pannelloSinistro.test.tsx` aggiornato; provare dal vivo su runtime di scarto con un progetto a 6 pagine su 2 livelli
(trascinamento, ricarica: l'ordine sopravvive, albero visibile con palette/tag aperti); LVGL su SDL2/Xvfb e sul TC620 di test col container nuovo.

## Stato (20-09-2026, sera)
**F1 e F2 implementati** sui rami annidati `feat/albero-pagine` → `feat/page-navigator`. Provato dal vivo su un runtime di scarto: albero con
trascinamento e ordine che sopravvive alla ricarica, albero visibile con la palette aperta, navigatore nel viewer web (voci nell'ordine dell'albero,
pagina corrente evidenziata, clic che naviga), navigatore aggiunto dalla palette dell'IDE, viewer LVGL (`--istantanea`, SDL dummy) con lo stesso menù
e il clic che chiede la pagina giusta. **Restano**: collaudo del maintainer sull'IDE vero, prova sul TC620 col container nuovo, un template esempio con
albero e navigatori laterali/verticali (oggi solo la barra in fondo a `demo-items`), e — fuori dal piano — le voci gerarchiche indentate in un
navigatore verticale (`nav_indent`), non richieste.

## Stato (24-09-2026): collaudato sul pannello vero, resta il template

I due «restano» che dipendevano dall'hardware sono chiusi, e non sul TC620 ma sul **WP630**:

- **Collaudo del maintainer**: fatto sull'IDE vero il 23-09 (rifiniture del blocco B) e sul pannello
  il 24-09, navigando **col dito** fra le pagine.
- **Prova sul dispositivo col container nuovo**: fatta. Prima con `podman exec … --istantanea` sui
  quattro casi (barra in fondo, colonna verticale, `children_of_current` che su una foglia mostra le
  sorelle col percorso davanti, pagina esclusa da un navigatore e raggiunta da un altro), poi **a
  schermo**, col viewer LVGL che disegna sul pannello al posto di Chromium.

**Chiuso dal maintainer il 24-09-2026**: «per conto mio è concluso, ho fatto alcuni sinottici con
il menù pagine in basso e sui lati, direi che il test è ok». Il collaudo che il piano chiedeva è
quindi fatto, e sui suoi progetti veri invece che su un esempio costruito apposta.

**Quello che resta fuori, dichiarato**: il **template d'esempio** con navigatori laterali/verticali
non è stato aggiunto al parco di `examples/templates/`, dove c'è ancora solo la barra in fondo di
`demo-items`. Non è un pezzo mancante della funzione — è materiale dimostrativo. Se un giorno
servirà (per un manuale, per una demo, o per dare a `check_templates.sh` un caso verticale su cui
lavorare), si fa in mezz'ora partendo dai sinottici del maintainer.

**Un difetto trovato dal collaudo, e già corretto** (`a833177a`): una pagina senza navigatore su
LVGL è un vicolo cieco, perché quel viewer non ha una barra propria. La regola B14 esisteva ma
guardava solo `hide_viewer_chrome`. Ora copre anche i target LVGL.

**Scarti dal piano, e perché**: la cache dell'elenco pagine lato LVGL è una `static` in `client.rs` (`aggiorna_pagine_nav`), non un `SharedPages` infilato in tutta
la catena dei renderer; l'etichetta di `nav_items` la risolve il navigatore stesso (web: `vociNavigatore` con la lingua del contesto; LVGL: `resolve_msg` nel renderer),
quindi `localizeObject` e la lista `TEXT_FIELDS` non sono cambiate; «Migra i testi» non tocca ancora le etichette degli override (nascono già come `{{token}}`
dal campo tradotto dell'editor). Stato del pannello e dell'albero: `PagesSection` resta in `LeftPanel.tsx` (non in un file a parte).
