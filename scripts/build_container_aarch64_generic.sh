#!/usr/bin/env bash
#
# Costruisce l'immagine container aarch64 "generica" (senza SDK Pixsys) del
# runtime SWS e — con --push — la pubblica sul registry. Gemello di
# scripts/build_container_x86_64.sh: stesso flusso, stesso builder
# arch-agnostico (Containerfile.aarch64-generic.builder), ma qui build-arch e
# target-arch NON coincidono — su una macchina x86_64 gira tutto sotto
# emulazione QEMU, sensibilmente più lento del gemello x86_64.
#
# Non sostituisce scripts/build_container.sh (SDK Yocto Pixsys): quel
# percorso resta quello giusto per un device Pixsys reale (tuning cortex-a35,
# ABI pinning esatto all'OS Pixsys). Questo serve per testare senza accesso
# all'SDK e per device aarch64 non Pixsys.
#
# L'immagine NON compila nulla: incarta il binario già buildato (dentro il
# builder) e la SPA già buildata.
#
# Due modi di consegnare l'immagine:
#
#   --push        → registry (default ghcr.io/soligolab/sws-runtime), tag
#                   *-arm64-generic — MAI -arm64 nudo: quel tag è
#                   dell'immagine Pixsys-tuned, e install-container.sh --pull
#                   senza argomento lo sceglie di default. Questa immagine va
#                   sempre installata per riferimento esplicito.
#   (default)     → archivio dist/sws-runtime-<versione>-aarch64-generic-
#                   image.tar.gz da copiare via scp.
#
# Uso:
#   ./scripts/build_container_aarch64_generic.sh                 # build + immagine + archivio
#   ./scripts/build_container_aarch64_generic.sh --push          # ...e pubblica sul registry
#   ./scripts/build_container_aarch64_generic.sh --no-save --push # solo pubblicazione
#   ./scripts/build_container_aarch64_generic.sh --no-rust       # riusa il binario esistente
#   ./scripts/build_container_aarch64_generic.sh --no-spa        # riusa sws-editor/dist così com'è
#   ./scripts/build_container_aarch64_generic.sh --registry REF  # altro repository di destinazione
#   ./scripts/build_container_aarch64_generic.sh --out DIR       # directory di output (default dist/)
#
# Requisiti: podman, emulazione QEMU per arm64 registrata sull'host (una
#            tantum, es. `sudo apt install qemu-user-static` o `sudo podman
#            run --rm --privileged docker.io/multiarch/qemu-user-static
#            --reset -p yes` — dipende dalla distro/versione), pnpm per la
#            SPA, rete per scaricare ubuntu:24.04 e — con --push — un
#            `podman login` già fatto sul registry. NON serve una toolchain
#            Rust né di cross-compile sull'host: vive nell'immagine builder,
#            emulata.
#
# root, non rootless (a differenza di tutto il resto della famiglia
# container): verificato empiricamente il 2026-08-01 che su podman rootless +
# crun l'emulazione QEMU non attraversa la user namespace del container
# (l'exec del binario arm64 fallisce con "Exec format error" anche a
# registrazione binfmt corretta, `flags: F` incluso) — con `sudo podman`
# funziona. Lo script va quindi lanciato con `sudo ./scripts/build_container_
# aarch64_generic.sh`. Effetto collaterale: podman "vero" non rimappa gli UID
# sui bind mount, quindi target-container-aarch64-generic/,
# .cargo-container-aarch64-generic/ e l'archivio in dist/ restano di
# proprietà di root — va fatto un `sudo chown -R $(whoami): ...` (o `sudo
# rm -rf`) dopo, per ripulire.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
PUSH=0
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
# Dedicata: non collide né con target/ dell'host (altra architettura) né con
# target/aarch64-unknown-linux-gnu/ del percorso SDK — un binario diverso,
# non intercambiabile (glibc/Python diversi, nessun tuning cortex-a35).
BIN="$REPO/sws-runtime/target-container-aarch64-generic/release/sws-runtime"
SPA_DIST="$REPO/sws-editor/dist"
BUILDER_IMAGE="sws-runtime-builder:aarch64-generic"
# Python della base `ubuntu:24.04`, che builder e immagine finale condividono.
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

# ── Emulazione QEMU registrata? ───────────────────────────────────────────────
# Senza, `podman build/run --platform linux/arm64` fallisce con un errore di
# formato eseguibile poco chiaro ("exec format error"). Controllo esplicito,
# stesso stile del controllo SDK in build_container.sh: fallisce con un
# messaggio che dice cosa fare, non prova a registrarla da solo (è
# un'operazione --privileged, non qualcosa da eseguire senza che l'operatore
# lo sappia).
if [ "$BUILD_RUST" -eq 1 ] && [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    echo "ERRORE: emulazione QEMU per arm64 non registrata su questa macchina." >&2
    echo "        Registrazione una tantum (l'una o l'altra, a seconda della distro):" >&2
    echo "          sudo apt install qemu-user-static" >&2
    echo "          sudo podman run --rm --privileged docker.io/multiarch/qemu-user-static --reset -p yes" >&2
    exit 1
fi

# root, non rootless: vedi il commento esteso in testa al file — su podman
# rootless + crun l'emulazione QEMU non attraversa la user namespace del
# container (verificato empiricamente, non solo temuto).
if [ "$BUILD_RUST" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: questo script va lanciato con sudo (build aarch64 emulata," >&2
    echo "        podman rootless non riesce a eseguire binari arm64 sotto QEMU" >&2
    echo "        su questa famiglia di kernel/crun)." >&2
    echo "          sudo ./scripts/build_container_aarch64_generic.sh" >&2
    echo "        Gli artefatti (target-container-aarch64-generic/, dist/*aarch64-generic*)" >&2
    echo "        resteranno di proprietà di root — serve un chown dopo." >&2
    exit 1
fi

# ── Controlli preliminari alla pubblicazione ──────────────────────────────────
GIT_SHA=""
if [ "$PUSH" -eq 1 ]; then
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
        exit 1
    fi
fi

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
IMAGE="sws-runtime:${VERSION}-arm64-generic"

echo "==> SWS runtime container image ${VERSION} (linux/arm64, generico — emulato)"

# ── 1. Build ───────────────────────────────────────────────────────────────────
# --network host su tutte le invocazioni podman di questo script: la build
# aarch64 richiede root (vedi il controllo binfmt sopra — l'emulazione QEMU
# sotto podman rootless non attraversa la user namespace su questa famiglia di
# kernel/crun, verificato empiricamente il 2026-08-01). Con `sudo podman`, la
# rete bridge di default non passa il DNS dell'host: apt (ports.ubuntu.com) e
# crates.io risultavano irraggiungibili nel container pur risolvendo bene
# sull'host. --network host aggira il proxy DNS di podman usando la rete
# dell'host direttamente.
if [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> [1/4] immagine builder (toolchain Rust su ubuntu:24.04, emulato arm64)"
    podman build --platform linux/arm64 --network host \
        -t "$BUILDER_IMAGE" \
        -f "$REPO/deploy/container/Containerfile.aarch64-generic.builder" \
        "$REPO/deploy/container"

    echo "==> [1a/4] cargo build --release --bin sws-runtime (dentro il builder, emulato — lento)"
    # AWS_LC_SYS_NO_ASM: aws-lc-sys (dietro rustls, via reqwest) include
    # assembly ARM scritta a mano per NEON+SHA3 — sotto emulazione QEMU su
    # questo host, `cc` va in SIGSEGV assemblandola (verificato empiricamente
    # il 2026-08-01, non un bug del codice SWS: bug/limite noto di QEMU con
    # certe estensioni crypto ARM). NO_ASM fa ripiegare aws-lc-sys sulle
    # implementazioni C portabili, accettabile per un binario di test/
    # portabilità, non per il percorso SDK Pixsys (che non passa da qui).
    # NO_ASM forza il builder CMake (vedi Containerfile.aarch64-generic.
    # builder), che lo accetta SOLO con opt-level esattamente 0 — non <= 2
    # come il builder cc userebbe altrimenti (verificato leggendo
    # builder/cmake_builder.rs, non assunto): opt-level 0 vuol dire nessuna
    # ottimizzazione, binario sensibilmente più lento a runtime. Accettabile
    # per verificare che il container si installi e parta, non per misurare
    # prestazioni — se serve un binario arm64 realmente ottimizzato, resta
    # il percorso SDK Pixsys.
    podman run --rm \
        --platform linux/arm64 \
        --network host \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime \
        -e CARGO_HOME=/src/.cargo-container-aarch64-generic \
        -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-aarch64-generic \
        -e AWS_LC_SYS_NO_ASM=1 \
        -e CARGO_PROFILE_RELEASE_OPT_LEVEL=0 \
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

# Guardia contro il classico errore di infilare un binario della architettura
# sbagliata in un'immagine arm64 — stesso principio del controllo aarch64-SDK
# in build_container.sh.
if ! file "$BIN" | grep -q "ARM aarch64"; then
    echo "ERROR: $BIN is not an aarch64 binary:" >&2
    file "$BIN" >&2
    exit 1
fi

NEEDED_PY=$(readelf -d "$BIN" | sed -n 's/.*\[libpython\([0-9.]*\)\.so.*/\1/p' | head -1)
if [ "$NEEDED_PY" != "$EXPECTED_PY" ]; then
    echo "ERRORE: il binario chiede libpython${NEEDED_PY:-?}, l'immagine finale offre libpython$EXPECTED_PY." >&2
    echo "        Il container partirebbe e morirebbe su 'cannot open shared object file'." >&2
    echo "        Controlla che Containerfile.aarch64-generic e .builder abbiano lo stesso FROM." >&2
    readelf -d "$BIN" | grep NEEDED >&2
    exit 1
fi
NEEDED_GLIBC=$(readelf -V "$BIN" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)
echo "    binario: libpython$NEEDED_PY, $NEEDED_GLIBC — combacia con la base"

# ── 2. Stage the build context ────────────────────────────────────────────────
CTX="$OUT_DIR/container-context-aarch64-generic"
echo "==> [2/4] staging build context in $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/bin" "$CTX/templates" "$CTX/www"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
cp -r "$REPO/examples/templates/." "$CTX/templates/"
cp -r "$SPA_DIST/." "$CTX/www/"

# ── 3. Build the image ────────────────────────────────────────────────────────
echo "==> [3/4] podman build --platform linux/arm64 -t $IMAGE"
podman build --platform linux/arm64 --network host --format docker \
    -t "$IMAGE" \
    -f "$REPO/deploy/container/Containerfile.aarch64-generic" \
    "$CTX"
rm -rf "$CTX"

# ── 4a. Pubblicazione sul registry ────────────────────────────────────────────
if [ "$PUSH" -eq 1 ]; then
    TAG_VERSION="${REGISTRY}:${VERSION}-arm64-generic"
    TAG_COMMIT="${REGISTRY}:${GIT_SHA}-arm64-generic"
    TAG_LATEST="${REGISTRY}:latest-arm64-generic"
    echo "==> [4/4] pubblicazione su $REGISTRY"
    for t in "$TAG_VERSION" "$TAG_COMMIT" "$TAG_LATEST"; do
        podman tag "$IMAGE" "$t"
        echo "    push $t"
        podman push "$t"
    done
    echo
    echo "    Riferimento esplicito richiesto — install-container.sh --pull senza" \
         "argomento cerca latest-arm64 (Pixsys-tuned), non questa immagine:"
    echo "    sul dispositivo:  ./install-container.sh --pull $TAG_LATEST"
    echo "    per inchiodare la versione:  ./install-container.sh --pull $TAG_VERSION"
fi

# ── 4b. Archivio trasferibile (ripiego offline) ───────────────────────────────
if [ "$SAVE" -eq 1 ]; then
    ARCHIVE="$OUT_DIR/sws-runtime-${VERSION}-aarch64-generic-image.tar"
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
