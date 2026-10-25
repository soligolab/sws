← [Indice](MAIN.md) | [← Autenticazione](09_auth_rbac.md) | [Successivo → Package Builder](11_packaging_deploy.md) →

---

# 10 — Deployment

> Come si installa e si aggiorna il runtime: container sui pannelli, tarball su Linux generico, binario Yocto, e il
> cloud. Per chi installa e mantiene i dispositivi. Il deploy **del progetto** su un runtime già installato è nel
> [capitolo 02](02_quickstart.md#3-abbina-il-pannello) e nel [capitolo 12](12_gitops.md#dispositivi-registrati).
>
> Misurato sul codice il 20-10-2026.

Questa guida descrive i quattro percorsi di deployment di SWS: il **container podman**, che è quello dei pannelli
(percorso C), Linux generico, Yocto per i device ARM64, e il **cloud** (percorso D).

---

## Percorso A — Generic Linux (x86_64 / ARM64)

Il percorso raccomandato per server Linux industriali generici con systemd.

### 1. Build del tarball

Dal repository, esegui lo script di packaging:

```bash
./scripts/package.sh
```

Questo produce `dist/sws-<versione>-linux-<arch>.tar.gz`: la versione la legge da `cargo metadata`
(`scripts/package.sh`), l'architettura da `uname -m`. Con la 2.14.0 su x86_64:
```
dist/sws-2.14.0-linux-x86_64.tar.gz
```

Flags opzionali:
```bash
./scripts/package.sh --no-rust   # salta la compilazione Rust (usa binario già compilato)
./scripts/package.sh --no-spa    # salta la build del frontend React
```

### 2. Trasferimento al target

```bash
scp dist/sws-2.14.0-linux-x86_64.tar.gz utente@192.168.1.10:/tmp/
```

### 3. Installazione

```bash
# Sul server target
cd /tmp
tar xzf sws-2.14.0-linux-x86_64.tar.gz
cd sws-2.14.0-linux-x86_64
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
curl -k https://localhost:7443/health
```

### 6. Accesso

| URL | Ruolo |
|-----|-------|
| `https://<ip>:7443` | Viewer operatori |
| `https://<ip>:7444` | Gestione remota (deploy, pull, backup, utenti) — **non l'IDE**, vedi sotto |

### L'IDE non c'è, sul dispositivo — e si può accendere

Dalla versione 2.4.0 tutti i pacchetti di installazione partono con **`--no-admin`**. La porta 7444
resta aperta, ma serve solo la gestione remota che l'editor sul PC chiama: deploy, pull, backup,
utenti, datastore — tutto autenticato. **Non c'è nessuna interfaccia da aprire nel browser, e il
progetto del dispositivo non si può modificare da lì.**

È voluto: un impianto in servizio non deve avere un editor completo raggiungibile in rete, e
`/api/script/exec` o `/api/fs/*` su un dispositivo di campo sono una superficie che non serve a
nessuno.

Per la messa in servizio o l'assistenza si riaccende, sul dispositivo:

```bash
sudo systemctl edit sws-runtime      # Environment=SWS_ENABLE_IDE=1
sudo systemctl restart sws-runtime
```

Da quel momento `https://<ip>:7444` serve l'IDE completo, e l'IDE mostra in testata il marcatore
**«Impianto in servizio»**: quello che si modifica è il progetto vero, e il salvataggio ne ricarica
sorgenti e allarmi senza riavvio. Finita l'assistenza, si toglie la variabile e si riavvia.

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
└── …                        lo storico sta in ogni progetto: projects/<progetto>/history/historian.db
```

### Porte su device Yocto

```
https://<device-ip>:7443   → Viewer operatori
https://<device-ip>:7444   → Gestione remota (deploy/pull/backup/utenti)
                             L'IDE completo solo con SWS_ENABLE_IDE=1
```

**Raccomandazione**: non esporre la porta 7444 agli operatori in produzione.
Usa firewall o VPN per limitare l'accesso alla porta 7444 — vale anche senza IDE,
perché da lì passano deploy e gestione utenti.

---

## Percorso C — Container podman

Un solo container — il runtime, che serve anche la SPA — installato come servizio systemd
**senza `sudo`** (podman rootless + quadlet). È **il percorso dei pannelli** (TC620, WP630) e di qualunque device
con podman: si aggiorna dall'IDE e non chiede un SDK. Il funzionamento interno — cartelle, aggiornamento, viewer
LVGL — è nel [capitolo 18, §1-2](18_container_e_comunicazione.md#1-comè-fatta-limmagine).

### Installazione

```bash
# sul dispositivo
./deploy/container/install-container.sh --pull
```

Lo script riconosce l'architettura da `uname -m` e scarica l'immagine corrispondente. Per un
device senza accesso al registry, la stessa installazione si spinge **dall'IDE via SSH**
(*Configurazione → Istanza → Device → Installazione*), che copia un archivio invece di
scaricarlo — oppure a mano con `--image <archivio.tar.gz>`.

### Immagini pubblicate

Non esiste un tag `latest` senza suffisso: l'architettura fa parte del nome, perché scaricare
l'immagine sbagliata è un errore che si scopre solo all'avvio.

| Tag | Per chi |
|-----|---------|
| `ghcr.io/soligolab/sws-runtime:latest-arm64` | **qualunque** dispositivo aarch64: pannelli Pixsys (PX30, RK3399, RK3588) e board generiche (Raspberry Pi, Jetson, VM cloud) |
| `ghcr.io/soligolab/sws-runtime:latest-arm64-generic` | alias del precedente, per i dispositivi installati con quel riferimento |
| `ghcr.io/soligolab/sws-runtime:latest-amd64` | host x86_64 |
| `rc-arm64`, `rc-amd64` | il canale di prova: lo spostano le `-rc` e le release |
| `<versione>-arm64`, `<versione>-amd64` (es. `2.14.0-arm64`) | per inchiodare una versione |
| `<commit>-arm64`, `<commit>-amd64` | l'immagine di un commit preciso |

Una release sposta `latest-*` e `rc-*`; una `-rc` sposta solo `rc-*` (`scripts/build_container.sh`,
`scripts/build_container_x86_64.sh`).

Dal 2026-09-10 (Q53) **l'immagine aarch64 è una sola**: il binario si cross-compila da x86_64 in
un container Ubuntu, ottimizzato, senza SDK Pixsys e senza QEMU. Prima erano due — una con l'SDK,
una compilata sotto emulazione e non ottimizzata — e i due percorsi sono stati rimossi il
14-09-2026.

Costruzione e pubblicazione: `scripts/build_container.sh`,
`scripts/build_container_x86_64.sh` (`--push` per pubblicare), oppure
`scripts/build_containers_all.sh` per entrambe. Non è un passo di CI: la pubblicazione è manuale
dalla macchina di sviluppo.

### Note container

- Dati persistenti in `/data/user/sws/{projects,config,logs}`, montati nel container.
- Porte: **7443** viewer operatori, **7444** gestione remota (`--no-admin`, nessun IDE) — come nel deploy nativo.
- Un pannello senza utenti è **chiuso** e mostra un codice di abbinamento, che `install-container.sh` stampa
  alla fine: vedi [capitolo 09](09_auth_rbac.md#1-un-pannello-nuovo-è-chiuso-labbinamento).
  `SWS_ADMIN_PASSWORD`, se impostata, crea un Admin al primo avvio.
- Il runtime parte in **HTTP**; il TLS si abilita generando o caricando un certificato dall'IDE
  (*Configurazione → Sicurezza → Certificati*), salvato in `config/` e riusato ai riavvii.
- Procedura completa, aggiornamento e diagnosi: `docs/DEPLOY_CONTAINER_AARCH64.md` e
  `docs/DEPLOY_CONTAINER_X86_64.md`.

> Fino al 2026-09-02 qui c'era un percorso `docker compose` con due container. È stato rimosso
> perché non partiva: l'immagine non passava `--viewer-port`, quindi nessuno era in ascolto sulla
> porta pubblicata, e il servizio chiamato `editor` serviva il bundle del *viewer*. Si recupera
> dalla history di git.

### Kiosk mode (avvio automatico browser)

Per pannelli industriali che devono avviarsi automaticamente alla pagina del sinottico:

```bash
./scripts/kiosk.sh --url https://localhost:7443 --fullscreen
```

Richiede GTK4 + WebKitGTK sul sistema host. Sui pannelli Pixsys lo schermo è Chromium in kiosk o il viewer LVGL:
vedi [capitolo 18, §2.2](18_container_e_comunicazione.md#22-lo-schermo-chromium-o-lvgl).

---

## Percorso D — Il cloud

La stessa immagine, sul VPS, fa da **gateway** davanti ai progetti e apre un **container per ogni progetto**;
Traefik fa il TLS con Let's Encrypt, e i pannelli si fanno raggiungere con un **tunnel** uscente. Non si installa
niente su un pannello per questo: dall'11-10-2026 un pannello non abbinato chiama da solo il gateway dell'immagine e
si abbina col codice dall'IDE nel cloud.

Il VPS, i quadlet, il gateway, i container di progetto e il tunnel sono descritti nel
[capitolo 18, §3](18_container_e_comunicazione.md#3-nel-cloud) e §5.3; i file stanno in `deploy/vps/`.

---

## Riepilogo percorsi

| Criterio | Container | Generic Linux | Yocto | Cloud |
|----------|-----------|-------------|-------|-------|
| Setup | install-container.sh --pull | Tarball + install.sh | Cross-compile | quadlet in `deploy/vps/` |
| Aggiornamenti | dall'IDE, o pull della nuova immagine | Nuovo tarball | Script deploy.sh | nuova immagine e riavvio del gateway |
| Dipendenze target | podman + systemd (rootless) | systemd, libssl | Yocto SDK | podman, Traefik |
| Raccomandato per | pannelli TC620/WP630, qualunque host con podman | server senza podman | PX30, RK3399, RK3588 | IDE condiviso e pannelli dietro NAT |

---

## Gestione certificati TLS (opzionale)

SWS parte in **HTTP plain** di default — nessun certificato, primo accesso diretto su
`http://<host>:7444`. Il TLS è **opt-in**: si attiva quando esiste `tls.crt` nella directory
config. Le directory config per ambiente:
- **Dev**: `.run/config/`
- **Produzione (generic)**: `/var/lib/sws/config/`
- **Yocto**: `/data/user/sws/config/`

> ⚠️ In modalità HTTP il login e il pannello admin viaggiano in chiaro. Per i device in campo /
> reti non fidate si raccomanda di **attivare il TLS**.

Attivazione dall'IDE — **Configurazione → Sicurezza → Certificati** (solo Admin):
- **Genera self-signed** — crea `tls.crt`+`tls.key` (SAN: localhost, 127.0.0.1, IP LAN) e riavvia in HTTPS.
- **Carica cert+key** — carica un certificato firmato da una CA (PEM, validato lato server) e riavvia in HTTPS.
- **Disabilita TLS** — rimuove i file e torna in HTTP.

In alternativa (es. provisioning automatico) si possono copiare manualmente `tls.crt` e `tls.key`
nella directory config e riavviare il runtime. Una volta attivo, il browser deve accettare il
self-signed una sola volta per installazione.

---

← [Indice](MAIN.md) | [← Autenticazione](09_auth_rbac.md) | [Successivo → Package Builder](11_packaging_deploy.md) →
