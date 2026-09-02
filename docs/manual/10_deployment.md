← [Indice](MAIN.md) | [← Autenticazione](09_auth_rbac.md) | [Successivo → Package Builder](11_packaging_deploy.md) →

---

# 10 — Deployment

Questa guida descrive i tre percorsi di deployment supportati da SWS:
generic Linux, Yocto cross-compile per device ARM64, e container Docker/Podman.

---

## Percorso A — Generic Linux (x86_64 / ARM64)

Il percorso raccomandato per server Linux industriali generici con systemd.

### 1. Build del tarball

Dal repository, esegui lo script di packaging:

```bash
./scripts/package.sh
```

Questo produce:
```
dist/sws-2026.7.0-linux-x86_64.tar.gz   (su x86_64)
dist/sws-2026.7.0-linux-aarch64.tar.gz   (su ARM64)
```

Flags opzionali:
```bash
./scripts/package.sh --no-rust   # salta la compilazione Rust (usa binario già compilato)
./scripts/package.sh --no-spa    # salta la build del frontend React
```

### 2. Trasferimento al target

```bash
scp dist/sws-2026.7.0-linux-x86_64.tar.gz utente@192.168.1.10:/tmp/
```

### 3. Installazione

```bash
# Sul server target
cd /tmp
tar xzf sws-2026.7.0-linux-x86_64.tar.gz
cd sws-2026.7.0-linux-x86_64
sudo ./install.sh
```

L'installer crea:

| Directory | Contenuto | Permessi |
|-----------|-----------|---------|
| `/opt/sws/` | Binario, asset web, template | Read-only dopo install |
| `/var/lib/sws/` | Progetti, certificati TLS, database | Scrivibile, persistente |
| `/etc/sws/runtime.env` | Credenziali e variabili d'ambiente | Solo root |
| `/etc/systemd/system/sws-runtime.service` | Unità systemd | — |

### 4. Configurazione credenziali

Modifica `/etc/sws/runtime.env`:

```bash
sudo nano /etc/sws/runtime.env
```

```env
SWS_ADMIN_PASSWORD=mia_password_sicura
# Opzionale — per sorgenti OPC-UA con password
SWS_OPCUA_PWD=password_opcua
# Opzionale — per integrazione HomeAssistant
HA_TOKEN=eyJhbGciOiJIUzI1NiI...
```

### 5. Avvio

```bash
sudo systemctl enable sws-runtime
sudo systemctl start sws-runtime

# Verifica
sudo systemctl status sws-runtime
curl -k https://localhost:8443/health
```

### 6. Accesso

| URL | Ruolo |
|-----|-------|
| `https://<ip>:8443` | Viewer operatori |
| `https://<ip>:8444` | Admin IDE |

### Aggiornamento

```bash
# Scarica nuovo tarball, poi:
tar xzf sws-<nuova-versione>-linux-x86_64.tar.gz
cd sws-<nuova-versione>-linux-x86_64
sudo ./install.sh   # aggiorna binario e asset, riavvia il servizio
```

### Disinstallazione

```bash
sudo ./install.sh --uninstall
# Dati in /var/lib/sws/ e /etc/sws/ NON vengono eliminati
# Per pulizia completa:
sudo rm -rf /var/lib/sws /etc/sws
```

---

## Percorso B — Yocto (PX30 / RK3399 / RK3588)

Il percorso preferito per i device Pixsys con Yocto Linux.
Produce un binario nativo `aarch64` senza container.

### Prerequisiti (una tantum sul dev server)

1. **Pixsys Yocto SDK** installato in `/usr/local/oecore-x86_64/`
2. **Target Rust**:
   ```bash
   rustup target add aarch64-unknown-linux-gnu
   ```
3. **pnpm** su `$PATH`
4. **Python 3** su `$PATH`

Verifica:
```bash
test -f /usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux && echo "SDK ok"
```

### Build

```bash
# Dall'root del repo
./scripts/yocto/build.sh             # release, con SPA embedded (default)
./scripts/yocto/build.sh --no-spa    # salta build frontend
./scripts/yocto/build.sh debug       # build debug senza --release
```

Output: `sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime`

### Deploy su device

```bash
# Chiedi al maintainer l'IP del device corrente
./scripts/yocto/deploy.sh <device-ip>
```

Lo script:
1. Copia il binario via SCP
2. Copia gli asset web
3. Riavvia il servizio systemd sul device

### Layout su device

```
/data/user/sws/
├── sws-runtime              Binario nativo aarch64
├── sws-runtime-launch.sh    Wrapper env + exec
├── runtime.env              Override per-device
├── config/                  Certificati TLS (persistenti)
├── projects/                Progetti operativi
├── templates/               Template bundled
├── www/                     SPA dist (viewer + admin)
└── historian.db             SQLite
```

### Porte su device Yocto

```
https://<device-ip>:8443   → Viewer operatori
https://<device-ip>:8444   → Admin IDE (solo per ingegneria)
```

**Raccomandazione**: non esporre la porta 8444 agli operatori in produzione.
Usa firewall o VPN per limitare l'accesso alla porta 8444.

---

## Percorso C — Container podman

Un solo container — il runtime, che serve anche la SPA — installato come servizio systemd
**senza `sudo`** (podman rootless + quadlet). Utile su un device che ha un runtime di container
ma non un SDK per compilare.

### Installazione

```bash
# sul dispositivo
./deploy/container/install-container.sh --pull
```

Lo script riconosce l'architettura da `uname -m` e scarica l'immagine corrispondente. Per un
device senza accesso al registry, la stessa installazione si spinge **dall'IDE via SSH**
(*Configurazione → Runtime → Installa su dispositivo*), che copia un archivio invece di
scaricarlo — oppure a mano con `--image <archivio.tar.gz>`.

### Immagini pubblicate

Non esiste un tag `latest` senza suffisso: l'architettura fa parte del nome, perché scaricare
l'immagine sbagliata è un errore che si scopre solo all'avvio.

| Tag | Per chi |
|-----|---------|
| `ghcr.io/soligolab/sws-runtime:latest-arm64` | device Pixsys aarch64 (binario dall'SDK Yocto) |
| `ghcr.io/soligolab/sws-runtime:latest-arm64-generic` | board ARM64 generiche (Raspberry Pi, Jetson, VM cloud) |
| `ghcr.io/soligolab/sws-runtime:latest-amd64` | host x86_64 |

Costruzione e pubblicazione: `scripts/build_container.sh`,
`scripts/build_container_aarch64_generic.sh`, `scripts/build_container_x86_64.sh`
(`--push` per pubblicare). Non è un passo di CI: l'immagine Pixsys contiene un binario
cross-compilato con l'SDK Yocto, che sui runner GitHub non esiste, quindi la pubblicazione è
manuale dalla macchina che ha l'SDK.

### Note container

- Dati persistenti in `/data/user/sws/{projects,config,logs}`, montati nel container.
- Porte: **8443** viewer operatori, **8444** admin IDE — come nel deploy nativo.
- Nessuna credenziale obbligatoria: parte in no-auth mode. `SWS_ADMIN_PASSWORD`, se impostata,
  seeda l'utente admin al primo avvio.
- Il runtime parte in **HTTP**; il TLS si abilita generando o caricando un certificato dall'IDE
  (*Configurazione → Stato → Certificato TLS*), salvato in `config/` e riusato ai riavvii.
- Procedura completa, aggiornamento e diagnosi: `docs/DEPLOY_CONTAINER_AARCH64.md` e
  `docs/DEPLOY_CONTAINER_X86_64.md`.

> Fino al 2026-09-02 qui c'era un percorso `docker compose` con due container. È stato rimosso
> perché non partiva: l'immagine non passava `--viewer-port`, quindi nessuno era in ascolto sulla
> porta pubblicata, e il servizio chiamato `editor` serviva il bundle del *viewer*. Si recupera
> dalla history di git.

### Kiosk mode (avvio automatico browser)

Per pannelli industriali che devono avviarsi automaticamente alla pagina del sinottico:

```bash
./scripts/kiosk.sh --url https://localhost:8443 --fullscreen
```

Richiede GTK4 + WebKitGTK sul sistema host.

---

## Riepilogo percorsi

| Criterio | Generic Linux | Yocto | Container |
|----------|-------------|-------|-----------|
| Setup | Tarball + install.sh | Cross-compile | install-container.sh --pull |
| Aggiornamenti | Nuovo tarball | Script deploy.sh | Pull nuova immagine |
| Dipendenze target | systemd, libssl | Yocto SDK | podman + systemd (rootless) |
| Performance | Nativa | Nativa (ottimizzata) | Overhead minimo |
| Raccomandato per | Server x86, ARM64 generico | PX30, RK3399, RK3588 | Dev, valutazione |

---

## Gestione certificati TLS (opzionale)

SWS parte in **HTTP plain** di default — nessun certificato, primo accesso diretto su
`http://<host>:8444`. Il TLS è **opt-in**: si attiva quando esiste `tls.crt` nella directory
config. Le directory config per ambiente:
- **Dev**: `.run/config/`
- **Produzione (generic)**: `/var/lib/sws/config/`
- **Yocto**: `/data/user/sws/config/`

> ⚠️ In modalità HTTP il login e il pannello admin viaggiano in chiaro. Per i device in campo /
> reti non fidate si raccomanda di **attivare il TLS**.

Attivazione dall'IDE — **Configurazione → Stato → Certificato TLS** (solo Admin):
- **Genera self-signed** — crea `tls.crt`+`tls.key` (SAN: localhost, 127.0.0.1, IP LAN) e riavvia in HTTPS.
- **Carica cert+key** — carica un certificato firmato da una CA (PEM, validato lato server) e riavvia in HTTPS.
- **Disabilita TLS** — rimuove i file e torna in HTTP.

In alternativa (es. provisioning automatico) si possono copiare manualmente `tls.crt` e `tls.key`
nella directory config e riavviare il runtime. Una volta attivo, il browser deve accettare il
self-signed una sola volta per installazione.

---

← [Indice](MAIN.md) | [← Autenticazione](09_auth_rbac.md) | [Successivo → Package Builder](11_packaging_deploy.md) →
