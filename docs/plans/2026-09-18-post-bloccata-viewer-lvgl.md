# Una POST che riceve 200 blocca per sempre il viewer LVGL

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.

## Perché questo ha un file suo

Delle schede aperte è **l'unica che è un difetto e non una scelta**. Non brucia — c'è una via
d'uscita già in uso (`block_on` invece di `spawn`) — ma è un blocco definitivo in un processo che
deve tenere acceso uno schermo d'impianto, e la causa non è nota: è stata isolata per esclusione
con sei prove dal vivo, non spiegata.

**La cosa da non perdere** è proprio l'elenco delle prove qui sotto: dice esattamente quale
combinazione si blocca e quali no, ed è il lavoro che non va rifatto.


## Sessione di plan del 20-09-2026 (misure nuove, nessun codice toccato)

Prima cosa fatta quando il maintainer ha chiesto di implementare Q55: misurare di nuovo, perché il codice si è
mosso dal 13-09. **Il difetto non si riproduce fuori dal viewer vero, in nessuna delle combinazioni provate.**

**Il codice di oggi**
- Il runtime tokio è **multi-thread** (`Runtime::new()`, `main.rs:259`): cade la spiegazione classica «un task
  `spawn`-ato su un runtime `current_thread` avanza solo mentre qualcuno è dentro `block_on`».
- `lvgl-sys` **non installa più** l'override di `strncmp`/`strcmp` che era il sospettato: dal 25-08 la copia
  vendorizzata con la `strncmp` corretta è attiva (`[patch]` nella radice del workspace, Q14/Q22) — cioè **già
  prima** della scoperta di Q55 (13-09). Il sospetto originale va riformulato.
- Le `spawn` di rete ancora vive in produzione: `put_tag` (PUT), `ack_alarm` (POST) e `apply_recipe` (POST), tutte
  fire-and-forget (`main.rs:767, 783, 1053, 1071`; `lvgl_render.rs:6733`), più il poller dello storico (GET).
  Da Q36 parte 1 allegano il token: il primo 200 vero di una scrittura autenticata è esattamente la combinazione
  che Q55 dice bloccarsi, e **nessuno l'ha mai osservata completare** dal vivo.
- Ognuna costruisce un `reqwest::Client` nuovo a ogni richiesta (con il TLS pinnato riletto da file).

**Prove di oggi** (esempio temporaneo nel crate, poi cancellato; processo che linka `lvgl-sys`, con e senza
`lv_init()`, con e senza un loop `lv_timer_handler()` sul thread principale):
- POST/PUT/GET → 200 e POST → 403 contro un server locale minimale, via `rt.spawn`: **tutte completano** in pochi
  millisecondi (9 combinazioni + il 403).
- **Login vero** (`POST /api/auth/login`, Argon2, ~660 ms) contro un runtime di scarto, con il client TLS pinnato
  del viewer, in HTTP **e** in HTTPS, `spawn` e `block_on`, nelle tre modalità: **tutti completano** e danno 200.
- Quindi **non bastano** a scatenarlo: linkare `lvgl-sys`, `lv_init()`, il loop di tick, il pinning TLS, una POST
  con 200 e corpo JSON.

**Cosa resta come differenza rispetto al viewer vero** (ipotesi non provate): il backend SDL2/DRM e i suoi thread;
`lvgl_log::install()` (callback C di log); FreeType/DejaVu (Q24); `resvg`; il task WebSocket in background; il
runtime creato **prima** di `lv_init`; e soprattutto — se la `spawn` originale toccava oggetti LVGL **dopo**
l'`await`, come fa oggi il ramo di successo del login (`set_logged_in`, `lv_label_set_text`…) — **chiamate LVGL da
un thread worker di tokio**: LVGL non è thread-safe, e solo il ramo con 200 aggiorna l'interfaccia. Spiegherebbe
perché blocca solo il 200 e non il 403. È l'ipotesi più economica da verificare.

**Opzioni, riviste**
- **A. Riprodurre nel viewer vero** (SDL2 sotto Xvfb, clic sintetici, breadcrumb dopo l'`await`). Una sessione,
  esito non garantito, ma è l'unico modo di *spiegare* il difetto.
- **B. Rendere il difetto irrilevante per costruzione** — *nuova, non nel seme*: un **thread di rete dedicato**
  (un solo `std::thread` con il suo runtime, comandi in ingresso e esiti in uscita su canali, il loop di rendering
  li sonda a ogni frame). Le scritture non passano più da `spawn` sul runtime condiviso **e** non bloccano il
  rendering. Non richiede di conoscere la causa; riusa il pattern `tag_rx`/`ack_rx` già presente.
- **C. `block_on` anche per le scritture** (la 3 del seme): il render loop si ferma per la durata di ogni scrittura.
- **D. Lasciare com'è**: sconsigliata, perché il caso non è più teorico (scritture autenticate dal 13-09).

**Fatta il 20-09-2026: opzione B** (ramo `fix/Q55-thread-di-rete`). `net_worker.rs`: un `std::thread` con un runtime
`current_thread` suo, i tre comandi (`PutTag`, `AckAlarm`, `ApplyRecipe`) su un canale, eseguiti in ordine con
`block_on` e un tetto di 15 s; `main.rs` (i due loop, SDL2 e DRM) e `lvgl_render.rs` (il click «Applica» delle
ricette) mettono in coda e proseguono. Sei test nel binario del viewer, contro un server HTTP locale: PUT/POST verso
200 completano portando il token, un 403 è un errore leggibile, un server muto non ferma la coda, l'ordine è
rispettato, e la coda globale (`avvia`/`invia`) funziona come la usa il loop. Un test ha preso un difetto vero:
`tokio::time::timeout` creato fuori dal runtime panicava.
**Limiti dichiarati**: il difetto originale **non si riproduce**, quindi non si può mostrare che questa strada
"lo risolva": si è tolta di mezzo la combinazione sospetta a favore di quella provata. La causa **resta
inspiegata** (opzione A, sotto). Non è stato fatto un collaudo dal vivo sul pannello.
**Residuo, opzionale — la 2 del seme**: riprodurre nel viewer vero (SDL2 sotto Xvfb, clic sintetici, breadcrumb
dopo l'`await`) e verificare l'ipotesi «chiamate LVGL da un thread worker».

## Collaudo dal vivo sul WP630, 24-09-2026 — la scrittura completa

Il limite dichiarato il 20-09 era: «Non è stato fatto un collaudo dal vivo sul pannello». Ora è
fatto, perché nel frattempo il viewer LVGL è andato a schermo sul dispositivo vero.

**Come.** Pagina di prova con uno slider legato a un tag interno (`prova.scrittura`, i16 0-100) e
un testo con `format: "valore: {value}"`. Progetto deployato sul pannello, viewer a schermo, e il
maintainer ha trascinato lo slider **col dito**.

**Esito**: il tag è passato da `0`/`Uncertain` a `19`, poi `69`, con qualità **Good** letta dal
runtime. Più scritture in fila — il trascinamento ne produce una serie — tutte arrivate e in
ordine. Il viewer è rimasto vivo, **stesso pid**, e ha continuato a disegnare.

Cioè: **la combinazione che Q55 dice bloccarsi — una PUT che riceve 200 dentro il binario del
viewer — completa**, col thread di rete dedicato del 20-09.

**Due cose che questo collaudo NON dice**, e vanno tenute diritte:

1. **Non era autenticata.** Il progetto di prova non ha utenti, quindi la scrittura è partita senza
   token. Il caso di Q36 — scrittura **con token** verso un 200 — resta da esercitare; serve un
   utente nel progetto e un login sul touch del pannello.
2. **Non spiega la causa.** Resta l'opzione A: il difetto originale non è mai stato riprodotto, e
   la strada scelta è stata toglierlo di mezzo per costruzione invece di capirlo. Se un giorno
   qualcuno rimette una `spawn` di rete in questo binario, il rischio torna intatto.

**Una nota su come NON si collauda**: `--istantanea --tocca` **non** esercita la rete. Il tocco
sintetico produce il comando e lo stampa (`comando prodotto: scrivere Int(79) su '…'`), ma in
quella modalità nessuno svuota le code — è scritto nel codice, `main.rs:594`. Serve il viewer vero
in esecuzione, con un tocco vero.

---

## Dalla scheda Q55 — `reqwest` via `rt_handle.spawn()` si blocca per sempre nel viewer LVGL, solo per una POST che riceve 200

*Aperta il 13-09-2026, scoperta durante il collaudo dal vivo di
[Q36 parte 1](archive/2026-09-12-q36-min-role-lvgl.md) (sessione vera nel client LVGL).*

**Context.** `sws_auth_keyboard_ready_cb` (`lvgl_render.rs`) chiamava `client::login()` — una
POST `reqwest` — via `ctx.rt_handle.spawn(async move { ... })`, lo stesso pattern già in uso da
tempo per `put_tag`/`ack_alarm`/`apply_recipe`. Dal vivo, quella `spawn` non tornava **mai**: nessun
panico, nessun errore, il `.await` semplicemente non si risolveva, anche aspettando 15 secondi
reali — mentre il server emetteva regolarmente `login: session issued` nel proprio log di audit,
cioè la richiesta arrivava e veniva accettata.

Isolato per esclusione, con più prove dal vivo nello stesso processo:
- lo stesso identico login funziona **all'istante** via `curl` verso lo stesso server;
- funziona all'istante anche da un binario Rust a sé stante (niente `lvgl-sys`), stesso
  `tokio`+`reqwest`, stessa richiesta, stesso server;
- funziona all'istante nello **stesso identico callback**, se invece di `spawn` si usa
  `rt_handle.block_on(...)`;
- altre `spawn` nello stesso processo funzionano bene: un `tokio::time::sleep`, una GET che
  riceve 403, una POST che riceve 403, una GET che riceve 200 con corpo JSON.

L'unica combinazione che si blocca è: **dentro `sws-lvgl-viewer`, via `spawn` (non `block_on`),
una POST che riceve 200**. Il sospetto — non verificato, solo un'ipotesi coerente con la storia
di questo motore — è l'override globale di `strncmp`/`strcmp` che `lvgl-sys` installa a livello
di libc, la stessa classe di rischio già vista rompere `libdbus` in SDL2 (Q14/Q22).

**Perché conta**: non è un problema del solo login. Qualunque `spawn` futuro che faccia una POST
destinata a un 200 nello stesso binario rischia lo stesso blocco silenzioso — senza panico, senza
log, un task che semplicemente non finisce mai. `put_tag`/`ack_alarm`/`apply_recipe` oggi vanno
verso 403 (anonimo) o non sono ancora stati provati verso un 200 reale con utente loggato: non è
escluso che li aspetti lo stesso destino il giorno in cui una scrittura autenticata va a buon
fine.

**Options.**

1. **Lasciarlo com'è**: `block_on` per il login (fatto, in Q36 parte 1), `spawn` fire-and-forget
   per le scritture — che oggi funzionano perché ricevono 403 o non sono state esercitate con un
   200. Zero indagine ulteriore, ma il rischio resta silenzioso per il prossimo che aggiunge una
   `spawn` con esito 200.
2. **Indagare la causa vera**: bisect sui simboli sovrascritti da `lvgl-sys` (`strncmp`/`strcmp` e
   vicini), o un repro minimo che aggiunga `lvgl-sys` al binario a sé stante già usato per isolare
   il bug, per vedere se basta linkarlo (senza nemmeno creare un display) a riprodurre il blocco.
   Costa una sessione dedicata, con esito non garantito.
3. **Migrare anche le scritture a `block_on`**, preventivamente, per non lasciare nessuna `spawn`
   che possa ricevere un 200 in questo binario. Costa il render loop bloccato per la durata di una
   scrittura di rete (oggi accettabile per un tocco umano, meno chiaro per scritture frequenti o
   in serie).

**Default for PoC.** Opzione 1: nessuna `spawn` verso un esito 200 conosciuta in produzione dopo
Q36 parte 1 (il login, l'unico caso concretamente esercitato, ora usa `block_on`). Il rischio
resta annotato qui, non indagato oltre.

**Decided:** not yet.
