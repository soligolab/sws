← [Indice](MAIN.md) | [← Deployment](10_deployment.md) | [Successivo → GitOps](12_gitops.md) →

---

# 11 — Package Builder e SSH Deploy

L'IDE include uno strumento integrato per costruire il pacchetto runtime e
distribuirlo direttamente su device remoti via SSH — senza uscire dal browser.

Disponibile in: **Configurazione → Runtime** (connesso come Admin).

---

## Sezione "Pacchetto Runtime"

![Package builder](screenshots/10_package_builder.png)

Questa sezione appare nella tab **Runtime** della Configurazione
quando l'IDE è connesso a un runtime che ha `scripts/package.sh` disponibile.

### Prerequisiti

Il runtime deve essere avviato dalla **root del repository** (non da un device già deployato):

```bash
cd /path/to/sws
./scripts/dev.sh both
```

Se il runtime è avviato da un device Yocto o da `/opt/sws/`, il package builder
non è disponibile (il messaggio lo indica).

---

## Build del tarball

### Dalla UI

1. **Configurazione → Runtime** (assicurati di essere connesso)
2. Nella sezione **Pacchetto Runtime**, scegli le opzioni:
   - ✅ **Salta compilazione Rust** (usa binario già compilato)
   - ✅ **Salta build SPA** (usa frontend già compilato)
3. Click **🔨 Build pacchetto**
4. Il log di build appare in tempo reale (streaming chunked)
5. Al termine: `DONE` → il tarball è in `dist/`

### Dalla riga di comando

```bash
./scripts/package.sh                    # build completo (~5 min)
./scripts/package.sh --no-rust          # salta cargo build
./scripts/package.sh --no-spa           # salta pnpm build
./scripts/package.sh --no-rust --no-spa # solo impacchetta
```

Output: `dist/sws-0.1.0-dev-linux-x86_64.tar.gz`

---

## Lista pacchetti disponibili

Dopo la build, la sezione mostra i tarball presenti in `dist/`:

| Colonna | Descrizione |
|---------|-------------|
| Nome | `sws-<versione>-linux-<arch>.tar.gz` |
| Dimensione | In MB |
| Data | Timestamp di creazione |

Click su un tarball per selezionarlo come target del deploy.

---

## Deploy SSH su device

### Dalla UI

Con un tarball selezionato, compila il form **Installa su dispositivo**:

| Campo | Descrizione | Default |
|-------|-------------|---------|
| **Host / IP** | Indirizzo del device target | — |
| **Porta SSH** | Porta SSH del device | `22` |
| **Utente** | Username SSH | — |
| **Password** | Password SSH (via sshpass) | — |
| **Directory remota** | Percorso estrazione tarball | `/tmp/sws-deploy` |

Click **📦 Deploy su device**.

### Passi automatici del deploy

Il sistema esegue in sequenza, con log in streaming:

```
==> SCP: dist/sws-0.1.0-dev-linux-x86_64.tar.gz → user@192.168.1.10:/tmp/sws-deploy/
==> SCP completato
==> Estrazione tarball...
==> Installazione (install.sh)...
==> Health check...
==> Health check: OK
DONE
```

1. **SCP upload** — copia il tarball nel `remote_dir` del device
2. **Estrazione** — `mkdir -p <dir> && tar xzf <tarball> -C <dir>`
3. **Install** — `chmod +x install.sh && sudo ./install.sh`
4. **Health check** — `sleep 3 && curl -sk https://localhost:8443/health`

### Sicurezza

- Il percorso remoto è validato: deve essere assoluto, senza `..`, solo caratteri `[a-zA-Z0-9\-_./]`
- Il nome del tarball è validato: solo basename, deve terminare con `.tar.gz`
- Il tarball deve esistere nella directory `dist/` del repo (symlink escape prevenuto con `canonicalize()`)
- La password SSH è passata via `sshpass` — mai interpolata nella shell

### Nota su sshpass

`sshpass` deve essere installato sul sistema che esegue il runtime:

```bash
# Ubuntu/Debian
sudo apt install sshpass

# Fedora/RHEL
sudo dnf install sshpass
```

Se `sshpass` non è disponibile, il deploy usa SSH senza password
(richiede chiave SSH pre-configurata sul device).

---

## Alternativa: deploy manuale

Se preferisci non usare la UI, il deploy manuale è sempre disponibile:

```bash
# 1. Build
./scripts/package.sh

# 2. SCP
scp dist/sws-0.1.0-dev-linux-x86_64.tar.gz utente@device:/tmp/

# 3. SSH + install
ssh utente@device "
  cd /tmp
  tar xzf sws-0.1.0-dev-linux-x86_64.tar.gz
  cd sws-0.1.0-dev-linux-x86_64
  sudo ./install.sh
"

# 4. Health check
curl -k https://device:8443/health
```

---

← [Indice](MAIN.md) | [← Deployment](10_deployment.md) | [Successivo → GitOps](12_gitops.md) →
