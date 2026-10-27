# I thread del runtime: un nome, e una priorità

> **FATTO il 27-10-2026, da collaudare sul pannello.** Le quattro decisioni le ha prese il
> maintainer lo stesso giorno, e il lavoro è uscito subito dopo. Resta qui finché non lo conferma
> su un pannello vero, poi va in archivio.
>
> **Le decisioni, e cosa ne è venuto:**
>
> 1. **Un thread per protocollo** (strada B). `sws_core::motori::motore(nome, gentilezza)` crea un
>    thread con quel nome e un runtime tokio a thread singolo sopra, uno per nome; tutte le
>    sorgenti di un tipo ci finiscono dentro. In `htop`: `sws-modbus`, `sws-mqtt`, `sws-opcua`,
>    `sws-s7`, `sws-enip`, `sws-host`, `sws-ha`.
> 2. **Il nome dice il tipo**, e la sorgente la dice la pagina Prestazioni. Le misure delle
>    sorgenti si chiamano ora `sorgente.<tipo>.<id>` e la pagina le scrive `sws-modbus · linea1`,
>    cioè lo stesso nome che si legge in `htop`.
> 3. **Priorità bassa subito sui lavori di fondo**: `sws-storico`, `sws-log`, `sws-backup`,
>    `sws-ritenzione` nascono con `nice 10`, e la gentilezza vale anche per i thread bloccanti di
>    quel runtime — senza, una `spawn_blocking` sarebbe tornata a priorità normale proprio dove sta
>    il lavoro pesante.
> 4. **Lo storico accorpa, e la finestra è di dieci secondi**, perché le macchine hanno un UPS che
>    avvia lo spegnimento ordinato e lo spegnimento ordinato svuota la coda.
>
> **Misurato dopo** (`tmp/thread-prova/LEGGIMI.md`, tre sorgenti vive): da ventun
> `tokio-rt-worker` a otto, più i thread con un nome. E una cosa che prima non si poteva sapere:
> **`sws-host` tiene nove thread**, perché il plugin delle metriche chiama `spawn_blocking` a ogni
> giro. Il lavoro è lo stesso di prima; cambia che adesso si vede di chi è.
>
> **Quello che resta**, e non è stato fatto: i `tokio-rt-worker` del runtime condiviso tengono il
> nome predefinito di tokio (la strada A non è stata scelta, e rinominarli non attribuisce niente a
> nessuno); e il plugin Home Assistant ha il suo thread ma non misura ancora il proprio giro,
> quindi in Prestazioni non compare.

## Perché

Parole del maintainer, 27-10-2026:

> «i protocolli sono task separati? perché sarebbe utile associare ad ogni task un nome preciso
> tipo "sws_opcua" "sws_modbus" etc... per vederli bene con htop o programmi simili, ora li vedo
> tutti come tokio-rt-worker. Lo stesso nome poi lo riporterei in prestazioni»

E, poco dopo, sullo storico:

> «In alcuni scada/software plc i thread hanno priorità diverse e i log hanno priorità bassissima»

Le due cose sono la stessa domanda: **com'è disposto il lavoro del runtime sui thread, e come si
vede e si governa.** Lo scopo dichiarato non è la velocità: è «gestire in modo più efficiente lo
sviluppo e l'analisi e avere un'idea migliore delle prestazioni e di chi mangia risorse».

## Com'è adesso (misurato il 27-10-2026 sul WP630)

| | |
|---|---|
| Il processo | un `#[tokio::main]` normale (`sws-runtime/src/main.rs:424`): runtime multi-thread, worker = numero di CPU |
| I thread veri, contati in `/proc/<pid>/task/*/comm` | **21 `tokio-rt-worker`**, 1 `sws-runtime`, 1 `mDNS_daemon`, su **6 CPU** |
| Le sorgenti | un `tokio::spawn` ciascuna, tutte sullo stesso runtime (`sws-web/src/gateway/../source_supervisor.rs:359`, un ramo per protocollo) |
| `tokio-rt-worker` | **non lo scriviamo noi**: è il predefinito di tokio dalla 1.52, ed è lungo esattamente 15 caratteri — l'hanno scelto per entrarci |
| I 15 thread oltre i 6 worker | sono il **pool bloccante**. `max_blocking_threads` è 512 e tokio li tiene vivi 10 s: restano accesi perché qualcuno chiama `spawn_blocking` di continuo |
| Chi lo chiama di continuo | lo storico: **una `spawn_blocking` per campione** (`sqlite.rs:446`) |

## Il vincolo che decide tutto: un task non è un thread

Un task tokio **cambia thread a ogni `await`**. Non è un dettaglio implementativo da aggirare: è
come funziona lo scheduler. Quindi:

- **nessun nome di thread potrà mai voler dire «questo è il task Modbus»**, finché il task Modbus
  vive sul runtime condiviso;
- `Builder::thread_name_fn` può solo distinguere i worker **fra loro** (`sws-rt-0`… `sws-rt-5`), e
  neppure dai thread bloccanti: tokio usa **lo stesso** nome per il pool bloccante
  (`blocking/pool.rs:463`), e non c'è un secondo campo per loro;
- `nice` su Linux si applica **a un thread** (`setpriority` su un tid), non a un task. Quindi
  **priorità e thread dedicati sono la stessa decisione**: senza il thread, la priorità non ha
  dove attaccarsi.

Per vedere `sws-modbus` in htop, quel protocollo deve **possedere** un thread: un runtime tokio a
thread singolo, su un thread con quel nome. Non è un'etichetta, è un cambio di disposizione.

## I 15 caratteri

`TASK_COMM_LEN` è 16 col terminatore: **15 caratteri utili**, e il kernel tronca senza avvisare.

| nome | lunghezza | |
|---|---|---|
| `sws-modbus` | 10 | ci sta |
| `sws-opcua` | 9 | ci sta |
| `sws-storico` | 11 | ci sta |
| `sws-mb-linea1` | 13 | ci sta, ma il nome della sorgente è libero e lungo quanto vuole |
| `sws-modbus-linea-nord` | 21 | **troncato a `sws-modbus-lin`**, e due sorgenti con prefisso uguale diventano indistinguibili |

Tre modi di cavarsela, e vanno scelti, non mescolati:

1. **Solo il tipo**: `sws-modbus`, un thread per protocollo, tutte le sue sorgenti sopra. Sta
   sempre nei 15, ma non dice *quale* linea Modbus sta mangiando CPU.
2. **Tipo più indice**: `sws-modbus-3`, con la tabella indice→sorgente **nella pagina
   Prestazioni**, che è dove il maintainer vuole lo stesso nome. Sta sempre nei 15 (l'indice
   arriva a tre cifre), e la domanda «quale linea» ha una risposta, in un posto solo.
3. **Tipo più nome accorciato**: leggibile finché i nomi sono corti, ambiguo appena non lo sono.
   È l'unico dei tre che può mentire senza dirlo.

## Le tre strade

### A — Niente thread nuovi, solo nomi migliori

`thread_name_fn` con un contatore: i 21 diventano `sws-rt-0`… `sws-rt-20`.

**Pro**: una riga di codice, nessun rischio, e htop smette di dire «tokio» in un prodotto che
tokio non lo nomina da nessuna parte.
**Contro**: non risponde alla domanda. Sapere che il worker 4 è al 90% non dice **di chi** sia
quel 90%, e al giro dopo è un altro worker. Non abilita nessuna priorità.

### B — Un thread per protocollo

Ogni *tipo* di sorgente prende un thread suo con un runtime a thread singolo; le sue sorgenti
girano lì sopra. In htop compaiono `sws-modbus`, `sws-opcua`, `sws-mqtt`, `sws-s7`, `sws-enip`,
`sws-host`.

**Pro**: la CPU per protocollo si legge in htop e in `top`, senza strumenti nostri. La priorità
diventa possibile. Un protocollo che si blocca non ruba più un worker a tutti gli altri — oggi sì.
**Contro**: le sorgenti dello stesso protocollo non si parallelizzano più fra loro (su 6 CPU, con
un impianto a dieci linee Modbus, può contare). Sei thread che esistono anche quando quel
protocollo non c'è, a meno di crearli su richiesta. E il codice delle sorgenti deve diventare
indipendente dal runtime su cui gira: oggi non c'è motivo per cui non lo sia, ma va verificato
sorgente per sorgente — chi usa `spawn_blocking`, chi tiene un `JoinHandle`, chi parla con
`TagDb`.

### C — Un thread per sorgente

`sws-modbus-3`, uno per riga configurata.

**Pro**: la risposta più precisa possibile a «chi mangia».
**Contro**: il numero di thread segue la configurazione del cliente, non la macchina. Un impianto
con quaranta sorgenti fa quaranta thread su sei CPU, e lo scheduler del kernel li alterna invece
di lasciarli alla coda di tokio, che è fatta apposta. Su un pannello piccolo è spreco.

**Osservazione, non decisione**: B dà quasi tutto il valore a un costo molto minore di C, e la
precisione che perde la recupera la pagina Prestazioni, che le sorgenti le distingue già una per
una (`sorgente.<id>`).

## Le priorità

Una volta che un lavoro ha un thread suo, `nice` si può mettere. Due cose da sapere prima:

- **Abbassare la priorità non chiede privilegi; alzarla sì** (serve `RLIMIT_NICE` o
  `CAP_SYS_NICE`, e sul pannello il runtime gira come utente normale in un container rootless).
  Quindi la strada praticabile è **abbassare ciò che può aspettare**, mai alzare ciò che non può.
- Oltre a `nice` c'è `SCHED_BATCH`, che dice al kernel «questo thread non ha fretta di essere
  svegliato» ed è fatto per il lavoro di fondo. `SCHED_IDLE` è più aggressivo e rischia di non far
  mai scrivere lo storico su una macchina carica.

Candidati naturali a priorità bassa: lo **storico**, la **ritenzione**, i **backup**, la
**rotazione dei log**. Candidati a priorità normale e mai toccata: le sorgenti e il servizio HTTP.

**Il limite da dire chiaro**: `nice` sposta la CPU, non il disco. Se lo storico rallenta il
pannello perché scrive troppo spesso, abbassargli la priorità non lo cura — lo nasconde.

## Il primo caso vero: lo storico

Il maintainer ha chiesto se «lo storico scrive troppo, o se ogni scrittura finisce su disco senza
cache». Misurato, la risposta è doppia e vale la pena scriverla qui, perché è il banco di prova di
tutto il resto.

**La cache c'è, per i grafici**: `Historian::record` (`lib.rs:155`) scrive solo in un anello in
RAM, e c'è un test che lo dichiara — `record_non_scrive_su_disco`.

**Sul disco invece non c'è nessun accorpamento.** La catena è
`RegistroDatastore::record` → `SqliteBackend::record` → `SqliteStore::append` (`sqlite.rs:440`), e
per **ogni singolo campione** fa:

1. una `spawn_blocking` — un salto sul pool bloccante;
2. un `blocking_lock()` sull'**unica** connessione, che mette in fila tutti gli altri;
3. una ricerca dell'id del tag;
4. una `INSERT` da sola, quindi **una transazione implicita e un frame di WAL per campione**.

A 153 campioni al secondo (misurato sul WP630) sono 153 salti, 153 attese sullo stesso mutex e 153
transazioni al secondo. **I 15 thread bloccanti in più nascono da qui**, e non stanno lavorando in
parallelo: stanno in coda sullo stesso lucchetto.

Da notare: SQLite è già in WAL con `synchronous = NORMAL` (`sqlite.rs:375`), cioè la scelta giusta
— non c'è un `fsync` per scrittura. Il costo non è la durabilità, è il numero di transazioni.

**Quindi, per lo storico, l'accorpamento viene prima della priorità**: una coda in memoria svuotata
ogni N millisecondi in **una** transazione farebbe crollare 153 transazioni al secondo a poche, e
con esse i thread bloccanti. La priorità bassa è il complemento giusto *dopo*, non al posto.

Una cosa che la misura ha mostrato per caso: i **due** registratori — l'anello in RAM
(`lib.rs:262`) e il datastore su disco (`registry.rs:398`) — si misurano **tutti e due** col nome
`storico`. Nella pagina sono una riga sola, e il massimo di 115 ms non si sa di chi sia. Vanno
separati, ed è l'unica cosa di questo piano che si può fare senza decidere niente.

## Cosa serve guardare prima di scrivere

- Tutti i rami di `start_one` in `source_supervisor.rs`: quali sorgenti usano `spawn_blocking` o
  danno per scontato un runtime multi-thread.
- Il gateway e il container di progetto: lì di sorgenti non ne parte nessuna (25-10-2026), quindi i
  thread per protocollo non devono nemmeno nascere.
- `sws-banco`, che misura da fuori: con i thread nominati può anche leggere `/proc` e dire la CPU
  per thread, cioè per protocollo.
- La pagina Prestazioni: il maintainer vuole **lo stesso nome** lì. Oggi una riga dice
  `sorgente.mqtt-casa`; diventerebbe `sws-mqtt · casa`, con il nome del thread visibile.

## Le tre decisioni

1. **Quale strada**: A (solo nomi), B (un thread per protocollo), C (un thread per sorgente).
2. **Come stanno nei 15 caratteri**: solo il tipo, tipo più indice con la tabella in Prestazioni,
   o tipo più nome accorciato.
3. **Le priorità**: si abbassano subito (storico, ritenzione, backup, log) o si aspetta di avere i
   thread e si decide guardando?

E una quarta, che è di un altro ordine: **l'accorpamento delle scritture dello storico si fa
qui o diventa un lavoro suo?** È il rimedio con il guadagno più grande e misurabile fra tutti
quelli nominati in questo piano, e con i thread c'entra solo perché è la ragione per cui ce ne
sono quindici.

## Quello che questo piano non fa

- **Non tocca il viewer LVGL**, che è un processo a sé e un thread di disegno solo.
- **Non promette fotogrammi**. Sul WP630 il fotogramma se lo mangia la copia sullo schermo (23 ms
  su 35, misurato il 27-10): i thread del runtime sono un'altra storia, e va detto per non
  aspettarsi la cosa sbagliata.
- **Non alza nessuna priorità**: nel container rootless non si può, e provarci sarebbe un errore
  che compare solo sul pannello del cliente.
