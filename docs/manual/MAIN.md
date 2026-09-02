# SWS — Manuale Utente

**Soligo Web SCADA** è una piattaforma SCADA open-source, web-based, progettata per hardware industriale embedded ARM64. Questo manuale copre installazione, configurazione, utilizzo operativo e deploy.

> **Versione documentata**: 2026.7.0 (PoC)
> **Licenza**: AGPL-3.0 — © Soligo Lab

---

## Indice

| # | Capitolo | Descrizione |
|---|----------|-------------|
| [01](01_overview.md) | **Panoramica** | Cos'è SWS, funzionalità chiave, architettura ad alto livello |
| [02](02_quickstart.md) | **Quick Start** | Installazione, primo avvio, accesso all'interfaccia |
| [03](03_architecture.md) | **Architettura** | Crate Rust, dual-port 8443/8444, stack tecnico |
| [04](04_editor_guide.md) | **Guida all'editor** | Editor WYSIWYG: toolbar, pannelli, workflow di progetto |
| [05](05_widget_reference.md) | **Riferimento widget** | Tutti gli oggetti canvas con proprietà e screenshot |
| [06](06_protocols.md) | **Protocolli** | Modbus, OPC-UA, MQTT/Sparkplug B, S7, EtherNet/IP, HomeAssistant |
| [07](07_alarms.md) | **Sistema allarmi** | ISA-18.2, stati, ACK, shelving, notifiche SMTP |
| [08](08_historian.md) | **Historian e Trend** | Ring buffer, SQLite, visualizzatore trend, export CSV |
| [09](09_auth_rbac.md) | **Autenticazione e ruoli** | Argon2id, 4 ruoli, ABAC per zona, TTL sessione |
| [10](10_deployment.md) | **Deployment** | Linux generico, Yocto cross-compile, container ARM64 |
| [11](11_packaging_deploy.md) | **Package builder** | Build tarball e deploy SSH dal IDE |
| [12](12_gitops.md) | **GitOps** | Commit, push, pull, rollback, fingerprint progetto |
| [13](13_api_reference.md) | **API Reference** | Endpoint REST e WebSocket |
| [14](14_testing.md) | **Test e diagnostica** | Smoke test, Playwright E2E, log remoti |
| [15](15_multilingua.md) | **Multilingua** | Lingua UI (IT/EN) + tabella lingue di progetto, token `{{chiave}}`, cambio lingua |

---

## Prerequisiti rapidi

| Scenario | Requisiti |
|----------|-----------|
| **Sviluppo locale** | Rust ≥ 1.75, Node 20, pnpm 9, Python 3.10+ |
| **Avvio rapido (container)** | Podman (rootless), vedi `deploy/container/install-container.sh` |
| **Deploy su device** | Linux ARM64 (Yocto o generico) oppure x86_64, systemd |

---

## Porte di default

Il runtime è **mono-progetto** (un solo processo `sws-runtime` serve viewer, IDE e plugin) e
parte in **HTTP** finché non si abilita il TLS da *Configurazione → Stato → Certificato TLS*.

| Porta | Ruolo | Avviata da |
|-------|-------|------------|
| `8443` | Viewer operatori (RuntimeViewer) | `start_runtime.sh` |
| `8444` | Admin IDE + API admin completa | `start_runtime.sh` |
| `8460` | IDE editor stand-alone (nessun viewer) | `start_editor.sh` su PC sviluppatore |
| `8080` / `8090` | Companion HTTP (accettazione certificato) | solo quando il TLS è attivo |

> **Autenticazione opzionale (PoC).** Un progetto senza `users.yaml` gira in **no-auth mode**:
> nessun login, tutte le route aperte. Si attivano utenti e ruoli creando account dal tab Utenti.
> Vedi [09 — Autenticazione e ruoli](09_auth_rbac.md).

---

## Link rapidi

- [Repo GitHub](https://github.com/soligolab/sws)
- [CHANGELOG](../../CHANGELOG.md) — cronologia delle modifiche
- [Decisioni architetturali](../adr/) — ADR
- [Domande aperte](../OPEN_QUESTIONS.md) — decisioni differite
- [Status sessione](../../STATUS.md) — stato corrente del PoC
