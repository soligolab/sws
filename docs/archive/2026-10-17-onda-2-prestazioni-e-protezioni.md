# Piano — onda 2: prestazioni misurate (P5) e protezioni HTTP (C6)

## Context

È l'onda 2 del [piano prima fascia e CRA](docs/plans/2026-10-15-piano-prima-fascia-e-cra.md); l'onda 1 è chiusa.

- **P5.** Le prestazioni dichiarate sono la prima domanda di un integratore, e SWS non ha nessun numero misurato
  ([gap analysis](docs/archive/2026-10-15-gap-analysis-scada-professionali.md), riga 105: ❌).
- **C6.** Il CRA chiede impostazioni sicure per default. Oggi:
  - le intestazioni di sicurezza le hanno solo i file dei marchi (`marchi.rs`);
  - di limiti alle richieste ci sono solo quello sui login e il limite di dimensione degli upload
    (`DefaultBodyLimit`).
- **L'ordine** viene dal piano: **C6 dopo P5**, perché i limiti si tarano sui numeri misurati, non a occhio.

Scelte del maintainer (17-10-2026):
- **griglia media**: 100, 1.000 e 5.000 tag × 1, 5 e 20 client web, a 1 aggiornamento al secondo per tag;
- **macchine**: il **TC620** (pannello vero, client dal PC in rete locale) e **x86** come riferimento server/cloud;
- **iframe**: ammessi **da origini dichiarate**;
- **limiti**: per indirizzo, **tarati sul banco**.

## Ramo 1 — `feat/banco-prestazioni` (P5)

> **Fatto il 17-10-2026.** Misure in `docs/manual/16_prestazioni.md`. Differenze dal piano: sul pannello il progetto
> del banco si carica come ZIP (un pannello non crea progetti) e porta un suo Admin (gli utenti stanno nel progetto
> aperto); `/metrics` corretto e con le metriche del processo; seme `2026-10-17-tag-uguali-ritrasmessi.md`.

**Il carico.** Un binario nuovo nel workspace, `sws-banco` (crate `sws-runtime/crates/sws-banco`). Usa
`tokio-tungstenite` e `reqwest`, già nel lock.

1. **Prepara il progetto** sul runtime di destinazione, via API come fa `check_luce_lvgl.sh`:
   - lo crea, gli dà N tag con `generator` (`GeneratorSpec` in `sws-core/src/project.rs:395`, `period_ms` 1000);
   - aggiunge un tag scrivibile `banco.eco`.
2. **Apre K client** sul WebSocket dei tag (`/ws/tags`, quello del viewer, con la stessa sottoscrizione) e per
   60 s conta i valori arrivati al secondo.
3. **Latenza da capo a capo**, senza dipendere dagli orologi delle due macchine: una scrittura di `banco.eco` al
   secondo (`PUT /api/tags/:id`) e il tempo finché ognuno dei K client la vede; si riportano mediana e 95°
   percentile.
4. **Risorse**: CPU e memoria del runtime da `/metrics` (con la sessione, perché `/metrics` è protetto da C3), un
   campione ogni secondo, media e massimo.
5. **Esce** con una riga JSON per casella e una tabella markdown.

**Lo script** `scripts/banco_prestazioni.sh <url> [utente]`:
- percorre la griglia 3 × 3;
- salva `docs/prestazioni/<data>-<macchina>.json`;
- **ferma sempre** il runtime di prova che ha avviato lui (sul x86); sul TC620 usa il runtime del pannello con un
  progetto apposito e alla fine riapre quello di prima.

**Il manuale**: nuovo capitolo `docs/manual/16_prestazioni.md` con le due tabelle, come si rifà la misura e i
limiti della misura (rete locale, browser non simulato: è il carico del runtime, non il disegno).

## Ramo 2 — `feat/intestazioni-sicurezza` (C6, prima metà)

Un middleware in `sws-web/src/sicurezza_http.rs`, montato come `cache.rs` su tutti e tre i router.

**Intestazioni, su tutte le risposte:**
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`;
- `Content-Security-Policy`:
  - `default-src 'self'`;
  - `img-src 'self' data: blob: https:` (le immagini delle pagine possono essere URL esterni);
  - `style-src 'self' 'unsafe-inline'` (l'IDE usa stili inline ovunque);
  - `script-src 'self'`;
  - `connect-src 'self' ws: wss:`;
  - `frame-ancestors` dall'elenco dichiarato.

**Gli iframe.** Un campo nuovo dell'istanza, `origini_iframe: [..]`: vuoto vuol dire `frame-ancestors 'self'`.
Si dichiara in Configurazione → Istanza → Sicurezza, accanto al resto delle impostazioni di istanza. Sul gateway
cloud c'è la sua copia nella configurazione del gateway.

**HSTS** (`Strict-Transport-Security`) solo quando la risposta parte da un listener TLS, mai in HTTP in chiaro: il
pannello senza TLS non deve diventare irraggiungibile.

**La guardia** `check_intestazioni.sh`: ogni router monta il middleware, così non si toglie in silenzio.

**Prima di accendere la CSP**, con Playwright si percorrono IDE, viewer web, console e login, in cerca di errori
CSP in console. Ogni eccezione necessaria va scritta nel codice con il suo perché.

## Ramo 3 — `feat/limiti-richieste` (C6, seconda metà)

**Il middleware** `sws-web/src/limiti.rs`: un secchio di gettoni per indirizzo IP, in memoria, scritto in casa
(nessuna dipendenza nuova). Due secchi distinti:
- **letture** (`GET` sulle API);
- **scritture** (tutto il resto).

**L'indirizzo.** Quello della connessione. Dietro il gateway (`--auth-delegata`) vale l'intestazione del gateway
già fidata, mai un `X-Forwarded-For` arrivato da fuori.

**Esclusi:**
- i file della SPA e i WebSocket, che sono una connessione sola;
- `/health`;
- le chiamate del gateway e dei container figli (chiave di ritorno).

**Oltre il tetto**: risposta `429` con `Retry-After` e un messaggio leggibile. Ogni rifiuto finisce nel log a
campione, non riga per riga.

**I valori**: il massimo misurato dal banco nella casella più carica (20 client), per un client singolo, più un
margine ×3, scritto in un commento con la misura da cui viene. Sono configurabili con una variabile d'ambiente,
per chi ha un caso diverso.

## Verifica

- `cargo test` (sws-web, sws-banco), `pnpm build`, vitest, `./scripts/check_static.sh` verdi; squash solo a guardie
  verdi.
- **P5**: il banco gira su x86 e sul TC620. Le due tabelle sono nel manuale e i JSON in `docs/prestazioni/`.
  Runtime di prova fermati.
- **C6 intestazioni**: nessun errore CSP in console percorrendo IDE e viewer con Playwright; una pagina di prova in
  un iframe:
  - bloccata senza origine dichiarata;
  - mostrata con l'origine dichiarata.
- **C6 limiti**:
  - un test di carico oltre il tetto riceve `429`;
  - il banco a 20 client resta sotto il tetto, senza falsi rifiuti;
  - test Rust sul secchio di gettoni e sull'indirizzo dietro il gateway.
- A fine di ogni ramo, immagini pubblicate e cloud e TC620 allineati (regola del 17-10).
