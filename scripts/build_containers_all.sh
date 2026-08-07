#!/usr/bin/env bash
#
# Richiama in sequenza tutti e tre gli script di build container (SDK Pixsys
# aarch64, aarch64 generico senza SDK, x86_64), per costruire tutte le
# immagini in un colpo solo invece di lanciarle una a una a mano.
#
# Tutti gli argomenti passati a questo script vengono inoltrati IDENTICI a
# ciascuno dei tre script (--push, --no-rust, --no-spa, --registry, --out,
# ecc.) — stesso set di flag di scripts/build_container.sh, vedi quello
# script per il significato di ciascuna flag. Si ferma al primo script che
# fallisce (set -e) senza proseguire con gli altri.
#
# Due eccezioni, gestite SOLO da questo script (non inoltrate ai tre):
#
#   -h, --help     Stampa questo testo ed esce, senza toccare nulla.
#
#   --require-sdk  Se l'SDK Yocto Pixsys non è installato, ferma l'intera
#                  sequenza con errore (comportamento dello script singolo).
#                  Di default, invece, l'SDK mancante salta SOLO
#                  build_container.sh (il percorso Pixsys-tuned) — con un
#                  avviso ben visibile, non in silenzio — e prosegue comunque
#                  con aarch64-generico e x86_64: sulle macchine senza SDK
#                  (es. l'ufficio) non serve ricordarsi un flag per ottenere
#                  le altre due immagini. Usa --require-sdk quando l'SDK
#                  mancante deve essere un errore bloccante (es. automazione
#                  di release che deve accorgersi di una macchina configurata
#                  male).
#
# Lanciare SENZA sudo, anche se aarch64-generico (a differenza degli altri
# due) richiede root: questo script chiede la password da solo con `sudo`
# SOLO per quel passo, quando serve (a meno di --no-rust, che con
# aarch64-generico non richiede root — vedi quello script). Lanciarlo INTERO
# con `sudo`, come sembrava necessario prima di questa correzione, fa girare
# ANCHE build_container.sh e build_container_x86_64.sh da root: sotto podman
# rootful la rete bridge di default non passa il DNS dell'host ai container,
# e il builder x86_64 fallisce risolvendo archive.ubuntu.com pur risolvendo
# benissimo sull'host (capitato dal vivo il 2026-08-07). Per compatibilità
# con chi lo lancia comunque con `sudo` per abitudine, questo script si
# accorge di girare da root e riabbassa i privilegi all'utente originale
# (`$SUDO_USER`) per i due passi che non devono essere root.
#
# Uso:
#   ./scripts/build_containers_all.sh                      # build + archivio per tutte e tre
#                                                            # (salta l'SDK Pixsys se manca, con avviso;
#                                                            #  chiede sudo da solo per aarch64-generico)
#   ./scripts/build_containers_all.sh --require-sdk         # ...ma fallisce se l'SDK Pixsys manca
#   ./scripts/build_containers_all.sh --push                # ...e pubblica tutte e tre sul registry
#   ./scripts/build_containers_all.sh --no-rust              # riusa i binari già compilati (tutti e tre,
#                                                            # niente sudo: aarch64-generico non lo richiede)
#   ./scripts/build_containers_all.sh --no-save --push       # solo pubblicazione, nessun archivio
#
# Requisiti: l'unione di quelli dei tre script singoli — SDK Yocto Pixsys
# (salvo --no-rust, o se manca e non si passa --require-sdk), podman,
# emulazione QEMU per arm64 registrata sull'host (una tantum), pnpm per la
# SPA, rete per ubuntu:24.04 e — con --push — un `podman login` già fatto.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    sed -n '2,55p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

# Stesso percorso cablato in build_container.sh: usato solo per decidere se
# saltare quello script per default, non per validare nient'altro (la
# validazione vera resta dentro build_container.sh stesso).
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"

REQUIRE_SDK=0
ARGS=()
for arg in "$@"; do
    case "$arg" in
        -h|--help)     usage; exit 0 ;;
        --require-sdk) REQUIRE_SDK=1 ;;
        *) ARGS+=("$arg") ;;
    esac
done

# Lancia uno dei tre script col livello di privilegio giusto per lui, non per
# noi. aarch64-generico vuole root (QEMU sotto podman rootless non attraversa
# la user namespace, vedi quello script); gli altri due NON lo vogliono (vedi
# il commento in testa al file). `id -u`/`$SUDO_USER` decidono l'azione:
#
#   non-root, aarch64-generico → `sudo` di questo script soltanto: chiede la
#                                 password qui, non prima, non per gli altri.
#   root (perché lanciato con `sudo`), aarch64-generico → già root, va bene.
#   root, gli altri due → si riabbassa a `$SUDO_USER` con `sudo -u`, che da
#                          root non richiede una nuova password.
#   non-root, gli altri due → invocazione diretta, comportamento di sempre.
run_script() {
    local script="$1"; shift
    if [ "$script" = "build_container_aarch64_generic.sh" ]; then
        if [ "$(id -u)" -eq 0 ]; then
            "$SCRIPT_DIR/$script" "$@"
        else
            echo "    (serve sudo per $script — QEMU sotto podman rootless non attraversa la user namespace)"
            sudo "$SCRIPT_DIR/$script" "$@"
        fi
    else
        if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
            sudo -u "$SUDO_USER" "$SCRIPT_DIR/$script" "$@"
        else
            "$SCRIPT_DIR/$script" "$@"
        fi
    fi
}

SCRIPTS=(
    "build_container.sh"
    "build_container_aarch64_generic.sh"
    "build_container_x86_64.sh"
)

for s in "${SCRIPTS[@]}"; do
    if [ "$s" = "build_container.sh" ] && [ "$REQUIRE_SDK" -eq 0 ] && [ ! -f "$SDK_ENV" ]; then
        echo
        echo "==> $s SALTATO: SDK Yocto Pixsys non trovato ($SDK_ENV)."
        echo "    Proseguo con le altre due immagini (--require-sdk per bloccarsi qui)."
        continue
    fi
    echo
    echo "════════════════════════════════════════════════════════════════════"
    echo "  $s ${ARGS[*]-}"
    echo "════════════════════════════════════════════════════════════════════"
    run_script "$s" "${ARGS[@]}"
done

echo
echo "==> immagini container costruite."
