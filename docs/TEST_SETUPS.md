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
