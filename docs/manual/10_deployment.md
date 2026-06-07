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
dist/sws-0.1.0-dev-linux-x86_64.tar.gz   (su x86_64)
dist/sws-0.1.0-dev-linux-aarch64.tar.gz   (su ARM64)
```

Flags opzionali:
```bash
./scripts/package.sh --no-rust   # salta la compilazione Rust (usa binario già compilato)
./scripts/package.sh --no-spa    # salta la build del frontend React
```

### 2. Trasferimento al target

```bash
scp dist/sws-0.1.0-dev-linux-x86_64.tar.gz utente@192.168.1.10:/tmp/
```

### 3. Installazione

```bash
# Sul server target
cd /tmp
tar xzf sws-0.1.0-dev-linux-x86_64.tar.gz
cd sws-0.1.0-dev-linux-x86_64
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

## Percorso C — Container Docker/Podman

Il percorso più veloce per valutazione e ambienti senza build environment.

### Avvio rapido

```bash
git clone https://github.com/soligolab/sws.git
cd sws

export SWS_ADMIN_PASSWORD=cambiami
docker compose up
```

### docker-compose.yml (estratto)

```yaml
services:
  sws-runtime:
    image: ghcr.io/soligolab/sws-runtime:latest
    ports:
      - "8443:8443"   # viewer operatori
      - "8444:8444"   # admin IDE
    environment:
      - SWS_ADMIN_PASSWORD=${SWS_ADMIN_PASSWORD}
    volumes:
      - sws-data:/var/lib/sws   # progetti e certificati persistenti

volumes:
  sws-data:
```

### Note container

- Immagine base: `debian:bookworm-slim`
- Architetture: `linux/arm64`, `linux/amd64` (multi-arch manifest)
- Certificato TLS auto-generato al primo avvio, persistente nel volume `sws-data`

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
| Setup | Tarball + install.sh | Cross-compile | Docker Compose |
| Aggiornamenti | Nuovo tarball | Script deploy.sh | Pull nuova immagine |
| Dipendenze target | systemd, libssl | Yocto SDK | Docker/Podman |
| Performance | Nativa | Nativa (ottimizzata) | Overhead minimo |
| Raccomandato per | Server x86, ARM64 generico | PX30, RK3399, RK3588 | Dev, valutazione |

---

## Gestione certificati TLS

SWS genera automaticamente certificati self-signed:
- **Dev**: `.run/config/tls.crt` + `.run/config/tls.key`
- **Produzione (generic)**: `/var/lib/sws/config/tls.crt` + `tls.key`
- **Yocto**: `/data/user/sws/config/tls.crt` + `tls.key`

I certificati vengono generati al primo avvio e **riutilizzati** nei restart successivi.
Il browser deve accettarli una sola volta per installazione.

Per usare un certificato firmato da una CA:
1. Sostituisci `tls.crt` e `tls.key` nella directory config
2. Riavvia il runtime

---

← [Indice](MAIN.md) | [← Autenticazione](09_auth_rbac.md) | [Successivo → Package Builder](11_packaging_deploy.md) →
