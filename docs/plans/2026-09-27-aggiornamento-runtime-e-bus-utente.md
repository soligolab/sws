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
    (Il 28-09 si aggiunge la Fase 1b, avviso sul pannello e changelog: decisioni 41-44.)

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

## Collaudo della Fase 1 sul TC620 (28-09-2026, mattina)

Autorizzato dal maintainer fino al punto 4 («prova a vedere se arrivi fino al punto 4»), con `podman login ghcr.io`
fatto da lui in `~/.config/containers/auth.json`.

1. **rc.1 su `rc-arm64`**, verificata sul registry (i tre tag sulla stessa immagine, `latest-arm64` intatto). TC620
   reinstallato **dal registry** sul canale di prova: quadlet con `AutoUpdate`, `Notify=healthy`, bus utente,
   `SWS_IMAGE`; `systemctl show` → `Type=notify`.
   **Difetto trovato**: la rc.1 diceva «disponibile: 2026.7.0» — il tag della vecchia numerazione a calendario è ancora
   nel registry e in semver batte ogni `2.x`. Corretto nella rc.2 (versioni con prima cifra ≥ 1000 ignorate), test
   provato rosso.
2. **«Aggiorna ora» rc.1 → rc.2**: 202 subito; pull in 15 s, runtime giù ~5 s, *healthy* a ~35 s, `UPDATED true`. Poi
   `podman-auto-update.service` ha cancellato dal pannello le immagini vecchie non usate (lo fa l'unit di sistema).
3. **Immagine rotta apposta** (la rc.2 con `ENTRYPOINT sleep`, pubblicata **solo** come `rc-arm64`, senza tag di
   versione): l'avvio scade a 90 s, `sleep` ignora SIGTERM e viene ucciso dopo altri 30 s, poi podman **rimette la rc.2**
   e riavvia → rc.2 *healthy*. Il ritorno indietro funziona.
   - **Ma podman dichiara il rollback «failed»** (`expected "done" but received "failed"`): il riavvio di `Restart=always`
     e quello del rollback si sono sovrapposti, con un riavvio in più. **Per la Fase 3**: l'avviso deve guardare la
     versione che gira alla fine, non il codice d'uscita di podman.
   - **Disservizio con un'immagine rotta: ~2,5 minuti** (90 s di attesa + 30 s per fermarla + riavvii). La rc.2 impiega
     ~35 s a diventare *healthy*: `TimeoutStartSec` (oggi 90 s) e il `TimeoutStopSec` si possono stringere — da tarare.
4. `rc-arm64` rimesso subito sulla rc.2 buona; l'immagine rotta resta su ghcr.io solo come versione senza tag.

## Avviso sul pannello e changelog (28-09-2026)

Proposta del maintainer: «Se esistono degli utenti definiti ok per il meccanismo su Admin. Se non ci sono utenti
tipicamente è una installazione di prova […] vorrei poter vedere un avviso di aggiornamento disponibile quando il
runtime parte o viene riavviato […] mi basta premere un tasto. Sarebbe anche utile, prima, poter vedere un changelog
[…] e se ci sono dei warning di compatibilità importanti, questo vale per tutte le modalità.»

41. **Senza utenti, l'avviso compare sullo schermo del pannello, in web e in LVGL**: all'avvio o al riavvio il
    runtime controlla il canale, e se c'è una versione nuova il pannello mostra «Novità / Aggiorna / Più tardi /
    Ignora questa versione». Senza utenti chiunque è già Admin, quindi il pulsante non apre niente di nuovo. Con
    utenti definiti l'avviso sul pannello non c'è: resta il percorso dell'Admin dall'IDE.
42. **Il changelog viaggia dentro l'immagine come etichetta**: alla build, la sezione di CHANGELOG della versione (per
    una `-rc`, `[Unreleased]`) e, a parte, i suoi avvisi di compatibilità. Il runtime le legge dal registry con la
    stessa chiamata anonima dei tag — pochi KB, niente pull — e per un salto di più versioni legge l'etichetta di
    **ogni** versione intermedia del canale, perché gli avvisi di una versione saltata sono quelli da non perdere.
43. **Gli avvisi di compatibilità si scrivono in una sottosezione `### ⚠ Compatibilità`** della versione, nel
    CHANGELOG. La finestra li mette in cima e chiede una conferma in più. Una guardia ne controlla il formato.
44. **«Più tardi» e «Ignora questa versione»**: il primo nasconde l'avviso fino al prossimo avvio, il secondo finché
    non esce una versione ancora più nuova.

Queste entrano come **Fase 1b**, dopo il collaudo della Fase 1 e prima della finestra programmata.

## Collaudo della Fase 1b a casa (28-09-2026, sera)

- rc.3 pubblicata con le etichette (`net.soligo.sws.changelog`, `.compat`), lette dal registry senza pull. Il piano
  dell'ufficio aveva un buco: le novità le legge **il runtime del pannello**, quindi una rc.2 non può mostrare quelle della
  rc.3. Il TC620 è stato portato alla rc.3 con «Aggiorna ora» (45 s), poi pubblicata la rc.4: la rc.3 vede «disponibile
  2.12.0-rc.4» con novità e avviso di compatibilità.
- **Difetto**: l'avviso a schermo chiamava `/api/update/*` dalla porta del viewer (8443), dove le rotte non c'erano (404):
  non poteva comparire mai. Corretto nella rc.5, dietro `require_admin`, con un test provato rosso.
- **Difetto minore**: l'immagine ereditava `org.opencontainers.image.version = 24.04` da Ubuntu; dalla rc.4 porta la
  versione di SWS.
45. **Le novità di una `-rc` restano tutto `[Unreleased]`** (scelta del maintainer, 28-09): chi è sul canale di prova vede
    tutto ciò che arriverà nella prossima release — oggi ~63 000 caratteri — non la differenza fra una rc e l'altra.

## Fase 2 — la finestra programmata (28-09-2026, sera)

46. **Tutte e due le forme**: di default un'**approvazione una tantum** («aggiorna alla 2.12.1 domenica alle 3»); per pannello
    si può accendere il **pilota automatico** («ogni domenica alle 3 installa ciò che c'è di nuovo nel canale»).
47. **L'ora è quella locale del pannello**, e l'IDE mostra **data e ora del pannello sia locali sia UTC** accanto alla
    finestra (maintainer: «così è impossibile confondersi»).
48. **Si sceglie con giorno + ora** (oggi / domani / lunedì… e «alle 03:00»); sotto non c'è un cron visibile.

**Misurato:** il TC620 è in `Europe/Rome`, il container in UTC (`/etc/localtime → …/UTC`); il `cron` del runtime lavora in
UTC. **Disegno:**
- quadlet: `Timezone=local` (podman copia il fuso dell'host nel container; tolta dall'installer sui podman 4.x come
  `Notify=healthy`); nel runtime `chrono::Local` converte giorno + ora del pannello in un istante, cambio d'ora compreso;
- `<config_dir>/aggiornamento.yaml` — del dispositivo, non del progetto (decisione 39): `approvazione` (versione +
  istante) e `pilota` (giorni + ora);
- un task nel runtime dorme fino al prossimo evento (al massimo un'ora, poi ricontrolla: la configurazione e l'orologio
  possono cambiare) e lì chiama `stato()`:
  - **approvazione**: aggiorna solo se il canale offre **ancora esattamente la versione approvata**. Podman installa la
    testa del canale, non una versione precisa: se nel frattempo è uscita una più nuova, l'approvazione si annulla e lo
    dice, perché nessuno ha letto quella;
  - **pilota**: aggiorna se c'è qualunque versione più nuova;
- `GET/PUT /api/update/schedule` (Admin, anche sulla porta di gestione), proxy nell'IDE; la sezione «Aggiornamento del
  runtime» mostra l'orologio del pannello, «Programma…», l'approvazione in corso con «Annulla», e il pilota automatico.
  Gli avvisi di compatibilità chiedono la seconda conferma anche quando si programma.

### Collaudo della Fase 2 sul TC620 (28-09, sera)

- rc.5 → rc.6 con «Aggiorna ora»; con la rc.6 sul pannello la finestra risponde, l'orologio del pannello è in **UTC** (il
  quadlet del TC620 non ha `Timezone=local`: vedi la questione qui sotto).
- **Il pilota automatico ha aggiornato da solo** rc.6 → rc.7 alle 19:45 del pannello, *healthy* in ~90 s, `ultimo_esito`
  scritto.
- **Visto dal maintainer**: ha scelto «21:41» intendendo la sua ora; il pannello era in UTC (19:40), quindi sarebbe scattato
  alle 23:41 sue. L'orologio doppio c'era, ma col pannello in UTC le due ore coincidono e il campo non dice di che fuso è.
- **Difetto**: il task della finestra rilegge la programmazione solo quando si sveglia (fino a un'ora): un cambio appena
  salvato poteva scattare in ritardo. Per il collaudo si è riavviato il runtime.
- **Difetto (Fase 1b)**: l'avviso a schermo non poteva comparire — leggeva `progettoHaUtenti`, che nel viewer non imposta
  nessuno (solo l'IDE), e i test lo impostavano a mano. Corretto nella rc.7: lo chiede a `/api/system`, e ricontrolla quando
  il runtime riparte (`uptime_s` che torna indietro), perché il viewer non ricarica la pagina a un riavvio.

**Chiesto dal maintainer per le prossime versioni:**
49. **Riprogrammare** un'approvazione o il pilota senza annullare e rifare.
50. **Migliorare la sezione**; in particolare, a connessione avvenuta **i campi partono dall'ora del pannello** (non da 03:00
    fisse), e accanto al campo c'è scritto di che fuso è l'ora.
51. Il task della finestra si **sveglia subito** quando la programmazione cambia.

### Fase 3 allargata: l'esito dell'aggiornamento (28-09, sera)

Il maintainer, dopo il pilota automatico sul TC620: «sul pannello non vedo nessuna segnalazione di aggiornamento avvenuto e/o
di changelog». Il pannello avvisava solo *prima*. La Fase 3 (prima: solo l'avviso di rollback) diventa l'esito di ogni
aggiornamento.

52. **«Aggiornato dalla X alla Y», con le novità di Y, in tre posti**: sullo schermo del pannello senza utenti (stesse
    regole dell'avviso di prima), nell'IDE (sezione Aggiornamento, alla prima connessione dopo) e sui **canali di notifica
    del progetto** (Telegram/email) — che col pilota automatico sono l'unico modo di saperlo quando nessuno guarda.
53. **Se non riesce**, negli stessi posti e in evidenza: «aggiornamento alla X non riuscito, il pannello è tornato alla Y».
    Si decide guardando **la versione che gira davvero** dopo, non il codice d'uscita di podman, che il 28-09 diceva
    «rollback failed» a un rollback riuscito.
54. **Sul pannello l'avviso resta finché qualcuno non lo chiude**, con «Novità» e «Chiudi»; chiuso una volta non ricompare
    per quell'aggiornamento.

**Disegno (da raffinare quando si scrive):** prima di `StartUnit` il runtime scrive in `aggiornamento.yaml` un `in_corso`
(da, a, quando). All'avvio: se gira `a`, l'esito «riuscito» si scrive solo dopo un paio di minuti di vita — una versione
nuova che parte e poi non diventa *healthy* viene rimpiazzata dal rollback prima —; se gira `da` con un `in_corso` di più
di qualche decina di secondi, l'esito è «non riuscito». Un `in_corso` a cui non segue nessun riavvio (niente di nuovo da
installare) si chiude da sé dopo qualche minuto, senza esito.

**Scritta il 28-09, sera** (ramo `feat/aggiornamento-f3-esito`): `aggiornamento_esito.rs` (`in_corso` prima di `StartUnit`, esito
all'avvio, conferma dopo 120 s, scadenza a 600 s), `evento` e `in_corso` in `/api/update/status`, riquadro sul pannello e riga
nell'IDE, Telegram sulle chat globali. **Email no**: nel progetto un destinatario esiste solo per singolo allarme
(`notify_email`); un destinatario di progetto per le notifiche di sistema sarebbe una decisione nuova. **Il primo esito
visibile arriva dall'aggiornamento *successivo* a quello che installa questa versione**: `in_corso` lo scrive la versione
che chiede, e le rc precedenti non lo scrivono.

### Le Novità per chi usa il pannello, separate dal CHANGELOG (28-09, sera)

Il maintainer, vedendo l'avviso sul pannello: «Dobbiamo rivedere il Changelog perché è troppo dettagliato e diventa
illeggibile. Oltretutto gestirei anche la versione in inglese». Il `CHANGELOG.md` è per chi sviluppa; dall'immagine esce un
testo diverso.

55. **Un file `NOVITA.yaml`**: per ogni versione un elenco di voci brevi, ognuna con testo **italiano e inglese**, e gli
    avvisi di compatibilità a parte, anche loro nelle due lingue. Una guardia controlla le due lingue e la lunghezza.
56. **Per le `-rc` le Novità sono tutto ciò che arriverà nella release**, in forma breve (conferma la decisione 45, ma non più
    col testo del CHANGELOG).
57. **Il pannello e l'IDE le mostrano nella lingua dell'interfaccia**; se una voce manca in quella lingua, l'altra.
58. **Le scrive Claude con ogni modifica visibile**, come il CHANGELOG; il maintainer le rivede al collaudo. Le voci della
    2.12 fin qui le riassume Claude una volta.

### Fase 4 — la commutazione del display dal runtime (29-09-2026)

Sessione di plan col maintainer; il seme del 24-09 è in archivio. **Decisioni:**
59. **Via il ripiego per PixsysOS < 2.1** (`systemctl disable/enable` al posto di `SetEnabled`): lì la commutazione risulta
    «non supportata».
60. **CODESYS non si tocca**: se `allow_url_override` è acceso, lo stato della commutazione lo segnala; la configurazione di
    CODESYS resta di chi installa.
61. **Il file `display-target` sparisce**: il runtime smette di scriverlo — e così i pezzi vecchi sull'host non scattano più —
    e lo stato della commutazione si legge dall'IDE, nella scheda Stato.
62. **I pezzi vecchi sull'host (`sws-display.path/.service`, `sws-display-apply.sh`) li toglie l'installer** alla prossima
    reinstallazione; nel frattempo restano inerti.

**Collaudo sul TC620 (29-09, notte, in autonomia su richiesta del maintainer):**
- rc.9 → rc.10 con «Aggiorna ora»; all'avvio il runtime ha commutato sul web da sé (`esito web`, browser attivo, viewer fermo,
  CODESYS senza override). **Fase 3 vista dal vivo**: `evento riuscito` rc.9 → rc.10 e Telegram «runtime aggiornato».
- Copia di prova di CasaDomotica con `target: lvgl_wayland`, senza allarmi, notifiche né sorgenti: aperta → browser fermo,
  `SetEnabled=false`, viewer attivo (`esito lvgl`); riaperta CasaDomotica → viewer fermo, `SetEnabled=true`, browser attivo.
  Copia tolta. Riaprire CasaDomotica dopo un altro progetto fa ripartire i suoi allarmi (la memoria tiene l'ultimo progetto
  chiuso): un Telegram per `sandokan_power_on`, messo in conto.
- Reinstallazione dal registry con l'installer nuovo: via `sws-display.path/.service`, lo script e `display-target`; il quadlet
  ha `Timezone=local` (orologio del pannello UTC+02:00, il pilota passa alle 19:45 locali).

### Questione aperta, emersa il 28-09: il quadlet non viaggia con l'aggiornamento

`podman auto-update` sostituisce l'**immagine**; il quadlet sul pannello resta quello scritto dall'installer. Una riga
nuova — `Timezone=local` della Fase 2, domani altro — arriva su un dispositivo solo reinstallandolo. Finché non si
decide come, ogni rc che cambia il quadlet lo deve dire nella sua sottosezione `### ⚠ Compatibilità`, e il runtime
dovrebbe accorgersi di girare con un quadlet vecchio (per esempio `SWS_QUADLET_VERSIONE` scritta dall'installer). Da
decidere con il maintainer: è un seme, non una scelta.

## Visto il 27-09, da non dimenticare

- Sui pannelli con CODESYS, `allow_url_override = true` fa vincere CODESYS sul browser all'avvio
  (`docs/TEST_SETUPS.md`): la commutazione del display deve saperlo, o lo schermo finisce su Cockpit.
