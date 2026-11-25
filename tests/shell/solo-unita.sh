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

# The channel switch (25-11-2026): `--image-ref` pulls the new image and writes
# it in both units, with SWS_IMAGE and the automatic update on.
: > "$LOG"
bash "$T/src/install-container.sh" --solo-unita --image-ref ghcr.io/soligolab/sws-runtime:dev-arm64 \
    > "$T/uscita2.log" 2>&1 || {
    echo "  ✗ --solo-unita --image-ref è fallito:"; sed 's/^/      /' "$T/uscita2.log"; exit 1; }
prova "--image-ref: immagine nuova nel runtime"         "grep -q '^Image=ghcr.io/soligolab/sws-runtime:dev-arm64$' '$R'"
prova "--image-ref: SWS_IMAGE coerente"                 "grep -q '^Environment=SWS_IMAGE=ghcr.io/soligolab/sws-runtime:dev-arm64$' '$R'"
prova "--image-ref: immagine nuova nel viewer"          "grep -q '^Image=ghcr.io/soligolab/sws-runtime:dev-arm64$' '$V'"
prova "--image-ref: aggiornamento automatico acceso"    "grep -q '^AutoUpdate=registry' '$R'"
prova "--image-ref: l'immagine si scarica prima"        "grep -q 'podman pull ghcr.io/soligolab/sws-runtime:dev-arm64' '$LOG'"
prova "--image-ref: cartella dati conservata"           "grep -q '^Volume=$T/altrove/config:/var/sws/config' '$R'"
prova "--image-ref: il runtime viene riavviato"         "grep -q 'systemctl --user restart sws-runtime' '$LOG'"
prova "--image-ref senza --solo-unita è rifiutato"      "! bash '$T/src/install-container.sh' --image-ref x:y > /dev/null 2>&1"
prova "--image-ref: il segno dell'immagine sostituita"  "grep -q '^image=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$T/altrove/config/channel-switch-prev'"
if [ "$fallito" -ne 0 ]; then
    echo "  uscita dell'installer (--image-ref):"; sed 's/^/      /' "$T/uscita2.log"
fi

# With `certutil` on the host and an earlier full install (review of 25-11-2026):
# a copy of the installer without the fiducia files must not stop, nor empty
# the fiducia unit that runs.
DATI="$T/altrove"
mkdir -p "$DATI/config" "$HOME/.config/systemd/user"
printf '#!/bin/sh\nexit 0\n' > "$DATI/config/fiducia-browser.sh"; chmod +x "$DATI/config/fiducia-browser.sh"
printf '[Path]\nPathChanged=x\n' > "$HOME/.config/systemd/user/sws-fiducia.path"
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/certutil"; chmod +x "$T/bin/certutil"
: > "$LOG"
bash "$T/src/install-container.sh" --solo-unita --image-ref ghcr.io/soligolab/sws-runtime:rc-arm64 \
    > "$T/uscita3.log" 2>&1
prova "certutil: l'installer arriva in fondo"           "grep -q '^Image=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$R'"
prova "certutil: la unit di fiducia non si svuota"     "[ -s '$HOME/.config/systemd/user/sws-fiducia.path' ]"
rm -f "$T/bin/certutil"

# A new image that does not become healthy: the units go back to the image
# that ran, and the runtime starts again on it.
cat > "$T/bin/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$LOG"
if [ "\$*" = "--user restart sws-runtime" ] && grep -q '^Image=ghcr.io/soligolab/sws-runtime:dev-arm64' "$R"; then exit 1; fi
exit 0
EOF
chmod +x "$T/bin/systemctl"
: > "$LOG"
if bash "$T/src/install-container.sh" --solo-unita --image-ref ghcr.io/soligolab/sws-runtime:dev-arm64 \
    > "$T/uscita4.log" 2>&1; then esito4=0; else esito4=1; fi
prova "ritorno: l'installer dice che non è riuscito"   "[ $esito4 -eq 1 ]"
prova "ritorno: il runtime torna all'immagine di prima" "grep -q '^Image=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$R'"
prova "ritorno: anche SWS_IMAGE"                       "grep -q '^Environment=SWS_IMAGE=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$R'"
prova "ritorno: anche il viewer"                       "grep -q '^Image=ghcr.io/soligolab/sws-runtime:rc-arm64$' '$V'"
prova "ritorno: aggiornamento automatico acceso"        "grep -q '^AutoUpdate=registry' '$R'"
prova "ritorno: il runtime riparte"                    "[ \"\$(grep -c 'restart sws-runtime' '$LOG')\" -ge 2 ]"
if [ "$fallito" -ne 0 ]; then
    echo "  uscita (certutil):"; sed 's/^/      /' "$T/uscita3.log" | tail -15
    echo "  uscita (ritorno):"; sed 's/^/      /' "$T/uscita4.log" | tail -15
fi
exit "$fallito"
