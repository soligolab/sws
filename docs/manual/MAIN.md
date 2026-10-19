# SWS — Manuale Utente

**Soligo Web SCADA** è una piattaforma SCADA open-source, web-based, progettata per hardware industriale embedded ARM64. Questo manuale copre installazione, configurazione, utilizzo operativo e deploy.

> **Licenza**: AGPL-3.0 — © Soligo Lab
>
> Ogni capitolo dice in testa per chi è e quando è stato misurato sul codice: è quel timbro, non un numero di
> versione qui, a dire quanto è aggiornato.

---

## Indice

| # | Capitolo | Descrizione |
|---|----------|-------------|
| [01](01_overview.md) | **Panoramica** | Cos'è SWS, funzionalità chiave, architettura ad alto livello |
| [02](02_quickstart.md) | **Quick Start** | Installazione, primo avvio, accesso all'interfaccia |
| [03](03_architecture.md) | **Architettura** | I 18 crate Rust, le porte di un runtime, il flusso dei dati, la forma del progetto, la SPA |
| [04](04_editor_guide.md) | **Guida all'editor** | Editor WYSIWYG: toolbar, pannelli, workflow di progetto |
| [05](05_widget_reference.md) | **Riferimento widget** | Tutti gli oggetti canvas con proprietà e screenshot |
| [06](06_protocols.md) | **Protocolli** | Modbus, OPC-UA, MQTT/Sparkplug B, S7, EtherNet/IP, HomeAssistant |
| [07](07_alarms.md) | **Sistema allarmi** | ISA-18.2, stati, ACK, shelving, notifiche SMTP |
| [08](08_historian.md) | **Historian e Trend** | Ring buffer, SQLite, visualizzatore trend, export CSV |
| [09](09_auth_rbac.md) | **Autenticazione e ruoli** | Abbinamento del pannello, utenti del progetto e dell'installazione, Argon2id, 4 ruoli, zone, aziende e console |
| [10](10_deployment.md) | **Deployment** | Linux generico, Yocto cross-compile, container ARM64 |
| [11](11_packaging_deploy.md) | **Package builder** | Build tarball e deploy SSH dal IDE |
| [12](12_gitops.md) | **GitOps** | Commit, push, pull, rollback, fingerprint progetto |
| [13](13_api_reference.md) | **API Reference** | Endpoint REST e WebSocket |
| [14](14_testing.md) | **Test e diagnostica** | Smoke test, Playwright E2E, log remoti |
| [15](15_multilingua.md) | **Multilingua** | Lingua UI (IT/EN) + tabella lingue di progetto, token `{{chiave}}`, cambio lingua |
| [16](16_prestazioni.md) | **Prestazioni misurate** | Tag, client, latenza, CPU e memoria su TC620 e x86; come rifare la misura |
| [17](17_sicurezza.md) | **Sicurezza** | Contatti e segnalazioni, protezioni attive per default (accesso, CSP, limiti, aggiornamenti), cosa manca ancora, cosa fare a mano |
| [18](18_container_e_comunicazione.md) | **Container e comunicazione** | L'immagine sws-runtime nei suoi tre ruoli (pannello, gateway, container di progetto), porte, flussi, tunnel, identità e token, TLS, variabili, diagnosi |

---

## Prerequisiti e porte

| Scenario | Requisiti |
|----------|-----------|
| **Sviluppo locale** | Rust ≥ 1.88, Node 22, pnpm 9, Python 3 con gli header (`python3-dev`, per PyO3) |
| **Pannello o server** | Podman rootless e systemd, Linux ARM64 o x86_64 — vedi `deploy/container/install-container.sh` |

Le porte (8443 viewer, 8444 gestione, 8080 per il certificato, 8460/8090 per l'IDE su un PC, 443 nel cloud), cosa
aprire sul firewall di un impianto e chi parla con chi sono nel
[capitolo 18, §4](18_container_e_comunicazione.md#4-le-porte).

> **Non esiste un'istanza aperta a tutti.** Un pannello senza utenti è **chiuso** e mostra un
> codice di abbinamento; un'IDE appena installata stampa all'avvio un codice di primo accesso.
> Vedi [09 — Autenticazione e ruoli](09_auth_rbac.md).

---

## Link rapidi

- [Repo GitHub](https://github.com/soligolab/sws)
- [CHANGELOG](../../CHANGELOG.md) — cronologia delle modifiche
- [Decisioni architetturali](../adr/) — ADR
- [Piani](../plans/README.md) — il lavoro in corso e le decisioni ancora da prendere
- [Domande aperte](../OPEN_QUESTIONS.md) — l'indice storico, congelato dal 18-09-2026
- [Status sessione](../../STATUS.md) — stato corrente del PoC
