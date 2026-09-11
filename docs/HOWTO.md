# SWS — Come si fa (ricette)

> Raccolta di capitoli brevi e indipendenti, uno per ogni "come faccio a fare X" posto al vivo dal
> maintainer. Non è un checklist da seguire in ordine (per quello vedi `docs/TESTING_GUIDE.md`) né
> una guida di riferimento su un solo argomento (per quello, i `docs/DEPLOY_*.md` dedicati) — è un
> indice di procedure puntuali, ognuna autosufficiente. Nuovi capitoli si aggiungono in fondo,
> numerati in ordine di comparsa.
>
> **Metà di questi capitoli esiste perché manca una funzione.** L'11-09-2026 sono stati riletti
> tutti insieme con una domanda sola — «perché devo farlo a mano?» — e dieci hanno prodotto una
> traccia di lavoro, registrata in `STATUS.md` come `T-58`…`T-67`. Dove c'è, il capitolo la nomina
> in coda: senza quel rimando si rilegge la ricetta e si riesegue il rituale senza sapere che è
> già registrato come lavoro da fare.
>
> Indirizzi/utenti dei device fisici citati nei capitoli **cambiano da sessione a sessione** —
> trattarli come l'ultimo valore noto, non come una costante, e verificare/chiedere prima di
> riusarli alla lettera in una sessione futura.

## Indice

1. [Testare `sws-lvgl-viewer` su un Pixsys reale, sostituendo Chromium](#1-testare-sws-lvgl-viewer-su-un-pixsys-reale-sostituendo-chromium)
2. [Liberare spazio su disco quando è pieno](#2-liberare-spazio-su-disco-quando-è-pieno)
3. [Il browser non vede il runtime dopo aver installato il certificato](#3-il-browser-non-vede-il-runtime-dopo-aver-installato-il-certificato)
4. [Un pulsante che apre un sito esterno (e Login/Logout dal sinottico)](#4-un-pulsante-che-apre-un-sito-esterno-e-loginlogout-dal-sinottico)
5. [Compilare tutto e pubblicare le immagini container](#5-compilare-tutto-e-pubblicare-le-immagini-container)
6. [Vedere cosa disegna il pannello senza avere il pannello](#6-vedere-cosa-disegna-il-pannello-senza-avere-il-pannello)
7. [Accendere l'assistente IA nell'editor](#7-accendere-lassistente-ia-nelleditor)
8. [Confrontare a numeri quello che disegna il browser con quello che disegna il pannello](#8-confrontare-a-numeri-quello-che-disegna-il-browser-con-quello-che-disegna-il-pannello)
9. [Il deploy dell'immagine fallisce dopo un factory reset del dispositivo](#9-il-deploy-dellimmagine-fallisce-dopo-un-factory-reset-del-dispositivo)
10. [Provare una modifica su un dispositivo senza pubblicare niente](#10-provare-una-modifica-su-un-dispositivo-senza-pubblicare-niente)
11. [Leggere la mail di GitHub che dice «CI failed»](#11-leggere-la-mail-di-github-che-dice-ci-failed)
12. [Installare il runtime su un dispositivo dall'editor](#12-installare-il-runtime-su-un-dispositivo-dalleditor)
13. [Dove sta la lista dei dispositivi registrati](#13-dove-sta-la-lista-dei-dispositivi-registrati)
14. [Convertire un progetto da LVGL a Web (o viceversa)](#14-convertire-un-progetto-da-lvgl-a-web-o-viceversa)

---

## 1. Testare `sws-lvgl-viewer` su un Pixsys reale, sostituendo Chromium

> ⚠️ **Capitolo scaduto** (constatato l'11-09-2026, traccia **T-67**). Il `podman run` di quindici
> flag che segue è oggi la quadlet `deploy/container/sws-lvgl-viewer.container`, e lo
> spegni-browser/accendi-viewer è `sws-display-apply.sh` guidato dal `target` del progetto (Q25).
> Resta valido solo per provare un **binario di sviluppo**, non un'immagine installata.

Contesto: `sws-lvgl-viewer` è un companion opzionale di `sws-runtime`, non un fork (vedi
`docs/OPEN_QUESTIONS.md` Q14, seguito 9, e `docs/DEPLOY_CONTAINER_AARCH64.md` §4 per i dettagli
tecnici dietro ogni passo qui sotto). Questo capitolo presume un device Pixsys dove Chromium
mostra oggi la SPA web, e sostituisce quel display layer con un container LVGL — senza toccare
`sws-runtime`, che resta acceso per tutto il test.

> **Nota del 2026-09-10 (Q53).** Da oggi l'immagine aarch64 è **una sola**, costruita da
> `./scripts/build_container.sh` con un cross-build in container (niente SDK, niente QEMU,
> ottimizzata), e `latest-arm64-generic` è un alias di `latest-arm64`. Il «percorso generico»
> descritto in questo capitolo è quello storico via QEMU, che produceva un binario **non
> ottimizzato**: i comandi restano validi con `--with-generic`, ma non c'è più motivo di usarli.
> Il racconto sotto è di agosto e lo si lascia com'era.

**Due percorsi per costruire l'immagine**, scelta esplicita del maintainer (2026-08-09): per ora
si preferisce il percorso **generico** (nessun SDK Pixsys, build sotto emulazione QEMU) invece di
quello Pixsys-tuned, anche se più lento — non lega il container a un device specifico. Il percorso
SDK resta un'alternativa per quando servirà davvero il tuning cortex-a35 (vedi in fondo a questo
passo).

### Passo 0 — Costruire l'immagine (percorso generico, senza SDK)

**Serve root**, ma non c'è bisogno di scrivere `sudo`: dal 2026-08-26 lo script se ne accorge e
si rilancia da solo, chiedendo la password al momento giusto — cioè dopo aver verificato le
condizioni che lo farebbero fallire comunque. Un umano al terminale lo lancia così (da Claude Code
no: `sudo` è negato dalla policy dei permessi di questo progetto):

```bash
./scripts/build_container_aarch64_generic.sh --with-lvgl --push
```

Prerequisiti (verificati presenti sul dev server il 2026-08-09, ricontrollare se cambia macchina):
`podman`, emulazione QEMU per arm64 registrata (`ls /proc/sys/fs/binfmt_misc/qemu-aarch64` deve
esistere — altrimenti `sudo apt install qemu-user-static`), rete per `ubuntu:24.04` e crates.io.
Niente toolchain Rust da installare sull'host: vive nell'immagine builder, emulata.

**Testato con successo il 2026-08-09** (dev server ufficio, dal maintainer stesso): bindgen contro
`libclang` sotto emulazione QEMU — l'incognita segnalata qui sopra — non si è materializzata,
`sws-lvgl-viewer` ha compilato in un ELF aarch64 valido (18 MB) esattamente come `sws-runtime`.
Immagine pubblicata con tre tag (`<versione>-arm64-generic`, `<sha>-arm64-generic`,
`latest-arm64-generic`) e archivio offline salvato in `dist/`. Un solo intoppo incontrato, già
corretto nello script: `podman login`/`podman push`, girando anch'essi sotto `sudo` per via del
controllo root qui sopra, non vedevano il login rootless fatto da utente normale prima del
comando — lo script ora punta esplicitamente all'`auth.json` di `$SUDO_USER` (via `--authfile`),
nessun secondo login richiesto. Se qualcos'altro fallisce, i log di `podman build`/`podman run`
dicono dove.

**Un secondo intoppo, trovato solo al primo avvio reale del container** (non alla build): l'immagine
finale non aveva la libreria SDL2 **runtime** (solo `-dev` nel builder, che è un'immagine intermedia
mai copiata in quella finale) — `sws-lvgl-viewer` partiva e crashava subito ("cannot open shared
object file: libSDL2-2.0.so.0"). Corretto: entrambi i `Containerfile` installano ora
`libsdl2-2.0-0` quando `--with-lvgl` è attivo (via `--build-arg`, automatico — non serve fare
nulla di diverso, basta ricostruire con uno script aggiornato). Se hai un'immagine costruita
*prima* di questo fix, ricostruiscila.

Senza rete verso il registry, ometti `--push` e copia via `scp` l'archivio prodotto
(`dist/sws-runtime-<versione>-aarch64-generic-image.tar.gz`).

Immagine risultante: tag `*-arm64-generic` (non `*-arm64`, che è il percorso SDK-based — usare
sempre il riferimento esplicito, `install-container.sh --pull` senza argomenti sceglie l'altro).

<details>
<summary>Alternativa: percorso SDK Pixsys-tuned (quando servirà davvero)</summary>

Da una macchina **con l'SDK Yocto Pixsys** installato (`/usr/local/oecore-x86_64/…` — non
disponibile su questo dev server):

```bash
./scripts/build_container.sh --with-lvgl --push
```

Nessun `sudo` richiesto per questo percorso. Produce il tag `*-arm64` (tuning cortex-a35, ABI
pinning esatto all'OS Pixsys) invece di `*-arm64-generic`.
</details>

### Passo 1 — Connettersi al device

```bash
ssh user@tc620-a-p3-c6-07aff9.local
```

Utente verificato per **questo** device il 2026-08-09: `user` (non `pixsys`, che è la convenzione
per il deploy nativo ma non ha accesso qui) — vedi la nota in cima a questo file su indirizzi/utenti
che cambiano.

### Passo 2 — Fermare Chromium

Verificato il 2026-08-09: `user` **non ha affatto sudo** su questo device (non solo "serve la
password" — non è nei sudoer). Serve autenticarsi come `pixsys` (le credenziali vendor, lo stesso
utente sotto cui girano tutti i unit Pixsys nel resto di questo repo):

```bash
su - pixsys
sudo systemctl stop chromium@main-app.service
```

(`su -`, login shell — utile se l'unit fosse a livello utente di `pixsys`; verificato poi che non
lo è, è un system unit vero, `/usr/lib/systemd/system/chromium@.service`: solo `pixsys` ha i
permessi sudo per fermarlo, `user` no.)

Lo schermo del pannello si svuota — atteso, Weston perde il suo unico client. Verifica lo stato
con `systemctl status chromium@main-app.service` (si può tornare a `user` prima di controllare,
non serve restare `pixsys`).

**In arrivo**: PixsysOS 2.1 permetterà di disattivare il browser direttamente da configurazione,
eliminando questo giro SSH — segnalato dal maintainer (2026-08-09), non ancora verificabile da
qui.

### Passo 3 — Scaricare l'immagine sul device (se pubblicata col Passo 0 via `--push`)

```bash
podman pull ghcr.io/soligolab/sws-runtime:latest-arm64-generic
```

(`latest-arm64-generic`, non `latest-arm64` — quel tag nudo è il percorso SDK-based, un'immagine
diversa. `install-container.sh --pull` senza argomento sceglie `latest-arm64`: qui va sempre
passato il riferimento esplicito.)

### Passo 4 — Trovare il socket Wayland reale

Non dare per scontato `wayland-0`: sul TC620 di prova era `wayland-1`.

```bash
ls /run/user/1000/wayland-*
```

Usa il nome che trovi (non quello di questo esempio) nel comando del passo successivo.

### Passo 5 — Avviare il container LVGL

`sws-lvgl-viewer` è solo un **client** verso `sws-runtime` (che gira già, non lo tocca) — esattamente
come lo sarebbe un browser puntato lì. Non serve ricaricare nulla: qualunque progetto sia già
aperto su `sws-runtime` in questo momento resta quello, il container legge lo stato corrente al
volo. Se non sai il nome esatto (case-sensitive) della pagina da mostrare — cambia ad ogni
progetto diverso che carichi durante i test — chiedilo direttamente a `sws-runtime`:

```bash
curl -s http://127.0.0.1:8443/api/synoptics
```

Nota il protocollo: **`http`, non `https`** — questo `sws-runtime` non ha ancora un `tls.crt`
configurato (il runtime parte in HTTP finché non esiste, `sws-runtime/src/main.rs`). Se un
`curl -k https://...` desse un errore TLS tipo "record overflow"/"packet length too long", è
proprio questo il sintomo: il server parla HTTP semplice — riprova con `http://`.

**Tutto su una riga sola** — su questo device, incollare la versione multi-riga con `\` a fine
riga su SSH ha rotto la continuazione due volte di fila (`-sh: ghcr.io/...: No such file or
directory`: il nome immagine viene interpretato come comando a sé, non come continuazione della
riga precedente). Non è un problema del comando, è la combo terminale/shell su questo device —
ma la forma su una riga lo evita del tutto, quindi è quella da usare qui:

```bash
podman run -d --name sws-lvgl-viewer --network host --userns=keep-id --ipc=host -v /tmp/.X11-unix:/tmp/.X11-unix -v /run/user/1000:/run/user/1000 -e XDG_RUNTIME_DIR=/run/user/1000 -e DISPLAY=:0 -e SDL_VIDEODRIVER=x11 --entrypoint sws-lvgl-viewer ghcr.io/soligolab/sws-runtime:latest-arm64 --base-url http://127.0.0.1:8443 --page "LVGL Demo"
```

**Questo comando è cambiato il 2026-08-24**: prima diceva `SDL_VIDEODRIVER=wayland` e non aveva
`--ipc=host`, e in quella forma **non funziona**. Le due correzioni, entrambe misurate su
wp630-a-p3-07a077.local:

- **`SDL_VIDEODRIVER=x11` (XWayland) invece di `wayland`.** Il backend Wayland nativo di SDL2 fa
  **SIGSEGV entro tre secondi** dall'apertura della finestra, riproducibile. Non è il motore LVGL:
  lo stesso binario con `SDL_VIDEODRIVER=dummy` gira a ~30 fps. È la stessa famiglia di problemi
  già vista sul TC620, dove SDL2 su Wayland dava schermo nero. Serve quindi anche
  `-v /tmp/.X11-unix:/tmp/.X11-unix` e `DISPLAY=:0`.
- **`--ipc=host`.** Senza, il primo frame muore con
  `X Error: BadValue ... 130 (MIT-SHM), 3 (X_ShmPutImage)`. MIT-SHM richiede che client e server X
  vedano gli stessi segmenti di memoria condivisa, ma podman isola il namespace IPC: XWayland gira
  sull'host, il viewer nel container. È un requisito noto delle app X11 in container, e non
  c'entra con la dimensione della finestra nonostante il messaggio sembri dirlo.

Le altre due flag erano già lì e restano necessarie:
- `--userns=keep-id`: senza, il socket dell'host risulta "Permission denied" dentro il
  container (rootless podman rimappa gli UID per default).
- `--network host`: senza, il container ha il proprio namespace di rete isolato — `127.0.0.1`
  dentro punta al container stesso, non all'host dove ascolta `sws-runtime`. Sintomo tipico:
  `curl` sull'host funziona, lo stesso URL dentro il container dà "Connection refused" nei log.

Sostituisci il nome pagina con quello trovato ai passi precedenti, se diverso dall'esempio.
L'immagine `latest-arm64` (SDK Pixsys) e `latest-arm64-generic` sono entrambe valide: dal
2026-08-24 **entrambe contengono il viewer LVGL per default**.

### Passo 6 — Controllare cosa succede

```bash
podman logs -f sws-lvgl-viewer
```

Una finestra/superficie Wayland dovrebbe comparire sullo schermo del pannello. Se non succede
nulla di visibile, i log sono il primo posto dove guardare (errori di connessione al backend,
pagina non trovata, crash all'avvio).

### Tornare a Chromium

```bash
podman rm -f sws-lvgl-viewer
sudo systemctl start chromium@main-app.service
```

`sws-runtime` non va mai toccato in questa procedura — resta lo stesso container acceso prima,
durante e dopo.

---

## 2. Liberare spazio su disco quando è pieno

Nato da un crash reale del linker ("Bus error" durante `cargo build`) con disco root al 100%: il
maggior consumatore è quasi sempre `target/debug` — sia quello del workspace principale sia i due
esclusi dal workspace (`sws-kiosk`, `sws-lvgl-viewer`, che un `cargo clean` sul workspace non
tocca). Cargo non fa mai pulizia automatica di questi alberi: crescono indefinitamente finché non
li si svuota a mano.

```bash
./scripts/clean_disk_space.sh
```

Mostra prima un report (dimensione di ciascun candidato + `df -h` attuale), poi chiede conferma.
Cancella (rigenerabili, nessuna perdita di dati): `target/debug` dei tre alberi Rust,
`sws-editor/node_modules`, immagini podman *dangling*. **Non tocca** `target/release`, `.bak/`
dei progetti, le cartelle `.run*` di test/dev — li riporta solo in dimensione, per decidere a
mano se vale la pena liberarli.

```bash
./scripts/clean_disk_space.sh -y                # nessuna conferma, per uso non presidiato
./scripts/clean_disk_space.sh --full-images      # elenca anche le immagini podman "vecchie" (non dangling)
./scripts/clean_disk_space.sh --cargo-cache      # svuota anche ~/.cargo/registry (impatta tutti i progetti Rust)
```

Dopo la pulizia il prossimo `cargo build`/`cargo check` ricompila da zero (nessuna cache
incrementale) — un paio di minuti, normale, non un errore.

---

*Traccia: **T-65 — nessuno avvisa **prima**: il disco pieno si presenta come un «Bus error» del linker, e `session_start.sh` potrebbe dirlo all'avvio**.*

## 3. Il browser non vede il runtime dopo aver installato il certificato

Sintomi visti dal vivo (2026-08-21): "Cerca runtime" non trova niente anche dopo aver importato
il certificato nel browser; il pulsante Viewer dice che il runtime non risponde mentre l'IDE
funziona; nei log del runtime compaiono `TLS handshake failed: CertificateUnknown` dal PC su cui
gira il browser.

Due cause, entrambe lato browser, nessun guasto sul runtime:

1. **Ogni porta è un origin TLS separato.** Accettare/importare il certificato per
   `https://host:8444` (IDE) NON copre `https://host:8443` (viewer) — e nemmeno lo stesso
   servizio raggiunto per IP invece che per hostname. Vanno accettati tutti gli origin che si
   usano davvero.
2. **La pagina già aperta resta "avvelenata".** Dopo l'accettazione/import, le fetch della
   pagina IDE già aperta continuano a fallire finché non la si ricarica.

Procedura (senza terminale):

1. Dall'IDE: Configurazione → Runtime → **"Scarica cert"** (passa dal backend, funziona anche
   prima di ogni accettazione — niente più `curl -k`). Importalo nel browser/OS, **oppure** usa
   l'accettazione rapida per sessione qui sotto.
2. Accetta il certificato per **ciascun origin**: la pagina helper HTTP (porta 8080 sul
   runtime, 8090 sull'editor) ora elenca ENTRAMBI gli indirizzi (IDE e viewer) con lo stato di
   accettazione per ciascuno, e reindirizza solo quando tutti e due rispondono. In alternativa:
   "Accetta cert TLS ↗" nell'IDE per l'admin, e il pulsante "Accetta cert ↗" che compare accanto
   al Viewer quando il probe fallisce su https.
3. **Ricarica la pagina dell'IDE.** Se non lo fai, ci pensa l'IDE a dirtelo: quando rileva che
   il runtime è tornato raggiungibile mostra un banner verde "ricarica la pagina per
   riconnetterti" (sotto c'è un watcher che riprova `/health` ogni 3 s dal momento del primo
   errore). Anche "Cerca runtime", quando fallisce per questo motivo, ora lo dice chiaramente
   con i bottoni "Apri /health" e "Ricarica la pagina" invece del fuorviante "Nessun runtime
   trovato".

---

## 4. Un pulsante che apre un sito esterno (e Login/Logout dal sinottico)

Nel pannello proprietà di un `button` (o `navbutton`), sezione **Azione predefinita**:

| Voce | Cosa fa |
|---|---|
| **Naviga a URL** | apre l'URL indicato; il campo **"Apri in"** scegle tra scheda nuova (default) e stessa scheda |
| **Login** | apre la schermata di login *sopra* il sinottico; al login riuscito si torna alla pagina di prima, con i permessi di scrittura del nuovo utente |
| **Logout** | chiude la sessione e torna al Viewer anonimo (in modalità no-auth rientra nell'admin sintetico) senza ricaricare la pagina |

Note pratiche:

- L'URL può essere assoluto (`https://esempio.it`), interno (`/api/health`) o scritto senza
  schema (`www.google.com`): in quest'ultimo caso viene prefissato `https://` da solo.
- **Su un pannello in kiosk scegli con cura "Apri in"**: con *scheda nuova* il sinottico resta
  aperto sotto ma la scheda nuova, senza barra delle schede, si chiude solo da tastiera; con
  *stessa scheda* si torna al sinottico solo ricaricando (o con il gesto "indietro" del
  browser). Per un pannello senza tastiera, la stessa scheda + una pagina di ritorno è più
  gestibile; per una postazione con mouse e tastiera, la scheda nuova è più comoda.
- Se il browser blocca la finestra popup, la navigazione avviene comunque nella stessa scheda
  invece di non fare niente.
- Il Python `on_press_fn` eventualmente impostato sullo stesso pulsante viene eseguito **prima**
  della navigazione; con Login/Logout invece non viene chiamato (vince l'azione predefinita).
- Queste tre azioni sono **solo web**: il motore LVGL non le supporta.

---

*Traccia: **T-59 — le tre azioni sono solo web e sul pannello LVGL **spariscono in silenzio**: è il referto di compatibilità che deve dirlo**.*

## 5. Compilare tutto e pubblicare le immagini container

Un comando solo. Il `podman login` serve una volta per macchina (senza, il push muore a metà):

```bash
podman login ghcr.io
./scripts/build_containers_all.sh --push
```

Compila la SPA e il Rust, poi costruisce e pubblica le **due** immagini su
`ghcr.io/soligolab/sws-runtime` (dal 2026-09-10, Q53: prima erano tre), ognuna con tre tag —
versione dal `Cargo.toml`, sha del commit, e `latest-*`:

| Immagine | Percorso di build | Tag |
|---|---|---|
| aarch64 (Pixsys e qualunque board arm64) | cross-build da x86_64 in container Ubuntu (`build_container.sh`) | `<ver>-arm64`, `<sha>-arm64`, `latest-arm64`, più gli alias `<ver>-arm64-generic` e `latest-arm64-generic` |
| x86_64 | build nativa (`build_container_x86_64.sh`) | `<ver>-amd64`, `<sha>-amd64`, `latest-amd64` |

Storici, solo su richiesta: `--sdk` (SDK Yocto Pixsys) e `--with-generic` (QEMU, ~50 minuti,
binario non ottimizzato). Spariranno quando il cross-build avrà girato abbastanza sui dispositivi.

Varianti:

```bash
./scripts/build_containers_all.sh                    # solo archivi in dist/, nessun push
./scripts/build_containers_all.sh --no-save --push    # solo push, nessun .tar.gz
./scripts/build_containers_all.sh --no-rust --push    # riusa i binari già compilati (niente sudo)
./scripts/build_containers_all.sh --no-lvgl --push    # SENZA sws-lvgl-viewer (il viewer c'è per default dal 2026-08-24)
./scripts/build_container_x86_64.sh --push            # una sola architettura
```

Le trappole, tutte già incontrate dal vivo:

- **Non lanciarlo con `sudo`.** Nessun passo lo richiede più (lo richiedeva solo la vecchia
  aarch64 via QEMU, oggi dietro `--with-generic`). Lanciato da root, sotto podman rootful la rete
  bridge non passa il DNS dell'host ai container e il builder x86_64 fallisce risolvendo
  `archive.ubuntu.com` pur risolvendo benissimo sull'host (2026-08-07).
- **La prima build aarch64 è lunga** (~8 minuti il runtime, poi il viewer), le successive
  incrementali: `target-container-aarch64-cross/` resta fra una build e l'altra. Se sembra ferma
  su «Compiling», sta compilando.
- **Emulazione arm64** registrata sull'host, una volta per macchina: se
  `/proc/sys/fs/binfmt_misc/qemu-aarch64` non esiste, `sudo apt install qemu-user-static`.
- **Nessuno deve modificare gli script mentre girano** — nemmeno un commento. Bash legge il
  file a blocchi, per offset: il 2026-09-09 un edit al commento in testa a
  `build_container_aarch64_generic.sh`, fatto durante la build, l'ha uccisa dopo 51 minuti con
  `line 381: build: command not found` (un frammento di `podman build` letto a metà riga). Il
  rilancio riusa la compilazione già fatta (`target-container-aarch64-generic` è incrementale),
  ma la sequenza va rifatta da capo. Chi lavora sullo stesso checkout controlli
  `pgrep -af build_container` prima di toccare `scripts/`.

Sul dispositivo, poi, si aggiorna con `install-container.sh --pull` (senza argomento sceglie
`latest-<arch>`), o dall'editor: Configurazione → Runtime → Installa su dispositivo (§12).
Dettagli in `docs/DEPLOY_CONTAINER_AARCH64.md`.

---

*Traccia: **T-66 — «non modificare uno script mentre gira» è affidato alla disciplina, ed è già costato una build di 51 minuti: un lock lo toglie di mezzo**.*

## 6. Vedere cosa disegna il pannello senza avere il pannello

**Il problema.** Il motore LVGL e quello del browser disegnano lo stesso progetto
in due modi diversi, e le differenze si scoprivano solo andando fisicamente
davanti a un dispositivo. Spesso settimane dopo averle introdotte: l'etichetta
del gauge fuori dal cerchio, il navbutton che dava schermo nero, la pipe che non
si riempiva, tutte trovate così.

**La risposta.** `sws-lvgl-viewer --istantanea` disegna una pagina, salva
un'immagine ed esce. Non serve né uno schermo né un dispositivo: il rendering di
LVGL è già interamente software, e SDL2/DRM servono solo a *mostrare* il buffer.

### Lo sa fare anche l'assistente

Dal 2026-09-04 l'assistente dell'IDE ha lo strumento `istantanea_pagina`: fa da sé
tutto quello che c'è scritto qui sotto — copia il progetto, avvia un runtime usa e
getta, scatta, converte in PNG — e **guarda** il risultato invece di dichiarare
fatto. Serve `sws-lvgl-viewer` installato accanto al runtime: c'è nell'immagine
arm64, **non** in quella x86_64.

A mano resta il modo di guardare quando si sta lavorando al rendering, e per
questo la procedura sotto vale ancora.

### Come si usa

Serve un runtime in ascolto con un progetto aperto — quello locale va benissimo:

```bash
./scripts/start_runtime.sh                      # viewer 8443, IDE 8444
cd sws-runtime && cargo build -p sws-lvgl-viewer

./target/debug/sws-lvgl-viewer \
    --base-url http://localhost:8443 \
    --page "Indicatori" \
    --istantanea /tmp/p.ppm

convert /tmp/p.ppm /tmp/p.png     # ImageMagick
pnmtopng /tmp/p.ppm > /tmp/p.png  # oppure netpbm
```

Il formato è **PPM** e non PNG di proposito: nessun encoder da aggiungere, quindi
nessun peso in più nel binario che finisce sul dispositivo (l'intera funzione
costa 21 KB sull'ARM, misurati).

Senza `--page` parte dalla pagina iniziale del progetto, come fa il viewer vero.

### Fotografare quello che succede *dopo* un tocco

```bash
--tocca 160,277                # tocca una volta
--tocca "160,277;661,459"      # tocca, poi risponde alla finestra che si apre
```

Le coordinate sono quelle di pagina, le stesse che si leggono nell'IDE. Il viewer
stampa anche **quali comandi il tocco ha prodotto**:

```
comando prodotto: scrivere Bool(true) su 'demo.cmd.button'
navigazione richiesta: pagina 'demo_p2'
il tocco non ha prodotto nessun comando
```

Serve perché un pulsante che apre la finestra giusta e poi scrive il valore
sbagliato, in una fotografia, sembrerebbe funzionare.

### Quanto lasciar disegnare

`--istantanea-ms` (500 di default) è quanto LVGL lavora prima dello scatto —
tempo **LVGL simulato**, non un'attesa: il ciclo fa `task_handler()` e poi
`tick_inc()`, senza dormire. Misurato il 2026-09-04: 600 ms di tempo LVGL
costano ~145 ms di orologio, 3000 ms ne costano ~290. Chiedere due secondi non fa
quindi aspettare due secondi — e due istantanee della stessa pagina allo stesso
valore sono confrontabili, perché le fasi di un blink cadono sempre allo stesso
punto. LVGL
disegna a pezzi e widget come il gauge o i grafici hanno bisogno di più di un
giro: un'istantanea presa troppo presto coglie una pagina a metà, e la si
scambia per un difetto di rendering. Con `--tocca` conviene alzarlo (800-1500 ms),
perché i tocchi si distribuiscono nel tempo disponibile.

Per cogliere una **fase precisa** di un lampeggio o di una rotazione, si scattano
due istantanee a distanza e si confrontano:

```bash
compare -metric AE a.png b.png null:    # quanti pixel sono cambiati
```

### Confrontarlo col browser

Aprire la stessa pagina nell'IDE, affiancare le due immagini e guardare. È così
che sono venuti fuori, in poche ore: gli oggetti semitrasparenti che sparivano
invece di sbiadire, le pipe che salgono tagliate a metà, le celle della griglia
vuote (in **tutti e due** i motori), la `setpoint` ridotta a una scheda bianca
con le barre di scorrimento.

### Quando NON basta

- **Il touch vero.** `--tocca` alimenta lo stesso indev del dito, ma non prova
  la calibrazione del pannello né il driver tslib.
- **Le prestazioni.** Il tempo di disegno su un x86 non dice niente su un PX30.
- **Lo schermo fisico.** Colori, angolo di visione e retroilluminazione si
  giudicano solo guardando il pannello.

Serve a trovare i difetti *di disegno* prima che arrivino sul dispositivo, non a
sostituire la prova sul dispositivo.

---

*Traccia: **T-62 — `istantanea.rs` fa già tutto questo per l'assistente IA; manca lo stesso pulsante per la persona**.*

## 7. Accendere l'assistente IA nell'editor

La chat nell'IDE guarda il progetto e **propone** modifiche: una persona vede il diff e
decide. Non scrive su disco, non esegue niente, non parla col dispositivo.

### La chiave

Il runtime la cerca in quest'ordine, e si ferma alla prima che trova:

1. la variabile d'ambiente `ANTHROPIC_API_KEY`;
2. `<config_dir>/anthropic.key` — per `start_editor.sh --instance 1` è
   `.run-editor/config/anthropic.key`;
3. `~/.config/sws/anthropic.key`.

Il terzo è quello consigliato: vale per tutte le istanze, non rischia un `git clean`, e sta
fuori dal repo.

```bash
 mkdir -p ~/.config/sws && \
   printf '%s' 'sk-ant-...' > ~/.config/sws/anthropic.key && \
   chmod 600 ~/.config/sws/anthropic.key
```

**Lo spazio prima di `mkdir` non è un refuso**: con `HISTCONTROL=ignorespace` tiene la chiave
fuori da `~/.bash_history`. E `printf '%s'` invece di `echo` così non ci finisce un a-capo (il
runtime fa comunque `.trim()`).

La chiave **non entra mai nel progetto**: il progetto si esporta, si manda in giro e finisce su
un dispositivo. Se manca, l'IDE funziona lo stesso e il pannello dice che l'assistente non è
configurato invece di sembrare rotto.

### Due fornitori: Anthropic o Kimi

Kimi (Moonshot) espone la **Messages API di Anthropic** su un endpoint dedicato, quindi lo
streaming, i blocchi, gli strumenti e i nomi degli eventi SSE sono gli stessi: il nostro lettore
di stream non cambia. Cambiano tre cose sole — indirizzo, header di autenticazione e il modo di
chiedere il ragionamento — e il codice le tiene in un `enum` (`ai/client.rs`, `Fornitore`).

Perché averli entrambi: il listino. Su una prova reale misurata il 2026-09-01 (6 giri, 21.468
token in ingresso, 3.750 in uscita) Opus 5 è costato **0,23 $**; la stessa prova con Kimi K3 ne
costerebbe circa **0,14 $**.

| | ingresso | ingresso da cache | uscita |
|---|---|---|---|
| `claude-opus-5` | 5 $/Mtok | 0,50 $ | 25 $/Mtok |
| `kimi-k3` | 3 $/Mtok | 0,30 $ | 15 $/Mtok |

**Dal 2026-09-01 la si può mettere dall'IDE**: Configurazione → tab **IDE** → «Assistente IA»,
dove si scelgono fornitore, modello e chiave. La chiave finisce in
`<config_dir>/<fornitore>.key` con permessi `600`, e fornitore/modello in
`<config_dir>/ai.yaml`. Due avvertenze che il pannello dice da sé:

- **le variabili d'ambiente scavalcano** quella configurazione, e se ce n'è una impostata il
  pannello lo segnala invece di lasciar credere che il salvataggio non funzioni;
- quelle rotte **esistono solo sull'istanza IDE** (avviata senza viewer). Su un runtime che serve
  un impianto rispondono 404: l'assistente lì non si configura dall'interfaccia, ed è una scelta
  e non una dimenticanza.

Restano validi i file, per chi preferisce la shell. La chiave di Kimi si prende su
<https://platform.kimi.ai> e si mette dove il runtime la cerca — stessi tre posti, altro nome:

```bash
 mkdir -p ~/.config/sws && \
   printf '%s' 'sk-...' > ~/.config/sws/kimi.key && \
   chmod 600 ~/.config/sws/kimi.key
```

In alternativa `MOONSHOT_API_KEY` (o `KIMI_API_KEY`) nell'ambiente.

**Chi vince, con due chiavi**: Anthropic, perché è il default. Per l'altro si dice a voce alta:

```bash
SWS_AI_FORNITORE=kimi ./scripts/start_editor.sh --instance 3
```

`SWS_AI_FORNITORE` accetta `anthropic`/`claude` e `kimi`/`moonshot`; un valore che non riconosce
**spegne la chat** e lo scrive nel log, invece di ricadere silenziosamente sul default. Il
modello si cambia con `SWS_AI_MODELLO` (per esempio `kimi-k2.6`, più economico, o
`claude-sonnet-5`), e il pannello dice sempre **fornitore e modello** con cui sta parlando:
chi guarda una proposta ha diritto di sapere chi l'ha scritta.

### Usarla

Menu ☰ → **Assistente IA** (solo Admin). Si scrive cosa serve, in italiano:

> aggiungi alla pagina Indicatori un bottone che accende e spegne la luce del salotto — è su
> MQTT, broker 192.168.1.50, topic `casa/salotto/luce`

L'assistente legge il progetto, si fa dare lo schema dei tipi che deve scrivere, valida la
proposta e la manda. Nel pannello compaiono le chiamate agli strumenti mentre accadono, poi il
diff: tre elenchi — tag, sorgenti, oggetti in pagina — e due pulsanti.

**Applica non salva.** La modifica va nell'editor: `Ctrl+Z` la annulla in un colpo solo
(entrambe le metà, pagine *e* tag/sorgenti), e il disco aspetta che si prema **Salva**.

Se il progetto è cambiato da quando l'assistente l'ha letto — un'altra scheda, un deploy — la
proposta viene **scartata** e il pannello lo dice: va richiesta di nuovo.

### Provarla senza spendere token

```bash
SWS_AI_FAKE=sws-runtime/crates/sws-web/tests/ai/luce-mqtt.json \
  ./scripts/start_editor.sh --instance 3
```

Rigioca una traccia registrata invece di chiamare il modello. Gli strumenti che esegue sono
quelli veri: il copione dice *cosa* chiamare, non cosa risponde. Serve per provare il
pannello, il diff e l'annullamento in modo deterministico — il modello vero risponde diverso
ogni volta, e una prova che dipende da lui non è una prova.

Il copione lavora a **toppa** (`sorgenti_aggiunte`, `tag_aggiunti`, `oggetti_aggiunti`) e non a
progetto intero, così vale per qualunque progetto aperto.

### Cosa l'assistente non può fare, per costruzione

Niente esecuzione di Python (l'endpoint che la offriva, `/api/script/exec`, è stato tolto con
Q47; e comunque girava senza sandbox quando RestrictedPython manca, che sul PC di sviluppo è la
norma), niente export del progetto (lo ZIP porta i segreti
in chiaro — decisione del 2026-07-29), nessun `PUT`, nessun deploy, nessun accesso al
filesystem. Legge il progetto **mascherato**, come lo vede il browser: le password dei driver
non entrano nel contesto del modello.

### Gli endpoint valgono anche da soli

Senza nessuna IA:

```bash
# «questo progetto è valido?» — senza salvarlo
curl -s -X POST localhost:8464/api/project/validate \
  -H 'content-type: application/json' \
  -d '{"pages":[{"id":"p","name":"Prova","objects":[
        {"id":"b","type":"button","x":0,"y":0,"lable":"ops"}]}]}' | jq

# i campi validi di un tipo, con la loro documentazione e un esempio vero
curl -s 'localhost:8464/api/schema/synoptic?tipo=button' | jq
curl -s 'localhost:8464/api/schema/source?kind=mqtt'     | jq '.mapping'
```

Prima di questi non c'era modo di chiedere «questo progetto è valido?» senza prima rovinarlo.


---

## 8. Confrontare a numeri quello che disegna il browser con quello che disegna il pannello

Il capitolo 6 spiega come *vedere* cosa disegna il motore LVGL senza il pannello. Questo spiega
come **confrontarlo col browser misurando**, invece che guardando due schermate e fidandosi
dell'occhio.

Serve quando si sospetta una divergenza WYSIWYG: un widget che sui due motori non viene uguale.
L'occhio, davanti a due immagini vicine, dice «sì, più o meno» — che è esattamente la risposta che
non serve. È così che è stata misurata la divergenza del grafico a barre (Q28): le barre sono più
del doppio nel browser, e nessuno se n'era accorto in mesi.

### Il giro completo

Un runtime usa e getta, la stessa pagina, gli stessi valori scritti a mano nei tag, e due misure.

```bash
W=/tmp/confronto; AP=8690; VP=8691; rm -rf $W; mkdir -p $W/{config,projects}
./sws-runtime/target/debug/sws-runtime --config $W/config --projects-root $W/projects \
  --templates-root examples/templates --www sws-editor/dist \
  --viewer-port $VP --admin-port $AP &

curl -sf -X POST localhost:$AP/api/projects -H 'Content-Type: application/json' -d '{"name":"c"}'
curl -sf -X POST localhost:$AP/api/projects/c/open
curl -sf -X PUT localhost:$AP/api/project/tags -H 'Content-Type: application/json' \
  -d '[{"id":"q.a","data_type":"float"}]'
curl -sf -X PUT "localhost:$AP/api/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{...}'

# I valori si SCRIVONO: all'istantanea i tag valgono il loro valore iniziale, che
# è sempre zero — non esiste un "initial_value" da dichiarare, e nemmeno i tag
# calcolati aiutano, perché senza acquisizione non vengono valutati.
curl -sf -X PUT localhost:$AP/api/tags/q.a -H 'Content-Type: application/json' -d '{"value":45}'

# Il pannello: un PPM, che è RGB888 grezzo e si legge in dieci righe di Python.
./sws-runtime/target/debug/sws-lvgl-viewer --base-url http://localhost:$VP \
  --page "Pagina 1" --istantanea $W/p.ppm
```

Per il browser basta Playwright sulla porta **viewer** (`$VP`), leggendo gli attributi degli
elementi invece dei pixel: `document.querySelectorAll("svg rect")` e il loro `height`.

### Le tre trappole, tutte pagate

1. **I tag valgono zero.** Non perché l'istantanea sia cieca — `--istantanea` legge i valori dal
   runtime che gli si indica con `--base-url`, ed è per questo che scriverli funziona (è lo
   *strumento della chat* del capitolo 6 ad avere un banco isolato dal campo, non questo comando).
   Valgono zero perché un runtime usa e getta non ha nessuna sorgente in acquisizione, e non esiste
   un valore iniziale da dichiarare: `TagDef::initial_value()` restituisce sempre lo zero del tipo.
   Nemmeno un tag **calcolato** aiuta — senza acquisizione l'espressione non viene valutata; provato.
   L'unica strada è `PUT /api/tags/:id` prima di scattare.
2. **I colori tornano quantizzati in RGB565.** Un `#3b82f6` esce come `rgb(57,129,246)`. Si
   confronta con una tolleranza (±14 va bene), non con l'uguaglianza.
3. **Contare i pixel di un colore non è misurare un'altezza.** Gli angoli smussati e
   l'antialiasing fanno mancare qualche percento. Per un'altezza conviene prendere
   `max(y) - min(y) + 1` fra i pixel di quel colore.

### Cosa se ne ricava

Numeri confrontabili fra i due motori — «130 px contro 61» — che si possono mettere in una scheda
di `OPEN_QUESTIONS.md` e su cui si può decidere. `scripts/check_fuori_pagina_lvgl.sh` è un esempio
completo e funzionante di questo giro, da copiare.

---

*Traccia: **T-63 — questa procedura si riscrive da capo a ogni sospetto: va incapsulata in una guardia riusabile**.*

## 9. Il deploy dell'immagine fallisce dopo un factory reset del dispositivo

**Il sintomo.** Dal pannello Runtime dell'IDE, «Deploy» dell'immagine container si ferma e nel
registro compare un muro di testo allarmante:

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!
...
Offending ECDSA key in /home/ut1/.ssh/known_hosts:53
Host key verification failed.
ERROR: ssh fallito (exit 255)
```

**Non è un attacco, ed ssh fa bene a fermarsi.** Un **factory reset rigenera le chiavi host SSH**
del dispositivo: la macchina è la stessa, ma si presenta con un'identità nuova, e il tuo
`known_hosts` ha ancora quella vecchia. Visto da fuori, questo e un attacco man-in-the-middle sono
indistinguibili — solo tu sai di aver premuto «factory reset».

### Il rimedio, dall'editor

Sotto il registro compare un avviso che nomina il factory reset, con il pulsante **«Dimentica la
vecchia chiave e riprova»**. Preme `POST /api/device/hostkey/forget` (solo Admin, registrato
nell'audit), che esegue `ssh-keygen -R` sul `known_hosts` **di questo PC** — anche nella forma
`[host]:porta` che OpenSSH usa fuori dalla porta 22 — e rilancia il deploy.

Tiene un backup in `known_hosts.old`, e tocca **solo** l'host in questione: le altre righe restano.

**Non è automatico, ed è una scelta.** Il pulsante esiste per risparmiarti il terminale, non per
decidere al posto tuo: se non hai resettato niente, quell'avviso è l'unico posto in cui il sistema
può dirti che stai parlando con una macchina diversa da quella di ieri. Fermati e verifica.

### Il pulsante non basta se hai appena resettato

Toglie la chiave **vecchia**; non installa quella **nuova**. E il factory reset ha cancellato anche
`authorized_keys` sul dispositivo. Quindi dopo un reset vero servono **due** gesti, e sistemarne uno
solo lascia il deploy fermo:

```sh
# 1. (equivale al pulsante — usalo se il deploy non parte dall'IDE)
ssh-keygen -f ~/.ssh/known_hosts -R 192.168.1.16

# 2. Reinstalla la chiave pubblica: chiede la password una volta.
ssh-copy-id -o StrictHostKeyChecking=accept-new -i ~/.ssh/id_ed25519.pub user@192.168.1.16

# 3. Verifica che entri senza password, PRIMA di rifare il deploy.
ssh -o BatchMode=yes user@192.168.1.16 'echo ok'
```

Il passo 3 non è cerimoniale: se risponde `ok` il deploy funzionerà; se chiede ancora qualcosa
fallirà allo stesso modo e avrai perso un altro giro.

### Perché ssh si ferma davvero, e prima non lo faceva

Fino alla 2.6.0 il deploy invocava ssh con `-o StrictHostKeyChecking=no`, e la cosa sembrava
prudente: «accetta e vai». **Era una falla**, e conviene sapere perché, perché è controintuitivo.

Da `ssh_config(5)`, alla voce `StrictHostKeyChecking`:

> If this flag is set to `no` or `off`, ssh will automatically add new host keys to the user known
> hosts files and **allow connections to hosts with changed hostkeys to proceed**, subject to some
> restrictions.

Quelle «restrizioni» sono la disabilitazione di password e keyboard-interactive — **non** della
chiave pubblica. Tradotto: su un dispositivo dove `ssh-copy-id` era già stato fatto, un deploy verso
un host che aveva cambiato identità sarebbe **passato in silenzio**.

Il 2026-09-07 ce ne siamo accorti solo per una coincidenza: il factory reset aveva cancellato anche
`authorized_keys`, quindi non restava nessun metodo di autenticazione e il comando falliva con
`Permission denied (publickey,password)`. Senza quella coincidenza, nessun errore e nessun avviso.

Dalla 2.6.5 l'opzione è **`accept-new`**, che è la differenza che conta:

| | `no` (prima) | `accept-new` (ora) |
|---|---|---|
| Dispositivo mai visto | accettato in silenzio | accettato in silenzio |
| Chiave **cambiata**, accesso a password | fallisce, per effetto collaterale | **rifiuta**, con l'avviso |
| Chiave **cambiata**, accesso a chiave | **prosegue in silenzio** | **rifiuta**, con l'avviso |

Il primo deploy verso un pannello nuovo quindi non cambia. A cambiare è che il caso pericoloso ora
si vede sempre. La guardia `scripts/check_chiave_host.sh` fallisce se `StrictHostKeyChecking=no`
ricompare in un'invocazione.

### Due trappole collegate

- **L'indirizzo può essere cambiato anche lui.** Dopo un reset il dispositivo può prendere un IP
  diverso: se `192.168.1.16` era di un'altra macchina, la riga incriminata in `known_hosts`
  appartiene a quella, non a questa. Meglio ragionare sul nome mDNS
  (`<modello>-<seriale>.local`) che sull'indirizzo.
- **L'utente conta.** Il deploy del container usa l'utente limitato (`user@`); `pixsys@` è
  l'accesso privilegiato che serve solo in fase di test. Reinstallare la chiave per uno non la
  installa per l'altro, e nessun comando di produzione deve presupporre il secondo.

Il rituale pre-sessione più generale (host key cambiata dopo un re-flash) è in
[`TEST_SETUPS.md`](TEST_SETUPS.md#procedura-ricorrente-del-maintainer-non-automatizzata).
Questo capitolo è il caso specifico del deploy container, che ha un rimedio suo dentro l'editor.

---

*Traccia: **T-64 — il passo 3 («verifica che entri senza password») è una sonda che esiste già e che nessuno lancia dopo il «dimentica la chiave»**.*

## 10. Provare una modifica su un dispositivo senza pubblicare niente

Sei su un ramo, hai toccato il Rust, e vuoi vedere se funziona **sul pannello** — non
pubblicare una release. Il capitolo 5 costruisce e pubblica tutte e tre le immagini: qui ne
serve una sola, e il registry non va toccato.

### Perché non `--push`

`build_container.sh --push` pubblica **tre** tag, e uno è `latest-arm64`: è il default di
`install-container.sh --pull` e quello che il deploy dall'IDE usa se lasci «Registry». Puntarlo
a una build di ramo significa che il prossimo deploy — anche di qualcun altro, anche fra un
mese — prende in silenzio il tuo esperimento. Per una prova si usa l'**archivio locale**, che
non lascia tracce fuori da questa macchina.

### La sequenza

```bash
cd ~/sws                                     # sul tuo ramo, niente da cambiare

# 1. Metti da parte l'archivio della release, se ha la stessa versione.
#    La build lo SOVRASCRIVE — il nome dipende da `version` in Cargo.toml, non
#    dal ramo — e nel menu dell'IDE i due sarebbero indistinguibili: stesso
#    nome, nessuna data. È già successo (2026-07-31, un archivio del giorno
#    prima finito su un dispositivo).
V=$(grep -m1 '^version' sws-runtime/Cargo.toml | cut -d'"' -f2)
mv "dist/sws-runtime-$V-aarch64-image.tar.gz" \
   "dist/sws-runtime-$V-aarch64-image.tar.gz.rilascio" 2>/dev/null || true

# 2. Una sola immagine, quella del pannello Pixsys. Niente --push.
./scripts/build_container.sh
```

Il grosso del tempo è la cross-compilazione Rust per aarch64. Due leve, se ti servono:

- `--no-spa` se hai toccato **solo** il Rust — riusa `sws-editor/dist` com'è;
- `--no-lvgl` se stai provando qualcosa che col pannello LVGL non c'entra. **Attenzione**: il
  companion `sws-lvgl-viewer` esce dall'immagine, quindi su un dispositivo che lo usa il
  container LVGL non parte più. Per una prova sul viewer web va bene; per un progetto LVGL no.

### Il deploy dall'IDE

Nell'IDE: **Runtime → Gestione container → Deploy**, e poi

| Campo | Valore |
|---|---|
| Sorgente immagine | **Archivio locale (offline)** — non «Registry (consigliato)» |
| Immagine | `sws-runtime-<versione>-aarch64-image.tar.gz` |
| Host | il nome mDNS del pannello (`<modello>-<seriale>.local`) |
| Utente | `user` — le credenziali limitate; `pixsys` è privilegiato e non va usato qui |

L'archivio viaggia intero via `scp` (~150 MB) e viene caricato sul dispositivo: più lento del
registry, che manderebbe il solo layer cambiato, ma non pubblica niente.

Se la chiave host è cambiata da un reset, vale il capitolo 9.

### Dopo la prova

```bash
mv "dist/sws-runtime-$V-aarch64-image.tar.gz.rilascio" \
   "dist/sws-runtime-$V-aarch64-image.tar.gz"
```

E un dettaglio che sorprende: `build_container.sh` ricostruisce anche la SPA in
`sws-editor/dist`, che è la stessa che il tuo editor locale sta servendo. Le correzioni lato
browser le vedi con un ricaricamento forzato della pagina, senza riavviare niente.

---

*Traccia: **T-61 — i due `mv` esistono solo perché il nome dell'archivio non dice da quale ramo viene**.*

## 11. Leggere la mail di GitHub che dice «CI failed»

Nata il 2026-09-09, quando il maintainer ha ricevuto la mail sul push della 2.7.0 e ha detto
«di CI/CD non so nulla». La CI era rossa **da mesi** e nessuno lo aveva letto.

**Cos'è.** A ogni push su `main` GitHub esegue `.github/workflows/ci.yml` su una macchina
pulita: otto «job», ognuno una colonna di passi. Se un job fallisce arriva la mail. La pagina
è `github.com/soligolab/sws/actions`: il run in testa è l'ultimo push.

**I simboli.** Verde: passato. Rosso: un passo è fallito. **Cerchio grigio barrato: saltato,
non fallito** — «DCO sign-off» gira solo sulle pull request, quindi sui push è sempre grigio;
«Rust build & test» e «Rust SBOM» dipendono da «Rust lint» e restano grigi se quello cade.

**Cosa leggere, in ordine.**

1. Nel riepilogo, la colonna a sinistra: quali job sono rossi.
2. Cliccare il job rosso: la lista dei passi, uno è rosso. Cliccarlo: il registro. Le ultime
   trenta righe dicono quasi sempre tutto; `exit code 101` è cargo che si è fermato, la riga
   che comincia per `error:` sopra dice perché.
3. Gli **avvisi gialli** in fondo («Node.js 20 is deprecated…») riguardano le azioni di GitHub,
   non il nostro codice: non fanno fallire niente.

**Cosa c'era di rotto, perché non torni.** Tre cose che il codice non c'entrava:

| Job | Causa | Rimedio |
|---|---|---|
| Rust lint, 13 secondi | toolchain **1.75** (2023): non leggeva il lockfile v4, non compilava `time`/`icu` | toolchain **1.94** in `ci.yml`, `rust-version = "1.88"` in `Cargo.toml` |
| Rust lint, dopo | il runner non ha SDL2, libdrm, FreeType, libclang, python3-dev (prerequisiti del README) | passo `apt-get` nei job che compilano |
| Rust audit | cargo-audit **0.21** non legge più il database (CVSS 4.0) | 0.22.2; le 5 vulnerabilità a monte in `sws-runtime/.cargo/audit.toml`, ognuna col perché |
| Rust SBOM | `cargo install` senza versione → 0.5.9, dove `--output-file` non esiste | pinnata la 0.5.9, `--override-filename`, un `sbom.json` per crate |

La regola che ne esce: **ogni strumento della CI è pinnato a una versione**, e la versione
Rust della CI è quella delle macchine di sviluppo — così `cargo fmt --check` dice la stessa cosa
qui e là. Quando `cargo audit` si accende su una vulnerabilità nuova, il job fallisce: è quello
che deve fare. Si aggiunge una riga a `audit.toml` **solo** se la correzione non esiste o non
dipende da noi, e si scrive accanto perché.

**Da qui.** Un run verde su `main` è la prova che il codice compila e passa i test su una
macchina che non è la nostra — la prima volta è stata il 2026-09-09, `bf46d06`. Non sostituisce
il collaudo sul dispositivo: la CI non ha un pannello.

---

*Traccia: **T-65 — la CI è stata rossa **per mesi** senza che nessuno lo leggesse: `session_start.sh` può dirlo a ogni sessione**.*

## 12. Installare il runtime su un dispositivo dall'editor

Configurazione → Runtime → «Installa su dispositivo», dal 2026-09-09 (Q52) un flusso in cinque
passi. Vale per **qualunque** macchina Linux raggiungibile via ssh con podman: SWS non guarda la
marca.

1. **Destinazione.** Scrivi host o IP, oppure «Cerca dispositivi in rete»: la tabella elenca ciò
   che mDNS vede sulla LAN — nome, indirizzo, servizi annunciati (ssh, sftp, workstation) e «SWS
   vX» se un runtime c'è già. Clicca la riga giusta. Se l'editor è già collegato a un dispositivo,
   il campo è precompilato con il suo hostname. **Chi non si annuncia via mDNS non compare**:
   molte distro pubblicano solo `_workstation`, alcune niente — l'IP a mano funziona sempre.
2. **Credenziali.** Utente `user` (quello limitato dell'utente finale, mai `root`) e password. La
   password resta nel modulo finché la pagina è aperta e non viene salvata da nessuna parte.
3. **Verifica dispositivo.** Una sessione ssh, fino a 30 secondi, che **guarda senza toccare**:
   architettura e sistema, podman e versione (serve ≥ 4.4), mappature subuid/subgid, linger,
   sessione systemd dell'utente, spazio nello storage di podman (~1,5 GB), cartella dati, un SWS
   già installato. Ogni riga è ✓, ⚠ o ✗ con il rimedio accanto; ⚠ non ferma (il linger, per
   esempio, l'installer prova ad abilitarlo da solo), ✗ sì. Se la chiave host è cambiata compare
   il pulsante «Dimentica la vecchia chiave e riprova» (§9): la verifica riparte da sola dopo.
4. **Immagine.** Registry per default; il riferimento (`latest-arm64` per qualunque aarch64,
   `latest-amd64` per x86: un'immagine per architettura, Q53) lo propone la verifica e finisce nel
   campo «riferimento immagine», che resta modificabile. «Archivio locale» compare solo se l'editor gira
   dal repo (ha `dist/`).
5. **Installa** (o **Aggiorna**, se SWS c'è già). Spento solo quando la verifica ha trovato ✗: il
   titolo del pulsante dice di leggere la lista. Il registro scorre come prima.

Cosa NON vedi se l'editor non gira da un checkout del repo (Q51): «Pacchetto runtime», il
selettore Binario/Container e «Archivio locale». Non è un guasto: sono strumenti di sviluppo che
senza `scripts/` e `dist/` non possono funzionare, e il server lo dice (`GET /api/build/stato`).

Da riga di comando la stessa sonda si lancia con
`ssh user@<host> 'sh -s' < deploy/container/sonda-dispositivo.sh`: stampa i fatti grezzi,
`SONDA chiave=valore`, senza giudizio.

---

## 13. Dove sta la lista dei dispositivi registrati

Dal 2026-09-10 (Q50) la lista di Configurazione → Dispositivi non è più nel browser: la tiene il
runtime che serve l'editor, nel file

```
<cartella progetti>/.ambiente/dispositivi.yaml      # di solito ~/sws_projects/.ambiente/
```

con etichetta, URL della porta di gestione e utente. **Mai la password**: quella si chiede nella
riga della scheda e resta in memoria finché la pagina è aperta. `.ambiente` è la cartella, dentro
quella dei progetti, per ciò che descrive l'ambiente di lavoro e non è un progetto; il punto
davanti la tiene fuori dall'elenco dei progetti. Fa parte del backup della cartella dei progetti.

Come si riempie: a mano dal modulo in fondo alla scheda; da «Cerca dispositivi in rete», che
elenca ciò che mDNS vede con un «+» per riga; da «+ Dispositivi» accanto a ogni runtime trovato da
«Cerca runtime» in Configurazione → Runtime. La vecchia lista del browser si sposta sul server da
sola la prima volta che apri la scheda dopo l'aggiornamento, senza le password.

Da riga di comando: `curl -s http://localhost:8460/api/devices` (o la porta del tuo editor) la
mostra; il file si può anche scrivere a mano, purché non contenga campi in più — un `pass:` lo fa
rifiutare, apposta.

---

## 14. Convertire un progetto da LVGL a Web (o viceversa)

**Risposta corta: oggi non c'è un pulsante.** Il tipo di destinazione si sceglie **alla
creazione** del progetto, nella WelcomeScreen (`POST /api/projects` porta il campo `target`), e
nessuna rotta lo cambia dopo: fra le `PUT /api/project/*` non ce n'è una per `target`. Si cambia
a mano nel file.

### Come si fa

1. **Chiudi il progetto nell'editor** (o ferma il runtime che lo tiene aperto). Non è pignoleria:
   il runtime carica `project.yaml` all'apertura e lo riscrive **dalla memoria** al primo
   salvataggio. Se modifichi il file con il progetto aperto, il primo salvataggio rimette il
   valore di prima e sembra che la modifica non abbia attecchito.
2. Apri `<cartella progetti>/<nome progetto>/project.yaml` e cambia il blocco:
   ```yaml
   target:
     kind: lvgl_wayland     # → web
   ```
   In alternativa **cancella tutto il blocco `target:`**: un progetto senza `target` vale `web`.
   Non è una scorciatoia, è la regola — i progetti creati prima che il campo esistesse sono tutti
   web, e `wanted_engine` (`sws-web/src/display_target.rs`) tratta `None` e `Web` allo stesso modo.
3. Riapri il progetto.

### Che cosa succede dopo, sul dispositivo

Il campo non è decorativo: all'apertura e a ogni salvataggio il runtime scrive `web` o `lvgl` nel
file `display-target` (`display_target::publish`), e sul pannello `sws-display-apply.sh` commuta
lo schermo — spegne il viewer LVGL e accende il browser, o il contrario. Quindi convertire un
progetto **cambia che cosa si vede sul pannello** al primo deploy successivo.

### La direzione conta

**LVGL → web è la direzione sicura**: il renderer web disegna più tipi di oggetto di quello LVGL,
quindi tutto ciò che si vedeva sul pannello si vedrà anche nel browser.

**Web → LVGL no**: un progetto web può contenere oggetti che il motore LVGL non sa disegnare. La
palette dell'editor li distingue — in un progetto LVGL i tipi supportati portano un distintivo
«L» — ma un progetto già disegnato per il web non viene ricontrollato quando cambi `target`. Dopo
la conversione conviene aprire ogni pagina e guardarla sul pannello, non solo nel browser.

*(Se un giorno questo diventa un'operazione frequente, il posto giusto per un pulsante è
Configurazione → Progetto, con l'avviso sulla direzione rischiosa. Oggi non c'è.)*

*Traccia: **T-58 (il pulsante) e T-59 (il referto che sostituisce «apri ogni pagina e guardala sul pannello»)**.*
