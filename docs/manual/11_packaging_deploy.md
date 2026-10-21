← [Indice](MAIN.md) | [← Deployment](10_deployment.md) | [Successivo → GitOps](12_gitops.md) →

---

# 11 — Package Builder e SSH Deploy

> Le schede dell'IDE che costruiscono il runtime e lo installano su un dispositivo via SSH, come binario o come
> container, e che poi gestiscono il container installato. Per chi mette in servizio i dispositivi. Qui si
> installa **il runtime**; il progetto ci arriva poi col deploy ([capitolo 12](12_gitops.md#dispositivi-registrati)).
>
> Misurato sul codice il 20-10-2026.

L'IDE include uno strumento integrato per costruire il pacchetto runtime e
distribuirlo direttamente su device remoti via SSH — senza uscire dal browser.

Disponibile in **Configurazione → Istanza** (solo Admin), in tre schede:

| Scheda | Cosa fa | Componente |
|---|---|---|
| **Sviluppatore → Pacchetto runtime** | costruisce il tarball e lo elenca; c'è solo se il runtime gira da un checkout del repo | `DevPackageTab.tsx` |
| **Device → Installazione** | installa su un dispositivo via SSH, come binario o come container | `InstallTab.tsx` |
| **Device → Container** | gestisce un container già installato: stato, avvio, boot, riavvio, pulizia immagini, disinstallazione | `ContainerTab.tsx` |

---

## Sezione "Pacchetto Runtime"

![Package builder](screenshots/10_package_builder.png)

Questa scheda (**Istanza → Sviluppatore → Pacchetto runtime**) appare solo quando il runtime gira da un checkout
del repo, con `scripts/package.sh` disponibile (`GET /api/build/stato`); altrimenti l'albero non la mostra.

### Prerequisiti

Il runtime deve essere avviato dalla **root del repository** (non da un device già deployato):

```bash
cd /path/to/sws
./scripts/start_runtime.sh
```

Se il runtime è avviato da un device Yocto, da `/opt/sws/` o da un container, il package builder non è
disponibile: il server risponde 503 (`packaging.rs`) e la scheda non compare.

---

## Build del tarball

### Dalla UI

1. **Configurazione → Istanza → Sviluppatore → Pacchetto runtime**
2. Scegli le opzioni:
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

Output: `dist/sws-<versione>-linux-<arch>.tar.gz` — la versione da `cargo metadata`, l'architettura da
`uname -m`; con la 2.14.0 su x86_64, `dist/sws-2.14.0-linux-x86_64.tar.gz`.

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

In **Istanza → Device → Installazione**, con un tarball selezionato, compila il form **Installa su dispositivo**:

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
==> SCP: dist/sws-2.14.0-linux-x86_64.tar.gz → user@192.168.1.10:/tmp/sws-deploy/
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
4. **Health check** — `sleep 3 && curl -sk https://localhost:7443/health`

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

## Deploy container (Podman)

Alternativa al binario nativo: installa il runtime come **container Podman
rootless**, gestito da systemd tramite una unit **quadlet** — nessun `sudo`
richiesto sul device, a differenza del binario nativo.

### Dalla UI

Nel form **Installa su dispositivo**, scegli **Container (Podman)** invece di
**Binario nativo**. Compaiono campi aggiuntivi:

| Campo | Descrizione | Default |
|-------|-------------|---------|
| **Sorgente immagine** | Registry (scarica sul device) o Archivio locale (SCP di ~59 MB) | Registry |
| **Riferimento immagine** | Solo con Registry — vuoto = ultima immagine per l'architettura del device | — |
| **Percorso dati sul device** | Directory per progetti/config/log | `/data/user/sws` |
| **Installazione pulita** | Azzera i dati esistenti prima di installare (richiede conferma) | Disattivato |

I campi Host/Porta/Utente/Password/Directory remota sono gli stessi del
binario nativo, sopra.

Click **🐳 Installa / Aggiorna container**. Il servizio si avvia automaticamente
al boot (via `loginctl enable-linger` + `[Install] WantedBy=default.target`
nella unit quadlet) — un container rootless non riparte da solo dopo un
reboot senza questi due elementi.

### Gestione container

La scheda **Istanza → Device → Container** (dal 25-09-2026 una scheda sua, prima un riquadro dell'installazione)
agisce su un container **già installato** (su questa stessa macchina o su un
device remoto, indipendentemente da quando/come è stato installato):

| Ambito | Come funziona |
|--------|---------------|
| **Locale** (default) | Nessun SSH — comandi diretti sul host che esegue l'IDE. Pensato per il caso più comune: un container installato per test sulla stessa macchina, che collide con `start_runtime.sh` sulle stesse porte. |
| **Remoto** | Riusa i campi SSH del pannello di installazione sopra. |

Azioni disponibili:

- **Stato** — riepilogo `systemctl status`, avvio automatico al boot, linger,
  stato del container.
- **Avvia / Ferma / Riavvia** — `systemctl --user start/stop/restart`.
- **Abilita / Disabilita avvio al boot** — commenta/scommenta `WantedBy=` nella
  unit quadlet e ricarica systemd. *Non* usa `systemctl enable/disable`: per
  una unit generata da quadlet è un no-op (rigenerata da zero a ogni
  `daemon-reload`/boot dalla sezione `[Install]` del file `.container`, non da
  un unit file persistente). Non tocca lo stato corrente: disabilitare non
  ferma un container in esecuzione.
- **Policy di restart** — riscrive `Restart=` nella unit (Sempre / Solo su
  errore / Mai) e ricarica systemd. Cambia solo cosa succede al *prossimo*
  stop/crash, non riavvia il servizio.
- **🧹 Pulisci immagini non usate** — rimuove ogni immagine podman che il container in esecuzione non usa (le
  versioni accumulate dai deploy), compresa quella di prima che servirebbe a tornare indietro; l'immagine attiva
  non si tocca.
- **Disinstalla** (zona pericolosa) — rimuove servizio, unit quadlet e
  container. Con **"Cancella anche i dati"** (richiede conferma), cancella
  anche la directory dati — altrimenti resta sul disco.

### La configurazione del servizio (i quadlet)

L'aggiornamento automatico (`podman auto-update`) sostituisce l'immagine ma non i quadlet del pannello. Dal 02-10-2026
il pannello sa se i suoi quadlet sono più vecchi di quelli della versione che gira (il numero `[quadlet N]` nella
`Description`) e li sa riscrivere da sé: in **Istanza → Device → Connessione**, riquadro **Configurazione del
servizio**, pulsante **Aggiorna** (il pannello si riavvia); sui pannelli senza utenti lo propone anche lo schermo.
Riscrive i quadlet dai template dell'immagine con `install-container.sh --solo-unita`, conservando immagine, cartella
dati e rete. Come la reinstallazione, riporta ai valori del template le modifiche fatte da **Gestione container**
(avvio al boot, politica di riavvio). Dettagli: HOWTO §20.

### Dopo un aggiornamento: confermare o tornare indietro

Dal 03-10-2026 ogni aggiornamento (dal registro o da archivio) lascia sul pannello la versione di prima e
un'istantanea dei dati presa subito prima. Dopo due minuti di vita della versione nuova, in **Istanza → Device →
Connessione**, riquadro **Dopo l'aggiornamento** (e sullo schermo dei pannelli senza utenti), si sceglie: **Conferma e
pulisci** (toglie le immagini vecchie, tiene la precedente, e l'istantanea), **Conferma dopo il prossimo riavvio**,
**Più tardi**, o **Torna alla …** (immagine e dati di prima; quanto scritto dopo l'aggiornamento si perde). Dopo un
ritorno, finestra e pilota automatico non reinstallano la versione scartata. Senza spazio per l'istantanea
l'aggiornamento non parte. Dettagli: HOWTO §21.

### Comandi equivalenti da riga di comando

```bash
# Installazione
./deploy/container/install-container.sh --pull

# Gestione
systemctl --user status  sws-runtime
systemctl --user restart sws-runtime
journalctl --user -u sws-runtime -f

# Disinstallazione
./deploy/container/install-container.sh --uninstall            # dati conservati
./deploy/container/install-container.sh --uninstall --purge    # dati compresi
```

---

## Alternativa: deploy manuale

Se preferisci non usare la UI, il deploy manuale è sempre disponibile:

```bash
# 1. Build
./scripts/package.sh

# 2. SCP
scp dist/sws-2.14.0-linux-x86_64.tar.gz utente@device:/tmp/

# 3. SSH + install
ssh utente@device "
  cd /tmp
  tar xzf sws-2.14.0-linux-x86_64.tar.gz
  cd sws-2.14.0-linux-x86_64
  sudo ./install.sh
"

# 4. Health check
curl -k https://device:7443/health
```

---

← [Indice](MAIN.md) | [← Deployment](10_deployment.md) | [Successivo → GitOps](12_gitops.md) →
