# SWS Editor (portable IDE)

Standalone SWS project designer for a developer PC. Unpack and run — no root,
no systemd, no installation.

## Requirements

- Linux (x86_64 or aarch64)
- Python 3 (the runtime links libpython via PyO3)

## Run

```sh
./run-editor.sh
```

Then open the IDE: <http://localhost:8460>

By default the editor runs in **no-auth mode** (no login), like the development
editor. Set `SWS_ADMIN_USER` + `SWS_ADMIN_PASSWORD` before launching if you want
a login prompt.

## What you get

- The canvas designer / admin IDE only (no operator viewer).
- All data — projects, config, and the TLS cert once enabled — under `./data/`.
  Back up or delete that folder as a unit; the package is fully portable.

## Deploy a project to a device

Design here, then push to a runtime device from the IDE:
ConfigView -> Runtime -> Connect. (Runtime devices are installed from the
`sws-runtime-*` package via `sudo ./install.sh`.)

## Options (environment variables)

- `SWS_ADMIN_PORT` — IDE port (default 8460)
- `SWS_ADMIN_USER` / `SWS_ADMIN_PASSWORD` — admin account (enables the login)
- `RUST_LOG=debug` — verbose logging

## Notes

- Runs plain HTTP on localhost (a browser secure context). Enable HTTPS later
  from ConfigView -> Status -> TLS Certificate.
- If the binary cannot find libpython, point the loader at it, e.g.:

  ```sh
  LD_LIBRARY_PATH=$(python3 -c 'import sysconfig;print(sysconfig.get_config_var("LIBDIR"))') ./run-editor.sh
  ```
