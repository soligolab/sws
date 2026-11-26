#!/usr/bin/env bash
#
# The firewalld functions of the installers on a fake firewalld (26-11-2026).
#
# A fake `firewall-cmd` keeps the open ports of each zone, running and
# permanent, in files. The test checks that the installation opens 7443 and
# 7444 in the zone with a network card, that a second run changes nothing,
# that the uninstallation closes them, that without firewalld nothing is
# done, and that every installer carries the same functions.
#
# Run by scripts/check_quadlet.sh. Direct use: tests/shell/firewall.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/fw"
FAIL=0
ok() { echo "  ✓ $1"; }
ko() { echo "  ✗ $1"; FAIL=1; }

cat > "$T/bin/firewall-cmd" <<'FAKE'
#!/usr/bin/env bash
D="$FW_DIR"
echo "firewall-cmd $*" >> "$D/calls.log"
perm=run; zone=""
for a in "$@"; do
    case "$a" in
        --permanent) perm=perm ;;
        --zone=*) zone="${a#--zone=}" ;;
    esac
done
for a in "$@"; do
    case "$a" in
        --state) [ -f "$D/stopped" ] && { echo "not running"; exit 252; }; echo running; exit 0 ;;
        --get-active-zones) printf 'public\n  interfaces: ethernet0\ntrusted\n  sources: 10.0.0.0/8\n'; exit 0 ;;
        --get-default-zone) echo public; exit 0 ;;
        --get-zones) echo "block public trusted"; exit 0 ;;
        --query-port=*) grep -qx "${a#--query-port=}" "$D/$perm.$zone" 2>/dev/null; exit $? ;;
        --add-port=*) echo "${a#--add-port=}" >> "$D/$perm.$zone"; exit 0 ;;
        --remove-port=*) p="${a#--remove-port=}"; [ -f "$D/$perm.$zone" ] && { grep -vx "$p" "$D/$perm.$zone" > "$D/tmp" || true; mv "$D/tmp" "$D/$perm.$zone"; }; exit 0 ;;
    esac
done
exit 0
FAKE
chmod +x "$T/bin/firewall-cmd"
export PATH="$T/bin:$PATH" FW_DIR="$T/fw"

# The function block of an installer, between its two markers.
blocco() {
    awk '/^# ── firewalld \(Pixsys OS 2.2.0/{f=1} f&&/^# ── (Disinstallazione|Uninstall)/{exit} f' "$1"
}
blocco "$REPO/deploy/container/install-container.sh" > "$T/funzioni.sh"
[ -s "$T/funzioni.sh" ] || { ko "install-container.sh: firewalld block not found"; exit 1; }
for f in deploy/yocto/install.sh deploy/tiny-ty/install.sh deploy/generic-linux/install.sh; do
    if cmp -s "$T/funzioni.sh" <(blocco "$REPO/$f"); then ok "$f: the same firewalld functions"; else ko "$f: the firewalld functions differ from install-container.sh"; fi
done
# shellcheck disable=SC1091
. "$T/funzioni.sh"

open_firewall_ports > "$T/out" 2>&1
for p in 7443/tcp 7444/tcp; do
    if grep -qx "$p" "$T/fw/run.public" && grep -qx "$p" "$T/fw/perm.public"; then ok "$p open in public, running and permanent"; else ko "$p not open in public"; fi
done
[ -f "$T/fw/run.trusted" ] && ko "a zone without a network card was touched" || ok "the zone with only sources is not touched"
grep -q -- "--reload" "$T/fw/calls.log" && ko "the installer reloads firewalld" || ok "no --reload"
open_firewall_ports > "$T/out2" 2>&1
[ "$(sort "$T/fw/run.public" | uniq -d | wc -l)" -eq 0 ] && ok "a second run adds nothing" || ko "a second run adds the ports again"
close_firewall_ports > /dev/null 2>&1
[ -s "$T/fw/run.public" ] || [ -s "$T/fw/perm.public" ] && ko "the uninstallation leaves the ports open" || ok "the uninstallation closes the ports"
rm -f "$T/fw"/run.* "$T/fw"/perm.*; touch "$T/fw/stopped"
open_firewall_ports > /dev/null 2>&1
ls "$T/fw"/run.* >/dev/null 2>&1 && ko "firewalld stopped, but the installer changed it" || ok "firewalld stopped: nothing is done"
exit $FAIL
