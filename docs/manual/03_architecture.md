← [Indice](MAIN.md) | [← Quick Start](02_quickstart.md) | [Successivo → Editor](04_editor_guide.md) →

---

# 03 — Architettura

Questa sezione descrive come SWS è costruito internamente: la struttura a crate Rust,
il modello a doppia porta, il flusso dei dati dal PLC al browser.

---

## Visione d'insieme

SWS è un **monorepo** con due componenti principali che girano sullo stesso host:

```
sws/
├── sws-runtime/     Rust — server HTTPS + tag engine + plugin protocollo
└── sws-editor/      TypeScript + React — SPA editor + viewer operatori
```

Il runtime è un **singolo binario Rust** che:
- Avvia due server HTTPS (porta 8443 e 8444)
- Carica il progetto dal filesystem (YAML)
- Raccoglie dati dai PLC tramite plugin
- Gestisce tag, allarmi, historian e autenticazione
- Serve la SPA React (admin e viewer) come file statici incorporati nel binario

---

## Crate Rust

Il workspace `sws-runtime/crates/` è composto da 14 crate:

```
sws-runtime/crates/
  sws-core           Tipi condivisi: TagValue, AlarmDef, ProjectMeta, ...
  sws-auth           Argon2id, RBAC 4 ruoli, token sessione
  sws-historian      Ring buffer in-memory + persistenza SQLite
  sws-pyscript       PyO3 + RestrictedPython sandbox, supervisor script globali
  sws-audit          Audit log append-only (eventi auth, scritture tag, modifiche progetto)
  sws-web            Router Axum dual-port 8443+8444, tutti gli handler HTTP/WS
  sws-plugin-api     Trait Plugin + TagValue condivisi tra i plugin
  sws-plugin-modbus  Modbus TCP + RTU (tokio-modbus)
  sws-plugin-opcua   OPC-UA client + server (async-opcua 0.18)
  sws-plugin-mqtt    MQTT client + Sparkplug B encode/decode (rumqttc + prost)
  sws-plugin-ha      HomeAssistant WebSocket (state_changed + call_service)
  sws-plugin-s7      Siemens S7 (pure-Rust s7 crate, tokio bridge)
  sws-plugin-enip    EtherNet/IP (rseip, ControlLogix symbolic tag access)
  sws-runtime        Entry point binario, TLS dual-port server (8443 + 8444)
```

### Dipendenze chiave

| Funzione | Crate / libreria |
|----------|-----------------|
| HTTP/WebSocket | `axum`, `tower`, `tower-http`, `hyper-util` |
| TLS | `rustls`, `tokio-rustls`, `rcgen` (nessun OpenSSL) |
| Async runtime | `tokio` |
| Logging strutturato | `tracing` + `tracing-subscriber` (JSON) |
| Metriche Prometheus | `metrics`, `metrics-exporter-prometheus` |
| Autenticazione | `argon2` (Argon2id) |
| Scripting Python | `pyo3` 0.23 + `RestrictedPython` |
| Database historian | `rusqlite` (SQLite embedded) |

---

## Architettura dual-port

SWS avvia **due server HTTPS indipendenti** dallo stesso processo:

```
processo sws-runtime
      │
      ├── porta 8443 ──── Viewer operatori (RuntimeViewer)
      │       │           Auth: opzionale (anonimo = sola lettura)
      │       │           SPA: dist/index.html (~24 kB)
      │       │           Route: /api/* (lettura), /ws/* (stream live)
      │       │
      └── porta 8444 ──── Admin IDE
              │           Auth: obbligatoria (401 senza token)
              │           SPA: dist/index-admin.html (~310 kB)
              │           Route: tutto quanto + project lifecycle
```

**Perché due porte?**

La separazione permette di applicare politiche di rete diverse:
- La porta 8443 può essere esposta a tutti i client in rete (pannelli HMI, operatori, kiosk)
- La porta 8444 rimane accessibile solo agli ingegneri (firewall, VPN, allowlist IP)
- Le route di gestione progetto (`upload`, `delete`, `open`) esistono **solo** su 8444

---

## Flusso dati: dal PLC al browser

```
PLC / Dispositivo di campo
        │
        │  protocollo nativo
        ▼
sws-plugin-modbus / sws-plugin-opcua / ...
        │
        │  write_tag(id, value, quality)
        ▼
sws-core :: TagDb (in-memory HashMap<String, TagState>)
        │
        ├──► sws-historian  (campionamento SQLite: deadband / on-change / periodico)
        │
        ├──► sws-audit      (scritture tag → audit log JSONL)
        │
        └──► WebSocket broadcast (push a tutti i browser connessi)
                │
                ▼
        Browser (RuntimeViewer o Editor in Modalità Runtime)
        aggiorna il sinottico SVG in tempo reale
```

I plugin operano in task Tokio separati e comunicano col `TagDb` tramite `Arc<RwLock<...>>`.

---

## Formato progetto (YAML)

Un progetto SWS è una **directory di file YAML**:

```
/data/user/sws/projects/mio-progetto/
├── project.yaml       # meta, tag, sorgenti, allarmi, utenti
├── synoptics/
│   ├── page1.yaml     # un file per sinottico
│   └── page2.yaml
├── faceplates/
│   └── motor.yaml
└── scripts/
    └── on_alarm.py
```

Vantaggi del formato YAML:
- Leggibile da un editor di testo
- Versionabile con Git (diff human-readable)
- Importabile/esportabile come archivio `.zip`

---

## Editor React (SPA)

Il frontend è una React 19 + TypeScript SPA compilata con Vite 6.
Ha **due entry point** distinti:

| Entry | Bundle | Route | Uso |
|-------|--------|-------|-----|
| `index.html` → `src/main.tsx` | ~24 kB | porta 8443 `/` | Viewer operatori |
| `index-admin.html` → `src/admin-main.tsx` | ~310 kB | porta 8444 `/` | Admin IDE |

Il viewer operatori è deliberatamente leggero — serve per pannelli embedded con RAM limitata.

### State management

Zustand (`src/store/index.ts`) gestisce lo stato globale:
- Tag live (aggiornati via WebSocket)
- Allarmi attivi (push dal server)
- Progetto corrente (pagine, oggetti, configurazione)
- Autenticazione (token Bearer)
- Cronologia undo/redo (fino a 200 step)

---

## Sicurezza by design

| Aspetto | Implementazione |
|---------|----------------|
| **TLS only** | Nessun HTTP plain — rustls self-signed auto-generato al primo avvio |
| **Password** | Argon2id, mai in chiaro nel database o nei log |
| **Dipendenze** | `Cargo.lock` e `pnpm-lock.yaml` sempre committati; `cargo-audit` in CI |
| **Memory safety** | Rust puro; nessun `unsafe` senza commento `// SAFETY:` |
| **SBOM** | CycloneDX generato dalla CI ad ogni build |
| **Audit log** | Append-only JSONL: autenticazioni, scritture tag, modifiche progetto |
| **ABAC** | Zone per sinottico — ogni pagina può richiedere `allowed_zones` specifiche |

---

## Dev workflow

```bash
# Avvio completo (compila Rust al primo lancio, poi avvio runtime + Vite)
./scripts/dev.sh

# Struttura dello stato locale (tutto .gitignore-ato)
.run/
├── config/        # tls.crt + tls.key (generati una volta, riusati)
├── project/       # project.yaml demo con 2 tag + 1 allarme
└── logs/          # runtime.log
```

Per compilare solo il runtime:
```bash
cd sws-runtime && cargo build --release
```

Per avviare solo il frontend:
```bash
cd sws-editor && pnpm dev
```

---

← [Indice](MAIN.md) | [← Quick Start](02_quickstart.md) | [Successivo → Editor](04_editor_guide.md) →
