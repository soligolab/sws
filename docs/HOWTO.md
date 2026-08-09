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

**Prerequisito bloccante**: serve un'immagine container costruita con `--with-lvgl` da una
macchina che ha l'SDK Yocto Pixsys installato (`/usr/local/oecore-x86_64/…`). Il rendering LVGL
vero non è ancora stato verificato end-to-end per questo motivo esatto — solo la meccanica di
accesso al socket Wayland lo è stata (Passo 4 sotto), con un container diverso.

### Passo 0 — Costruire e pubblicare un'immagine con LVGL incluso

Da una macchina **con l'SDK Yocto Pixsys** (non il dev server usato per preparare questo lavoro —
verificato assente lì):

```bash
./scripts/build_container.sh --with-lvgl --push
```

Senza rete verso il registry, ometti `--push` e copia via `scp` l'archivio prodotto
(`dist/sws-runtime-<versione>-aarch64-image.tar.gz`) — vedi `docs/DEPLOY_CONTAINER_AARCH64.md`
§"Ripiego offline" per come caricarlo sul device da lì.

Lo script si ferma da solo con un errore leggibile se `sws-lvgl-viewer` non cross-compila (es.
manca `libsdl2-dev` nel sysroot — rischio noto, non ancora verificato in nessuna direzione).

### Passo 1 — Connettersi al device

```bash
ssh user@tc620-a-p3-c6-07aff9.local
```

Utente verificato per **questo** device il 2026-08-09: `user` (non `pixsys`, che è la convenzione
per il deploy nativo ma non ha accesso qui) — vedi la nota in cima a questo file su indirizzi/utenti
che cambiano.

### Passo 2 — Fermare Chromium

```bash
sudo systemctl stop chromium@main-app.service
```

Chiede la password interattivamente (`user` non ha sudo senza password su questo device). Lo
schermo probabilmente resta fermo sull'ultimo frame mostrato — atteso, Weston perde il suo unico
client. Verifica che sia fermo con `systemctl status chromium@main-app.service`.

### Passo 3 — Scaricare l'immagine sul device (se pubblicata col Passo 0 via `--push`)

```bash
podman pull ghcr.io/soligolab/sws-runtime:latest-arm64
```

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
  ghcr.io/soligolab/sws-runtime:latest-arm64 \
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
