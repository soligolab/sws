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
/opt/sws/
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

The unit runs the launch wrapper, which sources `runtime.env` and execs
`sws-runtime --config ... --projects-root ... --templates-root ...
--www ...`.

Quick check from the dev box after a deploy:

```
curl -k https://<host>:8443/health        # → "ok"
```

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
| `sws-runtime` exits with `permission denied` on `historian.db` | first start as a non-root user that can't write `/opt/sws/` | unit currently runs `User=root` for the PoC — confirm `User=` line in `/etc/systemd/system/sws-runtime.service` |
| Re-deploy wipes `runtime.env` | shouldn't happen — `deploy.sh` only seeds it when missing | check `deploy.sh` install block; if intentional during a major upgrade, back up the file first |

---

## 6. Files in this flow

| File | Purpose |
|---|---|
| `scripts/yocto/build.sh` | wrapper that sources SDK env + invokes cargo with the right cross config |
| `scripts/yocto/yocto-linker.sh` | linker wrapper invoked by cargo for the aarch64 target |
| `scripts/yocto/deploy.sh` | rsync/scp binary + SPA + systemd unit to a device, restart |
| `deploy/yocto/sws-runtime.service` | systemd unit installed at `/etc/systemd/system/` |
| `deploy/yocto/sws-runtime-launch.sh` | env loader + exec wrapper installed at `/opt/sws/` |
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
