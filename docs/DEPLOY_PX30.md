# Deploy SWS on a Rockchip PX30 (or similar ARM64 SBC)

This guide covers the **happy path** for getting `sws-runtime` and
`sws-editor` running on a Rockchip PX30 industrial board. The same
recipe works for any ARM64 Linux with a container runtime (RK3399,
Raspberry Pi 4, NVIDIA Jetson, …) — the only PX30-specific bits are
the kernel/distro notes at the end.

The PoC target (per `docs/CONTEXT.md` Phase 1 exit criteria) is to
demonstrate that a single person can drop SWS on a PX30, point it at a
real PLC over Modbus TCP, build a small synoptic in the editor, and
watch values update live in a browser. **This document is the recipe
for that demo.**

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

```
http://<board-ip>:5173
```

The editor proxies `/api` and `/ws/*` to the runtime container via
compose DNS (`runtime:8443`), so the browser only ever sees the editor
container's TLS cert.

Login: `admin` / whatever you passed in `SWS_ADMIN_PASSWORD`.

## 4b. Alternative: single-container deployment

Since version `0.1.0-dev` (May 2026), the runtime can serve the
Vite-built SPA itself. This removes the `sws-editor` Nginx container —
both REST/WS and the static UI live behind one HTTPS endpoint.

To switch:

1. **Build the SPA on the host** (the runtime image doesn't bundle
   pnpm/node):

   ```sh
   (cd sws-editor && pnpm install && pnpm build)
   ```

2. **Edit `compose.yaml`** — comment out the entire `editor:` service
   and uncomment the four lines under "Single-container mode (optional)"
   inside the `runtime:` service.

3. **Restart**: `podman compose up -d`.

The browser now opens `https://<board-ip>:8443` directly, accepts the
self-signed cert once, and lands on the WelcomeScreen. All `/api` and
`/ws/*` requests go to the same origin — no proxy hop, no second cert.

When to prefer the two-container shape (the default in `compose.yaml`):
the editor container's Nginx will gzip/HTTP-cache static assets, so for
a public-facing deployment behind a load balancer that's still the
right shape. For a PX30 on the factory floor talking to one operator
on the LAN, single-container is simpler and burns fewer MB of RAM.

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
# Login
TOKEN=$(curl -sk -X POST "https://<board-ip>:8443/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme"}' | jq -r .token)

# Read tags
curl -sk -H "Authorization: Bearer $TOKEN" \
  "https://<board-ip>:8443/api/tags" | jq .

# Write a coil (assumes plug-and-play Modbus mapping)
curl -sk -X PUT -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value": true}' \
  "https://<board-ip>:8443/api/tags/pump1.fault"
```

If all three succeed, **Phase 1 exit criteria is met**.

## 8. Next-step polish (post-PoC)

These are out of scope for the demo but listed in `STATUS.md`:

- Container signing with cosign (CRA item).
- Auto-update mechanism with rollback.
- Let's Encrypt / ACME integration for the editor's nginx.
- Hardened systemd unit (`PrivateTmp=`, `NoNewPrivileges=`, …).
- Audit log shipping (today it's a per-host file).
