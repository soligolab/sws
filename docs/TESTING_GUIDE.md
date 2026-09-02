# SWS — Manual Testing Guide

> Comprehensive end-to-end checklist for every feature delivered so far.
> Follow top-to-bottom on a fresh clone. Tick each box as you verify it.
> Deeper protocol-specific recipes live in `docs/OPCUA_SETUP.md`
> (OPC-UA) and `scripts/README.md` (dev runner + Playwright). Hardware
> deploy steps are in `docs/DEPLOY_CONTAINER_AARCH64.md` (podman) and
> `docs/YOCTO_CROSSCOMPILE.md` (native binary).
>
> **Time budget**: ~90 minutes for the full sweep. Skip any section you
> aren't planning to use — every area is independent.

---

## 0. Prerequisites

- [ ] Rust toolchain — stable, edition 2021 (`rustup show` shows ≥ 1.75).
- [ ] Node.js 21+ with `corepack` (or `pnpm` directly).
- [ ] System `python3` (`PYO3_PYTHON=python3` is set by the launcher scripts).
- [ ] A browser able to ignore self-signed cert warnings (Firefox / Chrome / Chromium / Edge).
- [ ] Optional: `curl` and `jq` for headless checks.

Optional simulators (only needed for the protocol sections):
- [ ] MQTT — use `broker.freemqtt.com` public, or run `mosquitto -v`.
- [ ] OPC-UA — `npx node-opcua-server-example` (Node 18+) or [Prosys Simulation Server](https://www.prosysopc.com/products/opc-ua-simulation-server/).
- [ ] Modbus TCP — `pymodbus` server example or any PLC simulator on `:502`.

---

## 1. First-run smoke test

```sh
git clone …  # or pull latest
cd sws
./scripts/start_runtime.sh
```

- [ ] **1.1** The script prints one banner with two URLs: operator viewer on port **8443** and IDE/admin on **8444**. On a fresh `.run/config` (no certificate) they are `http://`, not `https://` — the banner says which. There is no Vite dev server on 5173 any more: the runtime serves the built SPA from `sws-editor/dist`.
- [ ] **1.2** Browser to the IDE URL (`http://localhost:8444`). Over HTTPS, accept the self-signed cert if prompted (Firefox: Advanced → Accept), or open the plain-HTTP companion page on port 8080 first, which walks through accepting it.
- [ ] **1.3** Login screen appears with autofocus on the password field. Empty submit is disabled.
- [ ] **1.4** Type `admin` / `admin` (env-seeded). After submit you land on the editor with the demo project pre-opened (you see "Page 1" / "Demo …" in the page list).
- [ ] **1.5** Hit `https://localhost:8443/health` with `curl -k` → returns `ok`.
- [ ] **1.6** Hit `https://localhost:8443/metrics` with `curl -k` → Prometheus text exposition with `sws_uptime_seconds`, `sws_tag_count`, `sws_cpu_usage_pct`, etc.
- [ ] **1.7** Wrong password (`admin` / `nope`) shows "Credenziali non valide".
- [ ] **1.8** Ten wrong passwords in a row should hit the rate-limiter ("Troppi tentativi. Riprova fra un minuto.").

### Logout / re-login

- [ ] **1.9** Click `☰ Menu` → `Esci`. Lands on the login screen.
- [ ] **1.10** Login again — the editor restores the same project.

---

## 2. WelcomeScreen / project lifecycle

If `--project` auto-opens, click `☰ Menu` → **Chiudi progetto** to reach the WelcomeScreen.

- [ ] **2.1** WelcomeScreen lists at least the demo project under `.run/projects/`.
- [ ] **2.2** Click **+ Nuovo progetto** → enter a name (`smoke-test`) → it appears in the list.
- [ ] **2.3** Click on the new project → opens, header pill shows the project name.
- [ ] **2.4** Close project. Back on Welcome, hover the new project → **Rinomina** inline (✎). Rename to `smoke-test-2`.
- [ ] **2.5** **Duplica** → produces `smoke-test-2 (copia)`.
- [ ] **2.6** **Elimina** the copy. Confirm dialog. Card disappears.
- [ ] **2.7** **+ Nuovo progetto** → click the **Da template** tab → if `examples/templates/demo-items/` is seeded, you see it; create a new project from it.
- [ ] **2.8** **Da ZIP** tab → pick a previously-exported `sws-project-*.zip`. Project appears with `(2)` suffix if the name already existed.

### Multi-runtime (ARCH-004)

- [ ] **2.9** WelcomeScreen footer shows **📡 Connetti a runtime remoto…**.
- [ ] **2.10** Click → modal opens, paste another runtime URL (or `https://localhost:8443` itself for a loopback test). Click **Test connessione** → "✓ OK" if reachable.
- [ ] **2.11** Click **Connetti** → page reloads. Header pill `📡 host:port` appears.
- [ ] **2.12** Click the pill → confirm → reverts to local runtime.

> ⚠️ Cross-origin first connect requires accepting the cert in a separate tab once — see the gotcha banner in the modal.

---

## 3. Editor — canvas + selection + palette

Open any project. Switch to **edit mode** (the toggle is in the top header).

### Canvas navigation

- [ ] **3.1** Ctrl + wheel → zoom in/out centred on the cursor. Badge in the corner shows percentage.
- [ ] **3.2** Wheel (no Ctrl) → pan vertically. Shift + wheel → pan horizontally.
- [ ] **3.3** Middle-click + drag → pan freely.
- [ ] **3.4** Ctrl+0 → reset zoom 100% / pan 0,0.
- [ ] **3.5** Ctrl+Shift+0 (or the ⊡ button) → fit all objects to view.
- [ ] **3.6** Mouse position indicator `X:NNN Y:NNN` updates as you move (bottom-left).

### Palette → adding objects

- [ ] **3.7** Expand each category in the LeftPanel palette: **Forme**, **Controlli**, **Display**, **SCADA**, **Layout**. Each shows distinctive icons and colors.
- [ ] **3.8** Click each object type at least once. Verify it appears on the canvas:
  - Rettangolo, Ellisse, Linea, Testo, Immagine
  - Bottone, Nav page, Checkbox, Radio, Slider
  - Gauge, LED, Progress, Tabella, Trend
  - Simbolo (SCADA), Griglia (Layout)
- [ ] **3.9** Each object has a teal selection outline + a dashed grey container border in edit mode.

### Selection

- [ ] **3.10** Click an object → selected (teal outline). Click empty canvas → deselects.
- [ ] **3.11** Shift+click adds/removes from selection. Multi-selection shows aggregated properties on the right panel.
- [ ] **3.12** Drag on empty canvas → blue dashed rect selects everything it touches.
- [ ] **3.13** Ctrl+A selects every object on the page.

### Move / nudge

- [ ] **3.14** Drag an object → moves smoothly. Snap-to-grid (cyan line) appears when aligning with another object's edge/center.
- [ ] **3.15** Arrow keys → nudge 1 px. Shift+Arrows → nudge by `gridSize` px.

### Resize handles

- [ ] **3.16** Select a rectangle. 8 white/yellow handles appear (4 corners + 4 mid-edges).
- [ ] **3.17** Drag any handle → resizes live. Snap-to-grid active.
- [ ] **3.18** **Shift + drag a corner** → preserves aspect ratio (BL-005 follow-up). The driver axis is whichever moved more.
- [ ] **3.19** Mid-edge handles ignore Shift (only one dimension is meaningful).
- [ ] **3.20** Select a line → two endpoint circles. Drag each → endpoint moves only.

### Z-order

- [ ] **3.21** Multi-object overlap. Select the back one. Ctrl+] → forward by 1; Ctrl+Shift+] → to front; Ctrl+[ → backward; Ctrl+Shift+[ → to back. The right panel's ZOrderBar (⬆⬆/↑/↓/⬇⬇) does the same with buttons.

### Object lock

- [ ] **3.22** Toggle "Bloccato" in the LAYER section of the right panel. Clicking the object on canvas does nothing now. 🔒 appears in LeftPanel next to it.

### Bindings (BindableInput)

- [ ] **3.23** Click the 🔗 icon next to any property (fill, opacity, rotation, text, etc.) → input flips to a TagInput. Bind to an existing tag. The "BINDING ATTIVI" section at the bottom of the panel shows the active link.

### Rulers + guides (task 4.2)

- [ ] **3.24** Top + left ruler strips visible (20 px) with adaptive tick labels (1/2/5 progression; labels ≥ 50 screen-px apart at any zoom).
- [ ] **3.25** Click+drag from the top ruler downward → spawns a **vertical** orange dashed guide. Release inside canvas → committed.
- [ ] **3.26** Same from the left ruler → **horizontal** guide.
- [ ] **3.27** Drag an existing guide → repositions live. Drag back onto its ruler (line turns red) → release → deleted.
- [ ] **3.28** Drag an object near a guide → snaps to it (cyan magnet line).
- [ ] **3.29** Click the ⟂ corner square → rulers hide. Small ⟂ icon top-left brings them back. Reload page → preference persists (`localStorage["sws.canvas.showRulers"]`).
- [ ] **3.30** Switch page → guides are page-local (different page = different / no guides).

---

## 4. Editor — LeftPanel features

### Pages section

- [ ] **4.1** Click a page row → switches current page.
- [ ] **4.2** Double-click name or ✎ → inline rename. Enter commits, Esc cancels.
- [ ] **4.3** ↑ / ↓ → reorder pages (visible only when not first / last).
- [ ] **4.4** ⧉ → duplicate. New page named `<Original> (copia)`.
- [ ] **4.5** × → delete with confirm. Ctrl-Z restores it.
- [ ] **4.6** **⬇** next to a page → downloads `<Page Name>.yaml` (task 7.1).
- [ ] **4.7** Footer `⬆ YAML` button → file picker → import `.yaml`. New page gets a fresh id; collision adds `(2)` to the name.

### Object palette section

- [ ] **4.8** "Forme" category expanded by default. Other categories collapsed.
- [ ] **4.9** Click any category header → expand/collapse with chevron animation.

### Objects on page (tree)

- [ ] **4.10** With ≥4 objects, scroll the section. Each row shows lock icon (if locked), type tag, name, action buttons (✎/⧉/×).
- [ ] **4.11** Filter input top of section → filters by name / type / id real-time.
- [ ] **4.12** Click a row → selects on canvas.
- [ ] **4.13** Double-click name → inline rename.

#### Grouping (task 1.3 + 1.4)

- [ ] **4.14** Select 2+ objects on canvas. The button **+ Raggruppa selezionati (N)** appears above the list. Click → creates a 📁 group (default name). Ctrl+G does the same.
- [ ] **4.15** ▶ next to the group → expand to see members at 12 px indent. Click group header → selects all members.
- [ ] **4.16** Inline rename group via ✎ or double-click.
- [ ] **4.17** ⊔ button → ungroup (confirm dialog).
- [ ] **4.18** **Drag** an object row out of a group → drop onto the **⤓ Senza gruppo** zone (visible only during drag) → leaves the group.
- [ ] **4.19** Drag an object row onto another group's header → joins that group (inside indicator).
- [ ] **4.20** Drag within a group → reorder (before/after indicator lines).
- [ ] **4.21** Drag a 📁 group row onto another group → groups reorder.
- [ ] **4.22** **Right-click** an object row → context menu (Rinomina / Duplica / Sposta in gruppo → / Raggruppa selezione [if 2+ selected and clicked-row is part of it] / Elimina). Click outside / Esc closes.
- [ ] **4.23** Right-click a group row → menu (Rinomina gruppo / Separa gruppo).

#### Grid sub-tree

- [ ] **4.24** Add a Grid object (Layout palette). It expands automatically in the tree when its cells have children. ▶ toggle expands the grid → shows cell coordinates (R,C). Click a cell row → selects that cell + child on canvas.

### Functions section

- [ ] **4.25** Click **+ Nuova funzione**. The right panel switches to the full-screen Python editor.
- [ ] **4.26** CodeMirror syntax highlighting, line numbers, find/replace (Ctrl+F), dark theme.
- [ ] **4.27** Dropdown "Inserisci template…" → snippets (increment, toggle, conditional, …) — picks one inserts at cursor.
- [ ] **4.28** Unsaved indicator dot appears on edit. Save (toolbar) clears it.

### Tags section

- [ ] **4.29** With a project loaded, the section shows each tag with quality dot (green Good / yellow Uncertain / red Bad / grey unknown) and current value.

### Sources section

- [ ] **4.30** Each source row shows id + colored pill (`MQTT` purple, `MBUS` blue, `OPC-UA` green). Click a row → jumps to **Configurazione → Protocolli**.

### History section (visual undo/redo)

- [ ] **4.31** Make 3+ edits. The CRONOLOGIA section lists them. Click an older entry → jumps back. Future entries appear italic/greyed.
- [ ] **4.32** ↶ / ↷ buttons at the bottom = Ctrl+Z / Ctrl+Y.

---

## 5. ConfigView tabs

Click **Configurazione** in the top toggle.

### Variabili tab

- [ ] **5.1** Existing tags listed in a table. Add a new row with **+ Aggiungi variabile**. Fill id (`smoke.test1`), description, type (float/int/bool/string).
- [ ] **5.2** Save → green chip "✓ Salvato". The new tag appears in the LeftPanel Tags section.

### Protocolli tab

#### Modbus TCP

- [ ] **5.3** **+ Aggiungi Modbus TCP** → card with default host `192.168.1.10`, port 502, unit 1. Add a mapping row (tag + register).
- [ ] **5.4** Save → MBUS pill in LeftPanel.

#### MQTT

- [ ] **5.5** **+ Aggiungi MQTT** → card. Default host `broker.local`. Switch host to `broker.freemqtt.com`, add a topic mapping.
- [ ] **5.6** Click **🔍 Sfoglia broker** → modal subscribes to `#`, lists discovered topics. Pick one → import.
- [ ] **5.7** Test sezioni TLS, Last Will, QoS (foldable sub-sections).

#### OPC-UA (BL-005 full)

Start a simulator first: `npx node-opcua-server-example` (endpoint `opc.tcp://localhost:26543/UA/MyLittleServer`).

- [ ] **5.8** **+ Aggiungi OPC-UA** → card. Endpoint URL = simulator URL. Security policy = `None`. Auth = anonima.
- [ ] **5.9** Click **🔍 Sfoglia server** → modal opens, root level loads (Server / Objects). Click **📁 Objects** → expands (lazy load). Pick a Variable → checkbox → **Importa**. Row added to the Nodi table; `descrizione` pre-filled from display_name.
- [ ] **5.10** Set a Tag for the imported NodeId (or click `＋` to quick-create).
- [ ] **5.11** Save → in LeftPanel Sources you see the green `OPC-UA` pill. The Variabili tab shows the new tag with live updates.
- [ ] **5.12** **Writes** (step 4): on a synoptic page, put a button writing to the imported tag. Switch to view mode, click → check simulator logs for the write call. The tag value in LeftPanel echoes the new value immediately.
- [ ] **5.13** **Reverse browse** (advanced): from your browser DevTools console, `await fetch('https://localhost:8443/api/sources/opcua/browse', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + JSON.parse(localStorage.sws_auth).token }, body: JSON.stringify({ endpoint_url: 'opc.tcp://localhost:26543/UA/MyLittleServer', auth: { kind: 'anonymous' }, parent_node_id: 'ns=1;s=Temperature', direction: 'inverse' })}).then(r => r.json())` → returns the parent / inbound refs.

##### Security policies (BL-005c)

- [ ] **5.14** Change Security policy to **Basic256Sha256**. Save.
- [ ] **5.15** Check `<project>/opcua-pki/<source-id>/` — `own/cert.der` + `own/private.pem` appear (cert + key auto-generated).
- [ ] **5.16** First connect attempt usually fails — open the simulator UI (Prosys: Certificates → Rejected, node-opcua: usually permissive) and trust the SWS cert.
- [ ] **5.17** Within 5 s the runtime retries and connects. Logs show `opcua: connected, creating subscription`.

##### Euromap auto-detect (BL-005b)

If you have a real Euromap 77/83 device, click **🤖 Rileva Euromap**. Otherwise add a Variable on your simulator with `browse_name` = `CycleTime` (e.g. node-opcua: edit example), then:

- [ ] **5.18** Click **🤖 Rileva Euromap** → modal scans, table lists matches. Pre-selected. Click **Importa** → rows appear with `<source-id>.cycle_time` tag suggested + auto-created.

### Allarmi tab

- [ ] **5.19** Add an alarm row: tag = the smoke test tag, condition above 50, severity Warning, message "demo overflow".
- [ ] **5.20** Save. Drop the tag value above 50 (write via slider or button on a page). Banner appears at top with red border. The bell badge in RuntimeView lights up.
- [ ] **5.21** Optional: set `notify_url` to a webhook (`https://webhook.site/...`); when alarm goes active a POST is fired.

### Utenti tab (admin)

- [ ] **5.22** Tab visible only with admin role. Table lists the seeded admin.
- [ ] **5.23** **+ Nuovo utente** form: username `operator1`, password `op1234`, role Operator, "deve cambiare al primo login" on.
- [ ] **5.24** Logout. Login as `operator1` / `op1234` → forced ChangePasswordScreen. Set new password.
- [ ] **5.25** Now logged in as Operator: Utenti tab is hidden. Editor still works; sensitive admin actions (delete project, save sources from ConfigView) are gated where appropriate.
- [ ] **5.26** Logout. Back as admin → reset operator1's password (♻ button). Delete operator1. Confirm last-admin protection: try to delete the only admin → rejected.

### Risorse tab

- [ ] **5.27** Lists custom symbols if any. Form to add a new SVG: URL, label, license, author, source. Save.
- [ ] **5.28** Switch to Edit → Palette → Simbolo → SymbolGallery → group "Simboli progetto" includes the new symbol. Drop it on canvas.

### Stato tab

- [ ] **5.29** Card grid: runtime version, active project, uptime, tag count, sources, active alarms, historian samples. CPU/RAM/disk progress bars. Refresh every 10 s.

### Backup tab (admin)

- [ ] **5.30** Click **+ Backup adesso** → row appears with timestamp + size + create-now (modal close).
- [ ] **5.31** Check disk: `<project>/backups/<UTC-timestamp>/{project.yaml, synoptics/, users.yaml}` populated.
- [ ] **5.32** Make a change on a page + save. Click **Ripristina** on the backup → confirm → page reverts to backup state.
- [ ] **5.33** **Elimina** a backup → row disappears.
- [ ] **5.34** **Auto-backup**: stop `start_runtime.sh`, restart with `--auto-backup-interval-minutes 1 --auto-backup-retention 5` (edit `scripts/start_runtime.sh` or run the runtime binary directly). After 1 minute a new backup appears in the list. After 5 you start pruning oldest.

---

## 6. RuntimeView (view mode)

Toggle to **Esegui** in the header.

### Live data

- [ ] **6.1** Page nav bar across the top if 2+ pages. Click switches pages.
- [ ] **6.2** Objects bound to tags update in real time (try writing to a tag from another terminal: `curl -k -X PUT https://localhost:8443/api/tags/smoke.test1 -H 'Authorization: Bearer ...' -H 'Content-Type: application/json' -d '{"value": 42}'`).
- [ ] **6.3** Tag quality dot color changes (green / yellow / red).

### Operator widgets

- [ ] **6.4** A button bound to write a tag → click → tag value flips. **Inspect DevTools Network**: no HTTP `PUT /api/tags/...` should appear — the write goes over the existing `/ws/tags` socket (task 6.4 bidirectional WS).
- [ ] **6.5** DevTools WS frames inspector → outgoing `{"type":"write","tag":"...","value":...}`, incoming `{"type":"ack","tag":"...","ok":true}`.
- [ ] **6.6** Slider bound to write a numeric tag → drag → tag updates live.
- [ ] **6.7** Navbutton with `target_page` → click → page navigates.
- [ ] **6.8** A Trend object → samples flow in over time. The badge value updates.

### Alarms

- [ ] **6.9** Bell icon top-right with active count badge. Red border if any unacked. Click → dropdown lists alarms with severity dot + ACK button per row. **ACK tutti** appears when 2+ unacked.
- [ ] **6.10** Acknowledge an alarm → row goes green / removed. Recovery emits its own transition (visible in `/metrics` as `sws_alarm_transitions_total{direction="recovered"}`).

### Function test panel (task 6.3)

Only visible when the project defines functions.

- [ ] **6.11** Floating 🧪 button bottom-left → click → dialog opens.
- [ ] **6.12** Function dropdown lists every project function. Pick one. Editable inputs appear for each declared parameter (placeholder = default).
- [ ] **6.13** Click **▶ Esegui <funzione>** → output flows to the existing toast surface (stdout white, stderr amber, error red).

### Script output toasts

- [ ] **6.14** Any `on_press_fn` / `on_release_fn` producing stdout/stderr/error shows a card bottom-right. Auto-close 5 s on success / 10 s on error. Click × to dismiss. Max 4 visible at once.

### Log panel

Toggle in the header → drawer opens at the bottom (both edit + runtime mode).

- [ ] **6.15** Events flow live with timestamp + level color. Filters: 5 level checkboxes, target substring filter, full-text search with `<mark>` highlight, Pausa, Cancella. Auto-scroll detaches if you scroll up.
- [ ] **6.16** Date dropdown next to the live toggle → load an older `runtime-YYYY-MM-DD.jsonl` (located in `.run/logs/`). Header tints amber. Filters work on historical data too.
- [ ] **6.17** **⬇ Scarica** → JSONL download respecting current filters.

---

## 7. Save / import / export

### Save tutto

- [ ] **7.1** `☰ Menu → Salva tutto`. Chip shows "Salvataggio…" → "✓ Salvato" (2 s).
- [ ] **7.2** Force an error (kill the runtime mid-save) → chip turns red "❌ Errore — clicca per ritentare" with tooltip detail.

### Project ZIP export/import (admin)

- [ ] **7.3** `☰ Menu → Esporta progetto (.zip)` → downloads `sws-project-<name>-<ts>.zip`. MQTT passwords are stripped (replaced with empty).
- [ ] **7.4** Close project → Welcome → **Da ZIP** → upload the zip. New project appears with `(2)` suffix if name collides.
- [ ] **7.5** Open it → synoptic pages + tags + alarms + functions + custom symbols all round-trip. You re-enter MQTT passwords from Configurazione → Protocolli.

### Single-page YAML (task 7.1+7.3)

- [ ] **7.6** LeftPanel page row → **⬇** downloads `<Page Name>.yaml`.
- [ ] **7.7** Footer **⬆ YAML** → file picker → upload the YAML. New page with `(2)` suffix if name collides; navigates to it automatically.

---

## 8. Sessione / token / re-auth

- [ ] **8.1** Login. In DevTools Application → LocalStorage → `sws_auth` JSON has token + role + must_change_password.
- [ ] **8.2** Manually delete the token from LocalStorage. Trigger any action → modal **Sessione scaduta** appears, username pre-filled. Type password → session restored, the in-flight work survives.
- [ ] **8.3** Dismiss the re-auth modal (×) → falls back to LoginScreen.

---

## 9. Metrics + system endpoints

```sh
TOKEN=$(curl -ks -X POST https://localhost:8443/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)
```

- [ ] **9.1** `curl -k https://localhost:8443/health` → `ok` (no auth).
- [ ] **9.2** `curl -k https://localhost:8443/metrics` → Prometheus text. Look for:
  - `sws_uptime_seconds`
  - `sws_tag_count`
  - `sws_alarm_active_count`
  - `sws_cpu_usage_pct`
  - `sws_memory_used_bytes` / `_total_bytes`
  - `sws_disk_used_bytes` / `_total_bytes`
  - After clicking buttons / running scripts: `sws_script_exec_total{endpoint,status}`, `sws_http_requests_total{path,method,status}`, `sws_alarm_transitions_total{direction,severity}`.
- [ ] **9.3** `curl -k -H "Authorization: Bearer $TOKEN" https://localhost:8443/api/system | jq` → JSON with `runtime_version`, `uptime_s`, `active_project`, `tag_count`, `source_count`, `alarm_active_count`, `cpu_usage_pct`, `mem_used_mb`, `mem_total_mb`, `disk_used_gb`, `disk_total_gb`.

---

## 10. Deployment shapes

### ARCH-001 — Runtime serves the SPA

- [ ] **10.1** Build the editor: `cd sws-editor && corepack pnpm build` → `dist/` produced.
- [ ] **10.2** Launch runtime alone: `./sws-runtime/target/debug/sws-runtime --www /path/to/sws-editor/dist --project .run/projects/<name>`.
- [ ] **10.3** Browser to `https://localhost:8443/` (note: 8443, not 5173). SPA loads, `/api/*` + `/ws/*` work natively. No Nginx container needed.

### ARCH-002 — Remote runtime via VITE_RUNTIME_URL

- [ ] **10.4** Two hosts (or two ports). On host A: `./scripts/start_runtime.sh`. On host B: `./scripts/start_editor.sh` (IDE only, port 8460), then point it at host A from the UI: ConfigView → Runtime → **Connetti** with `http://hostA:8444` (the **admin** port — the viewer port 8443 has no project-lifecycle routes, so a deploy would fail with 404/405). The URL is stored in `localStorage["sws.runtimeBaseUrl"]`, which takes priority over everything else in `api/client.ts`.
- [ ] **10.5** Browser to host B's editor → all API + WS go to host A.

> `VITE_RUNTIME_URL` still works, but only for `pnpm dev` (the Vite proxy target): the launcher scripts serve the built SPA and never start Vite.

### ARCH-003 — Kiosk browser

- [ ] **10.6** Install a browser on the box: `sudo apt install chromium`.
- [ ] **10.7** Start runtime with `--kiosk-browser "chromium --kiosk --no-sandbox --app=https://localhost:8443"`. After `/health` is up the browser opens automatically in fullscreen kiosk mode. Killing the browser doesn't stop the runtime.

### ARCH-004 — Multi-runtime SPA

Covered in §2.9-2.12 above.

---

## 11. Playwright e2e (task 9.1)

```sh
# Terminal A — keep the runtime running. The admin env vars are required:
# start_runtime.sh seeds no user, and the e2e tests perform a login.
SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin ./scripts/start_runtime.sh

# Terminal B (first run only)
cd sws-editor && npx playwright install chromium

# Terminal B (each run)
cd sws-editor && corepack pnpm test:e2e
```

- [ ] **11.1** Both tests pass:
  - `login → add rect → save → reload preserves the rect`
  - `login form shows error on wrong password`
- [ ] **11.2** `corepack pnpm test:e2e:ui` opens Playwright's UI; rerun individual tests.
- [ ] **11.3** Failure artefacts: `sws-editor/playwright-report/` + `sws-editor/test-results/`.

---

## 12. Workspace tests + lint

```sh
cd sws-runtime && PYO3_PYTHON=python3 cargo test --workspace
cd sws-editor && corepack pnpm type-check && corepack pnpm build
```

- [ ] **12.1** Workspace: **53** unit tests pass (last count, sessione 29). Includes the OPC-UA dictionary integrity check, the backup roundtrip, the Prometheus recorder idempotence, etc.
- [ ] **12.2** Editor: tsc with zero errors, vite build produces `dist/`.

---

## 13. Headless restart / persistence

- [ ] **13.1** Stop `start_runtime.sh`. Restart it. Browser refresh → previous project re-opens, pages + tags + alarms intact (project.yaml + synoptics on disk).
- [ ] **13.2** `.run/logs/runtime-YYYY-MM-DD.jsonl` updated through the day; older days rotated. `SWS_LOG_RETENTION_DAYS=N` controls retention (default 7).
- [ ] **13.3** Login sessions are in-memory only — every runtime restart logs everyone out. Expected and documented in `LoginScreen.tsx`.

---

## 14. Bug-hunt edge cases

- [ ] **14.1** Rename page → save → reload. Old `.yaml` file removed; new one present (fix `ff32e40`).
- [ ] **14.2** Fresh clone: `rm -rf .run && ./scripts/start_runtime.sh` → **no** project is seeded any more (`dev.sh` used to create one): the WelcomeScreen opens with an empty project list and the bundled templates from `--templates-root`. Create one from a template and it becomes the project auto-opened at the next start.
- [ ] **14.3** No password env → runtime refuses to start with a clear error.
- [ ] **14.4** Invalid YAML on the synoptic import → 400 with the parse error in the response body; nothing written on disk.
- [ ] **14.5** Same `id` on two synoptic files (after manual fiddle) → save_synoptic removes the stale duplicate.

---

## What's NOT in this guide

Items deliberately out of scope (because they're explicit follow-ups):

- **Vendor-curated OPC-UA server trust list** (today every server cert is trusted).
- **OPC-UA historical reads** (`HistoryRead` service).
- **OPC-UA reverse-connect mode**.
- **MQTT Sparkplug B** encoding/decoding (Q2 in `OPEN_QUESTIONS.md`).
- **HMAC-signed / hash-chained audit log**.
- **Public security advisory feed + formal CVE process**.
- **OAuth2 / LDAP / 2FA**.
- **OTA update with rollback**.
- **PX30 hardware kiosk demo** (see `docs/YOCTO_CROSSCOMPILE.md` instead).

These are tracked in `STATUS.md` § Prossimi step / Backlog.

---

## Reporting results

If a step fails:

1. Note the section + step number.
2. Save the runtime log slice from `.run/logs/runtime-<date>.jsonl` covering the moment of failure.
3. Save the browser console + DevTools network trace if applicable.
4. Attach to the bug write-up (or paste into a `STATUS.md` "Bug aperti" section under a fresh date header).

For Playwright failures: the `trace.zip` under `sws-editor/test-results/<spec-name>/` reproduces the run frame-by-frame — open with `npx playwright show-trace path/to/trace.zip`.
