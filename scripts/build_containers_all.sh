#!/usr/bin/env bash
#
# Richiama in sequenza gli script di build container per costruire tutte le
# immagini in un colpo solo invece di lanciarle una a una a mano.
#
# LE IMMAGINI SONO DUE: aarch64 e x86_64. L'aarch64 la costruisce
# build_container.sh cross-compilando in un container Ubuntu (niente SDK Pixsys,
# niente QEMU, ottimizzata) e vale per qualunque board arm64;
# `latest-arm64-generic` è un **alias** della stessa immagine, pubblicato sempre
# perché i dispositivi installati con quel riferimento continuino ad aggiornarsi.
#
# Fase due di Q53, 14-09-2026: la vecchia immagine aarch64 via QEMU
# (opt-level 0, ~50 minuti) e il percorso con l'SDK Yocto Pixsys sono stati
# **rimossi**. Erano tenuti «finché il cross-build non è collaudato»; la misura
# sul WP630 del 10-09 (runtime su in 0,30 s all'1,2 % di un core) ha chiuso la
# questione. Con loro se n'è andato anche il giro dei privilegi: nessuno dei due
# script rimasti vuole root.
#
# Tutti gli argomenti passati a questo script vengono inoltrati IDENTICI a
# ciascuno degli script (--push, --no-rust, --no-spa, --registry, --out, ecc.)
# — stesso set di flag di scripts/build_container.sh, vedi quello script per il
# significato di ciascuna flag. Si ferma al primo script che fallisce (set -e)
# senza proseguire con gli altri.
#
# Un'eccezione, gestita SOLO da questo script (non inoltrata):
#
#   -h, --help      Stampa questo testo ed esce, senza toccare nulla.
#
# Lanciare SENZA sudo. Lanciarlo con `sudo` fa girare i due script da root, e
# sotto podman rootful la rete bridge di default non passa il DNS dell'host ai
# container: il builder x86_64 fallisce risolvendo archive.ubuntu.com pur
# risolvendo benissimo sull'host (capitato dal vivo il 2026-08-07). Per
# compatibilità con chi lo lancia comunque con `sudo` per abitudine, questo
# script si accorge di girare da root e riabbassa i privilegi all'utente
# originale (`$SUDO_USER`).
#
# Uso:
#   ./scripts/build_containers_all.sh                      # aarch64 (cross) + x86_64: build + archivio
#   ./scripts/build_containers_all.sh --push                # ...e pubblica sul registry
#   ./scripts/build_containers_all.sh --no-rust              # riusa i binari già compilati
#   ./scripts/build_containers_all.sh --no-save --push       # solo pubblicazione, nessun archivio
#
# Requisiti: podman, pnpm per la SPA, emulazione QEMU per arm64 registrata
# sull'host (una tantum, per l'apt-get dell'immagine aarch64), rete verso
# ubuntu:24.04, ports.ubuntu.com e crates.io, e — con --push — un `podman
# login` già fatto.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    sed -n '2,46p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

ARGS=()
for arg in "$@"; do
    case "$arg" in
        -h|--help) usage; exit 0 ;;
        # Ritirate il 14-09-2026 (fase due di Q53). Un messaggio esplicito
        # invece di lasciarle arrivare a build_container.sh, che direbbe solo
        # «Flag non riconosciuta»: chi le ha nelle dita ha diritto di sapere
        # che il percorso non c'è più e perché.
        --with-generic|--require-sdk|--sdk)
            echo "ERRORE: $arg è stata rimossa il 14-09-2026 (fase due di Q53)." >&2
            echo "        L'immagine aarch64 è una sola, cross-compilata in un container" >&2
            echo "        Ubuntu: ottimizzata, in minuti, senza SDK Pixsys e senza QEMU." >&2
            echo "        Lancia lo script senza flag. Gli alias -arm64-generic si" >&2
            echo "        pubblicano comunque, quindi i dispositivi installati con quel" >&2
            echo "        riferimento continuano ad aggiornarsi." >&2
            exit 1 ;;
        *) ARGS+=("$arg") ;;
    esac
done

# Nessuno dei due script vuole root — da quando la build QEMU è sparita, root
# non serve più a niente qui. Se questo script è stato lanciato con `sudo`
# per abitudine, si riabbassa a `$SUDO_USER` (da root non chiede una nuova
# password) invece di far fallire il builder x86_64 sul DNS.
run_script() {
    local script="$1"; shift
    if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
        sudo -u "$SUDO_USER" "$SCRIPT_DIR/$script" "$@"
    else
        "$SCRIPT_DIR/$script" "$@"
    fi
}

SCRIPTS=( "build_container.sh" "build_container_x86_64.sh" )

for s in "${SCRIPTS[@]}"; do
    echo
    echo "════════════════════════════════════════════════════════════════════"
    echo "  $s ${ARGS[*]-}"
    echo "════════════════════════════════════════════════════════════════════"
    run_script "$s" "${ARGS[@]}"
done

echo
echo "==> immagini container costruite."

# Il riepilogo finale: quali immagini ci sono, quanto pesano, a cosa servono.
#
# Serve perché l'uscita delle tre build è lunga centinaia di righe e finisce
# con l'ultima delle tre: chi ha lanciato il comando vede «done. Image:
# sws-runtime:2.5.0-amd64» e non ha davanti le altre due, né le dimensioni, né
# quale copiare su quale ferro. È anche il punto in cui si nota una build che è
# stata **saltata** (SDK Pixsys assente) invece di scoprirlo installando.
#
# `--pubblicate` solo se qui è passato `--push`: la presenza di una tag ghcr in
# locale prova che `podman tag` è stato fatto, non che il push sia arrivato, e
# lo script da solo non può distinguerlo. Chi ha lanciato la build invece sì.
RIEPILOGO_ARGS=()
for a in "${ARGS[@]-}"; do
    [ "$a" = "--push" ] && RIEPILOGO_ARGS+=("--pubblicate")
done
# Mai fatale: un riepilogo che fa fallire una build riuscita sarebbe assurdo.
"$SCRIPT_DIR/riepilogo_immagini.sh" "${RIEPILOGO_ARGS[@]-}" ||     echo "    (il riepilogo non è riuscito: le immagini però sono costruite)"
