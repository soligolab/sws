# Perché lo storico di CasaDomotica è così grande

**Stato: seme — ridotto il 27-09-2026. La causa principale è corretta (su `main` con lo squash del 27-09; prima sul ramo `feat/storico-una-strada`, 26-09 sera): una strada sola verso il disco, e l'IDE non registra. C'è anche la pulizia degli storici già gonfi («Pulisci storico», `feat/pulizia-storico`: CasaDomotica 590 → 36 MB). Restano da decidere il formato del campione e i backup che copiano lo storico.** Annotato su richiesta del maintainer il 26-09-2026, durante l'aggancio
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
