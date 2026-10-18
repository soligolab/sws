# Cornici di pagina: testata e piede comuni a più pagine

## Context

Richiesta del maintainer (15-10-2026), rivedendo CasaDomotica: in molti SCADA c'è il concetto di **frame** o
workspace, simile a intestazione e piè di pagina di Word: una parte della pagina che resta uguale su tutte le pagine
che la usano. Esempio concreto: barra di navigazione in basso, data e ora in alto, identiche su ogni pagina; si
modificano in un punto e cambiano ovunque. Più cornici per progetto, una predefinita per le pagine nuove,
sostituibile pagina per pagina, partendo da modelli base modificabili.

Scelte del maintainer (15-10-2026):
- il nome è **Cornice**;
- **fasce riservate**: testata e piede con un'altezza propria, disegnati **sotto** il contenuto. Nella pagina si
  vedono ma non si modificano; il validatore avvisa se un oggetto della pagina ci finisce sopra;
- **oggetto nuovo «Data e ora»** (orologio del dispositivo che mostra la pagina, web e LVGL);
- **segnaposti per pagina** nei testi della cornice, a partire da `{{pagina.nome}}`.

Approvato dal maintainer il 15-10-2026. Prove su CasaDomotica nel cloud (copia di sicurezza fatta prima: `~/sws-vps/backup-manuali/CasaDomotica-20261015-161553.tar.gz` sul VPS e in `~/sws-backup-vps/` sulla macchina `ufficio`).

## Misurato oggi (main `443913f0` + ramo `fix/gateway-container-sparito`)

- **Faceplate**, il parente più vicino: definizioni di progetto in `faceplates/*.yaml` (`FaceplateDef`: id, label,
  parametri, oggetti relativi all'origine), rotte `/api/faceplates`, incluse in esportazione, importazione ZIP,
  deploy remoto (`remote.rs`, cartelle `synoptics` e `faceplates`) e istantanea; disegnate anche da LVGL
  (`render_faceplate`). Le cornici seguono lo stesso schema di file e trasporto.
- **Layout di progetto** (`page_layout`, `PageLayoutConfig`): ha già i predefiniti delle pagine nuove (`default_width`,
  `default_height`, `default_background`), `home_page_id` e `hide_viewer_chrome`. Qui va la cornice predefinita.
- **Caricamento di una pagina**: un punto solo, `get_synoptic` (`sws-web/src/router.rs`), per l'IDE, per il viewer web
  e per LVGL (`sws-lvgl-viewer/src/client.rs`, `fetch_page`).
- **Impronta del progetto** (`/api/project/fingerprint`): oggi solo `project.yaml` più le pagine. Va estesa alle
  cornici, altrimenti modificare una cornice non ricaricherebbe i viewer.
- **Data e ora**: nessun oggetto le mostra. Esiste solo il tipo di variabile `datetime`.

## Il modello

- `cornici/<id>.yaml`: `{ id, nome, larghezza, altezza, testata: { altezza, sfondo? }, piede: { altezza, sfondo? }, oggetti: [...] }`.
  Gli oggetti sono in **coordinate di pagina** e devono stare dentro le fasce.
- `page_layout.cornice_predefinita?: string`: la cornice delle pagine che non ne dichiarano una, e di quelle nuove.
- `SynopticPage.cornice?: string | null`: assente = la predefinita; un id = quella cornice; `null` = nessuna cornice.
- Segnaposti nei campi di testo degli oggetti della cornice: `{{pagina.nome}}`, `{{pagina.id}}`,
  `{{progetto.nome}}`. Si risolvono prima dei token di lingua (`{{tNNNN}}`), con cui non collidono.

## La composizione: una sola, nel runtime

`GET /api/synoptics/:name?cornice=1` restituisce la pagina **composta**: oggetti della cornice in testa (sotto),
segnaposti risolti, id con prefisso (`cornice:<id>:<oggetto>`), contrassegnati come non modificabili. Senza il
parametro la pagina esce com'è nel file: è quello che legge l'IDE. Il viewer web e LVGL chiedono la versione
composta, così la regola vive in un punto (Rust, `sws-web`) e i due motori la ricevono uguale; la parità web/LVGL
resta quella degli oggetti, già coperta.

## Rami (uno alla volta)

**Ramo 1 — `feat/oggetto-data-e-ora`** (piccolo, utile da subito, prerequisito dei modelli)
- Tipo `clock` («Data e ora»): formato (data, ora, data e ora, personalizzato), secondi sì/no, lingua; legge
  l'orologio del dispositivo; aggiornamento ogni secondo. Web (`SvgCanvas.tsx`) e LVGL (`lvgl_render.rs`, timer).
- Palette (gruppo Indicatori), icona in `iconeStrumenti.ts`, specchi del modello (`types/index.ts`, `synoptic.rs`,
  `model.rs`), schema rigenerato, `check_lvgl_parity`, inventari dei campi, guardia delle icone.

**Ramo 2 — `feat/cornici`** (il cuore)
- Modello e archivio: `cornici/*.yaml`, rotte `/api/cornici` (elenco, leggi, salva, cancella), inclusione in
  esportazione, importazione ZIP, deploy remoto, istantanea e impronta del progetto. Validatore: oggetti fuori dalle
  fasce, cornice inesistente, misure diverse da quelle della pagina, oggetti della pagina dentro le fasce (avviso).
- Composizione in `get_synoptic` (`?cornice=1`); viewer web e LVGL la chiedono.
- Editor:
  - ramo **Cornici** nell'albero, accanto a Pagine; una cornice si apre sul canvas come una pagina, con le due
    fasce disegnate;
  - nella pagina, la cornice si vede attenuata e non selezionabile, con il rimando «Modifica la cornice»;
  - proprietà della pagina: menu «Cornice» (Predefinita del progetto · una delle cornici · Nessuna);
  - impostazioni del progetto: cornice predefinita.
- **Modelli base** da cui crearne una: «Testata con titolo, data e ora + barra di navigazione in basso», «Solo barra di
  navigazione in basso», «Solo testata», «Vuota». Alla prima pagina di un progetto l'editor propone di sceglierne una.

**Ramo 3 — `feat/cornici-casadomotica`** (applicazione)
- Template `comandi-pompa-pozzo` e almeno un altro template portati sulle cornici.
- Manuale, capitolo dell'editor; NOVITÀ.
- Su CasaDomotica lo fa il maintainer dall'IDE (la barra di navigazione di «Finestre e porte» finisce nella cornice).

## Fuori da questo piano

- Fasce laterali (sinistra/destra) e più livelli di cornice annidati: se serviranno, come seme.
- Conversione fra risoluzioni (seme [scalare-tra-risoluzioni](2026-10-15-scalare-tra-risoluzioni.md)): una cornice
  ha misure sue e si applica a pagine delle stesse misure.

## Verifica (per ogni ramo)

- `cargo check`, `cargo test` (sws-core, sws-web, sws-lvgl-viewer), `pnpm build`, vitest e `./scripts/check_static.sh`.
- Test della composizione in Rust: segnaposti, prefissi, nessuna cornice, cornice predefinita, `null`.
- Dal vivo:
  - un runtime di prova con due cornici e tre pagine (predefinita, sostituita, nessuna);
  - viewer web e istantanea LVGL confrontati;
  - modificata la cornice, i viewer si ricaricano;
  - nell'IDE, la cornice attenuata e non selezionabile nella pagina (Playwright).
- Collaudo sul TC620 per l'orologio e per la composizione su LVGL.
