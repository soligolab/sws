# Aggiornamento automatico del runtime e bus utente nel container

> **Piano — decisioni prese, disegno da fare.** Nato il 27-09-2026. È **prerequisito** del
> [piano utenti e aziende](2026-09-18-identita-utenti-istanze.md) e **assorbe** il seme della
> [commutazione del display via D-Bus](../archive/2026-09-24-commutazione-display-via-dbus.md) (24-09): tutti e due
> hanno bisogno della stessa cosa, il **bus utente di systemd montato nel container**, e toccano lo stesso installer.
>
> ⚠️ **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita per sviscerarne tutti
> i dettagli.** Qui ci sono le decisioni del maintainer e le misure del giorno; il disegno si fa allora.

## Perché insieme

- **Aggiornamento**: il runtime nel container non può riavviare se stesso; lo chiede a systemd, via bus utente, avviando
  `podman-auto-update.service`.
- **Commutazione del display**: l'ultimo meccanismo a file sull'host (`sws-display.path` + `.service` + uno script di ~200
  righe). Dei suoi quattro passi, l'avvio/arresto del viewer LVGL è l'unico che vuole il bus **utente**; gli altri stanno sul
  bus di sistema, già montato.

Stesso mount, stessa domanda di sicurezza (il bus utente permette di comandare **ogni** unit dell'utente, non solo le
nostre), stessa prova sul TC620. Fatti insieme, l'host dei Pixsys non ha più nessun pezzo nostro.

## Decisioni del maintainer — aggiornamento (27-09-2026)


Chiesto dal maintainer il 27-09-2026 dentro il [piano utenti e aziende](2026-09-18-identita-utenti-istanze.md)
(«prima in quel piano vorrei introdurre un meccanismo di aggiornamento automatico del runtime»), poi messo in un
piano suo: «lo vedo come propedeutico perché facilita lo sviluppo futuro».

**Misurato sul TC620:** podman **5.0.2**, con `podman-auto-update.{service,timer}` già installati dal sistema
(disabilitati); l'immagine ha un `HEALTHCHECK` (quindi podman può tornare indietro da solo se la versione nuova non
diventa *healthy*); al quadlet manca solo `AutoUpdate=registry`. Il viewer LVGL monta già `/run/user/1000`.

30. **Decide un Admin, con una finestra**: il pannello sa che c'è una versione nuova; l'Admin preme «Aggiorna
    ora» o fissa una finestra (es. domenica alle 3). Nessun riavvio a sorpresa di un impianto in servizio.
31. **Canali stabile / prova**: stabile segue le release, prova le immagini di prova (`-rc`, vedi sotto). Il pannello
    segue il suo canale.
32. **L'immagine si scarica da ghcr.io se raggiungibile, altrimenti dalla VPS** (un registry anche lì, raggiungibile
    via VPN).
33. **Se la versione nuova non parte: torna alla precedente e avvisa** — rollback di podman, notifica coi canali
    del progetto (Telegram/email), stato visibile nell'IDE.
34. **Il runtime fa partire l'aggiornamento attraverso il bus utente di systemd** (`/run/user/1000/bus` montato
    nel container; avvia `podman-auto-update.service`): la strada più stretta, e la stessa che serve al seme della
    [commutazione del display via D-Bus](../archive/2026-09-24-commutazione-display-via-dbus.md), assorbito qui. Scartato il socket di
    podman (darebbe al container il controllo di tutti i container dell'utente).
35. **Un IDE più nuovo del runtime avvisa e chiede conferma al deploy**, proponendo l'aggiornamento: con gli
    aggiornamenti le versioni si mescolano, e un runtime vecchio può perdere campi che non conosce.

Da tenere insieme: il viewer LVGL usa la stessa immagine e va aggiornato col runtime, mai uno sì e uno no.

## Dal seme della commutazione del display (24-09)

Il testo integrale, con le misure sul WP630, è in archivio:
[2026-09-24-commutazione-display-via-dbus](../archive/2026-09-24-commutazione-display-via-dbus.md). Le domande che
porta qui: che fine fa `display-target`; chi applica la commutazione al primo avvio; come si disinstalla il vecchio
meccanismo dai dispositivi che ce l'hanno.

## La prima prova, prima di qualunque codice

Sul TC620, a mano: montare `/run/user/1000/bus` nel container (con `UserNS=keep-id` l'uid combacia, come per il bus di
sistema) e da dentro avviare `podman-auto-update.service` e `sws-lvgl-viewer.service`. **Se l'autenticazione del bus
utente non regge dal container, cambia la strada** per entrambi.

## La prova, fatta il 27-09-2026 sera — il bus utente regge

Sul TC620 (dev.5), con un container usa-e-getta della stessa immagine e un client D-Bus minimo in Python puro
(nell'immagine non ci sono `busctl`, `systemctl`, `dbus-send`, né il modulo `dbus`):

| prova | esito |
|---|---|
| `-v /run/user/1000/bus:/run/user/1000/bus` + `--userns=keep-id`, AUTH EXTERNAL | **OK** (uid dentro = 1000) |
| `Hello`, `GetUnit("sws-runtime.service")` | risposta regolare |
| `StartUnit("podman-auto-update.service", "replace")` | **avviata** (job 5044): il container comanda una unit utente |
| stesso, **senza** `keep-id` | `REJECTED EXTERNAL` (uid dentro = 0): `UserNS=keep-id` è indispensabile, come per il bus di sistema |

`podman auto-update` in quel giro è uscito 125 («no container with ID … found»): era il container usa-e-getta, sparito
(`--rm`) mentre podman elencava. Lanciato direttamente, `podman auto-update --dry-run` → 0.

**Da portare nel disegno:**
- il runtime che avvia l'aggiornamento viene fermato e sostituito dall'aggiornamento stesso: va bene, perché il lavoro
  gira nella unit `podman-auto-update.service`, non nel chiamante — ma la risposta HTTP a «Aggiorna ora» deve partire
  **prima** di chiamare `StartUnit`;
- il rollback di podman scatta se il riavvio della unit fallisce: perché «fallisce» voglia dire «non è diventato
  *healthy*», il quadlet deve avere **`Notify=healthy`** oltre a `AutoUpdate=registry`;
- serve il client D-Bus nel runtime: `zbus` c'è già (lo usa `launcher_dbus.rs`), basta `Connection::session()` con
  `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`.

## Decisioni della sessione di plan (27-09-2026, sera)

36. **Le immagini di prova si chiamano `-rc`, non più `-dev`** (maintainer: «Al posto di dev chiamiamo rc le immagini
    di test»). Si riparte da `2.12.0-rc.1`: in semver `-dev.5` < `-rc.1`, quindi nessun pannello la vede «più vecchia».
    Le `-dev.3/4/5` già costruite restano com'erano (i loro tag, quando si fa il push, conservano il nome).
37. **Il canale di prova si pubblica anche su ghcr.io**, pubblico: chiunque può vedere e scaricare le `-rc`.
38. **I pannelli installati da archivio si aggiornano dall'IDE con un archivio** (via SSH, poi via VPN), come
    l'installazione di oggi; non entrano nell'aggiornamento automatico.
39. **Canale e finestra sono del dispositivo**, impostati dalla scheda Connessione e salvati nella config del runtime:
    un deploy non li cambia.
40. **Fasi: 1 «Aggiorna ora» → 2 finestra programmata → 3 avviso di rollback → 4 commutazione del display via bus.**

## Misurato per il disegno (27-09, sera)

- `podman auto-update` segue **lo stesso tag**: aggiorna quando cambia l'immagine dietro quel nome. Quindi i canali
  sono **tag mobili**: stabile = `latest-<arch>` (esiste già: i pannelli installati dal registry lo seguono da oggi),
  prova = `rc-<arch>` (nuovo). Un pannello installato da archivio (`localhost/…`) non ha un registry da seguire.
- Il runtime **non sa quale immagine esegue** (`/run/.containerenv` è vuoto in un container rootless): lo dirà il
  quadlet con una variabile (`SWS_IMAGE`), scritta dall'installer come già riscrive `Image=`.
- ghcr.io elenca i tag senza credenziali (100 tag, 27-09): il runtime confronta la **sua** versione con la più alta del
  suo canale.

## Fase 1 — «Aggiorna ora»

1. **Quadlet** (`sws-runtime.container`, e `AutoUpdate` anche sul viewer, stessa immagine): `AutoUpdate=registry`,
   `Notify=healthy`, `Volume=/run/user/1000/bus:/run/user/1000/bus`,
   `Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`, `Environment=SWS_IMAGE=<riferimento>`
   (riscritta dall'installer).
2. **Pubblicazione** (`build_container.sh --push`): una `-rc` sposta `rc-<arch>`; una release sposta `latest-<arch>`
   **e** `rc-<arch>` (il canale prova non resta indietro rispetto allo stabile).
3. **Runtime**: `GET /api/update/status` → versione, immagine, canale (dal tag), versione disponibile nel canale,
   «da archivio» se l'immagine è `localhost/…`; `POST /api/update/apply` (Admin) → risponde **prima**, poi
   `StartUnit("podman-auto-update.service")` via `zbus` sul bus di sessione. Entrambe anche in `deploy_only_app`.
4. **IDE**: proxy `/api/remote/update/*`; nella scheda Connessione una sezione «Aggiornamento del runtime»: versione,
   disponibile, «Aggiorna ora» con conferma; per i pannelli da archivio il rimando all'Installazione.
5. **Prassi**: HOWTO §19 e `check_release_coerente.sh` passano da `-dev` a `-rc`.

Collaudo sul TC620: reinstallarlo **dal registry** sul canale prova, pubblicare una `-rc` più nuova, «Aggiorna ora»,
verificare versione nuova e *healthy*; poi un'immagine rotta apposta per vedere il rollback.

## Visto il 27-09, da non dimenticare

- Sui pannelli con CODESYS, `allow_url_override = true` fa vincere CODESYS sul browser all'avvio
  (`docs/TEST_SETUPS.md`): la commutazione del display deve saperlo, o lo schermo finisce su Cockpit.
