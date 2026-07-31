← [Indice](MAIN.md) | [← Panoramica](01_overview.md) | [Successivo → Architettura](03_architecture.md) →

---

# 02 — Quick Start

Questa guida ti porta dall'installazione alla prima schermata operativa in pochi minuti.
Scegli il percorso più adatto alla tua situazione.

> **Nota PoC.** Di default il runtime parte in **HTTP** (nessun certificato) e in **no-auth
> mode** (nessun login). Per un device in campo abilita TLS e crea degli utenti — vedi
> [09 — Autenticazione e ruoli](09_auth_rbac.md) e [10 — Deployment](10_deployment.md).

---

## Percorso A — Runtime sul dispositivo (consigliato)

Un solo comando: compila il backend, ricostruisce la SPA se necessario, avvia il runtime e
riapre l'ultimo progetto attivo.

### Prerequisiti

| Strumento | Versione minima | Installazione |
|-----------|----------------|---------------|
| Rust | 1.75 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20 | [nodejs.org/download](https://nodejs.org/en/download) |
| pnpm | 9 | `npm install -g pnpm` |
| Python | 3.10+ | Normalmente già installato su Linux |

> Su Ubuntu 22.04+: `apt install libssl-dev pkg-config` per la compilazione Rust.

### Avvio

```bash
git clone https://github.com/soligolab/sws.git
cd sws

# Installa le dipendenze frontend (solo la prima volta)
cd sws-editor && pnpm install && cd ..

# Avvia il runtime: viewer 8443 + IDE/admin 8444 (+ companion HTTP 8080)
./scripts/start_runtime.sh
```

Lo script `start_runtime.sh`:
1. Compila il runtime Rust (`cargo build -j 1`; ~3 min al primo avvio)
2. Ricostruisce `sws-editor/dist/` se manca o è più vecchio dei sorgenti
3. Avvia il runtime sulle porte 8443 (viewer) e 8444 (IDE/admin)
4. Riapre automaticamente l'ultimo progetto attivo (mono-progetto)
5. Stampa gli URL di accesso e l'IP LAN nel terminale

### Accesso

| URL | Ruolo |
|-----|-------|
| `http://localhost:8444` | Admin IDE (editor) |
| `http://localhost:8443` | Viewer operatori |

In no-auth mode non serve alcuna credenziale: apri l'IDE e inizia. Quando il TLS è attivo gli URL
diventano `https://` e al primo accesso il browser chiede di accettare il certificato self-signed
— apri prima `http://localhost:8080` (companion) per accettarlo senza uscire dall'app.

![Prima schermata dell'IDE](screenshots/01_login.png)

---

## Percorso B — Solo editor su PC sviluppatore

Per lavorare al progetto da un PC e poi deployarlo su un runtime remoto in rete:

```bash
./scripts/start_editor.sh        # IDE su http://localhost:8460 (nessun viewer)
```

Poi, dall'IDE: *Configurazione → Runtime → Connetti*, inserisci l'URL del runtime remoto
(es. `https://192.168.1.50:8444`) e usa **Deploy** per inviare il progetto. Vedi
[12 — GitOps](12_gitops.md) e [11 — Package builder](11_packaging_deploy.md).

---

## Percorso C — Container (legacy)

Il file [`compose.yaml`](../../compose.yaml) avvia runtime + editor in container. **Attenzione**:
questo percorso precede il no-auth mode e richiede ancora `SWS_ADMIN_PASSWORD`.

```bash
SWS_ADMIN_PASSWORD=cambiami docker compose up
```

---

## Orientamento nell'interfaccia

### Admin IDE (porta 8444, oppure 8460 per il solo editor)

L'header in alto commuta tra **due modalità**:

**Editor** — costruzione del sinottico:
- Pannello sinistro: palette oggetti (widget da trascinare sul canvas)
- Canvas centrale: il sinottico in costruzione
- Pannello destro: proprietà dell'oggetto selezionato
- Header: salva (Ctrl+S), undo/redo, zoom, griglia, menu ☰

**Configurazione** — tag, protocolli, allarmi, utenti, runtime:
vedi la sezione successiva.

![Editor principale](screenshots/02_editor_main.png)

### Configurazione

Tab disponibili (Admin): **Variabili** (tag), **Protocolli**, **Allarmi**, **Script**,
**Faceplates**, **Ricette**, **Notifiche**, **Datastore**, **Utenti**, **Risorse**, **Backup**,
**Stato** (TLS, sistema), **Device** (dashboard multi-runtime), **Runtime** (connessione remota,
log, package builder).

### Viewer operatori (porta 8443)

Vista in sola lettura per la sala controllo:
- Nessun accesso all'editor
- Valori live via WebSocket, alarm banner sempre visibile
- Ottimizzato per touchscreen e pannelli HMI

---

## Creare il primo progetto

Se non esiste ancora un progetto, l'IDE mostra la **schermata di benvenuto**: dai un nome al
progetto (eventualmente partendo da un template di esempio in `examples/templates/`) e aprilo.

Per aggiungere un valore live al sinottico:

1. In modalità **Editor**, apri il gruppo **Display** nella palette sinistra
2. Clicca **Valore** per aggiungerlo al canvas
3. Nel pannello proprietà a destra imposta **Tag** → un tag esistente
4. **Salva** (`Ctrl+S`)
5. Apri il **Viewer** (porta 8443): il valore si aggiorna in tempo reale

---

## Smoke test da riga di comando

Con il runtime in HTTP (default) ometti `-k` e usa `http://`; con TLS attivo usa `https://` + `-k`:

```bash
# Health check (porta viewer)
curl http://localhost:8443/health
# → {"status":"ok","version":"2026.7.0"}

# Elenco tag (porta viewer, no-auth)
curl http://localhost:8443/api/tags

# Scrivi un valore su un tag
curl -X PUT http://localhost:8443/api/tags/<tag-id> \
  -H 'Content-Type: application/json' \
  -d '{"value": 99}'

# Allarmi attivi
curl http://localhost:8443/api/alarms
```

---

## Arrestare e ripartire

`Ctrl-C` nel terminale ferma il runtime. Lo stato persistente vive in `.run/` (runtime) o
`.run-editor/` (editor):

```
.run/
├── config/     # tls.crt + tls.key (solo se il TLS è stato attivato dall'IDE)
├── projects/   # un progetto per sottodirectory (project.yaml + synoptics/)
└── logs/       # runtime-YYYY-MM-DD.jsonl
```

Per ricominciare da zero: `rm -rf .run && ./scripts/start_runtime.sh`.

---

## Prossimi passi

- [03 — Architettura](03_architecture.md): come funziona internamente SWS
- [04 — Guida all'editor](04_editor_guide.md): creare sinottici professionali
- [06 — Protocolli](06_protocols.md): collegare SWS a PLC reali

---

← [Indice](MAIN.md) | [← Panoramica](01_overview.md) | [Successivo → Architettura](03_architecture.md) →
