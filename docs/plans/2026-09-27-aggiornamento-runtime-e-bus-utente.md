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
31. **Canali stabile / prova**: stabile segue le release, prova le `-dev`. Il pannello segue il suo canale.
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

## Visto il 27-09, da non dimenticare

- Sui pannelli con CODESYS, `allow_url_override = true` fa vincere CODESYS sul browser all'avvio
  (`docs/TEST_SETUPS.md`): la commutazione del display deve saperlo, o lo schermo finisce su Cockpit.
