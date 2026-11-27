# Il deploy di un progetto con un altro nome: l'identità d'impianto, e lo storico che segue i tag rinominati

> **Stato: pronto** — rivisto col maintainer il 27-11-2026 (era «piano da rivedere»). Nato dal collaudo della 2.27.0
> sul TC620. Il dettaglio del collaudo e dei rimedi a mano è in `docs/COLLAUDI_IN_SOSPESO.md`, sezione «Collaudo 2.27.0».

## Contesto

Collaudo 2.27.0 sul TC620 (27-11-2026). Il deploy di `CasaDomotica (TC620_Verticale)` sul pannello che aveva
`CasaDomotica` ha cancellato 1,6 GB di storico e gli utenti. Il registro del deploy ha scritto «Utenti: non toccati».
La copia verticale non ha chiesto la rotazione. Il maintainer distingue **tre casi** quando un progetto cambia nome:

1. **Copia di lavoro o di archivio** («Progetto1_prova1», «Progetto1_Testcolori»): sul pannello è sempre lo stesso
   impianto. Il deploy tiene tutto: storico, utenti, backup, segreti.
2. **Derivato per un altro prodotto dello stesso cliente**: lo storico si cancella, gli utenti restano.
3. **Progetto del tutto nuovo**: si cancella tutto.

Decisioni del maintainer (27-11):
- la scelta fra «stesso impianto» e «progetto diverso» si fa in **«Salva come»**;
- lo **storico dei tag rinominati** entra in questo piano.

## Le misure (27-11)

- `ProjectMeta` (`sws-core/src/project.rs:10`) ha solo `name` e `version`. `merge_preserved` (`router.rs:~6713`)
  conserva solo le chiavi sconosciute di primo livello: un campo nuovo in `meta` va dichiarato in `ProjectMeta`.
- `duplicate_project` (`projects.rs:2722`) copia tutto (`history/`, `users.yaml`, `secrets.yaml`, `backups/`) e
  **non** riscrive `meta.name` (il commento di `patch_project_name`, `projects.rs:3719`, dice il contrario): da
  verificare e correggere.
- Deploy (`remote.rs`): `progetti_da_sostituire` (3213), 428 `sostituisce-progetti` (3518), ciclo di cancellazione
  (3696-3740, stesso nome = `?preserve_state=true`, che toglie solo `DESIGN_ARTIFACTS`). `ProjectListEntry`
  (`projects.rs:167`) non ha l'identità. IDE: `store/conferme428.ts:144`.
- `rename_project` (`projects.rs:2552`) esiste dalla 2.1.1 ma **non è nel router del pannello** (`deploy_only_app`,
  `router.rs:2047`).
- Storico SQLite (`sws-historian/src/sqlite.rs:67`): dizionario `tag_storico(id, nome UNIQUE)` + `campioni(tag_id…)`.
  Rinominare = una riga; se il nome nuovo esiste già, si fondono i campioni. Postgres (`postgres_backend.rs:30`) ha il
  nome in ogni riga. La migrazione dal formato vecchio (`samples`) può essere in corso.
- «Rinomina ovunque» dell'IDE (`tag/rinominaTag.ts:211`, `store/index.ts:3282`) riscrive i riferimenti ma non lo
  storico, e nessuna chiamata arriva al runtime. I «tag orfani» (`DatastoresTab.tsx:374`, `GET /api/datastores/:id/tags`)
  hanno solo «cancella».
- `DatastoreRegistry` si costruisce solo all'apertura (`projects.rs:1545`): dopo una rinomina il nome nuovo non ha la
  rotta dello storico finché il progetto non si riapre. Da verificare e correggere.
- Orientamento: `cambiaOrientamento` (`formatoProgettoAzioni.ts:85`) scambia sempre le misure; il deploy chiede la
  rotazione solo con `page_layout.orientation: portrait` (`remote.rs:3596`).

## Cosa si fa

### A. L'identità d'impianto

1. `ProjectMeta.plant_id: Option<String>` (`#[serde(default, skip_serializing_if)]`), e `meta.plant_id?` nel tipo TS.
2. Un progetto nuovo (`create_project`, anche da template) riceve un `plant_id` nuovo. Un template non porta il suo.
3. **«Salva come»** (`MainMenu.tsx:129`): la finestra del nome ha due scelte, **«Copia dello stesso impianto»**
   (default) e **«Progetto nuovo (un altro impianto)»**. `duplicateProject` porta `new_plant: bool`.
   `duplicate_project`: riscrive `meta.name` (correzione); con `new_plant` dà un `plant_id` nuovo e non copia
   `history/` e `backups/`. Gli utenti si copiano in tutti e due i casi.
4. Un progetto senza `plant_id` (tutti quelli di oggi) lo riceve alla prima scelta del deploy (sotto), non prima: due
   copie vecchie dello stesso impianto non devono ricevere due identità diverse da sole.

### B. Il deploy con un nome diverso

1. Il pannello dice l'identità: `ProjectListEntry.plant_id` (letto da `project.yaml`).
2. Il router del pannello (`deploy_only_app`) riceve la rinomina (`/api/projects/:nome/rename`, Admin) e la
   cancellazione che **tiene gli utenti** (`DELETE …?keep=users`: resta solo `users.yaml`).
3. `remote.rs`, prima di cancellare:
   - **stesso `plant_id`** → caso 1, **senza domande**: rinomina sul pannello, poi il deploy a stesso nome
     (`preserve_state`). Riga nel registro: «stesso impianto: storico, utenti e backup conservati»;
   - **`plant_id` diverso** → 428 `sostituisce-progetti` con due risposte: **«Tieni gli utenti del pannello»** (caso 2:
     rinomina, poi `keep=users`, poi upload con `replace_users=false`) e **«Cancella tutto»** (caso 3, come oggi);
   - **identità mancante** (progetto o pannello vecchio) → la stessa domanda con tre risposte, la prima è «È lo stesso
     impianto». Con la risposta 1 il progetto riceve il `plant_id` (nuovo, o quello del pannello se c'è), e viaggia
     col deploy.
4. Un pannello senza la rotta di rinomina (versione vecchia): i casi 1 e 2 si fermano con «aggiorna il pannello per
   conservare storico o utenti»; il caso 3 funziona.
5. **Il registro dice il vero sugli utenti** (`riferisci_piano_utenti`, `remote.rs:1430`): caso 3 = «gli utenti del
   pannello si cancellano». Un pannello abbinato che resterebbe senza utenti passa dalla domanda `utenti-vuoti` che
   c'è già.
6. IDE: `conferme428.ts` mostra le risposte; testi in `it.json`/`en.json`.

### C. Lo storico segue i tag rinominati

1. `Project.tag_renames: Vec<TagRename { id, from, to }>` (chiave di primo livello in `project.yaml`, `id` univoco).
2. «Rinomina ovunque» (`rinominaTag`), dopo i salvataggi, chiama `POST /api/project/tag-renames {from, to}`: il runtime
   aggiunge la voce al progetto e la applica subito allo storico locale.
3. Il runtime applica le voci **all'apertura del progetto** (così il deploy le porta sul pannello), in ordine e una
   volta sola: tabella `tag_renames_applied(id)` nel database dello storico. Il backend SQLite rinomina la riga di
   `tag_storico`, o fonde i campioni se il nome nuovo c'è già. Postgres: `UPDATE sws_samples`. Con la migrazione dal
   formato vecchio in corso, la voce si riprova all'apertura dopo.
4. Tag orfani (`DatastoresTab.tsx`): accanto a «cancella», **«Assegna a un tag…»**. Crea la stessa voce, per le
   rinomine fatte a mano nel YAML o con git.
5. `apply_tags` ricostruisce le rotte di `DatastoreRegistry`, se la misura conferma che oggi non lo fa.

### D. L'orientamento delle copie

1. Il deploy considera verticale un progetto senza `orientation` con altezza > larghezza.
2. `cambiaOrientamento` scrive `orientation` senza scambiare le misure, se sono già nel verso chiesto.

### E. Documenti

- `CHANGELOG.md`, `NOVITA.yaml` (it/en): «Salva come» con le due scelte; il deploy che riconosce lo stesso impianto;
  lo storico che segue il tag rinominato.
- `docs/manual/` (deploy e storico) e `docs/HOWTO.md`: un capitolo «Una copia del progetto e il pannello».
- **CasaDomotica**: niente da adeguare. Il primo deploy con un nome diverso chiede una volta e scrive `plant_id`.

## Ordine e rami

1. Commit meta su `main`: i due piani aggiornati.
2. `feat/plant-id-e-rinomina-tag` (piano 1) → definition of done → squash.
3. `feat/save-nella-testata` (piano 2) da `main` → definition of done → squash.
4. Col sì del maintainer: `2.28.0-dev.4`, push, build.
5. Collaudo con `/test-changes` insieme alla dev.3.

## Verifica

- `cargo test` nuovi:
  - `duplicate_project`: riscrive `meta.name`, tiene o rinnova `plant_id`, salta `history/` con `new_plant`;
  - scelta del deploy: stesso id, id diverso, id mancante;
  - `DELETE ?keep=users`;
  - rinomina dello storico SQLite: riga semplice, fusione, una volta sola, catena a→b→c, a→b poi un tag `a` nuovo
    (non si sposta);
  - orientamento dedotto.
- vitest: «Salva come» con le due scelte; `conferme428` con 2 e 3 risposte; `rinominaTag` che chiama la rotta.
- `cargo check`, `cargo clippy -D warnings`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`.
- Sul PLX800 con **un progetto di prova**, mai CasaDomotica:
  1. «Salva come» copia → deploy: nessuna domanda, storico e utenti restano;
  2. «Salva come» progetto nuovo → «Tieni gli utenti»: storico vuoto, si entra con gli utenti di prima;
  3. «Cancella tutto»: storico e utenti via, il registro lo dice;
  4. rinomina di un tag con storico → deploy: il trend del nome nuovo mostra i dati vecchi;
  5. copia verticale fatta con «Cambia risoluzione»: il deploy chiede la rotazione.
