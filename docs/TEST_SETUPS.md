# SWS — Test setups

> Where the maintainer actually runs SWS while developing it. The list of physical devices changes between sessions; this doc records the *categories* of test environments and the conventions around using them. For up-to-date device addresses, ask the maintainer.

## 1. Casa — Ubuntu desktop con monitor

Un singolo PC desktop Linux con schermo. È l'unico posto in cui il maintainer può vedere `sws-kiosk` (GTK4 + WebKitGTK6) dal vivo su un display reale, senza Yocto/Wayland.

Cosa testare qui:
- `sws-kiosk` (finestra GTK locale).
- Runtime + editor in modalità locale (`./scripts/dev.sh`).
- Browser di sistema (Firefox/Chrome) per accettare il cert self-signed la prima volta.

## 2. Ufficio — dev server (questa macchina)

Il server di sviluppo dove vive il repo a `/home/ut1/sws`. **Macchina headless** (nessun monitor diretto).

Flusso tipico:
1. `./scripts/dev.sh` su questa macchina avvia runtime (8443) + Vite editor (5173) e stampa la LAN IP del server.
2. Il maintainer apre il browser sul **proprio PC** e punta a `http://<server-lan-ip>:5173` (consigliato — Vite fa proxy a 8443, niente cert self-signed da accettare dal browser remoto).

Cosa NON si può testare qui:
- `sws-kiosk`: richiede un display GTK; questa macchina non ne ha. Per quello, vedi sezione 1 (casa) o 3 (Yocto + Wayland).

## 3. Ufficio — dispositivi Yocto (PX30, RK3399, RK3588)

Dispositivi industriali Rockchip in LAN ufficio. Deploy in **container Podman** secondo `docs/DEPLOY_PX30.md`. Due modi di guardare la UI:

1. Browser remoto dal PC del maintainer (come per il dev server).
2. **Rendering Wayland diretto sul device** (il caso d'uso reale del prodotto: SCADA su pannello industriale).

| Piattaforma | Note |
|-------------|------|
| PX30 | Reference hardware principale per il PoC. |
| RK3399 | Compatibile via Podman/arm64. |
| RK3588 | Compatibile via Podman/arm64 (più potente, utile per stress test). |

**Lista dei device fisicamente disponibili = volatile.** Cambia tra sessioni. Lo snapshot più recente è nella memoria di sessione (`test-setup-office-yocto`). Prima di lanciare un test SSH, **chiedere sempre al maintainer** quale device usare e a quale indirizzo.

### Procedura ricorrente del maintainer (non automatizzata)

Il maintainer esegue **manualmente** sul dev server, prima di ogni sessione di test su un device:

```sh
# Se l'host key del device è cambiata (ad es. dopo un re-flash):
ssh-keygen -f ~/.ssh/known_hosts -R <host>

# Copia chiave pubblica nel device (richiede password una volta):
ssh-copy-id -i ~/.ssh/id_ed25519.pub pixsys@<host>
```

L'agente non esegue questi due comandi: deve aspettare che il maintainer li abbia fatti e poi può procedere con `ssh pixsys@<host>` per i comandi successivi.

## Convenzioni

- **Username sui device Yocto**: `pixsys` per default.
- **Cert self-signed**: il runtime genera `tls.crt` / `tls.key` in `.run/config/` al primo avvio (`rcgen`, CN=`localhost`). Per evitare di doverlo accettare nel browser, sviluppare via Vite proxy (porta 5173).
- **Non automatizzare** la distribuzione delle chiavi SSH ai device — è una scelta esplicita del maintainer.

## Vedi anche

- `STATUS.md` — handoff session-by-session.
- `docs/DEPLOY_PX30.md` — deploy in container sul PX30 reale.
- `scripts/README.md` — overview script `dev.sh` / `kiosk.sh`.
