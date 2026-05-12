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

### First-run gotcha

The runtime serves with a self-signed certificate. Browsers reject WebSocket
connections to `wss://` endpoints with untrusted certs **without showing a
prompt** — so the AlarmBanner and live tag stream stay silent.

**Fix once per browser**: open `https://localhost:8443/health` in the same
browser you'll use for the editor and click through the cert warning. After
that, `wss://localhost:8443/ws/tags` and `/ws/alarms` will work.

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
