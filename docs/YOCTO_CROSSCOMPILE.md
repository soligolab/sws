# Cross-compiling `sws-runtime` for Pixsys Yocto devices

> Native cross-compile flow used at the dev server in ufficio. Targets PX30 /
> RK3399 / RK3588 with a single `cortexa35-pixsys-linux` binary (cortex-a35 is
> the ARMv8 baseline of the trio — the other two are upward compatible).
>
> The kiosk (`sws-kiosk`, GTK4 + WebKitGTK) is **not** cross-compiled here: the
> Pixsys sysroot doesn't ship GTK4 / WebKitGTK headers + libs. Kiosk stays
> host-built and is deployed only to boxes that already have those packages
> (today: the home Ubuntu desktop, see `docs/TEST_SETUPS.md`).

---

## 1. Prereqs on the dev box (one-off)

1. **Pixsys Yocto SDK installed** at `/usr/local/oecore-x86_64/`.
   The script sources `environment-setup-cortexa35-pixsys-linux` from there.
   Quick check:

   ```
   test -f /usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux \
     && echo SDK ok
   ```

2. **Rust target**:

   ```
   rustup target add aarch64-unknown-linux-gnu
   ```

   `build.sh` adds it automatically if missing.

3. **pnpm** on `$PATH` (only when embedding the SPA — default). `corepack
   enable` works fine.

4. **A host `python3` on PATH.** `pyo3-build-config` runs a host Python at
   compile time even in cross mode (to introspect the bindings). On Debian
   that means `apt install python3` — `build.sh` auto-exports
   `PYO3_PYTHON=$(command -v python3)` so the default `/usr/bin/python`
   path doesn't matter.

5. **Sysroot contains Python 3.12 headers + lib** (needed by PyO3 cross).
   Verified once on 2026-05-20:

   ```
   ls /usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux/usr/include/python3.12/Python.h
   ls /usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux/usr/lib/libpython3.12.so
   ```

   If either is missing, the SDK was built without `python3-dev` — rebuild
   the Yocto SDK with `meta-pixsys` `python3-dev` in `TOOLCHAIN_TARGET_TASK`.

6. **`clang` + `libclang-dev` + `libsdl2-dev` on the host** — required by the
   LVGL viewer, built **by default** since 2026-08-24:

   ```
   sudo apt install clang libclang-dev libsdl2-dev
   ```

   Both `lvgl-sys` and `sws-lvgl-viewer/build.rs` run bindgen, which loads
   `libclang` at build time; the viewer links SDL2.

   **Dal 2026-08-25 questi tre pacchetti non sono più opzionali per chi tocca
   il repo**, non solo per chi cross-compila: `sws-lvgl-viewer` è entrato nel
   workspace, quindi `cargo check --workspace` e `cargo test --workspace` lo
   compilano ed eseguono. Senza, il workspace non compila affatto.

   Il motivo del cambio: finché era escluso, quel crate non era toccato né
   dalla CI né dal `cargo check` che fa da definizione di fatto — ed è il crate
   dove si sono concentrati i difetti (il crash della sparkline di Q22, i
   binding che non si muovevano). I suoi 39 test ora girano sul PC di sviluppo
   invece che solo cross-compilati ed eseguiti a mano sul pannello.

   Il viewer si può ancora saltare nella **cross-compilazione** con
   `--no-lvgl`; quello che non si può più saltare è la compilazione nativa del
   workspace.

7. **Sysroot contains SDL2 + libdrm dev files** (the LVGL viewer links both).
   Verified on 2026-08-24 — this closed a "not verified" note the scripts had
   been carrying since the crate was created:

   ```
   ls /usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux/usr/include/SDL2
   ls /usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux/usr/lib/pkgconfig/sdl2.pc
   ls /usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux/usr/include/libdrm
   ```

8. **`libsdl2-dev` on the host** — needed **only** to build or test the viewer
   natively (`cd crates/sws-lvgl-viewer && cargo test`), not to cross-compile
   it. The crate is a `[[bin]]`, so even a pure unit test links the whole
   binary against SDL2. Cross-compiling uses the sysroot copy instead and does
   not need this.

> **Perché una cross-build tocca anche il compilatore dell'host.** `lvgl 0.6.2`
> dichiara `lvgl-sys` fra le proprie `[build-dependencies]` (il suo `build.rs`
> chiama `lvgl_sys::_bindgen_raw_src()`), quindi i sorgenti C di LVGL vengono
> compilati **due volte**: per il target e per l'host. Il `source` dell'SDK
> esporta `CC=aarch64-pixsys-linux-gcc` globalmente, e senza contromisure cc-rs
> lo userebbe anche per l'unità host, aggiungendoci `-m64` — corretto per
> x86_64, fatale per il gcc aarch64. `build.sh` esporta perciò `HOST_CC=gcc` e
> `HOST_CFLAGS=""`. **Attenzione al nome**: cc-rs vuole `HOST_CC` o il triple in
> minuscolo (`CC_x86_64_unknown_linux_gnu`); la forma maiuscola in stile
> `CARGO_TARGET_*` è una convenzione di cargo e qui non viene letta.

---

## 2. Building

From repo root:

```
./scripts/yocto/build.sh             # release, embeds SPA dist (default)
./scripts/yocto/build.sh --no-spa    # skip pnpm build of sws-editor
./scripts/yocto/build.sh debug       # cargo build without --release
```

What the script does (see `scripts/yocto/build.sh`):

- Sources the SDK env (`CC`, `CXX`, `AR`, `PKG_CONFIG_*`, …).
- Sets `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER` to
  `scripts/yocto/yocto-linker.sh`, which invokes
  `aarch64-pixsys-linux-gcc` with `-mcpu=cortex-a35+crc+crypto`,
  `-mbranch-protection=standard`, and the SDK sysroot.
- Sets PyO3 cross hints (`PYO3_CROSS_LIB_DIR`,
  `PYO3_CROSS_PYTHON_VERSION=3.12`).
- Optionally builds the SPA (`pnpm build` in `sws-editor/`).
- `cargo build --target aarch64-unknown-linux-gnu -p sws-runtime
  [--release]`.

Output:

```
sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime
sws-editor/dist/                          (SPA bundle, when --no-spa not set)
```

The release profile is tuned in `sws-runtime/Cargo.toml`:

```toml
[profile.release]
lto = "thin"
strip = "symbols"
codegen-units = 1
opt-level = 3
```

A clean release build takes ~2-4 minutes on this dev box (LTO is the slow
part). Incremental rebuilds are seconds.

---

## 3. Sanity-checking the binary

```
BIN=sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime
file "$BIN"
aarch64-pixsys-linux-readelf -d "$BIN" | grep NEEDED
```

Expected:

- `file` → `ELF 64-bit LSB pie executable, ARM aarch64, ...`
- `NEEDED` → only `libpython3.12.so.1.0`, `libgcc_s.so.1`, `libm.so.6`,
  `libc.so.6`, and the linker `ld-linux-aarch64.so.1`.
  (`rusqlite` is built with `bundled` so `libsqlite3` is statically linked;
  `libpthread`/`libdl` merged into `libc` on glibc 2.34+.) No `libgtk*` /
  `libwebkit*` / `libssl` — those belong to the kiosk or to crates we
  deliberately avoid.

If anything else shows up (especially OpenSSL): something pulled a
non-vendored crate; bisect with `cargo tree -e features -i <crate>`.

Reference build (2026-05-21): 18 MB stripped binary, release profile (LTO
thin, `strip=symbols`), 3m40s clean build on the office dev server.

---

## 4. Deploying

```
./scripts/yocto/deploy.sh pixsys@<host>             # release + restart
./scripts/yocto/deploy.sh pixsys@<host> --no-restart
./scripts/yocto/deploy.sh pixsys@<host> --debug
```

Prereqs:

- Build done (`scripts/yocto/build.sh`).
- Passwordless SSH + sudo to `<host>` already set up (`ssh-copy-id` is run
  manually by the maintainer — see `feedback-yocto-device-access` and
  `docs/TEST_SETUPS.md`). **Always ask the maintainer for the device IP
  before running this** — addresses change per session.

Layout on device (created on first install, never overwritten afterwards
for the `runtime.env` file):

```
/data/user/sws/
  sws-runtime              binary
  sws-runtime-launch.sh    env loader + exec wrapper
  runtime.env              per-device overrides (admin user / passwords)
  config/                  TLS certs, generated on first start
  projects/                operator projects
  templates/               bundled templates from examples/templates/
  www/                     SPA dist (served at /)
  historian.db             SQLite, created on first start

/etc/systemd/system/sws-runtime.service
```

> Why `/data/user/sws` and not `/opt/sws`: Pixsys Yocto devices mount `/`
> read-only (squashfs/ubifs) and use `/data/user` as the writable scratch
> partition. `scp` from the `pixsys` account can only target there. The
> staging dir is also under `/data/user` so the post-staging `sudo install`
> step is a same-partition rename instead of a cross-partition copy.

The unit runs the launch wrapper, which sources `runtime.env` and execs
`sws-runtime --config ... --projects-root ... --templates-root ...
--www ...`.

Quick check from the dev box after a deploy:

```
curl -k https://<host>:8443/health        # viewer operatori → "ok"
curl -k https://<host>:8444/health        # admin IDE → "ok"
```

> **Nota porte (T-21)**: il runtime avvia due server HTTPS.
> `8443` = viewer operatori (optional_auth, esposto agli operatori).
> `8444` = admin IDE (required_auth, solo per deploy e amministrazione — non esporre agli operatori in produzione).

If `/health` doesn't answer, on the device:

```
sudo systemctl --no-pager status sws-runtime.service
sudo journalctl -u sws-runtime.service -n 200 --no-pager
```

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `aarch64-pixsys-linux-gcc: not found` after sourcing SDK | SDK not installed, or installed under a different prefix | reinstall SDK under `/usr/local/oecore-x86_64/`, or edit `SDK_ENV` at the top of `scripts/yocto/build.sh` |
| `cargo` link error: `cannot find -lpython3.12` | sysroot missing Python lib, or `PYO3_CROSS_LIB_DIR` wrong | check `ls $OECORE_TARGET_SYSROOT/usr/lib/libpython3.12.so*`; rebuild SDK with `python3-dev` if missing |
| `pyo3: cross-compilation requires PYO3_CROSS_PYTHON_VERSION` | build env didn't keep the export | re-run via `./scripts/yocto/build.sh` (it exports it); don't call `cargo build` by hand |
| `failed to run the Python interpreter at /usr/bin/python: No such file or directory` | Debian box has only `python3`, no `python` alias | `apt install python3` + let `build.sh` auto-export `PYO3_PYTHON` (already does), or `sudo ln -s /usr/bin/python3 /usr/bin/python` |
| `readelf -d` shows `libssl`/`libcrypto` | a crate pulled native OpenSSL | find it (`cargo tree -i openssl-sys`); switch to `rustls`-backed features |
| `readelf -d` shows `libgtk-4`/`libwebkit2gtk` | accidentally built `sws-kiosk` for the target | only build `-p sws-runtime` (default in `build.sh`); kiosk is host-only |
| Deploy succeeds but `/health` is silent | systemd unit not enabled, or port 8443 firewalled | `systemctl status sws-runtime`, then `journalctl -u sws-runtime -n 100` |
| `sws-runtime` exits with `permission denied` on `historian.db` | first start as a non-root user that can't write `/data/user/sws/` | unit currently runs `User=root` for the PoC — confirm `User=` line in `/etc/systemd/system/sws-runtime.service` |
| Re-deploy wipes `runtime.env` | shouldn't happen — `deploy.sh` only seeds it when missing | check `deploy.sh` install block; if intentional during a major upgrade, back up the file first |

---

## 6. Files in this flow

| File | Purpose |
|---|---|
| `scripts/yocto/build.sh` | wrapper that sources SDK env + invokes cargo with the right cross config |
| `scripts/yocto/yocto-linker.sh` | linker wrapper invoked by cargo for the aarch64 target |
| `scripts/yocto/deploy.sh` | rsync/scp binary + SPA + systemd unit to a device, restart |
| `deploy/yocto/sws-runtime.service` | systemd unit installed at `/etc/systemd/system/` |
| `deploy/yocto/sws-runtime-launch.sh` | env loader + exec wrapper installed at `/data/user/sws/` |
| `sws-runtime/Cargo.toml` (`[profile.release]`) | LTO + strip + opt-level for size-/perf-tuned builds |

---

## 7. Out of scope (for now)

- **Kiosk cross-compile.** Needs GTK4 + WebKitGTK in the Yocto sysroot.
  Tracked as a separate effort — see `STATUS.md` and `docs/TEST_SETUPS.md`.
- **Container build for the PX30.** The Podman / `compose.yaml` path
  (see `docs/DEPLOY_PX30.md`) is the older flow; this native cross-compile
  is the simpler path the maintainer is moving toward.
- **Signed artefacts / SBOM-per-device.** CRA item, post-PoC.
- **OTA / atomic-rollback updates.** Post-PoC.
