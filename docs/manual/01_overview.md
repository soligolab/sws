← [Indice](MAIN.md) | [Successivo → Quick Start](02_quickstart.md)

---

# 01 — Panoramica di SWS

**Soligo Web SCADA (SWS)** è una piattaforma SCADA open-source, completamente web-based, progettata per hardware industriale embedded ARM64. Sostituisce gli SCADA tradizionali che richiedono workstation Windows con un approccio moderno: un singolo binario Rust, un browser come unico client, progetti in YAML versionati con Git.

---

## Cos'è uno SCADA

Un sistema SCADA (Supervisory Control and Data Acquisition) raccoglie dati da PLC e dispositivi di campo, li visualizza in tempo reale su sinottici grafici e consente agli operatori di inviare comandi. SWS porta questa funzionalità su hardware low-cost e la rende accessibile da qualsiasi browser.

---

## Funzionalità chiave

### Protocolli di comunicazione

SWS si connette nativamente ai principali PLC e sistemi di automazione industriale:

| Protocollo | Descrizione |
|-----------|-------------|
| **Modbus TCP** | PLC con interfaccia Ethernet standard |
| **Modbus RTU** | PLC con porta seriale RS-485/RS-232 |
| **OPC-UA client** | Standard IEC 62541; client con subscribe/write/browse, security policy Basic256Sha256 |
| **OPC-UA server** | Espone i tag SWS come nodi OPC-UA (per integrazione con altri sistemi) |
| **MQTT / Sparkplug B** | IoT broker; encode/decode Sparkplug B (NBIRTH, NDATA, NCMD write-back) |
| **HomeAssistant** | WebSocket nativo HA (state_changed + call_service) |
| **Siemens S7** | DB/M/I/Q areas, tipi BOOL/BYTE/INT/WORD/DINT/REAL |
| **EtherNet/IP** | ControlLogix symbolic tag access (rseip) |

### Editor WYSIWYG

L'editor grafico permette di creare sinottici industriali senza scrivere codice:

- Drag-and-drop di oggetti dal pannello laterale
- Binding live tra oggetti e tag PLC
- Undo/redo fino a 200 passi
- Simboli SVG industriali integrati (22 built-in + upload custom)
- Faceplate per motori, valvole, serbatoi
- Widget avanzati: bar chart, pie chart, sparkline, text list, alarm viewer
- Pipe/tubazioni multi-waypoint con animazione di flusso

### Allarmi (ISA-18.2)

Il sistema di allarmi segue lo standard ISA-18.2:

- 4 stati: Normal → Unacknowledged → Acknowledged → Shelved
- Condizioni multi-variabili con delay e inhibit
- Shelving configurabile per zone operative
- Notifiche SMTP con escalation
- Webhook per integrazione con sistemi esterni
- Alarm banner sempre visibile nell'interfaccia operatore

### Historian e Trend

- Ring buffer in memoria + persistenza SQLite per ogni progetto
- Campionamento su deadband, on-change o periodico
- Visualizzatore trend interattivo con pan/zoom
- Export CSV per analisi offline
- API historian per integrazione con dashboard esterne (Grafana, ecc.)

### Autenticazione e controllo accessi

- **4 ruoli**: Admin, Supervisor, Operator, Viewer
- **ABAC per zona**: ogni sinottico può avere requisiti di accesso differenti
- Password hash Argon2id (nessuna password in chiaro mai)
- TTL sessione configurabile per utente
- Audit log append-only con struttura a catena

### GitOps integrato

Ogni progetto è una cartella di file YAML versionabile con Git:

- Commit e push del progetto direttamente dall'IDE
- Pull e rollback a versione precedente
- Fingerprint SHA256 per verifica integrità tra dispositivi
- Dashboard multi-device: stato, versione e fingerprint di ogni runtime

---

## Architettura ad alto livello

```
┌─────────────────────────────────────────────────────────┐
│  Browser (qualsiasi dispositivo in rete)                │
│                                                         │
│  ┌──────────────────┐   ┌───────────────────────────┐  │
│  │  Admin IDE       │   │  Viewer operatori         │  │
│  │  porta 8444      │   │  porta 8443               │  │
│  │  (ingegneria)    │   │  (sala controllo)         │  │
│  └────────┬─────────┘   └──────────────┬────────────┘  │
│           │ HTTPS REST / WSS           │               │
└───────────┼────────────────────────────┼───────────────┘
            │                            │
┌───────────┴────────────────────────────┴───────────────┐
│              sws-runtime (binario Rust)                 │
│                                                         │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │  Tag Engine │  │  sws-auth  │  │  sws-historian  │  │
│  │  (in-mem DB)│  │  RBAC+ABAC │  │  SQLite         │  │
│  └──────┬──────┘  └────────────┘  └─────────────────┘  │
│         │  plugin crates                                │
│  ┌──────┴──────────────────────────────────────────┐   │
│  │  Modbus │ OPC-UA │ MQTT │ S7 │ EtherNet/IP │ HA │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
            │
┌───────────┴────────────────────────────────────────────┐
│              Hardware industriale                       │
│  PLC Modbus │ Server OPC-UA │ Broker MQTT │ Siemens S7 │
└─────────────────────────────────────────────────────────┘
```

### Dual-port by design

SWS avvia **due server distinti** sullo stesso binario:

| Porta | Ruolo | SPA servita |
|-------|-------|-------------|
| **8443** | Viewer operatori | RuntimeViewer — 597 kB, 187 kB compressi |
| **8444** | Admin IDE | Editor completo — 874 kB, 249 kB compressi |

*(Misure del 2026-09-06, contando quello che il browser scarica davvero all'apertura. L'editor
carica a richiesta le parti che non servono subito: la Configurazione e l'editor Python con
CodeMirror, che da soli sarebbero altri 639 kB.)*

Questa separazione permette di esporre la porta 8443 agli operatori (pannelli HMI, browser kiosk) e di limitare la porta 8444 ai soli ingegneri autorizzati, anche con firewall differenti.

**HTTP di default, HTTPS opzionale.** Entrambe le porte partono in HTTP plain finché non si
carica o genera un certificato TLS (vedi [10 — Deployment](10_deployment.md)); la presenza del
certificato all'avvio commuta automaticamente in HTTPS. **Autenticazione opzionale**: senza
`users.yaml` il runtime è in *no-auth mode* (route aperte); creando utenti si attiva il login con
RBAC/ABAC. Per un device in campo abilitare sia TLS sia l'autenticazione.

---

## Piattaforme supportate

### Hardware di riferimento

| Hardware | Architettura | Deployment |
|----------|-------------|-----------|
| Rockchip PX30 | ARM64 | Binario nativo Yocto (percorso preferito) |
| Rockchip RK3399 | ARM64 | Binario nativo Yocto |
| Rockchip RK3588 | ARM64 | Binario nativo Yocto |
| PC Linux generici | x86_64 | Tarball `.tar.gz` + systemd |
| Container ARM64 | ARM64 | Docker/Podman Compose |

### Browser supportati

Qualsiasi browser moderno con supporto SVG e WebSocket:
- Chrome/Chromium 110+
- Firefox 110+
- Edge 110+
- Safari 16+ (con limitazioni per Web Crypto API)

---

## Stack tecnologico

### Runtime (Rust)

| Area | Libreria |
|------|---------|
| HTTP/WebSocket server | Axum + Tower + hyper-util |
| TLS | rustls + rcgen (no OpenSSL) |
| Async runtime | Tokio |
| Password hashing | Argon2 (Argon2id) |
| OPC-UA | async-opcua 0.18 |
| Modbus | tokio-modbus 0.6 |
| MQTT | rumqttc 0.24 |
| Sparkplug B | prost (Protobuf manuale) |
| Scripting Python | PyO3 0.23 + RestrictedPython |
| Historian | SQLite via rusqlite |
| Struttura log | tracing + JSON |
| Metriche | Prometheus via metrics crate |

### Editor (TypeScript + React)

| Area | Tecnologia |
|------|-----------|
| Framework UI | React 19 + TypeScript |
| Build | Vite 6 |
| State management | Zustand |
| Rendering grafico | SVG (sinottici interattivi) + Canvas 2D (trend) |
| Test E2E | Playwright |

---

## Licenza e governance

SWS è rilasciato sotto **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- Tutti i contributi richiedono `Signed-off-by:` (DCO)
- Repository pubblico: [github.com/soligolab/sws](https://github.com/soligolab/sws)
- Stato attuale: **Proof of Concept** — non per uso in produzione senza valutazione

---

← [Indice](MAIN.md) | [Successivo → Quick Start](02_quickstart.md)
