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
