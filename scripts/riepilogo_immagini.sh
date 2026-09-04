#!/usr/bin/env bash
#
# Riepiloga le immagini container di una versione: quali ci sono, quanto
# pesano, a cosa servono. Si lancia da sé in coda a
# `build_containers_all.sh`, e si può richiamare in qualunque momento senza
# ricostruire niente — non tocca nulla, legge e stampa.
#
# Uso:
#   ./scripts/riepilogo_immagini.sh              # la versione dichiarata in Cargo.toml
#   ./scripts/riepilogo_immagini.sh 2.4.0        # una versione precedente
#   ./scripts/riepilogo_immagini.sh --pubblicate # dì che le tag ghcr sono state pushate
#
# ── Perché legge `dist/` e non solo `podman images` ──────────────────────────
#
# Le tre immagini **non stanno tutte nello stesso deposito**. `arm64-generic` si
# costruisce con `sudo` (QEMU sotto podman rootless non attraversa la user
# namespace), quindi finisce nel deposito di root: un `podman images` da utente
# normale non la vede, e un riepilogo ingenuo la darebbe per **mancante** dopo
# averla appena costruita. Gli archivi in `dist/` invece sono tutti là, di
# proprietà dell'utente, e sono anche la cosa che si copia davvero su un
# dispositivo. Sono loro la fonte primaria; `podman images` arricchisce quando
# l'immagine è nel deposito raggiungibile, e quando non c'è lo script dice
# *dove* sta invece di dire che non esiste.
#
# `sudo` non lo chiede mai: un riepilogo che chiede una password non è un
# riepilogo. Se `sudo -n` passa senza chiedere niente, ne approfitta.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PUBBLICATE=0
VERSION=""
for arg in "$@"; do
    case "$arg" in
        --pubblicate) PUBBLICATE=1 ;;
        -h|--help) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'; exit 0 ;;
        *) VERSION="$arg" ;;
    esac
done

if [ -z "$VERSION" ]; then
    VERSION="$(grep -m1 -oE '^version = "[0-9][0-9.]*"' "$REPO_ROOT/sws-runtime/Cargo.toml" \
               | grep -oE '[0-9][0-9.]*')"
fi
REGISTRY="ghcr.io/soligolab/sws-runtime"

# I tre gusti, con ciò che li distingue davvero. Il testo sta qui e non nei
# Containerfile perché è la risposta alla domanda «quale copio su questo
# pezzo di ferro?», che nessun file di build si pone.
#
# Campi: <suffisso-immagine>|<suffisso-archivio>|<a cosa serve>|<come è costruita>
GUSTI=(
  "arm64|aarch64|pannelli Pixsys (PX30, RK3399, RK3588)|SDK Yocto Pixsys: linka la libc del dispositivo, e porta anche sws-lvgl-viewer"
  "arm64-generic|aarch64-generic|board arm64 non Pixsys (Debian/Ubuntu)|in container con QEMU, senza SDK: gira dove la libc è quella della distro"
  "amd64|x86_64|PC, VM, prove in locale|in container su ubuntu:24.04, nessuna emulazione"
)

byte_umani() {
    local b="$1"
    if   [ "$b" -ge 1073741824 ] 2>/dev/null; then awk -v b="$b" 'BEGIN{printf "%.1f GB", b/1073741824}'
    elif [ "$b" -ge 1048576 ]    2>/dev/null; then awk -v b="$b" 'BEGIN{printf "%.0f MB", b/1048576}'
    else awk -v b="$b" 'BEGIN{printf "%.0f kB", b/1024}'
    fi
}

# La dimensione dell'immagine **decompressa** nel deposito, che è quella che
# occupa sul dispositivo — diversa e molto più grande dell'archivio compresso
# che si copia. Vanno dette entrambe, o il numero sorprende al momento del load.
dimensione_immagine() {
    local rif="$1" out
    out="$(podman image inspect --format '{{.Size}}' "$rif" 2>/dev/null)"
    if [ -z "$out" ] && sudo -n true 2>/dev/null; then
        out="$(sudo -n podman image inspect --format '{{.Size}}' "$rif" 2>/dev/null)"
        [ -n "$out" ] && echo "$out root" && return 0
    fi
    [ -n "$out" ] && echo "$out utente"
}

echo
echo "════════════════════════════════════════════════════════════════════"
echo "  Immagini SWS $VERSION"
echo "════════════════════════════════════════════════════════════════════"

trovate=0
mancanti=()
for g in "${GUSTI[@]}"; do
    IFS='|' read -r suff arch_file scopo costruzione <<< "$g"
    immagine="sws-runtime:${VERSION}-${suff}"
    archivio="$REPO_ROOT/dist/sws-runtime-${VERSION}-${arch_file}-image.tar.gz"

    if [ ! -f "$archivio" ]; then
        mancanti+=("$immagine")
        continue
    fi
    trovate=$((trovate + 1))

    printf '\n  \033[1m%s\033[0m\n' "$immagine"
    printf '    per       %s\n' "$scopo"
    printf '    come      %s\n' "$costruzione"

    a_byte="$(stat -c %s "$archivio" 2>/dev/null || echo 0)"
    printf '    archivio  %s  (%s)\n' "$(byte_umani "$a_byte")" "dist/$(basename "$archivio")"

    letta="$(dimensione_immagine "localhost/$immagine")"
    if [ -n "$letta" ]; then
        printf '    caricata  %s nel deposito (%s)\n' \
            "$(byte_umani "${letta% *}")" "${letta#* }"
    elif [ "$suff" = "arm64-generic" ]; then
        printf '    caricata  nel deposito di \033[1mroot\033[0m: si costruisce con sudo, quindi\n'
        printf '              `podman images` da utente non la vede (`sudo podman images`)\n'
    else
        printf '    caricata  non nel deposito locale — c%s solo l%sarchivio\n' "'è" "'"
    fi

    if podman image exists "${REGISTRY}:${VERSION}-${suff}" 2>/dev/null; then
        if [ "$PUBBLICATE" -eq 1 ]; then
            printf '    registry  pubblicata su %s\n' "${REGISTRY}:${VERSION}-${suff}"
            printf '              (anche come :latest-%s e :<commit>-%s)\n' "$suff" "$suff"
        else
            # Etichettata non vuol dire pubblicata: `podman tag` è locale, e
            # verificare il remoto vorrebbe la rete e un login. Lo si dice
            # invece di far credere che sia già su ghcr.
            printf '    registry  etichettata per %s\n' "${REGISTRY}:${VERSION}-${suff}"
            printf '              (etichettata, non necessariamente pushata)\n'
        fi
    fi
done

if [ "$trovate" -eq 0 ]; then
    echo
    echo "  Nessun archivio della $VERSION in dist/."
    echo "  Le versioni che ci sono:"
    ls -1 "$REPO_ROOT/dist/" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -uV | sed 's/^/    /'
    exit 0
fi

if [ "${#mancanti[@]}" -gt 0 ]; then
    echo
    printf '  \033[33mNon costruite:\033[0m %s\n' "${mancanti[*]}"
    # La nota sull'SDK solo se manca davvero la Pixsys: spiegare la causa
    # sbagliata è peggio che non spiegare niente — manda a cercare un SDK a
    # chi ha solo saltato la x86_64.
    case " ${mancanti[*]} " in
        *"-arm64 "*) echo "  (l'SDK Yocto Pixsys mancante salta questa build con un avviso; --require-sdk la rende un errore)" ;;
    esac
fi

# Ciò che vale per tutte e tre, e che è la cosa da ricordare prima di
# aggiornare un pannello: dalla 2.4.0 l'IDE sul dispositivo non c'è più.
cat <<'FINE'

  Tutte e tre, uguali in questo:
    porte      8443 viewer, 8444 gestione remota
    dati       montare /var/sws/{config,projects,logs}
    IDE        NON c'è: il CMD porta --no-admin (dalla 2.4.0). Sulla 8444
               resta solo la gestione remota che l'editor chiama; aprirla
               col browser non dà l'IDE, e il progetto si modifica
               nell'editor e si deploya
    dentro     binario runtime + SPA + template; niente sorgenti, niente toolchain

  Per installarne una su un dispositivo:
    scp dist/sws-runtime-<versione>-<arch>-image.tar.gz  root@<device>:/tmp/
    ssh root@<device> 'podman load -i /tmp/sws-runtime-*-image.tar.gz'
FINE
echo
