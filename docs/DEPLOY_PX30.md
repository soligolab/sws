# Deploy SWS on a Rockchip PX30 (or similar ARM64 SBC)

> **Nota (giugno 2026)**: Per i device **Pixsys Yocto** (PX30/RK3399/RK3588) il percorso
> preferito è il binario nativo — vedi `docs/YOCTO_CROSSCOMPILE.md`.
> Questa guida descrive il flusso **container (Podman/Docker)** per device ARM64 generici
> (Raspberry Pi, Jetson, ecc.) che non hanno un SDK Yocto disponibile.

This guide covers the **happy path** for getting `sws-runtime` running in a container on
a Rockchip PX30 or any other ARM64 Linux board with a container runtime (RK3399,
Raspberry Pi 4, NVIDIA Jetson, …).

## 1. Prerequisites

| Item | Tested with |
|---|---|
| Host distro | Debian 12 / Yocto Kirkstone / Buildroot 2023.11 |
| Architecture | linux/arm64 |
| Container runtime | Podman 4.4+, or Docker 24+, or containerd 1.7+ |
| Disk free | 1.5 GB for both images + 200 MB headroom for `.run/db` |
| RAM | 512 MB minimum (1 GB recommended once historian fills) |
| Network | Static IP on the same VLAN as the PLC for Modbus TCP |

If the host has Python 3.11+ installed system-wide, the runtime can
optionally pick it up via PyO3 — the bundled libpython is the default
inside the image, no host install is needed.

## 2. Build images for ARM64

From an x86 developer laptop with `docker buildx` (one-time setup):

```sh
# Enable QEMU for cross-arch emulation
docker run --privileged --rm tonistiigi/binfmt --install all
docker buildx create --use --name sws-builder
```

Then build and either push to a registry **or** produce OCI archives:

```sh
# Pushes both runtime + editor to ghcr.io/soligolab as multi-arch
./scripts/build-images.sh --registry ghcr.io/soligolab --tag 0.1.0 --push

# Or: produce loadable OCI archives under .run/oci/
./scripts/build-images.sh --tag 0.1.0
```

Transfer the archives to the board with `scp` / a USB stick / whatever
is convenient.

## 3. On the board: load images and start

```sh
# Load if you brought OCI archives over
podman load -i sws-runtime-0.1.0.tar
podman load -i sws-editor-0.1.0.tar

# Pull if you pushed to a registry
podman pull ghcr.io/soligolab/sws-runtime:0.1.0
podman pull ghcr.io/soligolab/sws-editor:0.1.0

# Copy compose.yaml (from the repo) onto the board
mkdir -p ~/sws && cd ~/sws
# … place compose.yaml here …

# Start, providing the admin password inline
SWS_ADMIN_PASSWORD=changeme podman compose up -d
```

`compose.yaml` creates three host-mounted directories under `.run/`:

```
.run/
├── config/       # TLS cert (generated on first run)
├── project/      # project.yaml (synoptics, tags, sources, alarms)
└── db/           # historian.db (SQLite ring buffer + log)
```

Pre-seed `project.yaml` with your Modbus device:

```yaml
meta: { name: demo, version: "0.1.0" }
tags:
  - { id: pump1.speed,  description: Pompa principale,  data_type: float }
  - { id: pump1.fault,  description: Pompa fault,       data_type: bool }
sources:
  - kind: modbus_tcp
    id: plc
    host: 192.168.1.10     # ← PLC IP on the LAN
    port: 502
    unit_id: 1
    poll_interval_ms: 500
    registers:
      - { tag: pump1.speed, address: 100, scale: 1.0 }
      - { tag: pump1.fault, address: 101, scale: 1.0 }
alarms: []
```

Restart the runtime container (or use the editor's Configurazione tab —
sources hot-reload at the next save).

## 4. Open the editor from a workstation

From a workstation on the same LAN:

| URL | Cosa mostra |
|-----|-------------|
| `https://<board-ip>:8444` | IDE admin (deploy, configurazione, editor grafico) |
| `https://<board-ip>:8443` | Viewer operatori (sinottici, allarmi, trend) |

Entrambe le porte richiedono di accettare il cert self-signed una volta nel browser.
Dopo il primo avvio il cert è persistente — i restart successivi non richiedono
ri-accettazione.

Login: `admin` / il valore passato in `SWS_ADMIN_PASSWORD`.

## 4b. Alternative: single-container deployment (--www)

The runtime può servire la SPA Vite direttamente, eliminando il container `sws-editor`.
Dalla T-21, il runtime avvia **due porte** in automatico:

- **8443** — viewer operatori (serve `dist/index.html`)
- **8444** — admin IDE (serve `dist/index-admin.html`)

Per usare il single-container:

1. **Build della SPA sul host** (il runtime image non include pnpm/node):

   ```sh
   (cd sws-editor && pnpm install && pnpm build)
   ```

2. **Modifica `compose.yaml`** — commentare il servizio `editor:` e decommentare le righe
   di "Single-container mode" nel servizio `runtime:` che aggiungono `--www /var/sws/www`.

3. **Restart**: `podman compose up -d`.

Il browser può aprire sia `https://<board-ip>:8443` (viewer) che `https://<board-ip>:8444`
(admin IDE). Entrambe le porte usano lo stesso cert self-signed persistente.

## 4c. Kiosk mode (unattended boot)

For panel-PC / HMI scenarios — the board has a display attached and you
want the SCADA synoptic to come up by itself without anyone logging in
or opening a browser — pass `--kiosk-browser <shell-cmd>` to the runtime.
Once `/health` answers OK, the runtime spawns the command (fire-and-forget;
its death does not stop the runtime).

```yaml
# In compose.yaml, under the runtime service `command:` (combine with
# the single-container `--www` override from §4b for the fullest demo):
command: ["sws-runtime",
          "--config",         "/var/sws/config",
          "--projects-root",  "/var/sws/projects",
          "--project",        "/var/sws/projects/default",
          "--www",            "/var/sws/www",
          "--kiosk-browser",  "chromium --kiosk --no-sandbox --app=https://localhost:8443"]
```

Browser choices:

| Command | Notes |
|---|---|
| `chromium --kiosk --no-sandbox --app=URL` | Most common; needs `chromium` package on the host (the stock SWS image does NOT bundle a browser — install on the board or build a derived image). |
| `epiphany-browser --application-mode URL` | GNOME Web — lighter than Chromium, fewer deps |
| `firefox --kiosk URL` | Mature kiosk mode since FF 71 |
| `cage -- chromium --kiosk --app=URL` | Wayland-only minimal kiosk wrapper — clean, no window decorations |

The browser process inherits stdin/stdout from the runtime: its logs end
up in journald or `podman logs <container>` alongside the runtime's own
output. If the browser crashes, the runtime keeps serving; restart the
browser by hand (or wrap it in a `while true; do …; done` shell loop in
the `--kiosk-browser` command itself).

Installing chromium on Debian Bookworm arm64 (host side):

```sh
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
    chromium                    \
    fonts-noto-core libgl1-mesa-dri
```

For an X-less Wayland kiosk on a barebones board, `cage` + chromium is
the minimal setup:

```sh
sudo apt-get install -y cage chromium
# in compose: --kiosk-browser "cage -- chromium --kiosk --no-sandbox --app=https://localhost:8443"
```

## 5. Operational notes

### TLS certs

The runtime auto-generates a self-signed certificate on first run. For
a real production deployment swap it out:

```sh
# Replace .run/config/tls.crt and .run/config/tls.key with your own
# (PEM-encoded, single chain), then restart the runtime container.
```

### Auth

`compose.yaml` reads four env vars — only `SWS_ADMIN_PASSWORD` is
required. Set the others to enable Supervisor / Operator / Viewer
accounts. Sessions roll on every successful request and expire after
8 h by default (`SWS_SESSION_TTL_SECS`).

### Historian disk usage

The default ring buffer is 5000 samples per tag in memory plus the same
in SQLite at `/var/sws/db/historian.db`. At ~80 bytes per row this is
~400 KB per tag — a 50-tag project sits well under 50 MB. Disable
persistence by setting `SWS_HISTORIAN_DB=""` if the SBC has no usable
SSD.

### systemd unit (optional)

If the board uses systemd, drop this at `/etc/systemd/system/sws.service`:

```ini
[Unit]
Description=SWS (Soligo Web SCADA)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/sws/sws
EnvironmentFile=/etc/sws.env       # contains SWS_ADMIN_PASSWORD etc.
ExecStart=/usr/bin/podman compose up
ExecStop=/usr/bin/podman compose down
Restart=on-failure
User=sws

[Install]
WantedBy=multi-user.target
```

Then `systemctl enable --now sws.service`.

## 6. Known gotchas (PX30-specific or notable)

- **`/usr/bin/python` is missing on Debian Bookworm**: only `python3`
  ships by default. PyO3's build script fails without `PYO3_PYTHON`
  set. Inside the runtime container this is fine (we link against
  libpython3.11 at build time); on the host it matters only if you're
  cross-compiling from the board itself.
- **Clock skew on a coldstart PX30** (no RTC battery): the historian's
  `ts_ms` will be wrong until NTP catches up. The runtime tolerates
  this; the trend chart's X axis just looks weird for the first
  ~30 seconds. Install `chrony` and force `chronyc -a makestep` on
  boot if this matters.
- **Modbus TCP from an arbitrary source port can be blocked**: some
  industrial PLCs are picky about the client's source port range.
  Run `podman compose up` with `network_mode: host` if you see
  RST on the third packet of every connect.
- **Out-of-memory under load**: when polling >100 tags at 100 ms the
  runtime's resident set is ~120 MB. Set `RUST_LOG=info` (default) —
  `debug` doubles allocations through `tracing-subscriber` and pushes
  a 512 MB board into swap.
- **SD card wear**: SQLite's WAL mode helps, but the historian still
  writes on every tag update. For high-throughput projects either
  mount `.run/db` on an eMMC partition, or disable persistence with
  `SWS_HISTORIAN_DB=""`.

## 7. Verifying the demo works

From a different machine on the LAN:

```sh
# Health check su entrambe le porte
curl -sk https://<board-ip>:8443/health   # → "ok"
curl -sk https://<board-ip>:8444/health   # → "ok"

# Login (route admin su 8444)
TOKEN=$(curl -sk -X POST "https://<board-ip>:8444/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme"}' | jq -r .token)

# Read tags (disponibile su 8443 senza token in optional_auth)
curl -sk "https://<board-ip>:8443/api/tags" | jq .

# Write a tag (8443 con token oppure 8444)
curl -sk -X PUT -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value": true}' \
  "https://<board-ip>:8443/api/tags/pump1.fault"
```

## 8. Note post-PoC

Il PoC (T-01…T-21) è funzionalmente completo. I prossimi passi (T-22…T-26) riguardano
il workflow di sviluppo e deploy multi-device (vedi `STATUS.md`).

Aspetti futuri per la fase product:
- Container signing con cosign (CRA item).
- Auto-update con rollback.
- Let's Encrypt / ACME integration.
- Hardened systemd unit (`PrivateTmp=`, `NoNewPrivileges=`, …).
- Audit log shipping (oggi è un file per-host).
