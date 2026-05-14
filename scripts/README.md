# scripts/

Local-dev helpers for the SWS PoC. None of these are needed in production
or CI — the container image and the GitLab/GitHub pipelines do their own
bootstrap.

## `dev.sh`

One-stop launcher: builds the Rust runtime, seeds an example `project.yaml`
under `.run/project/`, generates the self-signed TLS cert under
`.run/config/`, and (in `both` mode) starts both the runtime and the Vite
dev server.

```sh
./scripts/dev.sh          # both (recommended)
./scripts/dev.sh runtime  # only the runtime
./scripts/dev.sh editor   # only the editor (assumes runtime already up)
```

### Access from another device on the LAN

`dev.sh` binds Vite to `0.0.0.0:5173` so any browser on the same Wi-Fi /
LAN can hit `http://<your-host-ip>:5173` (the script prints the URL in
the info banner). The frontend builds WebSocket URLs from
`window.location`, so all `/api` and `/ws/*` traffic goes through Vite,
which proxies on the server side to the runtime on `localhost:8443`.

That means the remote browser **never sees the self-signed certificate**
and there is no extra cert-acceptance step.

If you launch the editor by hand without `dev.sh`, pass
`--host 0.0.0.0` to `pnpm dev` for the same effect.

The runtime itself still listens on `0.0.0.0:8443`, so a remote browser
that wants to hit the HTTPS endpoint directly (e.g. for raw `curl`
testing from another box) can — that path does require accepting the
cert.

### Verifying it's alive

```sh
# tag snapshot
curl -k https://localhost:8443/api/tags

# write a value (triggers `counter_high` alarm at >50)
curl -k -X PUT https://localhost:8443/api/tags/counter \
  -H 'Content-Type: application/json' \
  -d '{"value": 99}'

# active alarms
curl -k https://localhost:8443/api/alarms

# historian (after a few writes)
curl -k 'https://localhost:8443/api/history/counter?limit=20'
```

### Where state lives

```
.run/
├── config/        # tls.crt + tls.key, generated on first run
├── project/       # project.yaml (seeded with two demo tags + one alarm)
└── logs/          # runtime.log when started via the "both" mode
```

The whole `.run/` tree is `.gitignore`d. Wipe it any time:

```sh
rm -rf .run && ./scripts/dev.sh
```

### Stopping

Ctrl-C in the `both` mode kills both processes. In split mode use Ctrl-C
in each terminal.

## `demo-sine.py` — driving a Trend with a sine wave

Quick way to put movement on a `trend` object during the demo. Logs in,
then writes `offset + amplitude * sin(2π · t / period)` to a tag every
`--interval` seconds via `PUT /api/tags/:id`. No deps beyond Python's
stdlib.

The dev seed already creates a `sine` tag, so the default invocation
just works:

```sh
./scripts/demo-sine.py
```

To visualize it: in the editor (Editor mode) drop a **Trend** object,
set its **Tag** to `sine`, set the **Finestra** to ~30 s, save the
synoptic, switch to **Runtime** mode. You should see the wave scroll.

Common tweaks:

```sh
./scripts/demo-sine.py --tag flow --period 20 --amplitude 25 --offset 50
./scripts/demo-sine.py --interval 0.05      # 20 Hz, smoother trace
./scripts/demo-sine.py --password mypw      # if you override admin password
```

Stop with Ctrl-C. The script auto-reauthenticates on a 401 (so it
survives a runtime restart) and exits cleanly on Ctrl-C.

## `demo-driver.py` — multi-tag, multi-waveform driver

Superset of `demo-sine.py`. Pass `--gen` once per generator (each is a
comma-separated `key=value` list with at least `tag=NAME`). All
generators share one asyncio loop so they tick together.

```sh
./scripts/demo-driver.py \
  --gen 'tag=sine,wave=sin,period=10,amp=50,offset=50' \
  --gen 'tag=cosine,wave=cos,period=8' \
  --gen 'tag=triangle,wave=tri,period=12,amp=30,offset=20' \
  --gen 'tag=ramp,wave=saw,period=20' \
  --gen 'tag=noise,wave=random,amp=10,offset=50'
```

Waveforms: `sin`, `cos`, `tri`, `saw`, `square` (with optional `duty`),
`random`, `step` (with `step_low`, `step_high`, `step_at`). Other keys:
`period`, `amplitude` / `amp`, `offset`, `interval`, `phase`.

Drop one **Trend** object in the editor, set its **Tag** to `sine`, then
add `cosine`, `triangle`, `ramp`, `noise` to **ALTRI TAG (OVERLAY)** —
five lines on the same axes.

## MQTT write path

A `TopicMapping` now also accepts an optional **Topic out (publish)** in
the ConfigView Protocolli tab. When set, a write to that tag (via
`PUT /api/tags/:id`, an object's `on_press` script, or a button) is
forwarded to the configured topic as a raw string payload
(`true` / `42.5` / etc.). Subscribe and publish topics can be the same
channel or different ones.
