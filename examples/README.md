# SWS examples

Working snapshots that ship with the repo so a fresh clone has something
to run.

## `templates/`

Project templates bundled with the runtime, exposed via the
`Crea nuovo progetto → Da template` flow in the WelcomeScreen.
Each template is a directory under `examples/templates/<id>/` with:

- `template.yaml` — `{ id, label, description }` metadata read by
  `GET /api/templates`.
- `project.yaml` + `synoptics/` — the same on-disk format as a real
  project. Copied recursively into `<projects_root>/<new_name>/` when
  the template is picked.

### `templates/demo-items/`

The current built-in demo (previously at `examples/demo/`, moved
2026-05-15 with the multi-project IDE refactor). Contents:

- `project.yaml` — 16 tags (5 baseline + 11 `demo.*` for binding
  showcase), MQTT echo source on `broker.freemqtt.com:1883`, one alarm,
  two Python functions (`fnc_CounterUP` / `fnc_CounterDWN`).
- `synoptics/Page 1.yaml` — counter rectangles, buttons, slider, MQTT
  echo round-trip, pump symbol.
- `synoptics/Page 2.yaml` — welcome page with hints.
- `synoptics/Page 3.yaml` — showcase of every widget type with `demo.*`
  bindings (rotation, opacity, fill, etc.).
- `synoptics/Page 4.yaml` — fill color picker (preset buttons write to
  `demo.fill_color`).

All four pages have a uniform header with `◀ Precedente` / `Successiva ▶`
navbuttons for circular navigation (1↔2↔3↔4↔1).

## Updating a template snapshot

The editor has an admin-only "Esporta progetto" entry in the header
menu that downloads a ZIP of the current runtime state. The on-disk
format inside the ZIP mirrors what's in a project directory, so the
easiest way to refresh `templates/demo-items/` from a curated session
is:

1. Open the `demo-items` project (or any project you want to snapshot)
   in the editor.
2. Make your changes and save.
3. Header → "Esporta progetto" → keep the downloaded ZIP somewhere.
4. Replace `project.yaml` and `synoptics/` inside the template directory
   with the contents of the ZIP (don't ship `manifest.json` — it's only
   meaningful inside the export archive).
5. Keep `template.yaml` unchanged.
6. Commit.

**Never** commit `users.yaml` — it carries the Argon2id password
hashes for the local accounts.
