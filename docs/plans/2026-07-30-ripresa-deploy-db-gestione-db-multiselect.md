# Piano di ripresa (sessione interrotta — "è tardi", da riprendere in ufficio)

Tre filoni aperti, non ancora eseguiti (siamo rimasti in plan mode di proposito). Nessuna modifica
è stata fatta oltre a quanto già presente nel working tree (vedi §0). Quando riprendi: leggi questo
file, poi `ExitPlanMode` (o chiedimi di rientrare in plan mode se vuoi rivedere qualcosa prima).

## Azione immediata richiesta ora (prima di riprendere in ufficio)

Il maintainer ha chiesto esplicitamente di pushare subito il fix del drag (§3), pur sapendo che
probabilmente non funziona ancora — per non perderlo. Azione concordata: creare un branch dedicato
WIP (es. `fix/multiselect-drag`), committare il diff così com'è con un messaggio che dichiara
esplicitamente lo stato "WIP, da verificare/correggere", e pusharlo su origin. Non tocca `main`.

## §0 — Stato del working tree ORA (importante, leggere per primo)

`git status --short` mostra **un solo file modificato, non committato**:
```
M sws-editor/src/canvas/SvgCanvas.tsx
```
È il fix del drag multi-selezione (vedi §3). **Non è ancora stato messo su nessun branch dedicato**
perché il task successivo (deploy/DB, §1-§2) doveva comunque aprirne uno nuovo — quando riprendi,
la prima decisione è: questo fix va su un branch SUO (piccolo, isolato, non c'entra con
deploy/database) o lo includi nello stesso branch del lavoro deploy/DB? Consiglio: **branch separato**,
sono due bug/feature indipendenti (coerente con la convenzione del progetto in `CLAUDE.md`, un
branch per task).

`main` locale è pulito/allineato a `origin/main` a parte questo file. Gli ultimi commit su `main`
sono solo `docs(status)` di chiusura sessione — nessun lavoro di codice perso o da recuperare oltre
a questo diff.

---

## §1 — BUG: il "Deploy" cancella il database del dispositivo (richiesto: branch dedicato)

### Contesto

Il maintainer: *"il deploy va a ricaricare nel progetto anche l'eventuale database, questo non deve
succedere, se il database nel dispositivo esiste deve essere mantenuto ed eventualmente va fatta la
migrazione per aggiungere valori."*

**Causa confermata leggendo il codice (non un'ipotesi)** — ricerca già fatta:

- `POST /api/remote/deploy` (`sws-runtime/crates/sws-web/src/remote.rs:209-348`, funzione
  `remote_deploy`) fa, per ogni progetto già presente sul target: `GET /api/projects` → elenco →
  `POST /api/projects/close` → **`DELETE /api/projects/{name}`** per ognuno (righe 242-263, commento
  esplicito riga 239-240: *"wipe every existing project on the target so the deploy fully
  overwrites it"*) → poi `POST /api/projects/upload` con lo ZIP nuovo → `POST
  /api/projects/{name}/open`.
- `DELETE /api/projects/:name` → `delete_project` (`sws-runtime/crates/sws-web/src/projects.rs:606`)
  esegue **`tokio::fs::remove_dir_all(&target)`** sull'**intera cartella progetto**, `.history/`
  (il database SQLite storico) compreso. Nessuna esclusione.
- Lo ZIP esportato dall'IDE (`build_export_zip`, `router.rs:2010-2043`) contiene **solo**
  `manifest.json` + `project.yaml` + `synoptics/*.yaml` + `users.yaml` (se presente) — **non
  contiene mai `.history/`**. Quindi il DB non viene "sovrascritto con uno vuoto dallo ZIP": viene
  **cancellato** al passo delete, e poi `SqliteStore::open` lo ricrea silenziosamente vuoto
  (`CREATE TABLE IF NOT EXISTS`) al prossimo avvio — da qui l'impressione di "ricaricato".
- **Non serve nessuna migrazione di schema**: la tabella `samples` (`sws-historian/src/sqlite.rs`)
  è generica (`tag TEXT, ts_ms, value, quality` — una riga per campione, nessuna tabella per-tag).
  Un tag nuovo nel progetto deployato inizia semplicemente a scrivere righe nella stessa tabella,
  senza bisogno di `ALTER TABLE`/migrazione. Quindi "la migrazione per aggiungere valori" di cui
  parla il maintainer **è già gratis** una volta che smettiamo di cancellare il DB — non serve
  scrivere codice di migrazione a parte.

### Fix proposto

Principio generale (più robusto di un elenco fisso di cartelle da escludere): **il deploy deve
sovrascrivere solo gli artefatti di "design"** (`project.yaml`, `synoptics/*.yaml`) **e non toccare
mai lo stato locale del dispositivo** (`.history/` = database, `.bak/` = backup, `recipes/` = dati
ricette runtime, `.opcua-pki/` = identità crittografica OPC-UA).

1. **`sws-runtime/crates/sws-web/src/projects.rs` — `delete_project`**: nuovo query param opzionale
   `?preserve_state=true`. Quando presente, invece di `remove_dir_all(&target)` sull'intera
   cartella, rimuove **solo** `project.yaml` e l'intera `synoptics/` (vedi §Nota users.yaml sotto)
   — tutto il resto (`.history/`, `.bak/`, `recipes/`, `.opcua-pki/`, logs) resta intatto. Il
   comportamento di default (nessun param, usato dal bottone "Elimina" nella WelcomeScreen) **non
   cambia** — resta distruttivo come oggi, è la scelta intenzionale dell'utente.
2. **`upload_project_zip`** (`projects.rs`): nuovo query param `?deploy=true`. Oggi risponde 409 se
   la cartella target esiste già. Con questo flag, se la cartella esiste (perché il passo 1 l'ha
   appena "svuotata" solo dei file di design), **non rifiuta** — estrae lo ZIP dentro la cartella
   già esistente (che ha ancora `.history/` intatto).
3. **`remote.rs` — `remote_deploy`**: prima di cancellare i progetti già presenti sul target,
   confronta il **nome** di ciascuno con il nome del progetto che si sta deployando (già noto,
   serve a costruire lo ZIP):
   - **stesso nome** (il caso comune: ridistribuire lo stesso progetto dopo modifiche in IDE) →
     `DELETE .../{name}?preserve_state=true` invece della delete distruttiva; poi
     `POST .../upload?deploy=true&name={name}`.
   - **nome diverso** (si sta sostituendo un progetto con uno completamente diverso) → comportamento
     di oggi invariato (delete totale) — non ha senso "preservare" lo storico di un progetto che
     non è quello che stai deployando.

### Decisione da confermare (non presa da solo, nessuno per rispondere ora)

`users.yaml` (utenti/password del dispositivo) è incluso oggi nello ZIP export/import, quindi un
deploy lo sovrascrive già con quello dell'IDE. È un problema **analogo** al database — account
locali del dispositivo sostituiti a sorpresa da quelli (probabilmente vuoti/diversi) del progetto
IDE. Non l'hai menzionato esplicitamente, quindi non ho deciso da solo: **la mia proposta di default
è di trattarlo come "stato locale" e NON sovrascriverlo mai col deploy** (stessa logica del
database — coerente, un deploy non dovrebbe cambiare chi può loggarsi sul device), ma è una scelta
che riguarda la sicurezza degli accessi quindi meglio la confermi tu. Se preferisci il comportamento
attuale (users.yaml sempre sovrascritto dal deploy), va escluso dal punto 1 sopra.

### File da toccare
- `sws-runtime/crates/sws-web/src/projects.rs` (`delete_project`, `upload_project_zip`)
- `sws-runtime/crates/sws-web/src/remote.rs` (`remote_deploy`)

### Verifica
- Progetto A aperto su un runtime con storico reale (es. Sandokan, ha già ore di dati). Deploy dello
  stesso progetto A modificato dall'IDE → dopo il deploy, `.history/historian.db` ha lo **stesso**
  `first_ts`/conteggio campioni di prima (non azzerato) — verificabile via
  `GET /api/history/:tag/stats` prima/dopo, come già fatto nella sessione precedente per il bug del
  riavvio.
  - Deploy di un progetto B con nome diverso sullo stesso target → comportamento distruttivo
  di oggi (comportamento voluto, è un progetto diverso).
- `cargo build` + `pnpm build` verdi.

---

## §2 — FEATURE: sezione "Gestione database" nell'IDE

### Contesto

Il maintainer: *"aggiungi una sezione per la gestione dei database del dispositivo come clean,
rimozione tabelle non in uso, backup e tutte le funzioni utili"* — indica come posizione possibile
"Configurazione → Runtime" **o** "Configurazione → Database" (lascia a me la scelta).

**Scoperta importante**: buona parte del backend **esiste già ma non è mai stata collegata alla
UI**:
- `POST /api/datastores/:id/purge` (`{retention_rows, retention_days}`) — esiste, client
  `api.purgeDatastore` esiste (`sws-editor/src/api/client.ts:723`), **nessun bottone la chiama**.
- `GET /api/datastores/:id/export` — esiste, client `api.exportDatastore` (client.ts:730),
  **nessun bottone la chiama**.
- `GET /api/datastores/:id/stats` — questo invece **è già usato** dalla tab Datastore esistente.
- Il **backup completo** (`BackupsTab`, tab "Backup" già esistente e funzionante) **include già
  `.history/`** (`sws-runtime/crates/sws-web/src/backups.rs:26-32`, costante `BACKED_UP`) — quindi
  "backup del database" **è già coperto** dalla tab Backup esistente, non serve costruirlo da capo,
  solo eventualmente un rimando/nota nella nuova sezione.

**Decisione di design**: estendere la tab **"Datastore" già esistente**
(`DatastoresTab`, `sws-editor/src/config/ConfigView.tsx:5455-5662`) invece di crearne una nuova o
infilarla nella tab "Runtime". Motivo: quando apri direttamente la ConfigView del **runtime sul
dispositivo** (il caso normale, non tramite l'IDE separato), "Datastore" già mostra i backend del
progetto correntemente aperto **su quel device** — è il posto giusto per "gestione del database del
dispositivo connesso". La tab "Runtime" invece serve alla connessione/deploy verso un *altro*
runtime remoto, un concetto diverso.

### Cosa aggiungere (per ogni backend nella tab Datastore esistente)

1. **Pulisci ora** (bottone, richiede conferma) — chiama `api.purgeDatastore(id, {retention_rows,
   retention_days})` già esistente. Riusa i valori di retention già configurati per il backend, con
   possibilità di inserirne di ad-hoc per una pulizia una tantum.
2. **Esporta** (bottone) — chiama `api.exportDatastore` già esistente, scarica i dati.
3. **Tag orfani** (nuovo, richiede backend) — elenco dei tag che hanno campioni nel DB ma non
   esistono più in `project.tags` (es. un tag rinominato o rimosso dal progetto, il suo storico
   resta "orfano" nel DB). Bottone "Elimina" per singolo tag orfano + "Elimina tutti".
4. **Vacuum / Recupera spazio** (nuovo, richiede backend) — mostra dimensione file prima/dopo,
   esegue `VACUUM` (+ `PRAGMA wal_checkpoint(TRUNCATE)` visto che SQLite qui gira in WAL).
5. Nota/link alla tab **Backup** esistente per il backup completo (già fatto, non duplicare).

### Backend da scrivere (nessun endpoint di questo tipo esiste oggi)

- `sws-runtime/crates/sws-historian/src/sqlite.rs` (`SqliteStore`): nuovi metodi pubblici
  `distinct_tags(&self) -> Vec<String>` (query già fatta inline altrove, va estratta/resa
  pubblica), `delete_tag(&self, tag: &str) -> anyhow::Result<u64>` (`DELETE FROM samples WHERE
  tag = ?`, ritorna righe cancellate), `vacuum(&self) -> anyhow::Result<()>` (`VACUUM;` +
  checkpoint WAL).
- `sws-runtime/crates/sws-historian/src/sqlite_backend.rs` (`SqliteBackend`): wrapper che chiamano i
  metodi sopra, stesso pattern di `purge`/`export` già presenti (righe 70-100).
- `sws-runtime/crates/sws-historian/src/registry.rs` (`DatastoreRegistry`): passthrough
  `list_backend_tags(id)`, `delete_backend_tag(id, tag)`, `vacuum_backend(id)`, stesso pattern di
  `purge_backend`/`export_backend` (righe 199-223).
- `sws-runtime/crates/sws-web/src/router.rs`: nuovi handler admin-only, accanto a
  `datastore_purge`/`datastore_export` (righe ~294-307): `GET /api/datastores/:id/tags` (ritorna
  `{db_tags: [...], orphan_tags: [...]}`, confrontando con i tag correnti — da recuperare da
  `s.db`/`TagDb`, verificare a implementazione l'API esatta per ottenere l'elenco id correnti, es.
  `s.db.snapshot()` già vista in `sws-core/src/tag.rs:92` e derivarne le chiavi), `POST
  /api/datastores/:id/delete-tag` (body `{tag}`, audit-logged come le altre azioni admin
  distruttive), `POST /api/datastores/:id/vacuum` (ritorna size prima/dopo).
- `sws-editor/src/api/client.ts`: `listDatastoreTags(id)`, `deleteTagHistory(id, tag)`,
  `vacuumDatastore(id)`.
- i18n: nuove label in `it.json`/`en.json` per bottoni/conferme.

### Verifica
- `cargo build` + `cargo test -p sws-historian -p sws-web` (se esistono test unitari sul modulo
  sqlite, altrimenti aggiungerne per `delete_tag`/`distinct_tags`) + `pnpm build` verdi.
- Sul progetto Sandokan (ha storico reale): rinominare/rimuovere un tag da project.yaml → deve
  comparire come "orfano" nella nuova sezione; eliminarlo → sparisce dal DB (verificabile via
  query diretta sqlite come già fatto in sessioni precedenti); Vacuum → dimensione file non
  cresce dopo la cancellazione (anzi si riduce).

---

## §3 — Multi-select drag: il maintainer dice che è ANCORA rotto

Il fix di ieri (vedi diff in `git diff sws-editor/src/canvas/SvgCanvas.tsx`, non ancora committato —
§0) è ancora nel working tree ma **secondo il maintainer il bug persiste**. Non ho un browser per
verificare — ecco cosa controllare appena si riprende, in ordine:

1. **Escludere prima la spiegazione più banale**: il fix è stato compilato (`pnpm build`, dist
   rebuilt alle 06:45) e l'istanza editor (porta 8460) è partita alle 06:52, **dopo** la build — quindi
   in teoria l'istanza in esecuzione ORA serve già il fix. Ma se il maintainer aveva una scheda del
   browser già aperta da prima, il bundle JS vecchio potrebbe essere ancora in memoria lato client:
   **hard refresh** (Ctrl+Shift+R) prima di ritestare, poi verificare di persona.
2. Se dopo un hard refresh il bug c'è ancora, rileggere con attenzione la logica in
   `SvgCanvas.tsx` (diff completo già in `git diff`, non ripetuto qui) — il ragionamento fatto era:
   - `SvgObject.handleMouseDown`: un click senza shift su un oggetto già selezionato **come parte
     di una selezione multipla** (`selected && selectedCount > 1`) ora salta la chiamata a
     `onSelect` (che altrimenti collasserebbe la selezione a uno solo) e va dritto al drag.
   - `startDrag` cattura la geometria di partenza (`groupStart`) di tutti gli altri oggetti
     selezionati, se `selIds.length > 1 && selSet.has(obj.id)`.
   - Nel drag (`handleMouseMove`), dopo aver mosso l'oggetto "ancora" con tutto lo snap esistente,
     applica lo stesso delta rigido (`newX - startX`, `newY - startY`) a tutti gli oggetti in
     `groupStart` via `onMove(g.id, followerPatch)`.
   - Verificata la propagazione dei prop: `EditorShell.tsx` passa correttamente sia `selectedId` sia
     **`selectedIds={selectedIds}`** a `<SvgCanvas>` (riga ~686) — non è un problema di wiring
     mancante.
   - Verificata la consistenza dello store: `selectObject`/`toggleSelection`/`selectMany`
     (`store/index.ts:1086-1114`) mantengono `selectedObjectId`/`selectedObjectIds` coerenti tra
     loro — non c'è un disallineamento ovvio lì.
   - **Non verificato** (serve un browser): se c'è un `onClick` (diverso da `onMouseDown`) su un
     `<g>` padre o un altro handler che interviene fra il mousedown e il primo mousemove e resetta
     la selezione; se `suppressClick`/altri ref usati per il rettangolo di selezione interferiscono
     quando si parte da un oggetto già selezionato; se il problema è specifico di un tipo di
     oggetto diverso da quelli testati mentalmente (linee/pipe/grid).
3. **Metodo di verifica consigliato appena si ha un browser**: aprire l'editor, selezionare 2+
   oggetti semplici (es. due rettangoli) con rettangolo di selezione o shift-click, poi trascinare
   partendo da uno dei due. Se si muovono entrambi → fix confermato funzionante (era solo cache).
   Se si muove solo uno → aggiungere temporaneamente `console.log` in `handleMouseDown`/`startDrag`
   per verificare se `selectedCount`/`selIds.length` sono davvero > 1 nel momento del click (per
   escludere/confermare un problema di timing dei prop React).
4. Una volta risolto per davvero e verificato in browser: commit su un branch dedicato separato dal
   lavoro deploy/DB (vedi §0).

---

## Ordine di esecuzione consigliato alla ripresa

1. Confermare/correggere la decisione su `users.yaml` (§1).
2. Branch dedicato per §1+§2 (stesso ambito, "gestione database" — deploy-safety è il bug, la
   sezione UI è la feature collegata), es. `fix/deploy-preserve-database`.
3. Implementare §1 (fix deploy) per primo — è un bug con perdita dati reale, priorità più alta della
   feature di gestione.
4. Implementare §2 (sezione UI).
5. Branch separato per §3 (drag multi-selezione) — verificare prima con hard-refresh, poi
   eventualmente correggere ulteriormente, poi commit.
6. `cargo build`/`pnpm build`/test verdi su entrambi i branch prima di chiedere verifica al
   maintainer.
