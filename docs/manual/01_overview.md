← [Indice](MAIN.md) | [Successivo → Quick Start](02_quickstart.md)

---

# 01 — Panoramica di SWS

> Cos'è SWS e cosa sa fare, in una pagina, per chi lo incontra per la prima volta. I dettagli stanno nei capitoli
> a cui rimanda ogni sezione.
>
> Misurato sul codice il 19-10-2026.

---

**Soligo Web SCADA (SWS)** è una piattaforma SCADA open-source, completamente web-based, progettata per hardware industriale embedded ARM64. Sostituisce gli SCADA tradizionali che richiedono workstation Windows con un approccio moderno: un singolo binario Rust in un container, un browser (o lo schermo LVGL del pannello) come client, progetti in YAML versionati con Git.

---

## Cos'è uno SCADA

Un sistema SCADA (Supervisory Control and Data Acquisition) raccoglie dati da PLC e dispositivi di campo, li visualizza in tempo reale su sinottici grafici e consente agli operatori di inviare comandi. SWS porta questa funzionalità su hardware low-cost e la rende accessibile da qualsiasi browser.

---

## Funzionalità chiave

### Protocolli di comunicazione

SWS si connette nativamente ai principali PLC e sistemi di automazione industriale ([capitolo 06](06_protocols.md)):

| Protocollo | Descrizione |
|-----------|-------------|
| **Modbus TCP** | PLC con interfaccia Ethernet standard |
| **Modbus RTU** | PLC con porta seriale RS-485/RS-232 |
| **OPC-UA client** | Standard IEC 62541; client con subscribe/write/browse, security policy Basic256Sha256 |
| **OPC-UA server** | Espone i tag SWS come nodi OPC-UA (per integrazione con altri sistemi) |
| **MQTT / Sparkplug B** | IoT broker; encode/decode Sparkplug B (NBIRTH, NDATA, NCMD write-back) |
| **HomeAssistant** | WebSocket nativo HA (state_changed + call_service) |
| **Host** | Le risorse della macchina (CPU, RAM, temperature, disco, rete) come tag in sola lettura |
| **Siemens S7** | DB/M/I/Q areas, tipi BOOL/BYTE/INT/WORD/DINT/REAL |
| **EtherNet/IP** | ControlLogix symbolic tag access (rseip) |

### Editor WYSIWYG

L'editor grafico permette di creare sinottici industriali senza scrivere codice:

- Drag-and-drop di oggetti dal pannello laterale
- Binding live tra oggetti e tag PLC
- Undo/redo fino a 200 passi
- 39 tipi di oggetto, dal rettangolo al trend, al registro dati e allo storico allarmi ([capitolo 05](05_widget_reference.md))
- 138 simboli SVG industriali integrati, più quelli caricati dall'utente
- Faceplate riusabili, cornici comuni alle pagine, pagine di boot
- Tubazioni con più punti e animazione di flusso
- Le stesse pagine sul web e sullo schermo LVGL del pannello

### Allarmi (ISA-18.2)

Il sistema di allarmi segue lo standard ISA-18.2:

- 4 stati ISA: normale, attivo non riconosciuto, attivo riconosciuto, rientrato non riconosciuto
- Soglie a più livelli, banda morta, ritardo di attivazione e di rientro, tag di inibizione
- Shelving a tempo dal visualizzatore allarmi
- Notifiche email con escalation, e Telegram
- Webhook: un POST HTTP verso `notify_url` all'attivazione
- Banner, campanella e visualizzatore come oggetti da mettere nelle pagine che servono ([capitolo 07](07_alarms.md))

### Historian e Trend

- Anello in memoria per tag + datastore su disco: SQLite per progetto, oppure PostgreSQL
- Solo i tag con `history: true`, con banda morta e intervallo minimo
- Trend interattivo con pan/zoom, sul web e su LVGL
- Export CSV, anche dall'IDE
- API dello storico per strumenti esterni ([capitolo 08](08_historian.md))

### Autenticazione e controllo accessi

- **Abbinamento**: un pannello nuovo è chiuso e mostra un codice, finché un IDE non lo rivendica
- **4 ruoli** degli utenti del progetto: Admin, Supervisor, Operator, Viewer
- **Zone**: ogni sinottico può avere requisiti di accesso differenti
- Utenti dell'installazione (chi apre l'IDE) separati da quelli del progetto
- Password hash Argon2id (nessuna password in chiaro mai)
- Durata della sessione configurabile per utente
- Audit log in sola aggiunta, a catena di hash ([capitolo 09](09_auth_rbac.md))

### GitOps integrato

Ogni progetto è una cartella di file YAML versionabile con Git:

- Commit e push del progetto direttamente dall'IDE
- Pull e rollback a versione precedente
- Fingerprint SHA256 per verifica integrità tra dispositivi
- Dashboard multi-device: stato, versione e fingerprint di ogni runtime ([capitolo 12](12_gitops.md))

---

## Architettura ad alto livello

```
┌─────────────────────────────────────────────────────────┐
│  Browser (qualsiasi dispositivo in rete)                │
│                                                         │
│  ┌──────────────────┐   ┌───────────────────────────┐  │
│  │  IDE             │   │  Viewer operatori         │  │
│  │  in LAN: 8444    │   │  porta 8443, o lo schermo │  │
│  │  nel cloud: 443  │   │  del pannello (LVGL/web)  │  │
│  └────────┬─────────┘   └──────────────┬────────────┘  │
│           │ HTTP(S) REST / WS(S)       │               │
└───────────┼────────────────────────────┼───────────────┘
            │                            │
┌───────────┴────────────────────────────┴───────────────┐
│              sws-runtime (binario Rust, container)      │
│                                                         │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │  Tag Engine │  │  sws-auth  │  │  sws-historian  │  │
│  │  (in-mem DB)│  │  ruoli+zone│  │  SQLite / PG    │  │
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

Sul pannello lo stesso runtime apre **due porte**: la 8443 per gli operatori, la 8444 per l'IDE, che lì è solo
un'API ristretta e autenticata. Nel cloud la stessa immagine fa da **gateway** davanti ai progetti, e il pannello
si fa raggiungere con un **tunnel** uscente, senza porte aperte in entrata. Le porte e i flussi stanno nel
[capitolo 18](18_container_e_comunicazione.md), i crate e il percorso dei dati nel [capitolo 03](03_architecture.md).

**Peso al caricamento** (build del 19-10-2026, i file che la pagina carica subito): viewer circa 945 kB, 310 kB
compressi; IDE circa 1,4 MB, 420 kB compressi. Il resto (Configurazione, editor Python con CodeMirror)
si carica quando serve.

**HTTP di default, HTTPS opzionale.** Le porte partono in HTTP finché non si carica o genera un certificato TLS
(vedi [10 — Deployment](10_deployment.md)); nel cloud il TLS lo fa Traefik. **Nessuna istanza è aperta a tutti**:
un pannello senza utenti è chiuso e mostra un codice di abbinamento, un IDE appena installato chiede un codice di
primo accesso (vedi [09 — Autenticazione e ruoli](09_auth_rbac.md)).

---

## Piattaforme supportate

### Hardware di riferimento

| Hardware | Architettura | Deployment |
|----------|-------------|-----------|
| Pannelli Pixsys TC620, WP630 | ARM64 | Container Podman (quadlet `sws-runtime.container`), il percorso principale |
| Rockchip PX30, RK3399, RK3588 | ARM64 | Binario nativo Yocto (`deploy/yocto/`) |
| PC o server Linux | x86_64 | Container Podman, oppure tarball `.tar.gz` + systemd |
| VPS cloud | x86_64 | Container Podman: gateway e container di progetto dietro Traefik |

### Browser supportati

Qualsiasi browser moderno con supporto SVG e WebSocket:
- Chrome/Chromium 110+
- Firefox 110+
- Edge 110+
- Safari 16+

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
| MQTT | rumqttc 0.25 |
| Sparkplug B | prost (Protobuf manuale) |
| Scripting Python | PyO3 0.29 + RestrictedPython |
| Historian | SQLite via rusqlite, PostgreSQL via tokio-postgres |
| Tunnel | yamux su WebSocket |
| Schermo del pannello | LVGL + SDL2 (`sws-lvgl-viewer`) |
| Struttura log | tracing + JSON |
| Metriche | Prometheus via metrics crate |

### Editor (TypeScript + React)

| Area | Tecnologia |
|------|-----------|
| Framework UI | React 19 + TypeScript |
| Build | Vite 6 |
| State management | Zustand |
| Rendering grafico | SVG (sinottici interattivi) + Canvas 2D (trend) |
| Editor Python | CodeMirror 6 |
| Test | Vitest (unità), Playwright (E2E) |

---

## Licenza e governance

SWS è rilasciato sotto **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- Tutti i contributi richiedono `Signed-off-by:` (DCO)
- Repository pubblico: [github.com/soligolab/sws](https://github.com/soligolab/sws)
- Stato attuale: **Proof of Concept**. Fabbricante, contatti di sicurezza, periodo di supporto e procedura di
  segnalazione sono nel [capitolo 17](17_sicurezza.md): prima di metterlo su un impianto, leggere
  [cosa manca ancora](17_sicurezza.md#cosa-manca-ancora)

---

← [Indice](MAIN.md) | [Successivo → Quick Start](02_quickstart.md)
