# SWS — Come si fa (ricette)

> Raccolta di capitoli brevi e indipendenti, uno per ogni "come faccio a fare X" posto al vivo dal
> maintainer. Non è un checklist da seguire in ordine (per quello vedi `docs/TESTING_GUIDE.md`) né
> una guida di riferimento su un solo argomento (per quello, i `docs/DEPLOY_*.md` dedicati) — è un
> indice di procedure puntuali, ognuna autosufficiente. Nuovi capitoli si aggiungono in fondo,
> numerati in ordine di comparsa.
>
> Indirizzi/utenti dei device fisici citati nei capitoli **cambiano da sessione a sessione** —
> trattarli come l'ultimo valore noto, non come una costante, e verificare/chiedere prima di
> riusarli alla lettera in una sessione futura.

## Indice

1. [Testare `sws-lvgl-viewer` su un Pixsys reale, sostituendo Chromium](#1-testare-sws-lvgl-viewer-su-un-pixsys-reale-sostituendo-chromium)

---

## 1. Testare `sws-lvgl-viewer` su un Pixsys reale, sostituendo Chromium

Contesto: `sws-lvgl-viewer` è un companion opzionale di `sws-runtime`, non un fork (vedi
`docs/OPEN_QUESTIONS.md` Q14, seguito 9, e `docs/DEPLOY_CONTAINER_AARCH64.md` §4 per i dettagli
tecnici dietro ogni passo qui sotto). Questo capitolo presume un device Pixsys dove Chromium
mostra oggi la SPA web, e sostituisce quel display layer con un container LVGL — senza toccare
`sws-runtime`, che resta acceso per tutto il test.

**Due percorsi per costruire l'immagine**, scelta esplicita del maintainer (2026-08-09): per ora
si preferisce il percorso **generico** (nessun SDK Pixsys, build sotto emulazione QEMU) invece di
quello Pixsys-tuned, anche se più lento — non lega il container a un device specifico. Il percorso
SDK resta un'alternativa per quando servirà davvero il tuning cortex-a35 (vedi in fondo a questo
passo).

### Passo 0 — Costruire l'immagine (percorso generico, senza SDK)

**Va lanciato con `sudo`** (non da Claude Code: `sudo` è negato dalla policy dei permessi di
questo progetto — un umano al terminale lo lancia normalmente):

```bash
sudo ./scripts/build_container_aarch64_generic.sh --with-lvgl --push
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

```bash
podman run -d --name sws-lvgl-viewer \
  --userns=keep-id \
  -v /run/user/1000:/run/user/1000 \
  -e XDG_RUNTIME_DIR=/run/user/1000 \
  -e WAYLAND_DISPLAY=wayland-1 \
  -e SDL_VIDEODRIVER=wayland \
  --entrypoint sws-lvgl-viewer \
  ghcr.io/soligolab/sws-runtime:latest-arm64-generic \
  --base-url https://127.0.0.1:8443 --page "<pagina iniziale del progetto>"
```

`--userns=keep-id` non è opzionale: senza, il socket dell'host risulta "Permission denied" dentro
il container (rootless podman rimappa gli UID per default). Sostituisci `<pagina iniziale del
progetto>` col nome esatto (case-sensitive) della pagina synottico da cui partire — es.
`"LVGL Demo"` per il template demo incluso nel repo.

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
