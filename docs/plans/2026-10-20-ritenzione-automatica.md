# Ritenzione automatica dei datastore — piano d'esecuzione

> Nasce dal punto 2 del seme [residui dal manuale](2026-10-20-residui-dal-manuale.md), dove il maintainer ha
> deciso il 20-10-2026 le quattro scelte di fondo (quando, VACUUM, primo giro, cloud). Qui c'è come si fa, misurato
> sul codice la sera del 20-10-2026. Approvato con le decisioni in fondo.

## Cosa c'è già (misurato)

- `purge(retention_rows, retention_days)` su tutti e tre i backend (`sws-historian/src/sqlite_backend.rs:70`,
  `postgres_backend.rs:247`, `odbc_backend.rs:94`) e `DatastoreRegistry::purge_backend` (`registry.rs:261`).
  Su SQLite: `DELETE … WHERE ts_ms < cutoff` per i giorni, e per le righe un giro per tag che tiene le `max_rows` più
  recenti (`sqlite.rs:948`).
- `vacuum()` (VACUUM + checkpoint del WAL, ritorna i byte prima e dopo) e `stats()` con `sample_count` e
  `size_bytes`.
- La pulizia a mano: `POST /api/datastores/:id/purge` (Admin, `router.rs:3558`), il pulsante nella scheda Datastore
  (`DatastoresTab.tsx:127-137`), **senza audit**.
- Il modello del task: i backup automatici in `sws-runtime/src/main.rs:736-805` — battono ogni minuto, rileggono il
  `project.yaml` attivo a ogni giro, tengono il tempo per progetto e girano in `spawn_blocking`.
- La strada IDE → pannello per un'operazione sullo storico esiste già: `remote_pulisci_storico`
  (`router.rs:745`) chiama la rotta `clean-history` della porta di gestione ristretta (`router.rs:1430`).

## Cosa si fa

**1. Il task notturno** (`sws-runtime/src/main.rs`, accanto a quello dei backup). Ogni minuto:
- se l'ora del giro è passata e l'ultimo giro è di più di 20 ore fa, il giro è **dovuto** — copre il pannello spento
  di notte, che recupera al primo minuto utile dopo l'ora;
- per ogni datastore con `retention_rows` o `retention_days`: se la ritenzione **non è confermata**, calcola
  l'anteprima e si ferma lì; se è confermata, `purge_backend`;
- poi, solo SQLite, `vacuum()` se le righe cancellate sono almeno il **10 %** di quelle che c'erano;
- una riga di log `info!` col numero di righe e i byte, e una voce d'audit `datastore.ritenzione_auto`.

La decisione «è dovuto?» è una funzione pura (ora attuale, ora del giro, ultimo giro → sì/no), con i suoi test.

**2. L'anteprima** (`sws-historian`): un `conta_da_pulire(retention_rows, retention_days)` sui backend che conta
quello che `purge` cancellerebbe, con le stesse query in `SELECT COUNT(*)`, più una stima dei byte (righe da
cancellare / righe totali × `size_bytes`). Postgres conta allo stesso modo; ODBC risponde «non compilato».

**3. Lo stato** per progetto, in `history/ritenzione.json` (accanto a `historian.db`, fuori da git: la riga va in
`RIGHE_GITIGNORE_DATI`, `git_deploy.rs`): l'ultimo giro, e per ogni datastore la conferma — **con i valori che sono
stati confermati**. Se poi `retention_days` o `retention_rows` diventano più stretti, la conferma decade e l'IDE
richiede: un 365 portato a 30 è un altro primo giro.

**4. La conferma, una volta** (decisione del maintainer):
- `GET /api/datastores/ritenzione` — per datastore: stato (`non_configurata`, `da_confermare`, `attiva`), anteprima
  (righe, byte), ultimo giro, ora del prossimo;
- `POST /api/datastores/:id/ritenzione/conferma` — Admin, audit `datastore.ritenzione_confermata`;
- le stesse due sotto `/api/remote/…` e nella porta di gestione ristretta, come `clean-history`, così l'IDE chiede
  conferma **al dispositivo che cancellerà**, con i suoi numeri e non con quelli del PC;
- nell'IDE: un riquadro nella scheda Datastore e un avviso nella testata quando un datastore è `da_confermare`
  («la ritenzione cancellerà 3,2 milioni di righe, circa 410 MB, da `default`»), con Conferma.

**5. L'ora**: un campo per progetto (vedi domande), predefinito alle **03:00** ora locale del dispositivo.

**6. Cloud**: stesso codice. Il container di progetto è spento quando nessuno lavora, quindi il giro avviene alla
prima apertura dopo l'ora — lo dicono il capitolo 08 e la card.

**7. La pulizia a mano** finisce anche lei nell'audit (`datastore.purge`), che oggi manca.

## Verifica

- Test Rust: la funzione «dovuto» (prima dell'ora, dopo, giorno saltato, orologio indietro), l'anteprima che conta
  esattamente quello che `purge` cancella (su un SQLite temporaneo), la soglia del VACUUM, la conferma che decade con
  valori più stretti.
- Dal vivo: un progetto con 400 giorni di storico finto e `retention_days: 365` su un runtime di prova — l'IDE mostra
  l'anteprima, nessuna riga sparisce prima della conferma, dopo la conferma il giro cancella e il file si restringe.
- Sul TC620: anteprima letta dall'IDE attraverso la porta di gestione.
- `cargo check`, `pnpm build`, `check_static.sh`; capitoli 08 e 13, CHANGELOG, NOVITA.

## Decisioni del maintainer (20-10-2026, sera)

1. **L'ora vive nel progetto** (`project.yaml`, predefinita 03:00 ora locale del dispositivo): viaggia col deploy, e
   tutti i pannelli di quel progetto puliscono alla stessa ora.
2. **La conferma è per datastore**, con la sua anteprima, e decade quando i suoi valori diventano più stretti.
3. **L'avviso lo vede solo l'Admin**, che è chi può confermare.
