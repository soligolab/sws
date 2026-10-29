← [Indice](MAIN.md) | [← Quick Start](02_quickstart.md) | [Successivo → Editor](04_editor_guide.md) →

---

# 03 — Architettura

> Com'è costruito SWS dentro: i crate Rust, le porte di un runtime, il percorso di un valore dal campo allo schermo,
> la forma di un progetto su disco. Per chi deve capire il sistema prima di integrarlo o modificarlo. Dove gira
> l'immagine, come parlano fra loro pannello, IDE e cloud, e con quali porte e intestazioni sta nel
> [capitolo 18](18_container_e_comunicazione.md).
>
> Misurato sul codice il 19-10-2026.

---

## Visione d'insieme

SWS è un **monorepo** con due componenti:

```
sws/
├── sws-runtime/     Rust — il workspace del runtime: server HTTP/WS, motore dei tag, protocolli di campo
└── sws-editor/      TypeScript + React — l'IDE, il viewer degli operatori, la console, la chat, il log
```

Il runtime è **un binario solo**, `sws-runtime`, che sta in **un'immagine sola**
(`ghcr.io/soligolab/sws-runtime`). Quello che fa dipende dagli argomenti con cui parte
(`sws-runtime/crates/sws-runtime/src/main.rs`, struttura `Args`):

| Ruolo | Argomenti tipici | Dove |
|---|---|---|
| **Runtime del pannello** | `--viewer-port 7443 --no-admin` | TC620, WP630, un PC in reparto |
| **IDE su un PC** | solo `--admin-port` (niente viewer) | `start_editor.sh`, il PC di chi progetta |
| **Gateway del cloud** | `--gateway` | il VPS |
| **Container di progetto** | `--project … --admin-port 7444 --auth-delegata` | il VPS, uno per progetto aperto |

In ogni ruolo il runtime:
- carica il progetto dal filesystem (YAML) e al boot riapre l'ultimo attivo;
- acquisisce dal campo con i plugin di protocollo;
- calcola tag derivati, allarmi, storico e script;
- serve le API, i WebSocket e la SPA React dalla cartella passata con `--www`.

I quattro ruoli, le loro porte e la comunicazione fra loro sono nel [capitolo 18](18_container_e_comunicazione.md).
Sul pannello, accanto al runtime, può girare il **viewer LVGL**: la stessa immagine, con un altro entrypoint.

---

## Crate Rust

La cartella `sws-runtime/crates/` contiene **18 crate**. Diciassette sono membri del workspace; `sws-kiosk` ne è
escluso (`sws-runtime/Cargo.toml:4`) perché richiede GTK4 e WebKit, e si compila a parte.

**Il nucleo**

| Crate | Cosa contiene |
|---|---|
| `sws-core` | i tipi del progetto (`project.rs`), il database dei tag `TagDb` e il bus delle scritture `TagWriteBus` (`tag.rs`), il motore degli allarmi (`alarm.rs`), il bus dei log, i tipi composti, le traduzioni |
| `sws-auth` | gli utenti **del progetto** (`users.yaml`): Argon2id, i ruoli, le zone, i token di sessione |
| `sws-identita` | gli utenti **dell'installazione**, cioè chi apre l'IDE, indipendenti dal progetto (SQLite) |
| `sws-historian` | lo storico: un anello in memoria per tag più i datastore su disco (SQLite, PostgreSQL; ODBC è uno stub che risponde «non compilato») |
| `sws-pyscript` | gli script Python: PyO3 + RestrictedPython, e il supervisore degli script globali |
| `sws-audit` | il registro di audit: JSONL in sola aggiunta, ogni riga concatenata alla precedente con SHA-256 e, se c'è la chiave, firmata HMAC |
| `sws-web` | tutto il lato rete: router e handler HTTP/WS, deploy, backup, aggiornamenti, abbinamento, tunnel (`tunnel/`), gateway del cloud (`gateway/`), assistente AI (`ai/`) |
| `sws-runtime` | l'entrypoint del binario: legge gli argomenti, monta i router sulle porte, avvia i servizi |

**I protocolli** — ogni plugin espone una funzione `run(cfg, db, bus, stato, cancel)` che il supervisore delle
sorgenti (`sws-web/src/source_supervisor.rs`) avvia in un task Tokio suo. Non c'è più un crate di trait comune: il
contratto sono i tipi di `sws-core`.

| Crate | Protocollo |
|---|---|
| `sws-plugin-modbus` | Modbus TCP e RTU (`tokio-modbus`) |
| `sws-plugin-opcua` | OPC UA client e server (`async-opcua` 0.18) |
| `sws-plugin-mqtt` | MQTT e Sparkplug B (`rumqttc` 0.25 + `prost`) |
| `sws-plugin-s7` | Siemens S7 (aree DB/M/I/Q) |
| `sws-plugin-enip` | EtherNet/IP (`rseip`, accesso simbolico ControlLogix) |
| `sws-plugin-homeassistant` | Home Assistant via WebSocket (`state_changed` + `call_service`) |
| `sws-plugin-host` | le risorse della macchina (CPU, RAM, temperature, disco, rete, uptime) come tag in sola lettura |

**Gli schermi e gli strumenti**

| Crate | Cosa fa |
|---|---|
| `sws-lvgl-viewer` | disegna le pagine con LVGL su una finestra SDL2, collegato a un runtime come un browser (`/ws/tags`, `/ws/alarms`) — vedi [capitolo 18](18_container_e_comunicazione.md#22-lo-schermo-chromium-o-lvgl) |
| `sws-kiosk` | una finestra WebKit (GTK4) a schermo intero; fuori dal workspace — sul pannello lo schermo web è Chromium |
| `sws-banco` | il banco delle prestazioni: N tag × K client, latenza da capo a capo, CPU e memoria — vedi [capitolo 16](16_prestazioni.md) |

### Dipendenze chiave

| Funzione | Crate / libreria | Dove è dichiarata |
|---|---|---|
| HTTP/WebSocket | `axum` 0.7, `tower`, `tower-http`, `hyper-util` | `sws-runtime/Cargo.toml:56` |
| TLS | `rustls` 0.23, `tokio-rustls`, `rcgen` 0.13 (nessun OpenSSL) | `:76-78` |
| Async runtime | `tokio` | |
| Logging strutturato | `tracing` + `tracing-subscriber` (JSON) | `:62` |
| Metriche Prometheus | `metrics` 0.23, `metrics-exporter-prometheus` 0.15 | `:122-123` |
| Scoperta in LAN | `mdns-sd` 0.20 | `:93` |
| Tunnel dei pannelli | `yamux` 0.14 su WebSocket (`tokio-tungstenite` 0.24) | `crates/sws-web/Cargo.toml:77` |
| Scripting Python | `pyo3` 0.29 + `RestrictedPython` | `:119` |
| Storico | `rusqlite` 0.32 (SQLite incorporato), `tokio-postgres` | `:51` |

Rust minimo: **1.88** (`rust-version`, `sws-runtime/Cargo.toml:9`).

---

## Le porte di un runtime

Un processo `sws-runtime` apre **fino a due porte**, ognuna con il suo router (`sws-web/src/router.rs`):

```
processo sws-runtime
      │
      ├── --viewer-port (7443) ── Viewer degli operatori
      │       │                   SPA: index.html (RuntimeViewer)
      │       │                   API in lettura, comandi, login; /ws/tags, /ws/alarms
      │       │                   Accesso: autenticazione facoltativa, senza token si è Viewer anonimo
      │       │
      └── --admin-port (7444) ─── Gestione
              │                   con --no-admin (pannello): solo API ristretta per l'IDE remoto,
              │                     nessuna interfaccia servita, tutto autenticato
              │                   senza --no-admin (IDE su PC, container di progetto):
              │                     SPA index-admin.html e tutte le rotte di gestione
```

**Perché due porte.** Sul pannello la separazione permette politiche di rete diverse:
- la **7443** può essere aperta a tutta la rete dell'impianto (operatori, schermi, kiosk);
- la **7444** serve solo a chi usa l'IDE, e si può chiudere col firewall, con una VPN o con un elenco di indirizzi;
- le rotte che cambiano il progetto (deploy, apertura, eliminazione) esistono **solo** sulla 7444.

**Le due porte non sono più tutto.** Dal 2026 SWS ha anche:
- il **gateway del cloud**, una porta sola davanti a tutti i progetti, dietro Traefik;
- i **container di progetto**, uno per progetto aperto nel cloud, senza viewer;
- il **tunnel**: un WebSocket uscente con cui il pannello si fa raggiungere dal cloud senza porte aperte in entrata;
- la **porta 8080** di accompagnamento quando il TLS è attivo, per accettare il certificato autofirmato.

La tabella completa delle porte, chi ascolta e cosa aprire sul firewall di un impianto sono nel
[capitolo 18, §4](18_container_e_comunicazione.md#4-le-porte); l'elenco delle rotte di ogni router nel
[capitolo 13](13_api_reference.md).

---

## Flusso dati: dal campo allo schermo

```
PLC / dispositivo di campo
        │  protocollo nativo
        ▼
sws-plugin-modbus / -opcua / -mqtt / …   (un task Tokio per sorgente)
        │  TagDb::ingest(id, valore, qualità)   — scala e converte al tipo dichiarato
        ▼
sws-core :: TagDb   (in memoria: Arc<RwLock<HashMap<TagId, TagState>>>)
        │  broadcast di ogni TagUpdate
        ├──► motore degli allarmi       (sws-core/alarm.rs)
        ├──► tag derivati e script globali
        ├──► sws-historian              (anello in memoria; su disco solo i tag con history: true)
        └──► /ws/tags                   (a lotti, verso ogni client connesso)
                │
                ▼
        browser, kiosk o viewer LVGL: la pagina si aggiorna
```

**Nell'altro verso**, una scrittura dell'operatore (`PUT /api/tags/:id`, il WebSocket dei tag, una ricetta):
1. si controllano ruolo minimo, tipo e che il tag non sia calcolato — un rifiuto finisce nell'audit
   (`tag.write_denied`, `tag.write_rejected_type`, `tag.write_rejected_computed`);
2. una scrittura accettata finisce nell'audit come `tag.write`;
3. `TagWriteBus` la consegna al canale del plugin che possiede il tag, che la scrive sul campo.

Riferimenti: `sws-core/src/tag.rs` (`TagDb`, `ingest`, `TagWriteBus`), `sws-historian/src/lib.rs`,
`sws-web/src/source_supervisor.rs`.

---

## Formato del progetto

Un progetto SWS è **una cartella di file YAML**:

```
<radice dei progetti>/mio-progetto/
├── project.yaml       # meta, tag, tipi, sorgenti, allarmi, datastore, funzioni, script globali, lingue
├── users.yaml         # utenti del progetto (se ce ne sono)
├── secrets.yaml       # segreti delle sorgenti, fuori da project.yaml e fuori da Git (.gitignore)
├── synoptics/         # un file per pagina
│   ├── page1.yaml
│   └── page2.yaml
├── faceplates/        # faceplate riusabili
├── cornici/           # cornici: testate e piè di pagina comuni alle pagine
├── recipes/           # ricette
├── boot/              # pagine di boot: <nome>.yaml + <nome>.png
├── images/            # immagini caricate
├── anteprima.png      # la miniatura della pagina iniziale, per l'elenco dei progetti (fuori da Git e dal deploy)
└── history/
    └── historian.db   # lo storico SQLite del progetto
```

- Gli **script** non sono file `.py` a parte: il codice Python sta in `project.yaml`, nel campo `code` di
  `functions` e di `global_scripts`.
- `boot/`, `faceplates/`, `recipes/` e `cornici/` stanno fuori da `synoptics/` apposta: il runtime e i viewer
  mostrano come pagine solo quella cartella (`sws-web/src/boot.rs`).
- La **radice dei progetti** cambia col ruolo: `/var/sws/projects` nel container (sul pannello è il volume
  `/data/user/sws/projects`), `~/sws_projects` per l'IDE da cliente, `.run-editor/projects` in sviluppo (vedi [capitolo 18, §1.2](18_container_e_comunicazione.md#12-le-cartelle)).

Riferimenti: `sws-core/src/project.rs` (`GlobalScriptDef`); `secrets.yaml` in `sws-web/src/git_deploy.rs`; le cartelle in `sws-web/src/router.rs` (`images`, `faceplates`, `cornici`,
`recipes`) e `sws-web/src/boot.rs`; un esempio con le cornici in `examples/templates/tc620-sistema/`.

Vantaggi del formato:
- si legge con un editor di testo;
- si versiona con Git, con diff leggibili (vedi [capitolo 12](12_gitops.md));
- si esporta e si importa come archivio `.zip`.

---

## Editor React (SPA)

Il frontend è una SPA React 19 + TypeScript, compilata con Vite 6. Ha **cinque entry point**:

| Entry | Sorgente | Uso |
|---|---|---|
| `index.html` | `src/main.tsx` | viewer degli operatori (7443) |
| `index-admin.html` | `src/admin-main.tsx` | IDE (7444, dove non c'è `--no-admin`) |
| `index-console.html` | `src/console-main.tsx` | console del cloud (aziende, progetti, pannelli) |
| `index-chat.html` | `src/chat-main.tsx` | chat dell'assistente in finestra staccata |
| `index-log.html` | `src/log-main.tsx` | log in finestra staccata |

**Peso al caricamento**, misurato sulla build del 19-10-2026 (i file che la pagina carica subito, compressi gzip):
viewer circa **310 kB**, IDE circa **420 kB**. Il resto si carica quando serve.

### Stato dell'applicazione

Zustand (`src/store/index.ts`, `useAppStore`) tiene lo stato globale:
- i tag vivi, aggiornati dal WebSocket;
- gli allarmi attivi, spinti dal server;
- il progetto aperto (pagine, oggetti, configurazione);
- la sessione;
- la cronologia di annulla/ripeti, fino a **200 passi** (`HISTORY_LIMIT`).

---

## Sicurezza by design

| Aspetto | Implementazione |
|---------|----------------|
| **TLS** | HTTP di default sul pannello; HTTPS (rustls) generando o caricando un certificato dall'IDE — vedi [10 — Deployment](10_deployment.md). Nel cloud il TLS lo fa Traefik |
| **Password** | Argon2id, mai in chiaro su disco o nei log |
| **Intestazioni HTTP** | `nosniff`, `Referrer-Policy`, una `Content-Security-Policy` con `frame-ancestors` dalle origini dichiarate, HSTS solo in HTTPS (`sws-web/src/sicurezza_http.rs`) |
| **Limiti alle richieste** | un secchio di gettoni per indirizzo, letture e scritture separate, `429` oltre il tetto (`sws-web/src/limiti.rs`) |
| **Dipendenze** | `Cargo.lock` e `pnpm-lock.yaml` sempre committati; `cargo audit` in CI (`.github/workflows/ci.yml`) |
| **SBOM** | CycloneDX generato dalla CI a ogni build |
| **Audit** | JSONL in sola aggiunta a catena di hash: accessi, scritture dei tag, modifiche di progetto, deploy, aggiornamenti, abbinamenti |
| **Zone** | per pagina: ogni sinottico può richiedere `allowed_zones` — vedi [capitolo 09](09_auth_rbac.md) |

Il quadro completo, con gli obblighi del CRA, è nel [capitolo 17](17_sicurezza.md).

---

## Dev workflow

```bash
# Runtime del dispositivo: viewer 7443 + IDE 7444 + 8080, riapre il progetto `default`
./scripts/start_runtime.sh

# IDE come lo usa un cliente: 8460 + 8090, progetti in ~/sws_projects
./scripts/start_editor.sh

# Lo stesso IDE con i progetti dentro il checkout (.run-editor/projects): quello da usare sviluppando
./scripts/start_editor_develop.sh
```

Lo stato locale di `start_runtime.sh` sta in `.run/`, tutto ignorato da Git:

```
.run/
├── config/      # audit.jsonl, instance_id, known_projects.json; tls.crt + tls.key se il TLS è attivo
├── projects/    # un progetto per sottocartella
├── logs/        # runtime-AAAA-MM-GG.jsonl
└── oci/
```

Solo il runtime:
```bash
cd sws-runtime && cargo build --release
```

Solo il frontend, con ricaricamento a caldo:
```bash
cd sws-editor && pnpm dev
```

Le altre opzioni degli script sono in `scripts/README.md`.

---

← [Indice](MAIN.md) | [← Quick Start](02_quickstart.md) | [Successivo → Editor](04_editor_guide.md) →
