# SWS examples

Working snapshots that ship with the repo so a fresh clone has something
to run.

## `demo/`

Seed used by `scripts/dev.sh` when `.run/project/project.yaml` is missing
(typically a fresh clone or after `rm -rf .run/project`). Contents:

- `project.yaml` — 5 tags (`counter`, `pump.running`, `checkbox`,
  `demo.button`, `demo.led`), an MQTT source on
  `broker.freemqtt.com:1883` with three topic mappings (the counter +
  the `sws/demo/echo` echo loop), one counter alarm, two reusable
  Python functions (`fnc_CounterUP` / `fnc_CounterDWN`).
- `synoptics/Page 1.yaml` — green/red rectangles wired to the counter
  functions, two labelled buttons (UP/DOWN), a slider + text bound to
  the counter, two MQTT buttons (LED ON / LED OFF) writing
  `demo.button`, an LED bound to `demo.led`, a navbutton, a gauge,
  and a pump symbol from the built-in library.

## Updating the snapshot

The editor has an admin-only "Esporta" button in the header that
downloads a ZIP of the current runtime state. The on-disk format
inside the ZIP mirrors what's in `.run/project/`, so the easiest way
to refresh `examples/demo/` from a curated dev session is:

1. Make your changes in the editor and save.
2. Header → "Esporta progetto" → keep the downloaded ZIP somewhere.
3. Replace `examples/demo/project.yaml` and
   `examples/demo/synoptics/` with the contents of the ZIP (don't
   ship the `manifest.json` — it's only meaningful inside the export
   archive).
4. Commit.

Alternatively just `cp -r .run/project/{project.yaml,synoptics}
examples/demo/`. **Never** commit `users.yaml` — it carries the
Argon2id password hashes for the local accounts.
