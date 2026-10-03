#!/usr/bin/env bash
#
# `install-container.sh --solo-unita` su un pannello finto (02-10-2026).
#
# HOME di prova con un quadlet «vecchio» (senza versione, immagine del canale di
# prova, dati in un percorso non standard, rete host), e comandi finti nel PATH
# che registrano cosa viene chiamato. Si controlla che i quadlet nuovi portino la
# versione dei template, conservino immagine, dati e rete di quelli installati, e
# che immagine e container NON vengano toccati (niente pull, niente rm).
#
# Lo lancia scripts/check_quadlet.sh. Uso diretto: tests/shell/solo-unita.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

export HOME="$T/home"
UNIT_DIR="$HOME/.config/containers/systemd"
mkdir -p "$UNIT_DIR" "$T/bin" "$T/src"
LOG="$T/chiamate.log"

# Comandi finti: registrano e riescono.
for c in podman systemctl loginctl curl busctl; do
    cat > "$T/bin/$c" <<EOF
#!/usr/bin/env bash
echo "$c \$*" >> "$LOG"
case "$c \$1" in
    "podman version") echo "5.2.0" ;;
    "podman image") exit 0 ;;
    "loginctl show-user") echo "Linger=yes" ;;
esac
exit 0
EOF
    chmod +x "$T/bin/$c"
done
export PATH="$T/bin:$PATH"

# I sorgenti come li copia il runtime: installer + template accanto.
cp "$REPO/deploy/container/install-container.sh" "$REPO/deploy/container/sws-runtime.container" \
   "$REPO/deploy/container/sws-lvgl-viewer.container" "$T/src/"

# Il quadlet «vecchio» installato.
cat > "$UNIT_DIR/sws-runtime.container" <<EOF
[Unit]
Description=SWS runtime (container podman)
[Container]
Image=ghcr.io/soligolab/sws-runtime:rc-arm64
Network=host
ContainerName=sws-runtime
Volume=$T/altrove/config:/var/sws/config
Volume=$T/altrove/projects:/var/sws/projects
Volume=$T/altrove/logs:/var/sws/logs
[Service]
Restart=always
EOF

# subuid/subgid: l'installer le controlla; in prova si salta se mancano.
if ! grep -q "^$(id -un):" /etc/subuid 2>/dev/null; then
    echo "  (salto: nessuna mappatura subuid per $(id -un) su questa macchina)"
    exit 0
fi

bash "$T/src/install-container.sh" --solo-unita > "$T/uscita.log" 2>&1 || {
    echo "  ✗ --solo-unita è fallito:"; sed 's/^/      /' "$T/uscita.log"; exit 1; }

R="$UNIT_DIR/sws-runtime.container"
V="$UNIT_DIR/sws-lvgl-viewer.container"
fallito=0
prova() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; fallito=1; fi; }

N="$(sed -n 's/^Description=.*\[quadlet \([0-9]*\)\].*/\1/p' "$REPO/deploy/container/sws-runtime.container")"
prova "il runtime porta la versione dei template ($N)"  "grep -q '\\[quadlet $N\\]' '$R'"
prova "il viewer porta la versione dei template ($N)"   "grep -q '\\[quadlet $N\\]' '$V'"
prova "immagine conservata"                             "grep -q '^Image=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$R'"
prova "SWS_IMAGE coerente con l'immagine"               "grep -q '^Environment=SWS_IMAGE=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$R'"
prova "cartella dati conservata (runtime)"              "grep -q '^Volume=$T/altrove/config:/var/sws/config' '$R'"
prova "cartella dati conservata (viewer)"               "! grep -q '^Volume=/data/user/sws/' '$V'"
prova "rete host conservata"                            "grep -q '^Network=host' '$R'"
prova "il viewer riparte sempre"                        "grep -q '^Restart=always' '$V'"
prova "il runtime viene riavviato"                      "grep -q 'systemctl --user restart sws-runtime' '$LOG'"
prova "nessun pull"                                     "! grep -q 'podman pull' '$LOG'"
prova "il container non viene rimosso"                  "! grep -q 'podman rm' '$LOG'"

if [ "$fallito" -ne 0 ]; then
    echo "  uscita dell'installer:"; sed 's/^/      /' "$T/uscita.log"
fi
exit "$fallito"
