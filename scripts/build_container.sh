#!/usr/bin/env bash
#
# Costruisce l'immagine container aarch64 del runtime SWS e — con --push — la
# pubblica sul registry, che è la strada normale per portarla sui dispositivi.
#
# L'immagine NON compila nulla: incarta il binario prodotto dal cross-compile
# con l'SDK Yocto Pixsys (scripts/yocto/build.sh) e la SPA già buildata.
# Compilare Rust dentro un'immagine arm64 emulata richiederebbe ore.
#
# La SPA è DENTRO l'immagine dal 2026-07-30: col registry i layer si
# deduplicano, quindi un frontend nuovo trasferisce ~0,4 MB e non i 59 MB
# dell'immagine intera, e sul dispositivo non c'è più un secondo artefatto da
# copiare né il rischio di SPA e binario di versioni diverse.
#
# Due modi di consegnare l'immagine:
#
#   --push        → registry (default ghcr.io/soligolab/sws-runtime), poi sul
#                   dispositivo `install-container.sh --pull`. Un aggiornamento
#                   scarica il solo layer cambiato (~14 MB il binario).
#   (default)     → archivio dist/sws-runtime-<versione>-aarch64-image.tar.gz
#                   (~59 MB) da copiare via scp: il ripiego per un dispositivo
#                   senza rete verso il registry.
#
# Uso:
#   ./scripts/build_container.sh                    # cross-build + immagine + archivio
#   ./scripts/build_container.sh --push             # ...e pubblica sul registry
#   ./scripts/build_container.sh --no-save --push    # solo pubblicazione, nessun archivio
#   ./scripts/build_container.sh --no-rust          # riusa il binario aarch64 esistente
#   ./scripts/build_container.sh --no-spa           # riusa sws-editor/dist così com'è
#   ./scripts/build_container.sh --registry REF     # altro repository di destinazione
#   ./scripts/build_container.sh --out DIR          # directory di output (default dist/)
#   ./scripts/build_container.sh --with-lvgl        # include anche sws-lvgl-viewer nell'immagine
#
# --with-lvgl è opt-in, non il default: sws-lvgl-viewer collega SDL2 di
# sistema (vedi il suo Cargo.toml), e se il sysroot Yocto Pixsys non ha
# libsdl2-dev (non ancora verificato) la cross-compilazione fallisce — senza
# il flag, questo script si comporta esattamente come prima che quel crate
# esistesse, la pipeline sws-runtime-only non deve mai rompersi per colpa di
# una dipendenza opzionale.
#
# Requisiti: SDK Yocto Pixsys in /usr/local/oecore-x86_64/ (salvo --no-rust),
#            podman, rete per scaricare ubuntu:24.04 e — con --push — un
#            `podman login` già fatto sul registry.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    sed -n '2,43p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
PUSH=0
WITH_LVGL=0
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"
BIN="$REPO/sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime"
LVGL_BIN="$REPO/sws-runtime/crates/sws-lvgl-viewer/target/aarch64-unknown-linux-gnu/release/sws-lvgl-viewer"
SPA_DIST="$REPO/sws-editor/dist"

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)   usage; exit 0 ;;
        --no-rust)   BUILD_RUST=0; shift ;;
        --no-spa)    BUILD_SPA=0;  shift ;;
        --no-save)   SAVE=0;       shift ;;
        --push)      PUSH=1;       shift ;;
        --with-lvgl) WITH_LVGL=1;  shift ;;
        --registry)  REGISTRY="$2"; shift 2 ;;
        --out)       OUT_DIR="$2"; shift 2 ;;
        *) echo "Flag non riconosciuta: $1 (--help per l'elenco)" >&2; exit 1 ;;
    esac
done

if [ "$BUILD_RUST" -eq 1 ] && [ ! -f "$SDK_ENV" ]; then
    echo "ERRORE: SDK Yocto Pixsys non trovato ($SDK_ENV)." >&2
    echo "        Installalo, oppure passa --no-rust per riusare un binario esistente." >&2
    echo "        Questa immagine (Pixsys-tuned) richiede sempre l'SDK: non ha un ripiego" >&2
    echo "        automatico. Per le altre due immagini (aarch64-generico, x86_64), che non" >&2
    echo "        lo richiedono, usa:" >&2
    echo "          ./scripts/build_containers_all.sh   # salta questa in automatico se manca l'SDK" >&2
    exit 1
fi

# ── Controlli preliminari alla pubblicazione ──────────────────────────────────
# Tutti PRIMA della build: una cross-compilazione dura minuti, e scoprire alla
# fine che manca il login (o che l'albero è sporco) è tempo buttato.
GIT_SHA=""
if [ "$PUSH" -eq 1 ]; then
    # L'immagine porta un tag col commit da cui nasce. Con l'albero sporco quel
    # tag sarebbe una bugia: il contenuto pubblicato non corrisponderebbe a
    # nessun commit, e mesi dopo non ci sarebbe modo di sapere cosa contiene.
    if [ -n "$(cd "$REPO" && git status --porcelain 2>/dev/null)" ]; then
        echo "ERRORE: l'albero di lavoro ha modifiche non committate." >&2
        echo "        Il tag di provenienza dell'immagine indicherebbe un commit che non" >&2
        echo "        contiene ciò che stai pubblicando. Committa (o metti da parte) prima." >&2
        (cd "$REPO" && git status --short) >&2
        exit 1
    fi
    GIT_SHA=$(cd "$REPO" && git rev-parse --short HEAD)

    REGISTRY_HOST="${REGISTRY%%/*}"
    if ! podman login --get-login "$REGISTRY_HOST" >/dev/null 2>&1; then
        echo "ERRORE: nessun login su $REGISTRY_HOST." >&2
        echo "        podman login $REGISTRY_HOST -u <utente>" >&2
        echo "        (token con write:packages; incollalo al prompt, MAI in --password:" >&2
        echo "         finirebbe nella history della shell e nell'output di ps)" >&2
        echo "        Procedura completa: docs/DEPLOY_CONTAINER_AARCH64.md §Pubblicare." >&2
        exit 1
    fi
fi

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
# Il suffisso di architettura è nel tag LOCALE, non solo in quelli del
# registry: senza, una build x86_64 si prende lo stesso nome e
# `podman run sws-runtime:<versione>` dà quella costruita per ultima.
# Capitato davvero il 2026-07-31, costruendo le due immagini di seguito.
IMAGE="sws-runtime:${VERSION}-arm64"

echo "==> SWS runtime container image ${VERSION} (linux/arm64)"

# ── 1. Cross-compile ──────────────────────────────────────────────────────────
# In a subprocess on purpose: yocto/build.sh sources the SDK environment into
# its own shell, which would otherwise clobber PATH/pkg-config for the rest of
# this script. Same reasoning as scripts/build_deploy.sh.
if [ "$BUILD_RUST" -eq 1 ]; then
    YOCTO_FLAGS=( release )
    [ "$BUILD_SPA" -eq 1 ]  || YOCTO_FLAGS+=( --no-spa )
    [ "$WITH_LVGL" -eq 1 ]  && YOCTO_FLAGS+=( --with-lvgl )
    echo "==> [1/4] cross-compile (${YOCTO_FLAGS[*]})"
    bash "$REPO/scripts/yocto/build.sh" "${YOCTO_FLAGS[@]}"
else
    echo "==> [1/4] skipped (--no-rust)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }
if [ "$WITH_LVGL" -eq 1 ]; then
    [ -f "$LVGL_BIN" ] || { echo "ERROR: missing $LVGL_BIN (--with-lvgl requested)" >&2; exit 1; }
fi

# Guard against the classic mistake of feeding the host binary to an arm64
# image: it would build fine and fail only at `podman run` on the device.
if ! file "$BIN" | grep -q "ARM aarch64"; then
    echo "ERROR: $BIN is not an aarch64 binary:" >&2
    file "$BIN" >&2
    exit 1
fi
if [ "$WITH_LVGL" -eq 1 ] && ! file "$LVGL_BIN" | grep -q "ARM aarch64"; then
    echo "ERROR: $LVGL_BIN is not an aarch64 binary:" >&2
    file "$LVGL_BIN" >&2
    exit 1
fi

# ── 2. Stage the build context ────────────────────────────────────────────────
# A dedicated staging dir keeps the context at ~40 MB. Building from the repo
# root would tar up target/ and node_modules — gigabytes.
CTX="$OUT_DIR/container-context"
echo "==> [2/4] staging build context in $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/bin" "$CTX/templates" "$CTX/www"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
if [ "$WITH_LVGL" -eq 1 ]; then
    install -m 755 "$LVGL_BIN" "$CTX/bin/sws-lvgl-viewer"
fi
cp -r "$REPO/examples/templates/." "$CTX/templates/"
cp -r "$SPA_DIST/." "$CTX/www/"

# ── 3. Build the image ────────────────────────────────────────────────────────
# --format docker is required, not cosmetic: HEALTHCHECK has no place in the
# OCI image spec, so with the default (oci) podman drops it with a warning and
# `podman ps` would never report healthy.
echo "==> [3/4] podman build --platform linux/arm64 -t $IMAGE"
podman build --platform linux/arm64 --format docker \
    --build-arg "WITH_LVGL=$WITH_LVGL" \
    -t "$IMAGE" \
    -f "$REPO/deploy/container/Containerfile.aarch64" \
    "$CTX"
rm -rf "$CTX"

# ── 4a. Pubblicazione sul registry ────────────────────────────────────────────
# Due tag per la stessa immagine: uno mobile che i dispositivi seguono, uno
# immutabile che dice da quale commit nasce. Senza il secondo, fra sei mesi
# "cosa c'è sul dispositivo" non ha risposta.
#
# Il suffisso -arm64 è deliberato: questa NON è una manifest list multi-arch, e
# un tag nudo farebbe fallire un pull su x86 con un errore incomprensibile
# ("no matching manifest"), invece di dire che quell'immagine è solo per arm64.
if [ "$PUSH" -eq 1 ]; then
    TAG_VERSION="${REGISTRY}:${VERSION}-arm64"
    TAG_COMMIT="${REGISTRY}:${GIT_SHA}-arm64"
    # Terzo tag, mobile: è il default di `install-container.sh --pull`, così un
    # dispositivo prende l'ultima pubblicata senza che qualcuno debba ricordarsi
    # di aggiornare un numero dentro lo script a ogni release.
    TAG_LATEST="${REGISTRY}:latest-arm64"
    echo "==> [4/4] pubblicazione su $REGISTRY"
    for t in "$TAG_VERSION" "$TAG_COMMIT" "$TAG_LATEST"; do
        podman tag "$IMAGE" "$t"
        echo "    push $t"
        podman push "$t"
    done
    echo
    echo "    sul dispositivo:  ./install-container.sh --pull            # $TAG_LATEST"
    echo "    per inchiodare la versione:  ./install-container.sh --pull $TAG_VERSION"
fi

# ── 4b. Archivio trasferibile (ripiego offline) ───────────────────────────────
# Serve solo dove il registry non è raggiungibile: la SPA è dentro l'immagine,
# quindi questo archivio è l'unico artefatto da copiare.
if [ "$SAVE" -eq 1 ]; then
    ARCHIVE="$OUT_DIR/sws-runtime-${VERSION}-aarch64-image.tar"
    echo "==> [4b] podman save → ${ARCHIVE}.gz"
    mkdir -p "$OUT_DIR"
    rm -f "$ARCHIVE" "$ARCHIVE.gz"
    podman save -o "$ARCHIVE" "$IMAGE"
    gzip -f "$ARCHIVE"
    echo
    echo "    $(du -h "$ARCHIVE.gz" | cut -f1)  ${ARCHIVE}.gz"
else
    echo "==> [4b] archivio non prodotto (--no-save)"
fi

echo
echo "==> done. Image: $IMAGE"
