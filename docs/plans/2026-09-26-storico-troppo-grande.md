# Perché lo storico di CasaDomotica è così grande

**Stato: seme — decisione.** Annotato su richiesta del maintainer il 26-09-2026, durante l'aggancio
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

## Effetti collaterali già visti

- **Backup**: `backups.rs` mette `history` fra i `BACKED_UP`, e ogni backup automatico ne copia
  **l'intero file**. CasaDomotica ha 7 backup da ~550 MB = 3,2 GB, e crescono con lo storico.
- **Git**: il primo commit del progetto se l'è preso (risolto a parte, sul ramo delle guardie git:
  `*.db` e `backups/` nel `.gitignore`, file oltre 50 MB fermati al commit, oltre 100 MB al push).

## Domande da cui partire (non risposte)

1. Registrare al cambiamento (più un campione di mantenimento ogni N minuti) invece che a ogni
   lettura? Con banda morta per i valori numerici?
2. Chi decide cosa si storicizza: solo `history: true`, o anche un default per sorgente?
3. Formato del campione: tag per indice invece che per nome, valore tipizzato invece di JSON,
   qualità come intero. Con quale migrazione dei database esistenti?
4. I backup automatici devono copiare lo storico ogni volta, o solo il progetto (e lo storico a
   parte, più di rado o su richiesta)?
