#!/usr/bin/env bash
#
# Costruisce l'immagine container x86_64 (amd64) del runtime SWS e — con
# --push — la pubblica sul registry. Gemello di scripts/build_container.sh
# (aarch64): stesso flusso, nessun SDK di cross-compile, qui l'architettura di
# build e quella target coincidono e basta un `cargo build --release` nativo.
#
# L'immagine NON compila nulla: incarta i binari già buildati e la SPA già
# buildata.
#
# Dal 10-11-2026 porta anche `sws-lvgl-viewer`, come quella arm64. Non per uno
# schermo — un IDE nel cloud non ne ha — ma per `istantanea_pagina`: la foto di
# una pagina disegnata dallo stesso motore LVGL del pannello, che l'assistente
# dell'IDE usa per guardare quello che compone. Senza viewer, nel cloud
# (gateway e container dei progetti girano su questa immagine) lo strumento
# rispondeva soltanto che il viewer mancava.
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
#   ./scripts/build_container_x86_64.sh --no-lvgl       # senza sws-lvgl-viewer (niente istantanee)
#   ./scripts/build_container_x86_64.sh --registry REF  # altro repository di destinazione
#   ./scripts/build_container_x86_64.sh --out DIR       # directory di output (default dist/)
#
# Requisiti: podman, pnpm per la SPA, rete per scaricare ubuntu:24.04 e — con
#            --push — un `podman login` già fatto sul registry. NON serve una
#            toolchain Rust sull'host: vive nell'immagine builder.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

BUILD_RUST=1
WITH_LVGL=1
BUILD_SPA=1
SAVE=1
PUSH=0
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
# Non `target/release/`: quella è la build dell'host, con un'altra libpython.
BIN="$REPO/sws-runtime/target-container-x86_64/release/sws-runtime"
# Stessa target-dir del runtime: il viewer è nel workspace, e le dipendenze in
# comune (tokio, serde, reqwest…) si compilano una volta sola.
LVGL_BIN="$REPO/sws-runtime/target-container-x86_64/release/sws-lvgl-viewer"
SPA_DIST="$REPO/sws-editor/dist"
BUILDER_IMAGE="sws-runtime-builder:x86_64"
# Python della base `ubuntu:24.04`, che builder e immagine finale condividono.
# Cambiando quella base va cambiato anche questo, e lo script lo fa notare.
EXPECTED_PY="3.12"

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)  usage; exit 0 ;;
        --no-rust)  BUILD_RUST=0; shift ;;
        --no-spa)   BUILD_SPA=0;  shift ;;
        --no-save)  SAVE=0;       shift ;;
        --push)     PUSH=1;       shift ;;
        # Con lo stesso significato del gemello aarch64 dal 10-11-2026, quando
        # anche questa immagine ha preso il viewer (per le istantanee). Fino a
        # quel giorno erano accettate e ignorate, perché build_containers_all.sh
        # inoltra gli argomenti IDENTICI a tutti gli script.
        --with-lvgl) WITH_LVGL=1; shift ;;
        --no-lvgl)   WITH_LVGL=0; shift ;;
        # Idem: --sdk riguarda solo l'immagine aarch64 (build_container.sh).
        --sdk) shift ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --out)      OUT_DIR="$2"; shift 2 ;;
        *) echo "Flag non riconosciuta: $1 (--help per l'elenco)" >&2; exit 1 ;;
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
# costruzione — la stessa idea che il percorso aarch64 realizza col proprio
# container di cross-build.
#
# --network host su entrambe le invocazioni podman: questo script gira rootless
# e non serve sudo, ma se viene comunque lanciato da root — per abitudine, o da
# dentro `build_containers_all.sh` invocato con `sudo` — la rete bridge di
# default di podman rootFUL non passa il DNS dell'host al container: `apt-get`
# dentro l'immagine builder fallisce risolvendo archive.ubuntu.com pur
# risolvendo benissimo sull'host (capitato dal vivo il 2026-08-07). Innocuo
# anche in esecuzione rootless normale.
#
# Fino al 14-09-2026 il `sudo` serviva davvero, per il passo aarch64 via QEMU:
# quel passo non c'è più (fase due di Q53), ma la protezione resta perché
# l'abitudine di lanciare con `sudo` sopravvive agli script che la
# richiedevano.
if [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> [1/4] immagine builder (toolchain Rust su ubuntu:24.04)"
    podman build --platform linux/amd64 --network host \
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
        --network host \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime \
        -e CARGO_HOME=/src/.cargo-container-x86_64 \
        -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-x86_64 \
        "$BUILDER_IMAGE" \
        cargo build --release --bin sws-runtime

    if [ "$WITH_LVGL" -eq 1 ]; then
        # Come nel gemello aarch64: le patch al codice LVGL vendorizzato
        # devono esserci, perché cargo non si accorge se qualcuno le toglie (Q22).
        echo "==> [1b/4] verifica delle patch al codice vendorizzato"
        "$REPO/scripts/check_vendor_patches.sh" || {
            echo "ERRORE: patch al codice vendorizzato mancanti — build interrotta." >&2
            echo "        Riapplica con: ./scripts/check_vendor_patches.sh --apply" >&2
            exit 1
        }
        # Una invocazione a parte e non `--bin sws-runtime --bin sws-lvgl-viewer`
        # in una sola: compilati insieme, le feature delle dipendenze in comune
        # si unificano fra i due, e il runtime uscirebbe diverso da quello
        # costruito da solo. Da `sws-runtime/` e non dalla cartella del crate:
        # DEP_LV_CONFIG_PATH e FreeType li dà il config del workspace.
        # `sdl-statico`: SDL2 dentro il binario, non la libsdl2 di Ubuntu, che
        # nell'immagine si porterebbe dietro Mesa e LLVM (+270 MB misurati) per
        # una libreria che `--istantanea` non inizializza mai. Vedi il Cargo.toml
        # del viewer.
        echo "==> [1c/4] cargo build --release -p sws-lvgl-viewer --features sdl-statico (dentro il builder)"
        podman run --rm \
            --platform linux/amd64 \
            --network host \
            -v "$REPO":/src:Z \
            -w /src/sws-runtime \
            -e CARGO_HOME=/src/.cargo-container-x86_64 \
            -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-x86_64 \
            "$BUILDER_IMAGE" \
            cargo build --release -p sws-lvgl-viewer --features sdl-statico
    fi
else
    echo "==> [1/4] skipped (--no-rust)"
fi

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> [1d/4] pnpm build (SPA)"
    (cd "$REPO/sws-editor" && pnpm build)
else
    echo "==> [1d/4] skipped (--no-spa)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN — togli --no-rust" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }
if [ "$WITH_LVGL" -eq 1 ]; then
    [ -f "$LVGL_BIN" ] || { echo "ERROR: missing $LVGL_BIN — togli --no-rust, o usa --no-lvgl" >&2; exit 1; }
fi

# Guard against the classic mistake of feeding a foreign-arch binary to an
# amd64 image — same principle as build_container.sh's aarch64 check.
for b in "$BIN" $( [ "$WITH_LVGL" -eq 1 ] && echo "$LVGL_BIN" ); do
    if ! file "$b" | grep -q "x86-64"; then
        echo "ERROR: $b is not an x86_64 binary:" >&2
        file "$b" >&2
        exit 1
    fi
done

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
mkdir -p "$CTX/bin" "$CTX/templates" "$CTX/catalogo" "$CTX/www" "$CTX/fonts"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
if [ "$WITH_LVGL" -eq 1 ]; then
    # Accanto al runtime: istantanea.rs cerca i due binari nella stessa cartella.
    install -m 755 "$LVGL_BIN" "$CTX/bin/sws-lvgl-viewer"
    # I font che apt non porta, come nel gemello aarch64: l'istantanea deve
    # disegnare emoji, segmenti e matrice di punti come il pannello, o la foto
    # mentirebbe proprio su quegli oggetti. fonts/ resta vuota con --no-lvgl.
    install -m 644 \
        "$REPO/sws-runtime/crates/sws-lvgl-viewer/assets/fonts/NotoEmoji-Regular.ttf" \
        "$REPO"/sws-runtime/crates/sws-lvgl-viewer/assets/fonts/DSEG*.ttf \
        "$REPO"/sws-runtime/crates/sws-lvgl-viewer/assets/fonts/DotGothic16-Regular.ttf \
        "$REPO"/sws-runtime/crates/sws-lvgl-viewer/assets/fonts/*.txt "$CTX/fonts/"
fi
cp -r "$REPO/examples/templates/." "$CTX/templates/"
cp -r "$REPO/catalogo/." "$CTX/catalogo/"
cp "$REPO/deploy/container/ssh_known_hosts" "$CTX/ssh_known_hosts"
# La licenza nell'immagine (10-11-2026): Containerfile → /usr/share/sws/licenza/.
mkdir -p "$CTX/licenza"
install -m 644 "$REPO/LICENSE" "$REPO/LICENSING.md" "$CTX/licenza/"
cp -r "$SPA_DIST/." "$CTX/www/"
# I quadlet e l'installer viaggiano dentro l'immagine (02-10-2026, piano del
# quadlet che viaggia): dopo un `podman auto-update` il runtime sa qual è il
# quadlet giusto per la versione che gira, e lo sa riscrivere dal pannello.
mkdir -p "$CTX/quadlet"
install -m 644 "$REPO/deploy/container/sws-runtime.container" "$REPO/deploy/container/sws-lvgl-viewer.container" "$CTX/quadlet/"
# E dal 03-10-2026 lo script delle immagini: stato, pulizia e ritorno alla
# versione precedente dopo un aggiornamento (conferma_aggiornamento.rs).
install -m 755 "$REPO/deploy/container/install-container.sh" "$REPO/deploy/container/immagini.sh" "$REPO/deploy/container/fiducia-browser.sh" "$CTX/quadlet/"
install -m 644 "$REPO/deploy/container/sws-fiducia.path" "$REPO/deploy/container/sws-fiducia.service" "$CTX/quadlet/"
QUADLET="$(sed -n 's/^Description=.*\[quadlet \([0-9]*\)\].*/\1/p' "$REPO/deploy/container/sws-runtime.container")"

# ── 3. Build the image ────────────────────────────────────────────────────────
# --format docker è indispensabile, non cosmetico: HEALTHCHECK non esiste nella
# spec OCI, senza --format docker podman lo scarta con un warning silenzioso.
# Le novità viaggiano dentro l'immagine (decisione 42): vedi build_container.sh.
# Dal 28-09-2026 non la sezione del CHANGELOG (per chi sviluppa, illeggibile su
# un pannello) ma le Novità brevi di NOVITA.yaml, in italiano e inglese
# (decisioni 55-58). Una -rc porta quelle della release a cui arriverà.
NOVITA_IT="$(python3 "$REPO/scripts/novita.py" "$VERSION" it || true)"
NOVITA_EN="$(python3 "$REPO/scripts/novita.py" "$VERSION" en || true)"
COMPAT_IT="$(python3 "$REPO/scripts/novita.py" "$VERSION" it --compat || true)"
COMPAT_EN="$(python3 "$REPO/scripts/novita.py" "$VERSION" en --compat || true)"

echo "==> [3/4] podman build --platform linux/amd64 -t $IMAGE"
podman build --platform linux/amd64 --format docker \
    --build-arg "SWS_VERSION=$VERSION" \
    --build-arg "SWS_NOVITA_IT=$NOVITA_IT" \
    --build-arg "SWS_NOVITA_EN=$NOVITA_EN" \
    --build-arg "SWS_COMPAT_IT=$COMPAT_IT" \
    --build-arg "SWS_COMPAT_EN=$COMPAT_EN" \
    --build-arg "SWS_QUADLET=$QUADLET" \
    --build-arg "WITH_LVGL=$WITH_LVGL" \
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
    # Canali dell'aggiornamento (27-09-2026), come in build_container.sh:
    # `-rc` sposta solo `rc-amd64`, una release sposta `latest-` e `rc-`.
    TAG_RC="${REGISTRY}:rc-amd64"
    case "$VERSION" in
        *-rc.*) TAGS=( "$TAG_VERSION" "$TAG_COMMIT" "$TAG_RC" ) ;;
        *-*)    TAGS=( "$TAG_VERSION" "$TAG_COMMIT" ) ;;
        *)      TAGS=( "$TAG_VERSION" "$TAG_COMMIT" "$TAG_LATEST" "$TAG_RC" ) ;;
    esac
    for t in "${TAGS[@]}"; do
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
