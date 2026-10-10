# Fase 4 — il gateway

> Dettaglio della **Fase 4** del [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md).
> Le Fasi 1, 2 e 3 sono chiuse e in archivio.
>
> **Le specifiche sono decise** (09-10-2026, in fondo). Il disegno di dettaglio no: quando il
> lavoro comincerà serve ancora una sessione di plan su come è fatto il gateway dentro. Qui ci
> sono le misure di quel giorno, le decisioni prese e le due cose da provare prima di scrivere
> codice.

## Cos'è, in una riga

Un processo che sta davanti a tutti gli altri: serve le pagine pubbliche, fa l'autenticazione, e
**instrada ogni progetto al proprio container**, avviandolo a richiesta e spegnendolo da fermo.

È il pezzo che trasforma «un IDE con le aziende dentro» in «un servizio cloud», ed è anche quello
che rende sufficiente un VPS-1 (decisione 39): senza lo spegnimento da fermo, ogni progetto mai
aperto resterebbe un container acceso.

## Cosa dice già il tronco cloud

- `sws-runtime --gateway`: SPA pubblica, accesso, registrazione, pannello dell'azienda; instrada
  `/p/<progetto>/*` al container del progetto.
- `--auth-delegata` sul figlio: accetta l'identità dall'intestazione del gateway **solo** da socket
  locale. Il piano del 27-09 lo segnala per nome: «`ide_only` dietro il gateway deve voler dire
  *l'autenticazione la fa il gateway*, e le due cose non vanno confuse».
- Container podman rootless, immagine del runtime, montata **solo** la cartella del progetto
  (decisione 25).
- **Branding per azienda** (decisione 43): il gateway serve `/branding/active.json` per azienda.

## Misurato il 09-10-2026

1. **Non esiste niente**: nessuna opzione `--gateway`, nessun `--auth-delegata`, nessun codice di
   proxy inverso in `sws-runtime/crates/sws-runtime/src/main.rs`. Le opzioni di avvio attuali sono
   `--projects-root`, `--www`, `--viewer-port`, `--admin-port`, `--no-admin`,
   `--senza-autenticazione`.
2. **Il prerequisito infrastrutturale è soddisfatto.** Il tronco cloud chiede un'immagine **amd64**
   su ghcr prima di questa fase, perché il gateway gira su x86. C'è: `2.12.0-amd64` e
   `latest-amd64` sono sul registry dal 06-10-2026, e dal 09-10 anche `2.13.0-rc.1-amd64` e
   `rc-amd64` col lavoro di oggi.

   > **Questo punto prima diceva il contrario**, e lo diceva sbagliando. L'avevo ricavato dalle
   > note della release 2.12.0 in `STATUS.md`, che elencano solo i tag `arm64` — erano incomplete,
   > e io ho preso un documento per lo stato del registry senza interrogare il registry. La
   > verifica giusta costa un comando: `podman pull <tag>` riesce, su un tag inventato fallisce
   > con «manifest unknown».
3. **Il branding per azienda è già risolto a metà**, e non come previsto: dal 09-10-2026 il
   marchio segue chi entra via `GET /api/identita/marchio`, e il frontend ricarica il tema dopo
   l'accesso. Il gateway non deve più servire un `active.json` diverso per azienda — gli resta solo
   il caso **prima** del login, dove l'azienda non si conosce ancora.
4. **Il confinamento c'è già** ed è stato costruito per reggere qui: `risolvi_progetto` verifica
   l'appartenenza a ogni indirizzo, `confine()` fa lo stesso nella console. Il gateway li eredita,
   non li rifà.

## Le decisioni (maintainer, 09-10-2026)

### Le quote sono due

- **Il numero di progetti non è una quota.** Lo spazio lo copre già: cento progetti piccoli e uno
  grande pesano per quello che occupano, non per quanti sono. Sparisce.
- **I progetti aperti insieme sì.** Ogni progetto aperto è un container avviato, cioè memoria e
  CPU. È la quota che decide quante aziende sta su un VPS.
- **I pannelli no.** Il loro numero resta un dato utile da vedere, ma non limita niente. Cosa
  dica davvero quel numero va capito a parte (vedi «Resta aperto»).

Questo **supera la decisione 23**, che diceva «numero di progetti, spazio su disco, numero di
pannelli» e che in due punti del tronco cloud escludeva esplicitamente i progetti aperti. Le
parole del maintainer dell'08-10: «non è un problema il numero di utenti ma lo spazio, il numero
di progetti contemporanei aperti (quindi il numero di container da avviare), che saranno definiti
dall'admin globale».

### Quando il tetto è pieno, si rifiuta

Messaggio semplice: il tetto è pieno, riprova più tardi. Niente elenco di chi ha aperto cosa,
nessuno spegnimento automatico per far posto. Chi ha aperto un progetto non se lo ritrova chiuso
perché qualcun altro ne voleva uno.

### Un container si spegne quando nessuno è più collegato

Il segnale è il **browser**: finché una finestra è aperta su quel progetto c'è un WebSocket
attivo. Chiusa l'ultima, parte un timer; allo scadere il container si spegne. Riaprendo il
progetto riparte, con qualche secondo di attesa.

Predefinito **20 minuti**, modificabile dalla console.

Si è scartato «nessuna richiesta HTTP da N minuti» perché una scheda dimenticata aperta continua a
fare richieste da sola, e il container non si spegnerebbe mai.

### Il gateway è un container, dietro Traefik

Come gli altri servizi del VPS. Traefik, che c'è già, gli manda il traffico di `sws.soligo.net`.
Si aggiorna come ogni altra immagine.

Deve però poter avviare e fermare altri container, e questo da dentro un container va concesso
apposta: **è la prima cosa da provare**, prima di scrivere codice.

### `sws.soligo.net` diventa il gateway

L'IDE a istanza singola che gira lì adesso si spegne. I progetti che ci sono si rifanno o si
ricaricano. Un indirizzo solo, nessuna convivenza.

### Già deciso altrove

Al container di un progetto si monta **solo la cartella del progetto** (decisione 25). Quindi non
vede `identita.db`, e l'identità di chi sta lavorando gli arriva dal gateway. Non c'è niente da
decidere: la decisione 25 risponde già.

## Resta aperto

- **Cosa ci dice il numero di pannelli.** Il maintainer: «può essere un dato statistico utile, non
  una quota, ma dobbiamo analizzare con un dettaglio maggiore cosa ci dice questa informazione».
  Fino ad allora la colonna `max_pannelli` non si tocca e la console non la mostra.
- ~~Un container può avviarne un altro?~~ **Sì, provato sul VPS il 09-10-2026.** Vedi sotto.

## La prova sul VPS (09-10-2026): un container ne avvia un altro

Fatta su `vps-5ea9b77b`, podman 5.4.2, socket rootless già attivo. Da dentro un container, via
l'API di podman sul socket montato:

```
POST /v5.0.0/libpod/containers/create   → {"Id":"924b980d4cfa…"}
POST /v5.0.0/libpod/containers/…/start  → HTTP 204
podman logs                             → "sono-il-figlio"
```

Il figlio è stato creato, avviato, ha scritto, ed è stato rimosso. **Il gateway può essere un
container dietro Traefik**, come deciso.

### La trappola, che costerà mezz'ora a chi non la sa

Il socket è `srw-rw---- debian debian`. In podman rootless l'utente *root dentro* il container
corrisponde all'utente che l'ha avviato (`debian`), mentre un utente non-root dentro finisce in un
subuid che con `debian` non c'entra nulla. La prima prova è fallita con `HTTP 000` proprio per
questo: l'immagine usata gira come utente non privilegiato.

Quindi **il container del gateway deve girare come root al suo interno** (che fuori resta
`debian`, non root della macchina) per poter usare il socket. Nel `podman run` serve `--user 0` o
un'immagine che parta già da root.

Comandi della prova, per rifarla:

```bash
SOCK="$XDG_RUNTIME_DIR/podman/podman.sock"      # /run/user/1000/podman/podman.sock
podman run --rm --user 0 -v "$SOCK:/run/podman/podman.sock" --security-opt label=disable \
  docker.io/curlimages/curl:latest \
  -s --unix-socket /run/podman/podman.sock http://d/v5.0.0/libpod/_ping
```

Sul VPS restano scaricate `alpine` e `curlimages/curl`, una decina di megabyte in tutto: servono a
rifare la prova e non danno fastidio.

## Il primo passo concreto

**Scrivere il gateway.** Le due cose che lo precedevano sono fatte: l'immagine amd64 c'è
(`2.13.0-rc.1-amd64` col lavoro del 09-10, oltre alla 2.12.0 già presente dal 06-10) e podman
dentro un container funziona.

Resta da aprire la sessione di plan sul **dentro** del gateway: come instrada, dove tiene lo stato
dei container avviati, come passa l'identità al figlio.

## Fatto il 09-10-2026 — il gateway esiste

Ramo `feat/4a-gateway-podman`, tre commit.

### Com'è fatto dentro

Quattro moduli in `sws-runtime/crates/sws-web/src/gateway/`:

| | |
|---|---|
| `podman.rs` | il client di podman: HTTP/1.1 a mano sul socket unix, perché reqwest i socket unix non li fa. Crea, avvia, ferma, rimuove, elenca **solo i container nostri** (prefisso `sws-p-` e l'etichetta `net.soligo.sws.progetto`). |
| `progetti.rs` | `Regia`: chi è aperto, il tetto dell'azienda, il timer dei fermi, la riadozione dopo un riavvio. |
| `inoltro.rs` | il proxy: HTTP in streaming e WebSocket, con la pulizia delle intestazioni. |
| `rotte.rs` | `/p/<azienda>/<progetto>/…`: guscio, autorizzazione, accensione a richiesta. |

### Le tre cose che non si indovinano

**Il guscio della SPA lo serve il gateway, senza token.** Una navigazione del browser non ne porta
nessuno: il token vive in `localStorage` e lo aggiunge il codice della pagina, che non è ancora
stato caricato. Se la radice del prefisso fosse protetta, *ogni ricarica* darebbe 401 anche con una
sessione valida. Il guscio non è privato — è la stessa SPA che la console serve a chiunque, e i
suoi `/assets/` stanno già alla radice del sito. Tutto il resto sotto il prefisso è il progetto,
passa da `require_auth` e viene rigirato al container.

**L'identità la scrive il gateway, e le intestazioni del browser si buttano via prima.** Senza
quella pulizia il segreto sarebbe decorativo: chiunque potrebbe mandare `X-SWS-Utente:
qualcun-altro@esempio.it`, e il nostro segreto — aggiunto alla stessa richiesta — renderebbe
credibile la sua intestazione. Provato nei due versi: attraverso il gateway l'intestazione falsa
sparisce e il figlio vede l'utente vero; mandata dritta alla porta del container prende 401.
Guardia `check_inoltro_identita.sh`, provata rossa due volte.

**La radice dei progetti deve essere lo stesso percorso dentro e fuori dal gateway.** `apri`
controlla che la cartella esista — e quel controllo avviene dove gira il gateway — poi passa lo
stesso percorso a podman come sorgente del bind mount del figlio, e podman lo risolve **sull'host**.
Con due percorsi diversi il controllo passa e il container del progetto parte vuoto. Nel quadlet la
radice è montata allo stesso posto in tutti e due i lati.

### Provato a mano, con un gateway locale e l'immagine 2.13.0-rc.1-amd64

| | |
|---|---|
| `GET /p/-/impianto/` | 200, l'HTML dell'IDE |
| `GET /p/-/impianto/api/project` | 200 col progetto vero, container creato e avviato, 0,8 s in tutto |
| `GET /p/-/impianto/ws/tags` | 101 Switching Protocols |
| `GET /p/-/nonesiste/api/project` | 404 |
| `GET /p/acme/impianto/api/project` | 404 «azienda sconosciuta» |
| la stessa richiesta dritta alla porta del figlio | 401 |

### Cosa resta

- La console mostra il tetto dei progetti aperti e permette di cambiarlo (oggi il campo c'è nel
  database e nella console, ma nessuno vede quanti ne sono aperti adesso).
- Chiudere un progetto a mano dalla console, senza aspettare i venti minuti.
- Il branding **prima** del login, che è l'unico pezzo della decisione 43 ancora aperto.
