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
#   ./scripts/build_container_aarch64_generic.sh --with-lvgl     # include anche sws-lvgl-viewer
#
# --with-lvgl è opt-in, non il default: costruisce un secondo strato builder
# (Containerfile.aarch64-generic-lvgl.builder, clang/libclang/libsdl2-dev in
# più) e compila anche sws-lvgl-viewer sotto la stessa emulazione QEMU — non
# ancora provato in questa forma (bindgen contro libclang sotto emulazione è
# un'incognita in più rispetto al solo sws-runtime). Senza il flag, questo
# script si comporta esattamente come prima che quel crate esistesse.
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
# funziona.
#
# **Non serve lanciarlo con `sudo`**: dal 2026-08-26 lo script se ne accorge da
# solo e si rilancia, chiedendo la password quando serve — cioè dopo aver
# verificato le condizioni che lo farebbero fallire comunque (albero sporco con
# `--push`), così non la si digita per un lavoro che si rifiuterà due righe
# dopo. Lanciarlo con `sudo` a mano continua a funzionare identico.
#
# Effetto collaterale: podman "vero" non rimappa gli UID
# sui bind mount, quindi target-container-aarch64-generic/,
# .cargo-container-aarch64-generic/, dist/ e sws-editor/dist/ (pnpm build,
# lanciato direttamente e non in un container) finirebbero di proprietà di
# root — lo script stesso li restituisce all'utente originale all'uscita
# (vedi il `trap restore_ownership EXIT` qui sotto), non serve più farlo a
# mano.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    sed -n '2,66p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

# Lo script gira con sudo (vedi il controllo root più sotto): tutto ciò che
# root scrive — dist/, sws-editor/dist/ (pnpm build gira come root, non
# dentro un container), target-container-aarch64-generic/,
# .cargo-container-aarch64-generic/ — resterebbe altrimenti di sua proprietà,
# inutilizzabile dall'utente normale (persino un `pnpm build` successivo
# fallisce con EACCES, successo il 2026-08-02: pnpm prova a *ricreare*
# dist/assets/, non solo scriverci dentro, e non può farlo su una directory
# posseduta da root). Il trap gira SEMPRE all'uscita — successo, `--no-rust`,
# o uno `set -e` che interrompe a metà: uno script che fallisce non deve
# comunque lasciare artefatti root-owned in giro. `$SUDO_USER` è l'utente
# originale che ha lanciato `sudo`; senza sudo (o se root fa girare lo
# script direttamente, senza passare da un utente normale) non c'è nulla da
# restituire, quindi non fa nulla.
restore_ownership() {
    if [ -n "${SUDO_USER:-}" ]; then
        chown -R "$SUDO_USER:$(id -gn "$SUDO_USER")" \
            "$REPO/dist" \
            "$REPO/sws-editor/dist" \
            "$REPO/sws-runtime/target-container-aarch64-generic" \
            "$REPO/.cargo-container-aarch64-generic" \
            "$REPO/sws-runtime/crates/sws-lvgl-viewer/target-container-aarch64-generic" \
            2>/dev/null || true
    fi
}
trap restore_ownership EXIT

# Argomenti così come sono arrivati, prima che il ciclo di parsing li consumi
# con `shift`: servono a rilanciare lo script sotto sudo con gli stessi flag
# (vedi il blocco di auto-elevazione più sotto).
ORIG_ARGS=("$@")

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
PUSH=0
# LVGL acceso per default dal 2026-08-24, come nel gemello SDK: sui prodotti
# Pixsys si deve poter provare sia il runtime web sia quello LVGL da una sola
# immagine. Qui il viewer si compila nel builder QEMU, che ha già clang e
# libsdl2-dev, quindi non dipende dal sysroot dell'SDK.
WITH_LVGL=1
REGISTRY="ghcr.io/soligolab/sws-runtime"
OUT_DIR="$REPO/dist"
# Dedicata: non collide né con target/ dell'host (altra architettura) né con
# target/aarch64-unknown-linux-gnu/ del percorso SDK — un binario diverso,
# non intercambiabile (glibc/Python diversi, nessun tuning cortex-a35).
BIN="$REPO/sws-runtime/target-container-aarch64-generic/release/sws-runtime"
LVGL_CRATE_DIR="$REPO/sws-runtime/crates/sws-lvgl-viewer"
# Dedicata anche questa, per lo stesso motivo di BIN — e per non collidere
# con crates/sws-lvgl-viewer/target/ usato dai build locali x86_64 (simulatore
# SDL2 desktop): stesso crate, artefatti incompatibili tra loro.
LVGL_BIN="$LVGL_CRATE_DIR/target-container-aarch64-generic/release/sws-lvgl-viewer"
SPA_DIST="$REPO/sws-editor/dist"
BUILDER_IMAGE="sws-runtime-builder:aarch64-generic"
LVGL_BUILDER_IMAGE="sws-runtime-builder:aarch64-generic-lvgl"
# Python della base `ubuntu:24.04`, che builder e immagine finale condividono.
EXPECTED_PY="3.12"

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)   usage; exit 0 ;;
        --no-rust)   BUILD_RUST=0; shift ;;
        --no-spa)    BUILD_SPA=0;  shift ;;
        --no-save)   SAVE=0;       shift ;;
        --push)      PUSH=1;       shift ;;
        # Accettata e senza effetto: era il modo di chiederlo.
        --with-lvgl) WITH_LVGL=1;  shift ;;
        --no-lvgl)   WITH_LVGL=0;  shift ;;
        --registry)  REGISTRY="$2"; shift 2 ;;
        --out)       OUT_DIR="$2"; shift 2 ;;
        *) echo "Flag non riconosciuta: $1 (--help per l'elenco)" >&2; exit 1 ;;
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
    # Si rilancia da solo sotto sudo invece di dire all'utente di rifarlo a
    # mano. Prima però verifica le condizioni che farebbero fallire comunque la
    # pubblicazione: chiedere una password per un lavoro che si rifiuterà due
    # righe dopo è il modo peggiore di chiederla.
    #
    # I controlli qui sotto sono gli stessi ripetuti più avanti in forma
    # completa: farli due volte non costa niente (sono letture) e il secondo
    # giro gira comunque, anche quando lo script è invocato già da root.
    if [ "$PUSH" -eq 1 ]; then
        if [ -n "$(cd "$REPO" && git status --porcelain 2>/dev/null)" ]; then
            echo "ERRORE: l'albero di lavoro ha modifiche non committate." >&2
            echo "        Il tag di provenienza dell'immagine indicherebbe un commit che non" >&2
            echo "        contiene ciò che stai pubblicando. Committa (o metti da parte) prima." >&2
            (cd "$REPO" && git status --short) >&2
            exit 1
        fi
    fi

    if ! command -v sudo >/dev/null 2>&1; then
        echo "ERRORE: serve root (build aarch64 emulata: podman rootless non riesce a" >&2
        echo "        eseguire binari arm64 sotto QEMU su questa famiglia di kernel/crun)," >&2
        echo "        ma 'sudo' non è disponibile. Rilancia come root." >&2
        exit 1
    fi

    echo "==> serve root per la build emulata (QEMU sotto podman rootless non"
    echo "    attraversa la user namespace del container). Mi rilancio con sudo."
    echo "    Gli artefatti tornano tuoi all'uscita: nessun chown da fare dopo."
    # `exec`: il processo viene sostituito, quindi il trap che restituisce i
    # file all'utente originale vive nel processo root — che è dove serve.
    # `$SUDO_USER`, impostato da sudo, è ciò che permette sia quel trap sia il
    # riuso del tuo `podman login` (l'auth.json dell'utente, non di root).
    exec sudo -- "$0" "${ORIG_ARGS[@]}"
fi

# ── Controlli preliminari alla pubblicazione ──────────────────────────────────
GIT_SHA=""
AUTHFILE_ARGS=()
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

    # `podman login` non richiede root — è normale farlo come utente normale
    # prima di lanciare questo script con sudo (serve root solo per la build,
    # vedi sopra). Ma root ha un proprio auth store separato da quello
    # rootless di $SUDO_USER, quindi senza puntarci esplicitamente qui
    # risulterebbe "nessun login" anche con un login perfettamente valido —
    # e la correzione sbagliata sarebbe rifare il login come root (un secondo
    # set di credenziali da gestire, invece di riusare quello che c'è già).
    # Stessi due percorsi che prova podman stesso in ordine di priorità:
    # XDG_RUNTIME_DIR (sessione rootless via systemd-logind, il caso comune)
    # e il config dir come ripiego.
    if [ -n "${SUDO_USER:-}" ]; then
        SUDO_UID="$(id -u "$SUDO_USER")"
        SUDO_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
        for candidate in \
            "/run/user/${SUDO_UID}/containers/auth.json" \
            "$SUDO_HOME/.config/containers/auth.json"
        do
            if [ -f "$candidate" ]; then
                AUTHFILE_ARGS=(--authfile "$candidate")
                break
            fi
        done
    fi

    if ! podman login "${AUTHFILE_ARGS[@]}" --get-login "$REGISTRY_HOST" >/dev/null 2>&1; then
        echo "ERRORE: nessun login su $REGISTRY_HOST." >&2
        if [ "${#AUTHFILE_ARGS[@]}" -gt 0 ]; then
            echo "        (controllato anche ${AUTHFILE_ARGS[1]}, il login di \$SUDO_USER=$SUDO_USER)" >&2
        fi
        echo "        podman login $REGISTRY_HOST -u <utente>  # come utente normale, non con sudo" >&2
        exit 1
    fi
fi

# ── Strumenti dell'utente, visti da root ─────────────────────────────────────
#
# Questo script gira come root (vedi sopra), e sotto `sudo` il PATH è quello di
# root: `cargo` e `pnpm`, installati nella home dell'utente da rustup e da npm,
# non ci sono. Il sintomo è "cargo: command not found" seguito da un errore di
# JSON, perché a valle si prova a interpretare un output vuoto.
#
# Funzionava finché il PATH del chiamante sopravviveva a sudo — cosa che dipende
# dalla configurazione di sudoers della macchina, non da noi: una dipendenza
# invisibile che regge finché non cambia il computer. Qui si risolve il percorso
# in modo esplicito, così l'esito non dipende più da come è configurato sudo.
user_bin() {
    local cmd="$1" p home
    if p="$(command -v "$cmd" 2>/dev/null)" && [ -n "$p" ]; then
        printf '%s' "$p"; return 0
    fi
    if [ -n "${SUDO_USER:-}" ]; then
        home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
        for p in "$home/.cargo/bin/$cmd" \
                 "$home/.local/bin/$cmd" \
                 "$home/.local/share/pnpm/$cmd" \
                 "$home/.nvm/versions/node"/*/bin/"$cmd"; do
            [ -x "$p" ] && { printf '%s' "$p"; return 0; }
        done
    fi
    return 1
}

require_user_bin() {
    local cmd="$1" p
    if ! p="$(user_bin "$cmd")"; then
        echo "ERRORE: '$cmd' non trovato." >&2
        if [ -n "${SUDO_USER:-}" ]; then
            echo "        Lo script gira come root e '$cmd' non è nel PATH di root né" >&2
            echo "        nella home di \$SUDO_USER=$SUDO_USER. Se è installato altrove," >&2
            echo "        esportane il percorso prima di lanciare:" >&2
            echo "          sudo env \"PATH=\$PATH\" ./scripts/build_container_aarch64_generic.sh" >&2
        else
            echo "        Installalo o mettilo nel PATH." >&2
        fi
        exit 1
    fi
    printf '%s' "$p"
}

CARGO="$(require_user_bin cargo)"
VERSION=$(cd "$REPO/sws-runtime" && "$CARGO" metadata --no-deps --format-version 1 \
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

# ── 1c. Optional: sws-lvgl-viewer (--with-lvgl) ─────────────────────────────
# Stessa emulazione QEMU del passo sopra, ma con un builder esteso (clang/
# libclang per bindgen contro lvgl-sys, libsdl2-dev per il backend SDL2 del
# crate) e la working directory dentro crates/sws-lvgl-viewer: quel crate ha
# un .cargo/config.toml locale che imposta DEP_LV_CONFIG_PATH relativo alla
# cwd, scoperto durante il percorso SDK Pixsys — vale identico qui.
# Non prova AWS_LC_SYS_NO_ASM: sws-lvgl-viewer fissa `rustls` sul backend
# `ring` (Cargo.toml del crate), non `aws-lc-rs` — aws-lc-sys potrebbe non
# comparire affatto nel suo albero di dipendenze. CARGO_PROFILE_RELEASE_
# OPT_LEVEL=0 resta per prudenza (mitigazione generica, non specifica di
# aws-lc-sys). Se `ring` avesse un problema analogo sotto QEMU non è stato
# ancora verificato in nessuna direzione.
if [ "$BUILD_RUST" -eq 1 ] && [ "$WITH_LVGL" -eq 1 ]; then
    echo "==> [1c] immagine builder LVGL (+ clang/libclang/libsdl2-dev, emulato arm64)"
    podman build --platform linux/arm64 --network host \
        -t "$LVGL_BUILDER_IMAGE" \
        -f "$REPO/deploy/container/Containerfile.aarch64-generic-lvgl.builder" \
        "$REPO/deploy/container"

    echo "==> [1c] cargo build --release -p sws-lvgl-viewer (dentro il builder LVGL, emulato — lento)"
    podman run --rm \
        --platform linux/arm64 \
        --network host \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime/crates/sws-lvgl-viewer \
        -e CARGO_HOME=/src/.cargo-container-aarch64-generic \
        -e CARGO_TARGET_DIR=/src/sws-runtime/crates/sws-lvgl-viewer/target-container-aarch64-generic \
        -e CARGO_PROFILE_RELEASE_OPT_LEVEL=0 \
        "$LVGL_BUILDER_IMAGE" \
        cargo build --release
elif [ "$WITH_LVGL" -eq 1 ]; then
    echo "==> [1c] skipped build (--no-rust, riuso $LVGL_BIN esistente)"
else
    echo "==> [1c] skipped (--no-lvgl)"
fi

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> [1b/4] pnpm build (SPA)"
    # La SPA si compila come l'UTENTE, non come root.
    #
    # Non ha alcun bisogno di privilegi, e farla girare da root sporca cose che
    # il trap di fine script non restituisce: `pnpm build` scrive anche in
    # `sws-editor/node_modules/.vite` (cache di vite) e può toccare lo store di
    # pnpm nella home. Diventati di root, il successivo `pnpm build` normale
    # fallisce con errori di permessi in una cartella che nessuno sospetta.
    #
    # Inseguire quelle cartelle con altri chown sarebbe una rincorsa; non
    # sporcarle affatto chiude la questione. Da root `sudo -u` non richiede
    # password.
    PNPM="$(require_user_bin pnpm)"
    if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
        (cd "$REPO/sws-editor" && sudo -u "$SUDO_USER" "$PNPM" build)
    else
        (cd "$REPO/sws-editor" && "$PNPM" build)
    fi
else
    echo "==> [1b/4] skipped (--no-spa)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN — togli --no-rust" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }
if [ "$WITH_LVGL" -eq 1 ]; then
    [ -f "$LVGL_BIN" ] || { echo "ERROR: missing $LVGL_BIN (usa --no-lvgl per costruire senza)" >&2; exit 1; }
fi

# Guardia contro il classico errore di infilare un binario della architettura
# sbagliata in un'immagine arm64 — stesso principio del controllo aarch64-SDK
# in build_container.sh.
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
if [ "$WITH_LVGL" -eq 1 ]; then
    install -m 755 "$LVGL_BIN" "$CTX/bin/sws-lvgl-viewer"
fi
cp -r "$REPO/examples/templates/." "$CTX/templates/"
cp -r "$SPA_DIST/." "$CTX/www/"

# ── 3. Build the image ────────────────────────────────────────────────────────
echo "==> [3/4] podman build --platform linux/arm64 -t $IMAGE"
podman build --platform linux/arm64 --network host --format docker \
    --build-arg "WITH_LVGL=$WITH_LVGL" \
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
        podman push "${AUTHFILE_ARGS[@]}" "$t"
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
