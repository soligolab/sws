# scripts/

Helper locali per il PoC SWS. Non necessari in produzione o CI.

## Architettura dei due script

```
DISPOSITIVO (panel, server):         PC SVILUPPATORE:
  ./scripts/start_runtime.sh           ./scripts/start_editor.sh
  ├─ 8080  HTTP cert-acceptance         ├─ 8090  HTTP cert-acceptance
  ├─ 8443  viewer operatori             └─ 8460  IDE locale
  └─ 8444  IDE/admin remoto                  ↕ "Connetti runtime"
```

I due script usano range di porte separati per poter girare sulla **stessa
macchina** senza conflitti (es. dev locale con runtime + editor in parallelo).

## `start_runtime.sh` — runtime sul dispositivo

Avvia il binario Rust con **tutte e tre** le porte:
- `8080` — HTTP (no TLS): pagina di aiuto per accettare il certificato self-signed
- `8443` — viewer per operatori e kiosk (accesso anonimo)
- `8444` — IDE/admin remoto (accesso autenticato, Supervisor/Admin)

Auto-apre il progetto `default` se esiste in `.run/projects/default/`.

```sh
./scripts/start_runtime.sh                # instance 1: 8443/8444, dati .run/
./scripts/start_runtime.sh --instance 2   # instance 2: 8445/8446, dati .run-2/
```

### Dove vive lo stato

```
.run/
├── config/    # tls.crt + tls.key (solo se il TLS è stato attivato dall'IDE)
├── projects/  # progetti (uno per sottodirectory)
│   └── default/
│       ├── project.yaml
│       ├── synoptics/
│       └── users.yaml
└── logs/      # file JSONL ruotati per data
```

L'albero `.run/` è in `.gitignore`. Per ripartire da zero:

```sh
rm -rf .run && ./scripts/start_runtime.sh
```

### Certificato TLS (opzionale)

Il runtime parte in **HTTP plain** di default: nessun certificato, nessuna pagina di
accettazione, primo accesso diretto su `http://localhost:8444`. `localhost` è sempre un
"secure context" nei browser moderni, quindi l'IDE funziona senza TLS.

Il TLS si attiva **su richiesta** dall'IDE: **Configurazione → Stato → Certificato TLS**:
- **Genera self-signed** — crea `config/tls.crt`+`tls.key` e riavvia in HTTPS.
- **Carica cert+key** — carica un certificato firmato (es. CA aziendale), validato lato server.
- **Disabilita TLS** — rimuove i file e torna in HTTP.

La modalità è determinata dalla **presenza** di `config/tls.crt` all'avvio (gli script passano
`--http-port` solo quando il cert esiste). Quando il TLS è attivo, accetta il self-signed così:

```sh
curl -k https://localhost:8443/cert -o sws.crt   # scarica il cert per i trusted del browser
curl -k https://<ip>:8443/cert -o sws.crt         # da un altro PC sulla LAN
```

### Verifica che sia vivo

```sh
curl -k https://localhost:8443/health   # → "ok"
curl -k https://localhost:8444/health   # → "ok"
curl -k https://localhost:8443/api/tags
```

### End-to-end tests (Playwright)

Il suite Playwright si trova in `sws-editor/e2e/`. Avviare il runtime prima:

```sh
# Terminal A
./scripts/start_runtime.sh

# Terminal B (prima volta — scarica Chromium ~150 MB)
cd sws-editor && npx playwright install chromium

# Terminal B (ogni run)
cd sws-editor && pnpm test:e2e        # headless
cd sws-editor && pnpm test:e2e:ui     # debug UI
```

### `check_viewer_layout.sh` — barre di scorrimento sul pannello

Verifica che il viewer non produca barre di scorrimento su un pannello 1280×800
(il WP620), con e senza la barra superiore. Si avvia da solo: crea un runtime
temporaneo, un progetto da template con le pagine portate a 1280×800, e misura
col browser di Playwright.

```sh
pnpm --dir sws-editor build     # serve la dist compilata
cargo build -p sws-runtime
./scripts/check_viewer_layout.sh
```

Esce 0 solo se non c'è nessuna barra in **nessuna** delle quattro configurazioni
(chrome visibile, chrome nascosto, finestra più piccola della pagina, finestra
più grande). Esiste perché le tre barre che si vedevano sul dispositivo avevano
tre cause indipendenti e "pochi pixel di troppo" non si notano a occhio:
misurare è l'unico modo di sapere se sono tornate.

### `check_spa_autoreload.sh` — il pannello prende la SPA nuova?

Verifica che il viewer si ricarichi da solo quando sul dispositivo arriva un
frontend aggiornato (cioè dopo `install-container.sh --www-only`). Simula il
deploy rinominando il chunk di entry con un hash diverso — lo stesso segnale che
Vite produce a ogni build — e controlla che la pagina si ricarichi servendo il
bundle nuovo.

```sh
pnpm --dir sws-editor build
cargo build -p sws-runtime
./scripts/check_spa_autoreload.sh     # dura ~45 s: l'intervallo del watcher è 30 s
```

Esiste perché sul WP620 il pannello ha continuato a mostrare la versione vecchia
dopo un aggiornamento, e lì non c'è nessuno che possa premere ricarica: "il
deploy è andato" non significa "il pannello sta mostrando la versione nuova".

---

## `start_editor.sh` — IDE locale sul PC sviluppatore

Avvia il binario Rust con **solo** la porta IDE (nessun viewer).
Permette di creare e modificare progetti localmente, anche senza un runtime attivo.

- `8090` — HTTP (no TLS): pagina di aiuto per accettare il certificato self-signed
- `8460` — IDE/admin locale

```sh
./scripts/start_editor.sh                # IDE su 8460, HTTP su 8090, dati .run/
./scripts/start_editor.sh --instance 2   # IDE su 8462, HTTP su 8091, dati .run-2/
```

Per connettere un runtime remoto: apri l'IDE → **ConfigView → Runtime →
"Connetti"** → inserisci URL, utente e password del runtime (es. `https://192.168.1.50:8444`).
La connessione abilita sia il **deploy del progetto** sia la **visualizzazione live di tag e allarmi**
in real-time tramite relay WebSocket (il token remoto rimane nel processo locale, mai nel browser).

### Primo accesso (accettazione certificato)

Apri `http://localhost:8090/` nel browser. La pagina guida all'accettazione
del certificato self-signed senza uscire dall'applicazione.

### Costruire la SPA prima di usare gli script

Gli script servono la SPA già compilata da `sws-editor/dist/`. Se non è
presente o è stale, ricostruirla:

```sh
cd sws-editor && pnpm build
```

## `demo-sine.py` — driving a Trend with a sine wave

Quick way to put movement on a `trend` object during the demo. Logs in,
then writes `offset + amplitude * sin(2π · t / period)` to a tag every
`--interval` seconds via `PUT /api/tags/:id`. No deps beyond Python's
stdlib.

The dev seed already creates a `sine` tag, so the default invocation
just works:

```sh
./scripts/demo-sine.py
```

To visualize it: in the editor (Editor mode) drop a **Trend** object,
set its **Tag** to `sine`, set the **Finestra** to ~30 s, save the
synoptic, switch to **Runtime** mode. You should see the wave scroll.

Common tweaks:

```sh
./scripts/demo-sine.py --tag flow --period 20 --amplitude 25 --offset 50
./scripts/demo-sine.py --interval 0.05      # 20 Hz, smoother trace
./scripts/demo-sine.py --password mypw      # if you override admin password
```

Stop with Ctrl-C. The script auto-reauthenticates on a 401 (so it
survives a runtime restart) and exits cleanly on Ctrl-C.

## `demo-driver.py` — multi-tag, multi-waveform driver

Superset of `demo-sine.py`. Pass `--gen` once per generator (each is a
comma-separated `key=value` list with at least `tag=NAME`). All
generators share one asyncio loop so they tick together.

```sh
./scripts/demo-driver.py \
  --gen 'tag=sine,wave=sin,period=10,amp=50,offset=50' \
  --gen 'tag=cosine,wave=cos,period=8' \
  --gen 'tag=triangle,wave=tri,period=12,amp=30,offset=20' \
  --gen 'tag=ramp,wave=saw,period=20' \
  --gen 'tag=noise,wave=random,amp=10,offset=50'
```

Waveforms: `sin`, `cos`, `tri`, `saw`, `square` (with optional `duty`),
`random`, `step` (with `step_low`, `step_high`, `step_at`). Other keys:
`period`, `amplitude` / `amp`, `offset`, `interval`, `phase`.

Drop one **Trend** object in the editor, set its **Tag** to `sine`, then
add `cosine`, `triangle`, `ramp`, `noise` to **ALTRI TAG (OVERLAY)** —
five lines on the same axes.

## MQTT write path

A `TopicMapping` now also accepts an optional **Topic out (publish)** in
the ConfigView Protocolli tab. When set, a write to that tag (via
`PUT /api/tags/:id`, an object's `on_press` script, or a button) is
forwarded to the configured topic as a raw string payload
(`true` / `42.5` / etc.). Subscribe and publish topics can be the same
channel or different ones.
