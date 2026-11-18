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

The IDE always asks for a login. On the first run, when no user exists yet, the
editor prints a **first-access code** on the terminal: open the IDE, enter the
code and create the administrator account. The code stops working as soon as
the first user exists.

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
- `SWS_ADMIN_USER` / `SWS_ADMIN_PASSWORD` — not the IDE login: they seed an
  Admin user into a project opened without users (written to that project's
  `users.yaml`, so it travels to the device with the deploy)
- `RUST_LOG=debug` — verbose logging

## Notes

- Listens on all interfaces, in plain HTTP until a certificate is set: from
  another PC of the LAN, logins travel unencrypted. Enable HTTPS from
  ConfigView -> Status -> TLS Certificate, or keep port 8460 behind a firewall.
- If the binary cannot find libpython, point the loader at it, e.g.:

  ```sh
  LD_LIBRARY_PATH=$(python3 -c 'import sysconfig;print(sysconfig.get_config_var("LIBDIR"))') ./run-editor.sh
  ```
