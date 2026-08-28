# SWS — Test setups

> Where the maintainer actually runs SWS while developing it. The list of physical devices
> changes between sessions; this doc records the *categories* of test environments and the
> conventions around using them. For up-to-date device addresses, ask the maintainer.

## Architettura porte (T-21)

Il runtime avvia **due server HTTPS** su porte distinte:

| Porta | Ruolo | SPA servita | Auth |
|-------|-------|-------------|------|
| **8443** | Viewer operatori | `dist/index.html` (RuntimeViewer, ~24 kB) | Optional (`optional_auth`): no token → Viewer anonimo |
| **8444** | Admin IDE | `dist/index-admin.html` (App completa, ~310 kB) | Required: token valido oppure 401 |

Il proxy Vite (`5173 → 8444`) permette lo sviluppo senza accettare il cert self-signed
dell'admin IDE. Il cert TLS è **persistente tra i restart** del runtime (T-21 fix):
basta accettarlo una volta per browser.

---

## 1. Casa — Ubuntu desktop con monitor

Un singolo PC desktop Linux con schermo. È l'unico posto in cui il maintainer può vedere
`sws-kiosk` (GTK4 + WebKitGTK6) dal vivo su un display reale, senza Yocto/Wayland.

Cosa testare qui:
- `sws-kiosk` (finestra GTK locale).
- Runtime + IDE in modalità locale.
- Browser di sistema (Firefox/Chrome) per accettare i cert self-signed.

Dopo `./scripts/start_runtime.sh`:
- `https://localhost:8443` → Viewer operatori (accettare cert self-signed una volta)
- `https://localhost:8444` → IDE admin (accettare cert una volta)

Il cert TLS (`tls.crt`/`tls.key` in `.run/config/`) è persistente tra restart.

---

## 2. Ufficio — dev server (questa macchina)

Il server di sviluppo dove vive il repo a `/home/max_xxv/sws`. **Macchina headless**
(nessun monitor diretto).

Flusso tipico:
1. `./scripts/start_runtime.sh` su questa macchina avvia:
   - runtime (8443 viewer + 8444 admin/IDE)
   - stampa la LAN IP del server
2. Il maintainer apre il browser sul **proprio PC**:

| URL | Cosa mostra | Cert |
|-----|-------------|------|
| `https://<server-ip>:8443` | Viewer operatori | self-signed, accettare una volta |
| `https://<server-ip>:8444` | IDE admin diretto | self-signed, accettare una volta |

Cosa NON si può testare qui:
- `sws-kiosk`: richiede un display GTK; questa macchina non ne ha. Per quello, vedi
  sezione 1 (casa) o 3 (Yocto + Wayland).

---

## 3. Ufficio — dispositivi Yocto (PX30, RK3399, RK3588)

Dispositivi industriali Rockchip in LAN ufficio. Deploy tramite **binario nativo Yocto**
(`docs/YOCTO_CROSSCOMPILE.md`). La guida container (`docs/DEPLOY_PX30.md`) è il flusso
legacy per device ARM64 generici non-Yocto.

Layout su device:
```
/data/user/sws/
  sws-runtime              binario nativo aarch64
  sws-runtime-launch.sh    env loader + exec wrapper
  runtime.env              overrides per-device (admin password, ecc.)
  config/                  cert TLS (generati al primo avvio, persistenti)
  projects/                progetti operativi
  templates/               template bundled
  www/                     SPA dist (viewer 8443 + admin 8444)
  historian.db             SQLite
```

Porte su device:
```
https://<device-ip>:8443   → viewer operatori (non esporre agli operatori la porta 8444)
https://<device-ip>:8444   → admin IDE (solo per deploy e amministrazione)
```

Due modi di guardare la UI:
1. Browser remoto dal PC del maintainer (come per il dev server).
2. **Rendering Wayland diretto sul device** (caso d'uso reale del prodotto: SCADA su
   pannello industriale).

| Piattaforma | Note |
|-------------|------|
| PX30 | Reference hardware principale per il PoC. |
| RK3399 | Compatibile via stesso binario arm64. |
| RK3588 | Compatibile (più potente, utile per stress test). |

**Lista dei device fisicamente disponibili = volatile.** Cambia tra sessioni.
Prima di lanciare un test SSH, **chiedere sempre al maintainer** quale device usare e
a quale indirizzo.

### Pannelli della serie WP/TC — le particolarità che costano tempo

`WP630` e `TC620` sono **la stessa famiglia**: entrambi devono poter far girare sia il
runtime web sia quello LVGL. Le note qui sotto sono misurate, non dedotte, e valgono
per entrambi salvo dove indicato.

| Cosa | Valore | Perché importa |
|---|---|---|
| Utente SSH | **`user`**, non `pixsys` | `user` **non è sudoer**; per i comandi privilegiati serve `su - pixsys` |
| Socket Wayland | **`wayland-1`**, non `wayland-0` | misurato su TC620 e WP630. `sws-lvgl-viewer.service` ha `WAYLAND_DISPLAY=wayland-0` **cablato e sbagliato**: leggerlo da `ls /run/user/1000/wayland-*` |
| DRM | il device **non è sempre `card0`** — sul TC620 è `card1` | il default della CLI è `card0` |
| Gruppi di `user` | `wayland`, `seat`, `dialout`, `plugdev` — **niente `video`, niente `input`** | e non servono: vedi sotto |
| Accesso ai device | via **`seatd`** (`/run/seatd.sock`) | weston ottiene da lì i descrittori di `card1`, `renderD128` e degli input pur non essendo nei gruppi. È il disegno dell'OS, non una svista |
| Touch | `find-touchscreen.service` crea `/dev/input/ts` (pannello grezzo); `ts-uinput.service` produce `/dev/input/ts_uinput` (**calibrato** con `/etc/pointercal`, che non è identitario) | **weston legge `ts_uinput`**, non il grezzo. Usare sempre i symlink, mai un `/dev/input/eventN`: quel numero cambia |
| Schermo | `weston.service` + `chromium@main-app.service`, entrambi come `User=user` | per una prova LVGL a schermo pieno va fermato Chromium |

**Conseguenza pratica**: sul percorso **SDL2/Wayland** non serve alcun permesso speciale
— gli eventi li consegna weston, che il touch lo legge già calibrato. Il percorso **DRM**
invece apre i device direttamente, quindi non convive con weston (che è già DRM master) e
richiederebbe di passare da `seatd`, non di allargare i gruppi.

### La via di fuga del launcher — non romperla (misurato sul WP630, 2026-08-28)

`pixsys-launcher` gira a `sysinit.target`, **prima di Weston**, e disegna direttamente su DRM/KMS.
Legge il touch e allo scadere di un timer **unico da 10 s** guarda dove sta il dito:

| Dito allo scadere dei 10 s | Cosa parte |
|---|---|
| dentro l'icona **STOP** (225×225 px, angolo in alto a **destra**) | `chromium@wp-control.service` → **Cockpit su `http://127.0.0.1:9443`** |
| premuto altrove sullo schermo | `touch-calibration-from-launcher.service` |
| non premuto | **`desktop.target`** → Weston + `chromium@main-app.service` |

Un tocco rilasciato prima dei 10 s non ha effetto: conta solo dove si trova il dito nell'istante in
cui il timer scade.

**Il fatto che serve a chi scrive codice**: in modalità configurazione il launcher avvia *solo*
`chromium@wp-control.service` e **non raggiunge mai `desktop.target`**. Quindi

```bash
systemctl is-active desktop.target      # active = modalità normale
systemctl is-active chromium@wp-control.service   # active = modalità configurazione
```

distingue le due modalità in modo esatto, con due query che l'utente `user` può fare senza sudo.
È su questo che si regge `sws-display-apply.sh`.

**Cosa non fare**, pena rendere il dispositivo non configurabile:

- non prendere lo schermo senza aver prima verificato la modalità;
- non toccare `chromium@wp-control.service`;
- non abilitare `weston.service` al boot: partirebbe prima del launcher e, per il `Conflicts=`,
  ucciderebbe la finestra dei 10 s.

**Comandare il browser: la via giusta è D-Bus.**
`net.pixsys.Config1.WebBrowser.SetEnabled` dice al launcher se abilitare il browser, e il launcher
la rilegge a ogni avvio: è una *politica*, non un comando, quindi sopravvive al riavvio perché è il
launcher stesso a rispettarla. Vale però **dal prossimo avvio** — per la sessione in corso il
browser va comunque fermato con `systemctl stop`.

Disponibile da **PixsysOS 2.1.0**. Sui firmware precedenti il metodo non esiste (`Unknown method`,
misurato sul WP630 il 2026-08-28) e si ripiega su `systemctl disable --now`, che la regola polkit
`17-chromium.rules` concede all'utente senza sudo. In quel ripiego serve `disable` e non `stop`:
altrimenti il symlink in `desktop.target.wants` resta e al riavvio il browser torna su.

**Il ripiego è temporaneo.** `sws-display-apply.sh` lo marca con la parola `RIPIEGO`: si trova
cercandola, e va tolto quando 2.1.0 sarà su tutti i prodotti.

**Da verificare quando 2.1.0 arriva** (oggi non provabile, nessun dispositivo ce l'ha): che
`SetEnabled=false` basti da solo, cioè che il launcher **rimuova** anche il symlink già esistente in
`desktop.target.wants`. Se non lo facesse, il browser tornerebbe su al riavvio nonostante la
politica, e servirebbe tenere il `disable` anche dopo.

### GUI del pannello (Pixsys OS, verificato su un WP620 il 2026-07-28)

Il display del pannello è pilotato da **Chromium su Weston**, non dal runtime:

| Cosa | Dove |
|---|---|
| Unit del browser | `chromium@main-app.service` (system unit, `User=user`) |
| Lanciato da | `/usr/bin/chromium-start main-app` |
| URL mostrato | letto via **D-Bus**, non da un file |

```bash
# quale URL sta mostrando il pannello
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/WebBrowser/MainApp \
    net.pixsys.Config1.WebBrowser GetUrl          # → s "http://127.0.0.1:8443"
# cambiarlo: stessa interfaccia, SetUrl
# ricaricare la pagina sul pannello (funziona senza sudo dall'account `user`)
systemctl restart chromium@main-app.service
```

**Perché serve saperlo**: il browser del pannello non ricarica da sé, e una SPA
già caricata resta quella. Dopo un aggiornamento del **frontend** il pannello
va ricaricato una volta (riavviando quell'unit); dopo un semplice cambio di
**progetto** invece non serve, perché la SPA dalla versione del 2026-07-28
sorveglia il fingerprint e si aggiorna da sola. Diagnosticare questo come "il
deploy non funziona" costa parecchio tempo: il runtime e i file possono essere
perfettamente aggiornati mentre a schermo resta la pagina di ore prima.

### Procedura ricorrente del maintainer (non automatizzata)

Il maintainer esegue **manualmente** sul dev server, prima di ogni sessione di test su un
device:

```sh
# Se l'host key del device è cambiata (ad es. dopo un re-flash):
ssh-keygen -f ~/.ssh/known_hosts -R <host>

# Copia chiave pubblica nel device (richiede password una volta):
ssh-copy-id -i ~/.ssh/id_ed25519.pub pixsys@<host>
```

L'agente non esegue questi due comandi: deve aspettare che il maintainer li abbia fatti
e poi può procedere con `ssh pixsys@<host>` per i comandi successivi.

---

## Convenzioni

- **Username sui device Yocto**: `pixsys` per default.
- **Cert self-signed**: il runtime genera `tls.crt` / `tls.key` in `.run/` al primo avvio
  (`rcgen`). Dalla seconda esecuzione in poi i cert vengono riusati (T-21 fix) — il browser
  non chiede di riaccettarli.
- **Non automatizzare** la distribuzione delle chiavi SSH ai device — è una scelta
  esplicita del maintainer.

## Vedi anche

- `STATUS.md` — handoff session-by-session.
- `docs/YOCTO_CROSSCOMPILE.md` — build e deploy nativo su Pixsys Yocto (percorso preferito).
- `docs/DEPLOY_PX30.md` — deploy in container su ARM64 generico (percorso legacy).
- `scripts/README.md` — overview script `start_runtime.sh` / `start_editor.sh` / `kiosk.sh`.
