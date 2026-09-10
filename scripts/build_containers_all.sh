#!/usr/bin/env bash
#
# Richiama in sequenza gli script di build container per costruire tutte le
# immagini in un colpo solo invece di lanciarle una a una a mano.
#
# DALLA 2.7.2 (Q53, 2026-09-10) LE IMMAGINI SONO DUE: aarch64 e x86_64.
# L'aarch64 la costruisce build_container.sh cross-compilando in un container
# Ubuntu (niente SDK Pixsys, niente QEMU, ottimizzata) e vale per qualunque
# board arm64; `latest-arm64-generic` è ora un alias della stessa immagine.
# Il vecchio percorso QEMU (build_container_aarch64_generic.sh, opt-level 0)
# si lancia solo con --with-generic, e resta finché il cross-build non è
# collaudato; poi sparisce.
#
# Tutti gli argomenti passati a questo script vengono inoltrati IDENTICI a
# ciascuno degli script (--push, --no-rust, --no-spa, --sdk, --registry, --out,
# ecc.) — stesso set di flag di scripts/build_container.sh, vedi quello
# script per il significato di ciascuna flag. Si ferma al primo script che
# fallisce (set -e) senza proseguire con gli altri.
#
# Due eccezioni, gestite SOLO da questo script (non inoltrate):
#
#   -h, --help      Stampa questo testo ed esce, senza toccare nulla.
#
#   --with-generic  Costruisce ANCHE la vecchia immagine aarch64 via QEMU
#                   (chiede sudo da sola, dura ~50 minuti, binario non
#                   ottimizzato). Solo per confronto durante la transizione.
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
#   ./scripts/build_containers_all.sh                      # aarch64 (cross) + x86_64: build + archivio
#   ./scripts/build_containers_all.sh --push                # ...e pubblica sul registry
#   ./scripts/build_containers_all.sh --no-rust              # riusa i binari già compilati
#   ./scripts/build_containers_all.sh --no-save --push       # solo pubblicazione, nessun archivio
#   ./scripts/build_containers_all.sh --sdk                 # aarch64 con l'SDK Pixsys (storico)
#   ./scripts/build_containers_all.sh --with-generic        # anche la vecchia aarch64 via QEMU
#
# Requisiti: podman, pnpm per la SPA, emulazione QEMU per arm64 registrata
# sull'host (una tantum, per l'apt-get dell'immagine aarch64), rete verso
# ubuntu:24.04, ports.ubuntu.com e crates.io, e — con --push — un `podman
# login` già fatto. Con --sdk: l'SDK Yocto Pixsys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'
}

WITH_GENERIC=0
ARGS=()
for arg in "$@"; do
    case "$arg" in
        -h|--help)      usage; exit 0 ;;
        --with-generic) WITH_GENERIC=1 ;;
        # Storico: l'SDK ora si chiede a build_container.sh con --sdk, che
        # fallisce da sé se l'SDK manca. Accettata per chi la ha nelle dita.
        --require-sdk)  ARGS+=("--sdk") ;;
        *) ARGS+=("$arg") ;;
    esac
done

# Lancia uno degli script col livello di privilegio giusto per lui, non per
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

# Due immagini per default (Q53). Con --with-generic la vecchia aarch64 via QEMU
# va PER PRIMA: è l'unica che chiede `sudo`, e la password si digita subito
# invece che a metà di una build lunga (la cache di sudo scade in ~15 minuti).
SCRIPTS=()
[ "$WITH_GENERIC" -eq 1 ] && SCRIPTS+=( "build_container_aarch64_generic.sh" )
SCRIPTS+=( "build_container.sh" "build_container_x86_64.sh" )

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
