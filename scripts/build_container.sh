#!/usr/bin/env bash
#
# Costruisce l'immagine container aarch64 del runtime SWS e — con --push — la
# pubblica sul registry, che è la strada normale per portarla sui dispositivi.
#
# L'immagine NON compila nulla: incarta il binario aarch64 già compilato e la SPA
# già buildata. Compilare Rust dentro un'immagine arm64 emulata richiederebbe
# ore (è quello che faceva build_container_aarch64_generic.sh: 51 minuti, e per
# giunta a opt-level 0 — vedi Q53).
#
# COME NASCE IL BINARIO (Q53, 2026-09-10): per default in un container di build
# x86_64 con la toolchain Ubuntu per arm64 (deploy/container/
# Containerfile.aarch64-cross.builder): cross-compilazione nativa, ottimizzata,
# in minuti, senza SDK Pixsys e senza QEMU, contro le stesse librerie
# (ubuntu:24.04, glibc 2.39, Python 3.12) dell'immagine finale. L'unica
# immagine aarch64: vale per i pannelli Pixsys e per qualunque board arm64.
# Con --sdk si usa il percorso storico con l'SDK Yocto Pixsys
# (scripts/yocto/build.sh): resta finché il cross-build non è stato provato a
# sufficienza sul campo, poi sparisce.
#
# La SPA è DENTRO l'immagine dal 2026-07-30: col registry i layer si
# deduplicano, quindi un frontend nuovo trasferisce ~0,4 MB e non l'immagine
# intera, e sul dispositivo non c'è un secondo artefatto da copiare.
#
# Due modi di consegnare l'immagine:
#
#   --push        → registry (default ghcr.io/soligolab/sws-runtime), poi sul
#                   dispositivo `install-container.sh --pull`. Un aggiornamento
#                   scarica il solo layer cambiato.
#   (default)     → archivio dist/sws-runtime-<versione>-aarch64-image.tar.gz
#                   da copiare via scp: il ripiego per un dispositivo senza
#                   rete verso il registry.
#
# Uso:
#   ./scripts/build_container.sh                    # cross-build in container + immagine + archivio
#   ./scripts/build_container.sh --push             # ...e pubblica sul registry
#   ./scripts/build_container.sh --no-save --push    # solo pubblicazione, nessun archivio
#   ./scripts/build_container.sh --no-rust          # riusa il binario aarch64 esistente
#   ./scripts/build_container.sh --no-spa           # riusa sws-editor/dist così com'è
#   ./scripts/build_container.sh --sdk              # percorso storico: SDK Yocto Pixsys
#   ./scripts/build_container.sh --registry REF     # altro repository di destinazione
#   ./scripts/build_container.sh --out DIR          # directory di output (default dist/)
#   ./scripts/build_container.sh --no-lvgl          # NON includere sws-lvgl-viewer
#
# L'immagine porta ENTRAMBI i runtime per default dal 2026-08-24 (decisione del
# maintainer): sui dispositivi si deve poter provare sia il runtime web sia
# quello LVGL, e pubblicarne una senza viewer costringerebbe a un secondo giro.
# L'ENTRYPOINT resta sws-runtime; il viewer si lancia come secondo container con
# `--entrypoint sws-lvgl-viewer`. `--no-lvgl` resta come uscita di sicurezza.
#
# Requisiti: podman e rete (ubuntu:24.04, ports.ubuntu.com, crates.io); pnpm
#            per la SPA (salvo --no-spa); emulazione QEMU per arm64 registrata
#            sull'host per il solo passo `apt-get` dell'immagine finale
#            (`ls /proc/sys/fs/binfmt_misc/qemu-aarch64`); con --push un
#            `podman login` già fatto. Con --sdk: l'SDK Yocto Pixsys in
#            /usr/local/oecore-x86_64/ e clang/libclang sull'host.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    sed -n '2,56p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
PUSH=0
WITH_LVGL=1
BUILDER="cross"     # cross (default, Q53) | sdk (storico)
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"
SPA_DIST="$REPO/sws-editor/dist"
TARGET_TRIPLE="aarch64-unknown-linux-gnu"
BUILDER_IMAGE="sws-runtime-builder:aarch64-cross"
# Cartelle di lavoro del cross-build, dentro il repo e in .gitignore: cargo le
# tiene incrementali fra una build e l'altra (la prima è lunga, le altre no).
CROSS_TARGET="$REPO/sws-runtime/target-container-aarch64-cross"
CROSS_TARGET_LVGL="$REPO/sws-runtime/crates/sws-lvgl-viewer/target-container-aarch64-cross"
CROSS_CARGO_HOME="$REPO/.cargo-container-aarch64-cross"

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)   usage; exit 0 ;;
        --no-rust)   BUILD_RUST=0; shift ;;
        --no-spa)    BUILD_SPA=0;  shift ;;
        --no-save)   SAVE=0;       shift ;;
        --push)      PUSH=1;       shift ;;
        --sdk)       BUILDER="sdk"; shift ;;
        # Accettata e senza effetto: era il modo di chiederlo.
        --with-lvgl) WITH_LVGL=1;  shift ;;
        --no-lvgl)   WITH_LVGL=0;  shift ;;
        --registry)  REGISTRY="$2"; shift 2 ;;
        --out)       OUT_DIR="$2"; shift 2 ;;
        *) echo "Flag non riconosciuta: $1 (--help per l'elenco)" >&2; exit 1 ;;
    esac
done

# Dove sta il binario dipende da chi lo compila. Sono due alberi distinti di
# proposito: un --sdk dopo un cross (o viceversa) non deve poter incartare il
# binario dell'altro percorso credendolo aggiornato.
if [ "$BUILDER" = "sdk" ]; then
    BIN="$REPO/sws-runtime/target/$TARGET_TRIPLE/release/sws-runtime"
    LVGL_BIN="$REPO/sws-runtime/target/$TARGET_TRIPLE/release/sws-lvgl-viewer"
else
    BIN="$CROSS_TARGET/$TARGET_TRIPLE/release/sws-runtime"
    LVGL_BIN="$CROSS_TARGET_LVGL/$TARGET_TRIPLE/release/sws-lvgl-viewer"
fi

if [ "$BUILDER" = "sdk" ] && [ "$BUILD_RUST" -eq 1 ] && [ ! -f "$SDK_ENV" ]; then
    echo "ERRORE: --sdk richiede l'SDK Yocto Pixsys ($SDK_ENV), che qui non c'è." >&2
    echo "        Senza --sdk il binario si cross-compila in un container Ubuntu: è il default." >&2
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

echo "==> SWS runtime container image ${VERSION} (linux/arm64, binario da: $BUILDER)"

# ── 1. Il binario aarch64 ─────────────────────────────────────────────────────
if [ "$BUILD_RUST" -eq 1 ] && [ "$BUILDER" = "sdk" ]; then
    # In a subprocess on purpose: yocto/build.sh sources the SDK environment into
    # its own shell, which would otherwise clobber PATH/pkg-config for the rest of
    # this script. Same reasoning as scripts/build_deploy.sh.
    YOCTO_FLAGS=( release )
    [ "$BUILD_SPA" -eq 1 ]  || YOCTO_FLAGS+=( --no-spa )
    # Va propagato il NEGATIVO, non il positivo: da quando LVGL è il default
    # anche in build.sh, non passare niente significa "costruiscilo".
    [ "$WITH_LVGL" -eq 1 ]  || YOCTO_FLAGS+=( --no-lvgl )
    echo "==> [1/4] cross-compile con l'SDK Pixsys (${YOCTO_FLAGS[*]})"
    bash "$REPO/scripts/yocto/build.sh" "${YOCTO_FLAGS[@]}"

elif [ "$BUILD_RUST" -eq 1 ]; then
    # Il builder: un'immagine x86_64 con gcc per aarch64 e le librerie :arm64 di
    # Ubuntu 24.04 in multiarch. Si ricostruisce solo se il Containerfile cambia
    # (podman usa la cache dei layer); la prima volta scarica qualche centinaio
    # di MB da ports.ubuntu.com.
    echo "==> [1a/4] immagine builder $BUILDER_IMAGE (x86_64 → aarch64, toolchain Ubuntu)"
    podman build -t "$BUILDER_IMAGE" \
        -f "$REPO/deploy/container/Containerfile.aarch64-cross.builder" \
        "$REPO/deploy/container"

    if [ "$BUILD_SPA" -eq 1 ]; then
        echo "==> [1b/4] pnpm build (SPA)"
        if [ ! -d "$REPO/sws-editor/node_modules" ]; then
            (cd "$REPO/sws-editor" && pnpm install)
        fi
        (cd "$REPO/sws-editor" && pnpm build)
    fi

    # Stesso invito del percorso SDK (scripts/yocto/build.sh): le patch al
    # codice LVGL vendorizzato devono essere applicate, perché cargo non si
    # accorge se qualcuno le toglie — vedi Q22.
    if [ "$WITH_LVGL" -eq 1 ]; then
        echo "==> [1c/4] verifica delle patch al codice vendorizzato"
        "$REPO/scripts/check_vendor_patches.sh" || {
            echo "ERRORE: patch al codice vendorizzato mancanti — build interrotta." >&2
            echo "        Riapplica con: ./scripts/check_vendor_patches.sh --apply" >&2
            exit 1
        }
    fi

    # Rootless va bene: qui non si esegue niente di arm64, si compila soltanto.
    # `--network host` per crates.io e per il DNS: la rete bridge di podman
    # rootless a volte non risolve, e una build che muore su un download non
    # dice niente di utile. `:Z` per gli host con SELinux, innocuo altrove.
    echo "==> [1d/4] cargo build --release --target $TARGET_TRIPLE -p sws-runtime (nel builder)"
    podman run --rm --network host \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime \
        -e CARGO_HOME=/src/.cargo-container-aarch64-cross \
        -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-aarch64-cross \
        "$BUILDER_IMAGE" \
        cargo build --release --target "$TARGET_TRIPLE" -p sws-runtime

    if [ "$WITH_LVGL" -eq 1 ]; then
        # Con la cartella del crate come working directory, non da --manifest-path:
        # il suo .cargo/config.toml imposta DEP_LV_CONFIG_PATH relativo alla cwd,
        # e cargo lo cerca risalendo da lì (stessa cosa in yocto/build.sh).
        echo "==> [1e/4] cargo build --release --target $TARGET_TRIPLE (sws-lvgl-viewer, nel builder)"
        podman run --rm --network host \
            -v "$REPO":/src:Z \
            -w /src/sws-runtime/crates/sws-lvgl-viewer \
            -e CARGO_HOME=/src/.cargo-container-aarch64-cross \
            -e CARGO_TARGET_DIR=/src/sws-runtime/crates/sws-lvgl-viewer/target-container-aarch64-cross \
            "$BUILDER_IMAGE" \
            cargo build --release --target "$TARGET_TRIPLE"
    fi
else
    echo "==> [1/4] skipped (--no-rust)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }
if [ "$WITH_LVGL" -eq 1 ]; then
    [ -f "$LVGL_BIN" ] || { echo "ERROR: missing $LVGL_BIN (usa --no-lvgl per costruire senza)" >&2; exit 1; }
fi

# Guard against the classic mistake of feeding the host binary to an arm64
# image: it would build fine and fail only at `podman run` on the device.
for b in "$BIN" $( [ "$WITH_LVGL" -eq 1 ] && echo "$LVGL_BIN" ); do
    if ! file "$b" | grep -q "ARM aarch64"; then
        echo "ERROR: $b is not an aarch64 binary:" >&2
        file "$b" >&2
        exit 1
    fi
done

# Il binario deve girare sulla base dell'immagine finale (ubuntu:24.04: glibc
# 2.39, Python 3.12): un simbolo più nuovo o una libpython diversa passerebbero
# la build e fallirebbero al primo `podman run` sul dispositivo. Il controllo
# è lo stesso di docs/DEPLOY_CONTAINER_AARCH64.md §«Perché ubuntu:24.04».
if command -v readelf >/dev/null 2>&1; then
    GLIBC_MAX="$(readelf -V "$BIN" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)"
    if [ -n "$GLIBC_MAX" ] && [ "$(printf '%s\n' "${GLIBC_MAX#GLIBC_}" 2.39 | sort -V | tail -1)" != "2.39" ]; then
        echo "ERROR: $BIN richiede $GLIBC_MAX, l'immagine (ubuntu:24.04) ha glibc 2.39." >&2
        exit 1
    fi
    if ! readelf -d "$BIN" | grep -q 'libpython3\.12'; then
        echo "ERROR: $BIN non linka libpython3.12 (readelf -d), l'immagine ha Python 3.12:" >&2
        readelf -d "$BIN" | grep NEEDED >&2
        exit 1
    fi
    echo "    binario: aarch64, glibc ≤ ${GLIBC_MAX:-?}, libpython3.12 — combacia con ubuntu:24.04"
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
    TAGS=( "$TAG_VERSION" "$TAG_COMMIT" "$TAG_LATEST" )
    # Q53: `-arm64-generic` era un'immagine a parte (QEMU, non ottimizzata). Da
    # oggi è la STESSA immagine con un altro nome, così un dispositivo installato
    # con quel riferimento continua ad aggiornarsi. Alias di transizione: cade
    # quando nessun dispositivo lo usa più.
    if [ "$BUILDER" = "cross" ]; then
        TAGS+=( "${REGISTRY}:${VERSION}-arm64-generic" "${REGISTRY}:latest-arm64-generic" )
    fi
    echo "==> [4/4] pubblicazione su $REGISTRY"
    for t in "${TAGS[@]}"; do
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
