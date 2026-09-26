# Storico allarmi: la riga nasce allo scatto — piano

> Sessione di plan del 25-09-2026 sul seme dello storico allarmi.
> Approvato dal maintainer il 25-09-2026. Il seme è in archivio come superato
> ([`2026-09-23-storico-allarmi-eventi-persi.md`](../archive/2026-09-23-storico-allarmi-eventi-persi.md)). Ramo: `fix/storico-allarmi`.

## Context

Il maintainer: «in alarm_viewer e alarm_history non vedo gli allarmi, ma le notifiche mi arrivano su
Telegram». Un evento entra nello storico solo quando è **completo**, cioè passato dalla conferma: un
allarme che scatta, notifica e rientra **senza conferma** (`ActiveUnacked → NormalUnacked`) resta in
memoria per sempre e non arriva mai né al journal né a SQLite. La direzione del maintainer: «l'allarme
deve avvisare quando scatta» — **la riga nasce allo scatto** e si completa con rientro e conferma.

Rimisurato oggi (il modello è cambiato il 23-09 con «un tag, un allarme, più livelli»):

- `sws-core/src/alarm.rs` — `OpenEvent` nasce solo in `(Normal, true)` (alarm.rs:886-904); l'evento si
  completa solo in `ActiveAcked → Normal` (:926-947) e in `ack` da `NormalUnacked` (:694-707). Emissione
  via `journal_cb` + `journal.push` (:654-664, :714-723).
- **Secondo difetto trovato**: `OpenEvent` prende `def.message`/`def.severity` (:895-896), che negli
  allarmi del formato nuovo (con `levels`) sono vuoto e `Warning`. **Ogni riga di storico di un allarme
  nuovo ha messaggio vuoto e severità Warning**, qualunque livello sia scattato. Il livello in vigore è in
  `s.severity`/`s.message`/`s.level` (:340-362, aggiornati a :866-882).
- Il peggioramento dopo la conferma rimette `ActiveUnacked` ma **non tocca** l'`OpenEvent` (restano ack
  e severità vecchi). `duration_s` in `ack` si calcola fino alla conferma, non al rientro.
- `AlarmDb::load` (:491-518) butta gli eventi aperti senza scriverli; `load` gira a ogni apertura/chiusura
  progetto, import, soft-reload **e a ogni `PUT /api/project/alarms`** (modifica allarmi dall'IDE).
  Allo spegnimento nessun flush. Il journal in memoria è un `Vec` senza tetto.
- `sws-historian/src/sqlite.rs` — `alarm_events` (:33-45), `append_alarm_event` solo INSERT (:293-318),
  `query_alarm_events` (:321-396); **nessun meccanismo di migrazione** (solo `CREATE ... IF NOT EXISTS`).
  Postgres/ODBC non hanno allarmi.
- Cablaggio: `projects.rs:843-854` → `set_journal_callback` con `tokio::spawn(append)` per evento (niente
  ordine garantito), mai azzerato se il progetto nuovo non ha SQLite.
- Lettori: `/api/alarms/history` (router.rs:2622-2647, il ripiego in memoria ignora i filtri);
  `AlarmHistory.tsx` (gestisce già «Attivo»/«Non confermato», ma la chiave React
  `${alarm_id} ${ts_acked_ms}` si duplica con due righe non confermate, :152); `TrendCanvas.tsx:451`
  (marcatori: con le righe aperte compaiono allo scatto, meglio); viewer LVGL `client.rs:346-381` +
  `lvgl_render.rs:6222-6300` (ora / allarme / confermato Sì-No, il rientro non lo guarda mai).
  Nessun altro lettore (IA, Python, MQTT, OPC-UA).

## Decisioni del maintainer (25-09-2026)

| domanda | scelta |
|---|---|
| un livello che cambia mentre l'allarme è attivo | **stessa riga**, severità e messaggio del **livello più grave raggiunto**; un peggioramento dopo la conferma azzera la conferma della riga, come sul pannello |
| righe rimaste aperte (spegnimento, caduta, ricarica allarmi) | **chiuse come «interrotte»**: colonna nuova, piccola migrazione; se l'allarme è ancora vero riscatta e apre una riga nuova |
| tabella LVGL | la terza colonna diventa **«Stato»**: Attivo / Da confermare / Chiuso / Interrotto |

## La riga, definita

Una riga = **uno scatto** di un allarme, chiave `(alarm_id, ts_activated_ms)`. Ogni transizione
riscrive la riga intera (upsert), sempre con lo stato completo dell'evento:

| transizione (alarm.rs) | effetto sulla riga |
|---|---|
| `Normal → ActiveUnacked` | **nasce**: attivazione, livello, messaggio e severità **del livello vincente** |
| peggioramento (anche dopo conferma) | severità/messaggio al livello nuovo se più grave; se era confermata, `ts_acked_ms`/`acked_by` tornano vuoti |
| miglioramento | nessun cambio (resta il massimo raggiunto) |
| `ack` (da `ActiveUnacked` o `NormalUnacked`) | `ts_acked_ms`, `acked_by` |
| rientro (`ActiveUnacked → NormalUnacked` e `ActiveAcked → Normal`) | `ts_normalized_ms`, `duration_s` = rientro − scatto |
| `NormalUnacked → ActiveUnacked` (riscatta prima della conferma) | stessa riga: `ts_normalized_ms`/`duration_s` tornano vuoti |
| `load()` con eventi aperti, avvio con righe aperte in SQLite | `interrotto = true`, `ts_normalized_ms` = ora se mancava |

L'evento **esce dalla memoria** (`open_events`) quando è rientrato **e** confermato, come oggi; la riga
però esiste dal primo istante.

## Passi (un ramo, commit per passo)

### 1. Il nucleo — `sws-core/src/alarm.rs`
- `AlarmEvent` guadagna `interrotto: bool` (`#[serde(default)]`); `OpenEvent` guadagna
  `ts_normalized_ms` e il livello massimo raggiunto.
- `OpenEvent` nasce con `s.severity`/`s.message` (corregge il secondo difetto); a ogni transizione della
  tabella sopra si costruisce l'`AlarmEvent` corrente e lo si **emette** (non solo a evento completo).
- Il journal in memoria diventa upsert per chiave, con un tetto (1 000 righe, le più vecchie escono);
  `journal_snapshot` prende anche i filtri `alarm_id`/`from`/`to` che il ripiego di router.rs oggi ignora.
- `load()` emette le righe aperte come interrotte **prima** di azzerare.
- Test nel modulo esistente (helper `def()`, `livelli()`, `tre_livelli()`): scatto senza conferma → riga
  presente subito e chiusa al rientro con `ts_acked_ms` vuoto; formato nuovo → messaggio/severità del
  livello; peggioramento dopo conferma → riga con severità nuova e conferma azzerata; `load()` → riga
  interrotta. Adeguare `four_state_isa182_cycle` e `normalize_before_ack_gives_normal_unacked` (resta
  **una** riga, aggiornata).

### 2. L'historian e il cablaggio — `sws-historian/src/sqlite.rs`, `sws-web/src/projects.rs`
- Prima migrazione del crate: se `PRAGMA table_info(alarm_events)` non ha `interrotto`,
  `ALTER TABLE alarm_events ADD COLUMN interrotto INTEGER NOT NULL DEFAULT 0`; indice
  `(alarm_id, ts_activated_ms)`. Niente indice UNIQUE: se un database vecchio avesse doppioni, la
  creazione fallirebbe e il progetto non si aprirebbe.
- `upsert_alarm_event`: in transazione, `UPDATE … WHERE alarm_id=? AND ts_activated_ms=?`, e `INSERT`
  se non ha toccato righe. `append_alarm_event` sparisce.
- `chiudi_eventi_interrotti(ora)`: `interrotto=1`, `ts_normalized_ms = COALESCE(ts_normalized_ms, ora)`
  sulle righe con rientro **o** conferma mancanti. Si chiama quando il progetto aggancia lo store, prima
  che gli allarmi valutino — raccoglie ciò che una caduta ha lasciato aperto.
- `query_alarm_events` restituisce `interrotto`.
- **Ordine delle scritture**: oggi un `tokio::spawn` per evento, quindi l'aggiornamento può superare
  l'inserimento. Diventa **un canale e un solo scrittore** per store. Se il progetto nuovo non ha SQLite,
  la callback si stacca (oggi resta quella del progetto precedente).
- Test: primo test degli allarmi nel crate (store su cartella temporanea, come
  `vacuum_into_produces_a_consistent_copy`): upsert inserisce e poi aggiorna la stessa riga; migrazione
  su una tabella vecchia senza colonna; chiusura delle interrotte.

### 3. Chi legge
- `sws-editor/src/types/index.ts` (`interrotto?: boolean`), `components/AlarmHistory.tsx`: chiave di riga
  `alarm_id + ts_activated_ms`; colonna Rientro: «Attivo» / ora / «Interrotto»; durata «in corso» sulle
  aperte. i18n it/en. Test in `tests/alarmHistory.test.tsx`: due righe non confermate dello stesso
  allarme, una riga interrotta.
- Viewer LVGL: `AlarmHistoryEvent` legge `ts_normalized_ms` e `interrotto`; la terza colonna diventa
  «Stato» (Attivo / Da confermare / Chiuso / Interrotto) con una funzione pura e il suo test.
- `TrendCanvas`: nessun cambio (i marcatori compaiono allo scatto: è il comportamento giusto).

### 4. Documenti
- `docs/manual/07_alarms.md` (quando nasce e si chiude una riga, cosa vuol dire «interrotto»),
  `docs/manual/13_api_reference.md` (campo `interrotto`), CHANGELOG `[Unreleased]` → Fixed (i due difetti).
- Il seme va in `docs/archive/` come superato da questo piano.

## Fuori da questo piano (annotati)

- Potatura di `alarm_events` (oggi non si pota mai): un seme se serve.
- Storico allarmi su Postgres/ODBC: oggi solo SQLite, invariato.
- Il motivo della conferma resta nell'audit (la riga non lo porta), come oggi.

## Verifica

1. `cargo test -p sws-core -p sws-historian -p sws-web`, `cargo check --workspace`, `pnpm build`,
   `pnpm test`, `./scripts/check_static.sh`.
2. Stack di scarto (porte 8673/8674, come `check_e2e.sh`), progetto con un allarme a livelli su un tag
   scrivibile: tag sopra soglia → `GET /api/alarms/history` ha **subito** la riga, severità e messaggio
   del livello; tag sotto soglia senza conferma → riga con rientro e senza conferma; alzo al livello più
   grave → severità aggiornata; modifica degli allarmi dall'IDE a allarme attivo → riga interrotta e una
   nuova; `kill -9` del runtime con allarme attivo e riavvio → la riga è interrotta.
3. A schermo: widget `alarm_history` web con righe aperte e interrotte; tabella LVGL con la colonna Stato.
