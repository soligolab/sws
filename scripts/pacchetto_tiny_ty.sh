#!/usr/bin/env bash
#
# Il pacchetto di SWS per i Tiny TY (armv7, Ubuntu 22.04 armhf, niente podman):
# binari, pagine web, template, catalogo, font, RestrictedPython e
# l'installatore di deploy/tiny-ty/. Piano
# docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md, passo 3.
#
# Uso:
#   ./scripts/pacchetto_tiny_ty.sh             # build armv7 + SPA + pacchetto
#   ./scripts/pacchetto_tiny_ty.sh --no-rust   # riusa dist/armv7/
#   ./scripts/pacchetto_tiny_ty.sh --no-spa    # riusa sws-editor/dist/
#
# Esce in dist/sws-<versione>-tiny-ty-armv7.tar.gz. Sul dispositivo:
#   scp dist/sws-*-tiny-ty-armv7.tar.gz pixsys@<indirizzo>:~
#   ssh pixsys@<indirizzo> 'tar xzf sws-*-tiny-ty-armv7.tar.gz && sudo ./sws-*-tiny-ty-armv7/install.sh'
#
# Niente canale di aggiornamento ancora: un aggiornamento è un pacchetto nuovo
# installato sopra (passo 5 del piano, da decidere).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_RUST=1
BUILD_SPA=1
# RestrictedPython: la stessa soglia dell'immagine (Containerfile.aarch64).
RESTRICTED="RestrictedPython>=7.0"

for a in "$@"; do
    case "$a" in
        --no-rust) BUILD_RUST=0 ;;
        --no-spa)  BUILD_SPA=0 ;;
        -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
        *) echo "argomento sconosciuto: $a" >&2; exit 2 ;;
    esac
done

VERSIONE="$(sed -n 's/^version = "\(.*\)"/\1/p' "$REPO/sws-runtime/Cargo.toml" | head -n1)"
[ -n "$VERSIONE" ] || { echo "ERRORE: versione non trovata in sws-runtime/Cargo.toml" >&2; exit 1; }
NOME="sws-${VERSIONE}-tiny-ty-armv7"
DIST="$REPO/dist"
STAGE="$DIST/$NOME"

[ "$BUILD_RUST" -eq 0 ] || "$REPO/scripts/build_armv7.sh"
for b in sws-runtime sws-lvgl-viewer; do
    [ -x "$DIST/armv7/$b" ] || { echo "ERRORE: manca dist/armv7/$b (lancia senza --no-rust)" >&2; exit 1; }
done

[ "$BUILD_SPA" -eq 0 ] || (cd "$REPO/sws-editor" && pnpm build)
[ -f "$REPO/sws-editor/dist/index.html" ] || { echo "ERRORE: manca sws-editor/dist (lancia senza --no-spa)" >&2; exit 1; }

echo "==> $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/www" "$STAGE/templates" "$STAGE/catalogo" "$STAGE/fonts" "$STAGE/python"

install -m 755 "$DIST/armv7/sws-runtime" "$DIST/armv7/sws-lvgl-viewer" "$STAGE/bin/"
install -m 755 "$REPO/deploy/tiny-ty/sws-runtime-launch.sh" \
    "$REPO/deploy/tiny-ty/sws-lvgl-viewer-launch.sh" "$STAGE/bin/"
install -m 755 "$REPO/deploy/tiny-ty/install.sh" "$STAGE/"
install -m 644 "$REPO/deploy/tiny-ty/sws-runtime.service" \
    "$REPO/deploy/tiny-ty/sws-lvgl-viewer.service" \
    "$REPO/deploy/tiny-ty/99-sws-tiny-ty.rules" "$STAGE/"

cp -r "$REPO/sws-editor/dist/." "$STAGE/www/"
cp -r "$REPO/examples/templates/." "$STAGE/templates/"
cp -r "$REPO/catalogo/." "$STAGE/catalogo/"

# I font che apt non porta, come nell'immagine (build_container.sh): emoji,
# segmenti e matrice di punti, con le loro licenze. I DejaVu sono di sistema.
FONTS="$REPO/sws-runtime/crates/sws-lvgl-viewer/assets/fonts"
install -m 644 "$FONTS/NotoEmoji-Regular.ttf" "$FONTS"/DSEG*.ttf \
    "$FONTS/DotGothic16-Regular.ttf" "$FONTS"/*.txt "$STAGE/fonts/"

# La ruota pura Python, scelta per l'interprete del Tiny TY (3.10), non per
# quello di questa macchina.
python3 -m pip download --quiet --only-binary=:all: --no-deps \
    --python-version 3.10 --platform any "$RESTRICTED" -d "$STAGE/python"

install -m 644 "$REPO/LICENSE" "$REPO/LICENSING.md" "$STAGE/"
echo "$VERSIONE ($(git -C "$REPO" rev-parse --short HEAD))" > "$STAGE/VERSIONE"

(cd "$DIST" && tar czf "$NOME.tar.gz" "$NOME")
rm -rf "$STAGE"
echo "==> dist/$NOME.tar.gz ($(du -h "$DIST/$NOME.tar.gz" | cut -f1))"
