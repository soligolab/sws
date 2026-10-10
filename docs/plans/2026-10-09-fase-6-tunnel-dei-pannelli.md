# Fase 6 (prima parte) — il tunnel dei pannelli

> Dettaglio della **Fase 6** del [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md), aperta
> fuori ordine: il maintainer il 09-10-2026 ha chiesto «vorrei arrivare a poter connettere un
> pannello per fare il deploy», e quello è il tunnel. La Fase 5 (registrazione, email, 2FA) resta
> dov'era e si farà dopo.

## Il problema, in una riga

Un pannello sta dentro la rete di un cliente, dietro NAT: nessuno da fuori può aprire una
connessione verso di lui. Quindi deve essere lui a chiamare, e tutto il resto deve passare da
dentro quella chiamata.

## Cosa c'era già, misurato il 09-10-2026

**Il deploy dal cloud funziona già oggi, se il pannello è raggiungibile.** Provato: IDE in un
container dietro il gateway, un finto pannello (`--no-admin`, come in produzione) su un altro
container della stessa rete, `POST /api/remote/connect` con l'URL del pannello e poi
`POST /api/remote/deploy`:

```
✓ Esportato (25.2 KB)
✓ Caricato come "f0b"
✓ "f0b" attivo sul runtime
🚀 Deploy completato!
```

Il progetto è arrivato davvero sul disco del pannello. **Questo chiude una domanda**: tutto lo
strato remoto — connessione, deploy, utenti, backup, aggiornamenti — compone `{base}/api/…` da
`RemoteTarget.url` e non sa né gli importa com'è fatto quel `base`. Al tunnel non serve cambiarlo:
gli serve **esistere** e dare un `base`.

## Le decisioni del maintainer (09-10-2026)

### Multiplexer a stream, non messaggi richiesta/risposta

Il pannello apre **un** WebSocket verso il gateway. Dentro corre un multiplexer (`yamux`): ogni
richiesta dell'IDE diventa uno **stream**, e dentro lo stream si parla HTTP/1.1 vero.

Perché questa e non lo scambio di messaggi JSON `{id, metodo, percorso, corpo}`: con gli stream il
proxy scritto per il gateway vale quasi tale e quale, i corpi grossi (un progetto esportato) non
devono stare in memoria, e il WebSocket dei tag vivi passa dentro il tunnel senza essere un
secondo meccanismo da inventare. Il prezzo è una dipendenza nuova, accettata.

### Il codice di abbinamento lo mostra il pannello

Il pannello mostra un codice sul suo schermo e sulla sua pagina locale; chi amministra l'azienda
lo incolla nella console del cloud. È già la decisione 12/14 del tronco cloud, e lo stesso codice
è il primo accesso del pannello (decisione CRA 4).

Conseguenza sul giro dell'abbinamento, che va detta perché non è ovvia: il gateway **non può
raggiungere il pannello** per consegnargli un token. Quindi è il pannello che si presenta al
tunnel col proprio codice, il gateway lo tiene in attesa, e quando qualcuno in console rivendica
quel codice il pannello riceve il token duraturo sulla connessione che ha già aperto.

## Come è fatto

```
pannello                          gateway (sws.soligo.net)            IDE nel container
   │                                      │                                  │
   │  wss://tunnel.soligo.net/tunnel/v1   │                                  │
   ├─────────── una sola ────────────────>│  registro: pannello -> tunnel    │
   │                                      │                                  │
   │  <──── stream yamux (uno per richiesta) ────                            │
   │                                      │<─── GET /dev/<pannello>/api/… ───┤
   └─> 127.0.0.1:8444 (la sua porta di gestione)                             │
```

Tre pezzi:

| | |
|---|---|
| `tunnel/filo.rs` | il WebSocket visto come flusso di byte: serve perché `yamux` vuole qualcosa che si legga e si scriva, non messaggi |
| `tunnel/pannello.rs` | il lato pannello: chiama, si riconnette, accetta stream e li gira alla propria porta di gestione |
| `tunnel/gateway.rs` | il lato gateway: accetta, riconosce chi è, tiene il registro, e per ogni richiesta apre uno stream e ci parla HTTP |

E l'instradamento `/dev/<pannello>/…`, che è lo stesso proxy di `/p/<azienda>/<progetto>/…` con un
trasporto diverso sotto.

## A fette

**Fetta 1 — il filo regge. ✅ FATTA (09-10-2026).** Token statico in `<config>/pannelli.yaml`,
nessun abbinamento. Provato: pannello che chiama, `/dev/<pannello>/health` che risponde 200
attraverso il tunnel, e l'IDE nel container che fa `connect` e `deploy` passando di lì — col
progetto arrivato sul disco del pannello, che era raggiungibile **solo** dalla connessione aperta
da lui.

Tre cose imparate scrivendola, che valgono per la fetta dopo:

- **Un ping non è la fine del flusso.** Nel `Filo` un messaggio di servizio va saltato, non
  restituito come «zero byte letti»: quello per `AsyncRead` vuol dire *fine*, e il tunnel
  morirebbe al primo keepalive. C'è un tipo apposta (`Pezzo`) perché l'errore non si possa più
  scrivere.
- **`yamux::Connection` va sondata perché il protocollo avanzi**, quindi chi vuole uno stream non
  può chiamare un metodo: passa da un compito che possiede la connessione. Anche un'apertura *in
  uscita* resta ferma se nessuno chiama `poll_next_inbound`.
- **Un pannello che si ripresenta vince su quello già nel registro.** Il caso normale non è un
  impostore ma un pannello che ha perso la linea e ha richiamato prima che il gateway si
  accorgesse della caduta. Tenere la vecchia connessione vorrebbe dire un pannello irraggiungibile
  finché un timeout non scade, cioè proprio quando serve.

**Fetta 2 — l'abbinamento.** Il confine fra aziende **c'è già** (ogni pannello dichiara la
propria in `pannelli.yaml`, e `/dev/<pannello>/…` lo verifica con le stesse appartenenze che
filtrano i progetti; guardia `check_pannello_confinato.sh`). Quello che manca è il modo in cui un
cliente ci arriva senza che qualcuno scriva un file sul gateway: il codice sullo schermo del
pannello, la rivendicazione in console, il token duraturo. Il codice sul pannello, la rivendicazione in console, il token
duraturo, il pannello legato a un'azienda, e il gateway che decide a ogni richiesta chi può
parlare con chi.

**Fetta 3 — la tenuta.** La domanda della Fase 0 che nessuno ha ancora misurato: *una connessione
TLS uscente sulla 443 da dentro una rete d'impianto regge nel tempo?* NAT con timeout aggressivi,
proxy che intercettano, ispezione TLS. Si misura lasciando un pannello collegato per giorni e
contando le cadute. Non è un cancello — il tunnel si riconnette — ma la cadenza delle
riconnessioni dice se il disegno va bene o va irrobustito.

## Quello che questa fase non fa

Non tocca lo strato remoto (`remote.rs`): è provato che funziona così com'è. Cambia solo **dove
punta** `RemoteTarget.url`.

Non porta gli utenti d'impianto «locali» (decisione 21) né l'aggiornamento del pannello dal
cloud: vengono dopo, e passano dallo stesso tunnel senza codice nuovo.
