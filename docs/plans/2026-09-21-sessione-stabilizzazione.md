# Sessione di stabilizzazione — piano a passi (21-09-2026)

Scelta del maintainer: **si tocca tutto il blocco A (bug e rischi), B (difetti delle funzioni nuove) e C (collaudi sul TC620)**, **un passo alla volta**, ciascuno con
il suo ramo, il suo collaudo e la sua conferma prima del merge (regola «un ramo alla volta»). Nessun passo comincia se il precedente non è mergiato e i suoi rami eliminati.
Fuori: blocchi D/E (debito, semi) — restano in `docs/plans/README.md`.

Regola comune a ogni passo: `cargo check` + `pnpm build` + `./scripts/check_static.sh` verdi, test nuovi che falliscono senza la correzione, prova dal vivo dove c'è un
comportamento visibile, `CHANGELOG.md`/`STATUS.md` aggiornati, push solo su richiesta.

## Passo 0 — Pulizia e bug piccoli  (ramo `fix/pulizia-2110`)
1. **EtherNet/IP `kind`**: `types/index.ts:1208` e `ConfigView.tsx:1546` usano `'en_ip'`, Rust `#[serde(rename = "enip")]` (`project.rs:362`). Correggere il TS, e aggiungere
   una **guardia** `scripts/check_source_kinds.sh` che confronta i `kind` delle sorgenti fra `enum SourceDef` (Rust) e `SourceDef` (TS) — la classe di difetto è «due elenchi a mano».
   Test: creare una sorgente EnIP dal codice dell'IDE e rileggerla con il parser Rust (round-trip).
2. **Registro dell'IDE**: `known_projects.json` con voci che puntano a cartelle inesistenti (5 `flashtest…`): il runtime dovrebbe **ignorare/potare** le voci morte al caricamento
   (oggi `open_project` dà 404 «project not found» se il registro vince su una cartella che non c'è più — successo il 20-09). Aggiungere: se il percorso registrato non esiste, ripiegare su
   `projects_root/<nome>` e ripulire la voce. Test in `project_registry.rs`.
3. **`start_editor_develop.sh`** cerca ancora i progetti in `.run-editor/projects` mentre il maintainer li tiene in `~/sws_projects`: decidere (una riga in `HOWTO`/`CLAUDE.md` o cambiare il default).
4. **Push** di `main` (2 commit di documentazione dopo il tag) e verifica del container 2.11.0 sul registro (arm64 pubblicato, amd64 in corso al momento della scrittura).
5. **CI**: leggere `.github/workflows/ci.yml` e, se `gh` non c'è, dire al maintainer cosa guardare su GitHub.

## Passo 1 — Le 26 guardie con stack  (nessun ramo, solo lancio; fix su `fix/guardie-stack` se serve)
Lanciare a mano tutte le guardie elencate in `CON_STACK` di `check_static.sh` (e2e `check_e2e.sh`, screenshot) contro un runtime di scarto con un progetto a più pagine. Mai girate contro albero,
pannello sinistro fisso, navigatore, sorgente Host. Per ogni rosso: capire se è la guardia o il codice; correggere. Aspettativa da verificare per prima:
`e2e/screenshots.spec.ts` (clic sull'icona «Pagine», che non c'è più) e `check_e2e.sh --screenshots`.

## Passo 2 — I segreti del progetto  (ramo `feat/segreti-di-progetto`; **sessione di plan dedicata prima di scrivere codice**)
Problema: `notifications.telegram.bot_token`, `smtp.password` e le password/token delle sorgenti (MQTT, OPC-UA, Home Assistant) stanno in chiaro in `project.yaml`. L'API li maschera
(`MASKED_PASSWORD`, `router.rs:2804-2816`), ma il file sul disco no, e il file viaggia in export `.sws`, backup, deploy e — con `POST /api/project/git/init` — in un repository git.
Il token deve **viaggiare col progetto** (un deploy senza il token spegne le notifiche) ma **non finire dove non deve**.
Soluzione proposta: **`secrets.yaml` nella cartella del progetto**, permessi 0600, con i valori; `project.yaml` non li contiene più (campo assente = «vedi secrets»).
- **Deploy** al dispositivo e **backup/ripristino**: lo includono (senza, il progetto non funziona).
- **Export `.sws` per condividere, template, git**: lo escludono di default (casella «includi i segreti», spenta); `git init` scrive un `.gitignore` con `secrets.yaml`, e un repository già esistente riceve
  un avviso se `secrets.yaml` è tracciato.
- **Migrazione automatica** all'apertura di un progetto vecchio (con backup prima e avviso a video): sposta i valori in chiaro nel nuovo file.
- **Log e audit**: verificare che nessuno stampi i valori; guardia statica che cerca `bot_token`/`password` nei `tracing::` e nei `println!`.
- Decisioni da confermare a inizio passo: tutti i segreti o solo Telegram/SMTP per cominciare; cifratura a riposo (chiave dell'istanza) sì/no — sconsigliata in v1, complica il deploy.

## Passo 3 — Il viewer LVGL segue l'albero  (ramo `fix/lvgl-albero`)  [punto B7]
1. `resolve_start_page` (`sws-lvgl-viewer/src/client.rs:~357`): senza pagina iniziale dichiarata usa oggi `names.first()` (alfabetico). Passare da `GET /api/pages/nav`:
   home dichiarata → altrimenti la **prima dell'albero** (`riconcilia` + `appiattisci` di `sws-core::page_tree`). Test con la fixture condivisa.
2. **Navigatore**: la lettura dell'elenco a ogni render è una richiesta HTTP bloccante con un client nuovo (B8). Ridurla: rileggere solo al cambio di progetto (Q20) e alla prima apertura, altrimenti usare
   l'ultimo elenco; nei figli di griglia/faceplate non si rilegge. Provare con `--istantanea`/`--tocca` e misurare i tempi di cambio pagina.
3. Prova sul TC620 nel Passo 6.

## Passo 4 — L'albero nella cronologia e nel salvataggio  (ramo `fix/albero-annulla`)  [punti B9, B10]
Oggi l'albero si scrive subito sul server (debounce 300 ms) e non è annullabile; una pagina nuova non salvata è nell'albero scritto. **Proposta (default del piano): l'albero entra nella cronologia
come le pagine e si scrive in `saveAll`** insieme a loro: Ctrl+Z annulla spostamenti/eliminazioni/aggiunte, «Salva» scrive pagine e albero insieme, niente id orfani sul server, e il viewer vede l'albero
solo quando vede le pagine. Costo: `HistoryEntry` guadagna `pageTree`; `impostaAlberoPagine` non chiama più `persistiAlbero`; `saveAll` fa `api.updatePageLayout` se l'albero è cambiato rispetto
all'ultimo scritto (nuovo `savedPageTree`); il «dirty» dell'IDE conta anche l'albero. Test: undo/redo di un trascinamento; salvataggio unico; ricarica dopo l'annulla. **Alternativa** (scrittura immediata
+ conferma sull'eliminazione) da riprendere solo se il maintainer preferisce che l'albero sia «subito live».

## Passo 5 — Il resto del blocco B  (un ramo `fix/rifiniture-navigazione`)
- **B11 catalogo Host**: `GET /api/host/catalog` risponde per la macchina dell'IDE. Se l'IDE è collegato a un runtime remoto, instradare la richiesta al remoto (come le altre rotte `/api/remote/*`) e dichiararlo nella scheda;
  senza remoto vale il locale. Test sul proxy.
- **B12 barra del viewer**: `RuntimeView.tsx:381` mappa `pages` invece di `paginePerNavigazione(pages)`: verificare se nell'anteprima dell'IDE compaiono le pagine di boot; correggere e coprire con un test.
- **B13 `homeassistant-pro`**: il banner allarmi (`pro1_alarm_banner`, y 683.9–774) copre la barra di navigazione (y 738–782): spostare/ridurre il banner o alzare la barra (regole del parco R1–R5).
- **B14 schermo pieno**: `hide_viewer_chrome` + navigatore. Nota nel manuale 05 e, se il maintainer vuole, un avviso nell'IDE quando una pagina non ha nessun mezzo di navigazione.

## Passo 6 — Collaudo sul TC620  (nessun ramo; produce solo `STATUS.md` e, se serve, correzioni)
Lista di controllo con i comandi (il maintainer esegue, Claude legge i risultati solo con il via libera per il dispositivo di quel giorno):
1. Temperatura della sorgente Host (`thermal_zone` ≈ 60 °C) e stabilità di CPU/RAM/rete a 2 s.
2. Navigatore web e **LVGL** sul pannello vero: barra in fondo, colonna verticale, `children_of_current`, pagina nascosta da un navigatore e raggiunta da un altro.
3. Albero: ordine e gerarchia dopo un deploy e un riavvio del runtime.
4. **Immagine di boot dentro il container** (`docs/plans/2026-09-19-boot-image-collaudo-container.md`): con il runtime nel container, abilitare una pagina di boot e verificare `boot-image/status`.
5. **Q55**: una scrittura autenticata verso un 200 dal viewer LVGL (thread di rete) — osservare che completi; se sì, annotare la chiusura dell'ipotesi.
6. Segreti (dopo il Passo 2): deploy di un progetto con Telegram e verifica che la notifica parta; export senza segreti.

## Ordine e durata (stima)
0 → 1 → 2 → 3 → 4 → 5 → 6. Il Passo 2 è il più grosso (una sessione da solo); 0, 1, 3, 4 e 5 stanno ciascuno in mezza sessione; il 6 dipende dal container ricostruito e dal maintainer.

## Rischi
- Il Passo 2 tocca ogni percorso che legge o scrive `project.yaml` (deploy, backup, export, git, AI): serve una lista di controllo dei percorsi prima del codice.
- Il Passo 4 cambia il significato di «l'albero è live»: va confermato prima.
- Il Passo 1 può far emergere regressioni non previste: il tempo del Passo 1 va lasciato elastico.
