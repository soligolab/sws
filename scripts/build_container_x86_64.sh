#!/usr/bin/env bash
#
# Costruisce l'immagine container x86_64 (amd64) del runtime SWS e — con
# --push — la pubblica sul registry. Gemello di scripts/build_container.sh
# (aarch64): stesso flusso, nessun SDK di cross-compile, qui l'architettura di
# build e quella target coincidono e basta un `cargo build --release` nativo.
#
# L'immagine NON compila nulla: incarta il binario già buildato e la SPA già
# buildata.
#
# La SPA è DENTRO l'immagine dal 2026-07-30, come nel percorso aarch64: col
# registry i layer si deduplicano, quindi un frontend nuovo trasferisce il solo
# layer della SPA e non l'immagine intera, e sul dispositivo non c'è più un
# secondo artefatto da copiare né il rischio di SPA e binario di versioni
# diverse.
#
# Due modi di consegnare l'immagine:
#
#   --push        → registry (default ghcr.io/soligolab/sws-runtime), poi sul
#                   dispositivo `install-container.sh --pull`. Un aggiornamento
#                   scarica il solo layer cambiato.
#   (default)     → archivio dist/sws-runtime-<versione>-x86_64-image.tar.gz
#                   da copiare via scp: il ripiego per un dispositivo senza
#                   rete verso il registry.
#
# Uso:
#   ./scripts/build_container_x86_64.sh                 # build + immagine + archivio
#   ./scripts/build_container_x86_64.sh --push          # ...e pubblica sul registry
#   ./scripts/build_container_x86_64.sh --no-save --push # solo pubblicazione
#   ./scripts/build_container_x86_64.sh --no-rust       # riusa il binario x86_64 esistente
#   ./scripts/build_container_x86_64.sh --no-spa        # riusa sws-editor/dist così com'è
#   ./scripts/build_container_x86_64.sh --registry REF  # altro repository di destinazione
#   ./scripts/build_container_x86_64.sh --out DIR       # directory di output (default dist/)
#
# Requisiti: podman, pnpm per la SPA, rete per scaricare ubuntu:24.04 e — con
#            --push — un `podman login` già fatto sul registry. NON serve una
#            toolchain Rust sull'host: vive nell'immagine builder.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
PUSH=0
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
# Non `target/release/`: quella è la build dell'host, con un'altra libpython.
BIN="$REPO/sws-runtime/target-container-x86_64/release/sws-runtime"
SPA_DIST="$REPO/sws-editor/dist"
BUILDER_IMAGE="sws-runtime-builder:x86_64"
# Python della base `ubuntu:24.04`, che builder e immagine finale condividono.
# Cambiando quella base va cambiato anche questo, e lo script lo fa notare.
EXPECTED_PY="3.12"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-rust)  BUILD_RUST=0; shift ;;
        --no-spa)   BUILD_SPA=0;  shift ;;
        --no-save)  SAVE=0;       shift ;;
        --push)     PUSH=1;       shift ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --out)      OUT_DIR="$2"; shift 2 ;;
        *) echo "Flag non riconosciuta: $1" >&2; exit 1 ;;
    esac
done

# ── Controlli preliminari alla pubblicazione ──────────────────────────────────
# Tutti PRIMA della build, per la stessa ragione del percorso aarch64: scoprire
# alla fine che manca il login (o che l'albero è sporco) è tempo buttato.
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
# Suffisso di architettura anche nel tag locale: vedi il commento gemello
# in build_container.sh.
IMAGE="sws-runtime:${VERSION}-amd64"

echo "==> SWS runtime container image ${VERSION} (linux/amd64)"

# ── 1. Build ───────────────────────────────────────────────────────────────────
# Il binario si compila DENTRO l'immagine builder, non sull'host. Con PyO3 in
# `auto-initialize` il binario linka la libpython dell'ambiente che lo compila:
# compilandolo sull'host, l'immagine finale dipendeva da come è fatta la
# macchina di build — una Debian 12 produce un binario che chiede
# `libpython3.11.so.1.0`, che l'immagine finale (ubuntu:24.04, Python 3.12) non
# ha. Il builder è la stessa base dell'immagine finale, quindi combaciano per
# costruzione. È l'equivalente x86_64 dell'SDK Yocto fisso del percorso aarch64.
if [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> [1/4] immagine builder (toolchain Rust su ubuntu:24.04)"
    podman build --platform linux/amd64 \
        -t "$BUILDER_IMAGE" \
        -f "$REPO/deploy/container/Containerfile.x86_64.builder" \
        "$REPO/deploy/container"

    echo "==> [1a/4] cargo build --release --bin sws-runtime (dentro il builder)"
    # --target-dir dedicata: la `target/` dell'host contiene oggetti compilati
    # con un'altra libpython e un altro glibc, e mescolarli darebbe link
    # incoerenti difficili da diagnosticare. CARGO_HOME dentro il repo così i
    # crate scaricati sopravvivono fra un'esecuzione e l'altra.
    podman run --rm \
        --platform linux/amd64 \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime \
        -e CARGO_HOME=/src/.cargo-container-x86_64 \
        -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-x86_64 \
        "$BUILDER_IMAGE" \
        cargo build --release --bin sws-runtime
else
    echo "==> [1/4] skipped (--no-rust)"
fi

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> [1b/4] pnpm build (SPA)"
    (cd "$REPO/sws-editor" && pnpm build)
else
    echo "==> [1b/4] skipped (--no-spa)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN — togli --no-rust" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }

# Guard against the classic mistake of feeding a foreign-arch binary to an
# amd64 image — same principle as build_container.sh's aarch64 check.
if ! file "$BIN" | grep -q "x86-64"; then
    echo "ERROR: $BIN is not an x86_64 binary:" >&2
    file "$BIN" >&2
    exit 1
fi

# La verifica readelf non è sparita col builder: è passata da "ricordarsi di
# rifarla a mano" a "lo script si ferma da solo". Se un giorno il builder o la
# base finale cambiassero Python senza che l'altra segua, il difetto salterebbe
# fuori QUI e non al primo `podman run` sul dispositivo, con un messaggio che
# non spiega niente.
NEEDED_PY=$(readelf -d "$BIN" | sed -n 's/.*\[libpython\([0-9.]*\)\.so.*/\1/p' | head -1)
if [ "$NEEDED_PY" != "$EXPECTED_PY" ]; then
    echo "ERRORE: il binario chiede libpython${NEEDED_PY:-?}, l'immagine finale offre libpython$EXPECTED_PY." >&2
    echo "        Il container partirebbe e morirebbe su 'cannot open shared object file'." >&2
    echo "        Controlla che Containerfile.x86_64 e Containerfile.x86_64.builder abbiano lo stesso FROM." >&2
    readelf -d "$BIN" | grep NEEDED >&2
    exit 1
fi
NEEDED_GLIBC=$(readelf -V "$BIN" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)
echo "    binario: libpython$NEEDED_PY, $NEEDED_GLIBC — combacia con la base"

# ── 2. Stage the build context ────────────────────────────────────────────────
CTX="$OUT_DIR/container-context-x86_64"
echo "==> [2/4] staging build context in $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/bin" "$CTX/templates" "$CTX/www"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
cp -r "$REPO/examples/templates/." "$CTX/templates/"
cp -r "$SPA_DIST/." "$CTX/www/"

# ── 3. Build the image ────────────────────────────────────────────────────────
# --format docker è indispensabile, non cosmetico: HEALTHCHECK non esiste nella
# spec OCI, senza --format docker podman lo scarta con un warning silenzioso.
echo "==> [3/4] podman build --platform linux/amd64 -t $IMAGE"
podman build --platform linux/amd64 --format docker \
    -t "$IMAGE" \
    -f "$REPO/deploy/container/Containerfile.x86_64" \
    "$CTX"
rm -rf "$CTX"

# ── 4a. Pubblicazione sul registry ────────────────────────────────────────────
# Due tag per la stessa immagine: uno mobile che i dispositivi seguono, uno
# immutabile che dice da quale commit nasce.
#
# Il suffisso -amd64 è deliberato e speculare al -arm64 del percorso aarch64:
# questa NON è una manifest list multi-arch, e un tag nudo farebbe fallire un
# pull su arm64 con un errore incomprensibile ("no matching manifest") invece
# di dire che quell'immagine è solo per amd64.
if [ "$PUSH" -eq 1 ]; then
    TAG_VERSION="${REGISTRY}:${VERSION}-amd64"
    TAG_COMMIT="${REGISTRY}:${GIT_SHA}-amd64"
    # Mobile, come nel gemello aarch64. Suffisso -amd64: il default
    # dell'installer è `latest-arm64`, quindi su x86_64 questo va passato a mano.
    TAG_LATEST="${REGISTRY}:latest-amd64"
    echo "==> [4/4] pubblicazione su $REGISTRY"
    for t in "$TAG_VERSION" "$TAG_COMMIT" "$TAG_LATEST"; do
        podman tag "$IMAGE" "$t"
        echo "    push $t"
        podman push "$t"
    done
    echo
    echo "    sul dispositivo:  ./install-container.sh --pull $TAG_LATEST"
    echo "    per inchiodare la versione:  ./install-container.sh --pull $TAG_VERSION"
fi

# ── 4b. Archivio trasferibile (ripiego offline) ───────────────────────────────
# Serve solo dove il registry non è raggiungibile: la SPA è dentro l'immagine,
# quindi questo archivio è l'unico artefatto da copiare.
if [ "$SAVE" -eq 1 ]; then
    ARCHIVE="$OUT_DIR/sws-runtime-${VERSION}-x86_64-image.tar"
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
