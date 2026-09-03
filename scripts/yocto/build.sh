#!/usr/bin/env bash
#
# Cross-compile sws-runtime for Pixsys Yocto devices (aarch64 / cortex-a35).
# Same binary covers PX30, RK3399 and RK3588 (cortex-a35 is the ARMv8
# baseline of the trio; the others are upward compatible).
#
# Prereqs on the dev box (one-off):
#   1. SDK installed at /usr/local/oecore-x86_64/  (the sourceable env script
#      $SDK_ENV must exist — see below)
#   2. rustup target add aarch64-unknown-linux-gnu
#   3. pnpm available (corepack or shim); only required when --www embedding
#      is enabled (default)
#
# Usage:
#   ./scripts/yocto/build.sh             # release, SPA inclusa, LVGL incluso
#   ./scripts/yocto/build.sh --no-spa    # skip pnpm build of sws-editor
#   ./scripts/yocto/build.sh debug       # cargo build without --release
#   ./scripts/yocto/build.sh --no-lvgl   # NON cross-compilare sws-lvgl-viewer
#
# Output: sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime
#         (or debug/ for debug), e salvo --no-lvgl anche
#         sws-runtime/crates/sws-lvgl-viewer/target/aarch64-unknown-linux-gnu/release/sws-lvgl-viewer
#
# LVGL è acceso per default dal 2026-08-24. Era opt-in perché sws-lvgl-viewer
# linka SDL2 di sistema e serviva libsdl2-dev nel sysroot Pixsys, "non
# verificato" quando il crate è nato: **misurato il 2026-08-24 su una macchina
# con l'SDK, header, .so e sdl2.pc ci sono**, e con essi libdrm. Serve anche
# clang/libclang sull'host, perché lvgl-sys e build.rs usano bindgen.
#
# `--no-lvgl` resta come uscita di sicurezza: su un sysroot senza SDL2 il
# principio di prima vale ancora, cioè un pacchetto di sviluppo mancante non
# deve mai far fallire la build di sws-runtime, da cui dipende tutto il resto.
#
# The Vite dist (when built) is at sws-editor/dist/ on the dev box. The
# deploy script picks both up.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LINKER_WRAPPER="$REPO_ROOT/scripts/yocto/yocto-linker.sh"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"
TARGET_TRIPLE="aarch64-unknown-linux-gnu"

PROFILE="release"
BUILD_SPA=1
# LVGL è ACCESO per default dal 2026-08-24 (decisione del maintainer): sui
# prodotti Pixsys si deve poter provare sia il runtime web sia quello LVGL, e
# un'immagine che non porta il viewer costringe a una seconda pubblicazione.
# Era opt-in perché SDL2 nel sysroot Pixsys era dichiarato "non verificato":
# misurato il 2026-08-24 su questa macchina, header, .so e sdl2.pc ci sono.
WITH_LVGL=1
for arg in "$@"; do
  case "$arg" in
    debug)       PROFILE="debug" ;;
    release)     PROFILE="release" ;;
    --no-spa)    BUILD_SPA=0 ;;
    # Accettata e senza effetto: era il modo di chiederlo, non deve rompersi
    # in mano a chi ce l'ha nelle dita o in uno script.
    --with-lvgl) WITH_LVGL=1 ;;
    --no-lvgl)   WITH_LVGL=0 ;;
    *) echo "[build] unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────

if [ ! -f "$SDK_ENV" ]; then
  echo "[build] ERROR: SDK env script not found at $SDK_ENV" >&2
  echo "[build] Install the Pixsys Yocto SDK first." >&2
  exit 1
fi

if [ ! -x "$LINKER_WRAPPER" ]; then
  echo "[build] ERROR: linker wrapper missing or not executable: $LINKER_WRAPPER" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET_TRIPLE"; then
  echo "[build] installing Rust target $TARGET_TRIPLE…"
  rustup target add "$TARGET_TRIPLE"
fi

# ── Source SDK env (in a subshell — see comment below) ───────────────────────
#
# We deliberately source the SDK inside the same shell so cargo inherits all
# the cross-compile env (PKG_CONFIG_*, AR, CC for cc-rs, etc.). Side effect:
# the SDK overrides PATH and pkg-config. That's fine for this script — it
# only does cross builds.
#
# If you ever need to run host-native cargo from this same shell afterwards,
# open a new terminal — undoing the SDK env in-place is brittle.

# shellcheck disable=SC1090
. "$SDK_ENV"

# Sanity check the cross compiler is reachable.
if ! command -v aarch64-pixsys-linux-gcc >/dev/null 2>&1; then
  echo "[build] ERROR: aarch64-pixsys-linux-gcc not on PATH after sourcing SDK env." >&2
  exit 1
fi

# ── Cargo env ────────────────────────────────────────────────────────────────
#
# CARGO_TARGET_*_LINKER replaces the linker for the target triple with our
# wrapper, which invokes aarch64-pixsys-linux-gcc with the right sysroot
# and cortex-a35 flags. This is the same trick test-kit uses.
#
# PyO3 needs explicit cross hints — it cannot guess libpython location from
# the SDK env alone. Sysroot was verified to contain libpython3.12.so +
# Python.h on 2026-05-20.

export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$LINKER_WRAPPER"
export PYO3_CROSS_LIB_DIR="$OECORE_TARGET_SYSROOT/usr/lib"
export PYO3_CROSS_PYTHON_VERSION="3.12"

# Il compilatore C per il lato HOST di una cross-build.
#
# Serve perché `lvgl 0.6.2` dichiara `lvgl-sys` fra le [build-dependencies]:
# il suo build.rs chiama `lvgl_sys::_bindgen_raw_src()`, quindi cargo deve
# compilare i sorgenti C di LVGL **anche per l'host**, non solo per il target.
# Sourcing dell'SDK esporta CC=aarch64-pixsys-linux-gcc *globalmente*, e cc-rs
# lo raccoglie anche per quella compilazione host: poi ci aggiunge `-m64` —
# corretto per x86_64 — e il gcc aarch64 muore su "unrecognized command-line
# option '-m64'". Diagnosticato il 2026-08-24, alla prima cross-compilazione
# del crate LVGL mai tentata.
#
# `HOST_CC`/`HOST_CFLAGS` è la forma giusta: per l'unità host cc-rs non si
# considera in cross-compilazione (TARGET == HOST) e consulta quel prefisso.
# ATTENZIONE al nome: cc-rs vuole il triple in **minuscolo**
# (`CC_x86_64_unknown_linux_gnu`); la forma maiuscola `CARGO_TARGET_*` è una
# convenzione di cargo e qui non verrebbe letta — sbagliato al primo tentativo.
# Il triple si chiede a rustc invece di cablarlo: questo script gira anche
# altrove.
HOST_TRIPLE="$(rustc -vV | awk '/^host: /{print $2}')"
if command -v gcc >/dev/null 2>&1; then
  export HOST_CC="gcc"
  # Anche i CFLAGS: quelli dell'SDK sono innocui qui, ma `-mcpu=cortex-a35`
  # arriverebbe al gcc dell'host, che non lo conosce.
  export HOST_CFLAGS=""
  if [ -n "$HOST_TRIPLE" ]; then
    export "CC_$(echo "$HOST_TRIPLE" | tr '-' '_')=gcc"
    export "CFLAGS_$(echo "$HOST_TRIPLE" | tr '-' '_')="
  fi
fi

# ── Il sysroot per bindgen, che è un pezzo a sé ──────────────────────────────
#
# `lvgl-sys` genera i binding con bindgen, e il suo build.rs — quando
# TARGET != HOST — passa a clang **soltanto** `-target aarch64-unknown-linux-gnu`
# (vendor/lvgl-sys-0.6.2/build.rs:185-190). Nessun `--sysroot`. Clang legge
# quindi lo `/usr/include/stdint.h` dell'HOST ma con un target aarch64, va a
# cercare gli header multiarch di quella architettura, e su un host x86_64 non
# ci sono:
#
#     /usr/include/stdint.h:26:10: fatal error: 'bits/libc-header-start.h' file not found
#     Unable to generate bindings: ClangDiagnostic(...)
#
# Visto su frodo il 2026-09-03, alla prima build dell'immagine Pixsys su questa
# macchina. Su theobroma non capitava perché là gli header aarch64 dell'host
# c'erano (`libc6-dev-arm64-cross`): un prerequisito di sistema che nessuno
# aveva scritto da nessuna parte, e che è sparito col trasloco.
#
# Si dà a clang il sysroot **dell'SDK** e non quello di Debian, e non è
# equivalente: i binding descrivono i tipi della libc contro cui il binario
# girerà davvero, non quelli di una aarch64 generica. bindgen legge la variabile
# da sé e la accoda agli argomenti del build.rs, quindi non serve toccare il
# codice vendorizzato — che è anche la ragione per cui questa è la cura giusta:
# una patch al vendor si perde alla prossima re-importazione (vedi
# `check_vendor_patches.sh` e Q22).
#
# **La forma per-target, e non quella globale.** `BINDGEN_EXTRA_CLANG_ARGS`
# senza suffisso si applica a **tutte** le unità di bindgen della build,
# compresa quella per l'HOST — e lvgl-sys viene compilato anche per l'host,
# perché `lvgl` lo dichiara fra le [build-dependencies]. Puntando il clang x86_64
# al sysroot aarch64 si sposta soltanto il guasto:
#
#     .../cortexa35-pixsys-linux/usr/include/bits/timesize.h:23:10:
#         fatal error: 'bits/timesize-32.h' file not found
#
# Sbagliato al primo tentativo, il 2026-09-03. `bindgen` 0.64 risolve
# `BINDGEN_EXTRA_CLANG_ARGS_<TARGET>` (con trattini o underscore) e ricade sulla
# globale solo se quella specifica non c'è — verificato in
# `get_target_dependent_env_var`, lib.rs:2966.
# Underscore e non trattini: `export` rifiuta un nome con `-`, che non è un
# identificatore shell valido. bindgen accetta entrambe le forme.
export "BINDGEN_EXTRA_CLANG_ARGS_${TARGET_TRIPLE//-/_}=--sysroot=$OECORE_TARGET_SYSROOT"

# pyo3-build-config still needs a *host* Python to run its build script.
# Debian dev box has python3 but not /usr/bin/python (the default pyo3 path).
# Point it at python3 explicitly to avoid "No such file or directory" errors.
if [ -z "${PYO3_PYTHON:-}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYO3_PYTHON="$(command -v python3)"
    export PYO3_PYTHON
  else
    echo "[build] ERROR: no host python3 on PATH (needed by pyo3-build-config)." >&2
    exit 1
  fi
fi

# cc-rs (used by rusqlite/bundled, ring, etc.) will pick up $CC/$CXX from the
# SDK env. No extra config needed.

# ── Optional: build the SPA so the runtime can embed it via --www ────────────

if [ "$BUILD_SPA" -eq 1 ]; then
  if [ ! -d "$REPO_ROOT/sws-editor/node_modules" ]; then
    echo "[build] installing sws-editor deps (first run)…"
    (cd "$REPO_ROOT/sws-editor" && pnpm install)
  fi
  echo "[build] building SPA bundle (pnpm build)…"
  (cd "$REPO_ROOT/sws-editor" && pnpm build)
else
  echo "[build] skipping SPA build (--no-spa)"
fi

# ── Cargo build ──────────────────────────────────────────────────────────────

CARGO_FLAGS=( --target "$TARGET_TRIPLE" -p sws-runtime )
case "$PROFILE" in
  release) CARGO_FLAGS+=( --release ) ;;
  debug)   : ;;
esac

echo "[build] cargo build ${CARGO_FLAGS[*]}"
(cd "$REPO_ROOT/sws-runtime" && cargo build "${CARGO_FLAGS[@]}")

# ── Optional: sws-lvgl-viewer (--with-lvgl) ─────────────────────────────────
#
# Excluded from the sws-runtime workspace (see its own Cargo.toml comment),
# so it needs its own `cargo build` invocation — and it MUST run with that
# crate's directory as cwd, not via --manifest-path from elsewhere: it has a
# local .cargo/config.toml that points DEP_LV_CONFIG_PATH at lv_conf/
# relative to the current directory, and cargo's config discovery walks up
# from cwd, not from the manifest path.

if [ "$WITH_LVGL" -eq 1 ]; then
  # Le correzioni al sorgente LVGL vendorizzato devono essere ancora applicate.
  #
  # Non è una formalità: cargo NON si accorge se qualcuno le cancella. Il
  # build.rs di lvgl-sys osserva solo lv_conf.h, non i sorgenti C, quindi una
  # re-importazione della libreria riporta il difetto e la compilazione
  # successiva non dice niente. Vedi docs/OPEN_QUESTIONS.md Q22 per il caso che
  # ha motivato questo controllo — un crash non deterministico costato due
  # giorni.
  echo "[build] verifica delle patch al codice vendorizzato"
  if ! "$REPO_ROOT/scripts/check_vendor_patches.sh"; then
    echo "[build] ERROR: patch al codice vendorizzato mancanti — build interrotta." >&2
    echo "[build]        Riapplica con: ./scripts/check_vendor_patches.sh --apply" >&2
    exit 1
  fi

  LVGL_CRATE_DIR="$REPO_ROOT/sws-runtime/crates/sws-lvgl-viewer"
  LVGL_CARGO_FLAGS=( --target "$TARGET_TRIPLE" )
  case "$PROFILE" in
    release) LVGL_CARGO_FLAGS+=( --release ) ;;
    debug)   : ;;
  esac
  echo "[build] cargo build (sws-lvgl-viewer) ${LVGL_CARGO_FLAGS[*]}"
  (cd "$LVGL_CRATE_DIR" && cargo build "${LVGL_CARGO_FLAGS[@]}")
else
  echo "[build] skipping sws-lvgl-viewer (--no-lvgl)"
fi

# ── Report ───────────────────────────────────────────────────────────────────

BIN="$REPO_ROOT/sws-runtime/target/$TARGET_TRIPLE/$PROFILE/sws-runtime"
if [ -f "$BIN" ]; then
  SIZE_HUMAN="$(du -h "$BIN" | awk '{print $1}')"
  echo
  echo "[build] done."
  echo "[build] binary : $BIN  ($SIZE_HUMAN)"
  echo "[build] file   : $(file -b "$BIN" 2>/dev/null | head -1)"
  echo "[build] SPA    : $REPO_ROOT/sws-editor/dist  (deploy together)"
else
  echo "[build] ERROR: expected binary not found at $BIN" >&2
  exit 1
fi

if [ "$WITH_LVGL" -eq 1 ]; then
  # Il binario esce nel target dir del WORKSPACE, non in uno locale al crate.
  #
  # Cambiato il 2026-08-25, quando sws-lvgl-viewer è entrato nel workspace: da
  # allora cargo scrive in sws-runtime/target/ anche compilando con la cwd
  # dentro il crate. Il vecchio percorso continuava a esistere con dentro un
  # binario stantio, quindi questo script diceva "fatto" e consegnava una
  # versione vecchia — senza un avviso. Costato un giro di deploy: le modifiche
  # non comparivano e sembravano non funzionare.
  LVGL_BIN="$REPO_ROOT/sws-runtime/target/$TARGET_TRIPLE/$PROFILE/sws-lvgl-viewer"

  # Guardia contro il ripetersi del caso: se resta in giro un binario nel
  # vecchio percorso, è spazzatura che può solo ingannare.
  LVGL_BIN_VECCHIO="$LVGL_CRATE_DIR/target/$TARGET_TRIPLE/$PROFILE/sws-lvgl-viewer"
  if [ -f "$LVGL_BIN_VECCHIO" ]; then
    echo "[build] ATTENZIONE: trovato un binario nel vecchio percorso locale al crate," >&2
    echo "[build]             residuo di prima che entrasse nel workspace. Lo rimuovo," >&2
    echo "[build]             perché non venga spedito per errore:" >&2
    echo "[build]             $LVGL_BIN_VECCHIO" >&2
    rm -rf "$LVGL_CRATE_DIR/target"
  fi

  if [ -f "$LVGL_BIN" ]; then
    LVGL_SIZE_HUMAN="$(du -h "$LVGL_BIN" | awk '{print $1}')"
    echo "[build] lvgl   : $LVGL_BIN  ($LVGL_SIZE_HUMAN)"
    echo "[build] lvgl   : $(file -b "$LVGL_BIN" 2>/dev/null | head -1)"
  else
    echo "[build] ERROR: expected sws-lvgl-viewer binary not found at $LVGL_BIN" >&2
    exit 1
  fi
fi
