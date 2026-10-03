# Perché lo storico di CasaDomotica è così grande

**Stato: fatto il 03-10-2026** (squash `59a8f9d5`, 2.12.0-rc.20; piano in fondo: formato compatto e backup). Prima: seme — ridotto il 27-09-2026. La causa principale è corretta (su `main` con lo squash del 27-09; prima sul ramo `feat/storico-una-strada`, 26-09 sera): una strada sola verso il disco, e l'IDE non registra. C'è anche la pulizia degli storici già gonfi («Pulisci storico», `feat/pulizia-storico`: CasaDomotica 590 → 36 MB). Restano da decidere il formato del campione e i backup che copiano lo storico.** Annotato su richiesta del maintainer il 26-09-2026, durante l'aggancio
di CasaDomotica a git: «annota per dopo il capire perché il database è così grande».

> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita dedicata,
> che ne sviscera tutti i dettagli.** Quello che segue sono le misure del giorno in cui la domanda
> è nata, non un progetto: rileggerle contro il codice di allora prima di decidere qualunque cosa.

## Cosa si è visto (26-09-2026, sola lettura)

- `history/historian.db` di CasaDomotica: **~590 MB** per 27 giorni (primo campione 30-08, ultimo
  26-09), `retention_days: 30`. Una casa, non un impianto.
- `samples`: **7 025 541 righe**, **73 tag distinti** — mentre in `project.yaml` le righe
  `history: true` sono **20**. Da capire chi storicizza gli altri 53 (default delle sorgenti
  MQTT/HomeAssistant? tag scoperti?).
- ~84 byte a campione: `value` è **JSON in TEXT**, `quality` è **TEXT** (`"Good"`…), chiave
  primaria `(tag, ts_ms)` WITHOUT ROWID con il nome del tag ripetuto in ogni riga, più un secondo
  indice `idx_samples_ts`.
- I tag più scritti sono **valori che non cambiano quasi mai**: `state.id`, `state.type`,
  `state.name` ~433 000 campioni ciascuno (uno ogni ~5 s per 27 giorni), come i sensori di
  finestre e perimetrali. `sandokan.running` 972 155 (uno ogni ~2,4 s). Tutto indica che si
  registra **a ogni lettura**, non **al cambiamento**, e senza banda morta.
- `alarm_events`: 5 righe — lo storico allarmi non c'entra.
- `freelist_count` 0: niente spazio vuoto da recuperare con un `VACUUM`.

## La causa, misurata la sera del 26-09-2026

**Due registratori scrivono nello stesso file.**

1. Il registro dei datastore (`sws-historian/src/registry.rs`) instrada **solo** i tag con `history: true`,
   con banda morta e intervallo minimo (`TagFilter`). È il comportamento voluto.
2. Il registratore globale del buffer in RAM (`Historian::spawn_recorder` → `Historian::record`,
   `sws-historian/src/lib.rs`) salva su SQLite **ogni aggiornamento di ogni tag**, senza filtri. Il suo
   SQLite è lo stesso `history/historian.db`, agganciato da `open_project` con `swap_store`.

Conseguenze misurate su CasaDomotica (7 117 653 campioni):
- **93,1 % dei campioni ripete il valore precedente** dello stesso tag (6 627 786 righe).
- I tag più pesanti **non hanno `history: true`**: `sandokan.running` (984 229 campioni, uno ogni 2,4 s, 2
  valori diversi), `state.id`/`state.type`/`state.name` e le dieci finestre/porte `state.*` (~437 000
  ciascuno, uno ogni 4-5 s, 2-4 valori diversi). Insieme sono l'88 % delle righe.
- Per i tag che `history: true` ce l'hanno, banda morta e intervallo minimo **non servono**: l'altro
  registratore salva comunque tutto.
- Si registra anche con il progetto aperto **nell'IDE** (ultimi campioni alle 18:30 del 26-09, con
  CasaDomotica aperta nell'editor di sviluppo).
- Un tag **col nome vuoto** (`""`): 64 757 campioni, valore 0.0 qualità Bad, dal 02-09 al 07-09.
- Composizione del file (590 MB): tabella `samples` 320 MB, **indice `idx_samples_ts` 258 MB** — in una
  tabella `WITHOUT ROWID` ogni voce dell'indice porta con sé la chiave primaria, quindi il nome del tag
  per esteso, ripetuto per ogni campione.

Il buffer in RAM serve ai grafici dal vivo e a ripartire dopo un riavvio (`restore_recent`): da decidere
se debba ancora persistere, e cosa. Tolta la doppia scrittura, lo storico di CasaDomotica sarebbe fatto
dei soli 20 tag storicizzati, filtrati.

## Effetti collaterali già visti

- **Backup**: `backups.rs` mette `history` fra i `BACKED_UP`, e ogni backup automatico ne copia
  **l'intero file**. CasaDomotica ha 7 backup da ~550 MB = 3,2 GB, e crescono con lo storico.
- **Git**: il primo commit del progetto se l'è preso (risolto a parte, sul ramo delle guardie git:
  `*.db` e `backups/` nel `.gitignore`, file oltre 50 MB fermati al commit, oltre 100 MB al push).

## Domande da cui partire (non risposte)

0. Il registratore globale deve ancora scrivere su SQLite? Se sì, solo i tag `history: true` e con i loro
   filtri (cioè: una sola strada, quella del registro)? E l'IDE deve registrare storico?
1. Registrare al cambiamento (più un campione di mantenimento ogni N minuti) invece che a ogni
   lettura? Con banda morta per i valori numerici?
2. Chi decide cosa si storicizza: solo `history: true`, o anche un default per sorgente?
3. Formato del campione: tag per indice invece che per nome, valore tipizzato invece di JSON,
   qualità come intero. Con quale migrazione dei database esistenti?
4. I backup automatici devono copiare lo storico ogni volta, o solo il progetto (e lo storico a
   parte, più di rado o su richiesta)?

---

# Piano del 03-10-2026 — approvato

> Sessione di plan del 03-10-2026, un piano solo per tre semi (pulizia del disco, immagini sul pannello,
> storico). Le misure di oggi sono nel piano generale; qui la parte di questo seme.

**Scelte del maintainer (03-10-2026):** disco → **solo `incremental`**; immagini → si tengono **quella in uso e
la precedente**; storico → **backup e formato insieme**. Poi, rivedendo il piano: **la pulizia non parte da
sola**. Dopo un aggiornamento riuscito si propongono **quattro scelte** — «Conferma e pulisci», «Conferma dopo il
prossimo riavvio», «Più tardi», «Torna alla versione precedente» — e il ritorno riporta **anche i dati**:
un'**istantanea di config + progetti con lo storico** presa prima di ogni aggiornamento, **su entrambi i canali**.
Dopo un ritorno, niente aggiornamenti automatici **verso la versione scartata** (si riprende con una più nuova o
con «Aggiorna ora»). Il ritorno coi dati è indispensabile proprio per il §3: la migrazione dello storico è a senso
unico, e la versione vecchia non leggerebbe il formato nuovo.

**Ordine dei rami (un ramo alla volta):**
1. `feat/pota-incremental` → collaudo qui, squash, eliminato.
2. `feat/aggiornamento-con-ritorno` da `main` → **rc.17**; poi **annidato** `feat/storico-compatto` → **rc.18**.
   Le due rc servono entrambe al collaudo vero: rc.16 → rc.17 (la rc.16 non sa fare l'istantanea: si vede la
   proposta, senza ritorno dei dati), poi rc.17 → rc.18 (istantanea presa dalla rc.17, storico migrato dalla rc.18,
   «Torna alla precedente» → rc.17 con lo storico vecchio leggibile). Due squash dopo la conferma.

### 3. Lo storico compatto e i backup

**Formato** (`sws-historian/src/sqlite.rs`, l'unico che tocca le tabelle):
```sql
CREATE TABLE tag_storico (id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
CREATE TABLE campioni (
  tag_id  INTEGER NOT NULL,   -- tag_storico.id
  ts_ms   INTEGER NOT NULL,
  tipo    INTEGER NOT NULL,   -- 0 bool, 1 int, 2 float, 3 testo, 4 json (array/struttura)
  valore,                     -- senza affinità: 0/1, i64 esatto, REAL, TEXT
  qualita INTEGER NOT NULL,   -- 0 Good, 1 Uncertain, 2 Bad
  PRIMARY KEY (tag_id, ts_ms)) WITHOUT ROWID;
CREATE INDEX idx_campioni_ts ON campioni(ts_ms);
CREATE VIEW samples AS SELECT … -- tag, ts_ms, value (JSON), quality (testo): chi legge il file a mano
                                -- (e le guardie con stack) continua a funzionare
```
- Conversione `TagValue` ↔ (`tipo`, `valore`) in due funzioni pure, testate su ogni variante (Int oltre 2^53,
  Float intero, testo, array, struttura). Cache `nome → id` in `SqliteStore` (riempita all'apertura).
- Tutte le query riscritte sul nuovo schema: `append`, `restore_recent`, `last_before`, `query_range`,
  `prune_older_than_ms`, `prune_excess_rows`, `total_samples`, `full_stats`, `distinct_tags` (da `tag_storico` che
  ha campioni), `delete_tag`, `pulisci_storico` (LAG su `tipo, valore, qualita`).
- **Migrazione all'apertura** (`migra_campioni`, accanto a `migra_allarmi`): se esiste una **tabella** `samples` →
  in una transazione: `tag_storico` dai tag distinti, `campioni` da `samples` con `json_type(value)` per il tipo
  (testo `'Good'/'Bad'/…` o intero per la qualità, per i database di prova vecchi), `DROP TABLE samples`, vista;
  poi `VACUUM`. Log con righe e byte prima/dopo. Test: database vecchio finto → stesse letture prima e dopo.
- **Backup** (`sws-web/src/backups.rs`): `backup_now(dir, con_storico: bool)`. Il giro automatico (`main.rs`) e
  `migra_segreti_se_serve` **senza** storico; il pulsante «Crea backup» (`create_backup_handler`) **con** storico,
  scritto con `SqliteStore::vacuum_into` (copia coerente, già compattata) invece della copia grezza; mai i file
  `historian-prima-della-pulizia-*`. Il ripristino lascia già stare `history/` se il backup non ce l'ha (verificato
  in `restore_backup`); un test lo blinda.
- `scripts/check_database_mgmt.sh` / `check_deploy_preserve.sh` (guardie con stack) creano `samples` vecchio stile:
  con la migrazione e la vista restano valide; si rilanciano una volta.

### Documenti

Per ciascun ramo: CHANGELOG, `NOVITA.yaml` (ritorno e storico: sì, con riga di compatibilità «il ritorno coi dati
vale dagli aggiornamenti fatti da una versione ≥ rc.17»; incremental: no, è sviluppo), manuale (capitolo packaging:
conferma, pulizia, ritorno; capitolo storico/backup), HOWTO (capitolo nuovo «tornare alla versione precedente»),
`STATUS.md`, piano in archivio.

### Verifica

- **Ramo 1**: test shell provato rosso; `./scripts/pota_incremental.sh` a vuoto e poi `--esegui` qui (attesi ~80 GB
  liberati), poi `cargo check` per misurare il costo della prima build dopo. Conferma del maintainer, squash.
- **Ramo 2 (rc.17)**: `cargo test`, vitest, `pnpm build`, `check_static.sh`. Sul TC620 rc.16 → rc.17 da archivio
  (l'IDE chiede l'istantanea alla rc.16 → 404, si prosegue): dopo 120 s compare la domanda; si prova «Più tardi»
  (torna dopo un riavvio) e «Dopo il prossimo riavvio» (riavvio → immagini 9 → 2, nessuna domanda).
- **Ramo 3 (rc.18)**: test di `sws-historian` (conversione, migrazione, letture uguali prima/dopo), migrazione su
  una **copia** di `CasaDomotica/history/historian.db` (dimensione, conteggi per tag, trend dal vivo con
  `start_editor_develop.sh`). Sul TC620 rc.17 → rc.18: istantanea presa dalla rc.17, storico da 91 MB migrato,
  trend uguali; poi **«Torna alla precedente»** → rc.17 con lo storico vecchio leggibile e gli aggiornamenti
  automatici fermi sulla rc.18; infine «Aggiorna ora» di nuovo e «Conferma e pulisci». SSH in lettura per
  controllare (`podman images`, JSON dello stato, dimensione del db, `journalctl --user -u 'sws-immagini-*'`).
  Conferma del maintainer, due squash, push solo su istruzione.
