#!/usr/bin/env bash
#
# Il factory reset di un pannello non deve bloccare il deploy senza spiegazioni.
#
# Perché esiste: dopo un factory reset il dispositivo rigenera le chiavi host e
# ssh si rifiuta di collegarsi — giustamente, perché non può distinguere quel
# caso da un attacco. Il deploy dell'editor però finiva con «ERROR: ssh fallito
# (exit 255)», con la riga utile sepolta quindici righe più su nello stderr di
# ssh: il maintainer ci è inciampato due volte nello stesso giorno (2026-09-07).
#
# Ora il backend riconosce il caso e la UI offre un pulsante. La rimozione
# NON è automatica e non deve diventarlo: `StrictHostKeyChecking=no`
# spegnerebbe per sempre la protezione, questo endpoint la spegne una volta,
# per un host, su richiesta esplicita di una persona. Qui si prova che tolga
# quello che deve, che lasci il resto, e che non si faccia infilare un host
# malevolo (finisce in `ssh-keygen -R`).
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_chiave_host.sh
#
# Runtime scratch dichiarato (porta 8669, HOME finta in dir temporanea:
# NON tocca il known_hosts di chi lancia), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-chiavehost.$$"
APORT="${APORT:-8669}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects,.ssh}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

# Un known_hosts finto: il pannello (in chiaro e con porta), più un host che
# non c'entra e che deve sopravvivere.
KH="$WORK/.ssh/known_hosts"
cat > "$KH" <<'EOF'
tc620-prova.local ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFAKE1
tc620-prova.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE2
[tc620-prova.local]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE3
altro-dispositivo.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE4
EOF

# HOME finta: l'endpoint legge $HOME/.ssh/known_hosts, e non vogliamo che una
# guardia tocchi il file vero di chi la lancia.
HOME="$WORK" "$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

ROSSI=0
caso() { # caso <descrizione> <atteso> <ricevuto>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — atteso «$2», ricevuto «$3»"; ROSSI=$((ROSSI+1)); fi
}
chiama() { curl -s -o "$WORK/out" -w '%{http_code}' -X POST \
  "http://localhost:$APORT/api/device/hostkey/forget" \
  -H 'Content-Type: application/json' -d "$1"; }

echo "== un host che finisce in ssh-keygen -R non si accetta a scatola chiusa =="
caso "trattino iniziale (diventerebbe un'opzione) → 400" 400 "$(chiama '{"host":"-oProxyCommand=x"}')"
caso "punto e virgola → 400"                             400 "$(chiama '{"host":"h;rm -rf /"}')"
caso "barra → 400"                                       400 "$(chiama '{"host":"a/b"}')"
caso "vuoto → 400"                                       400 "$(chiama '{"host":""}')"

echo "== un host senza chiavi memorizzate lo dice, invece di fingere =="
st="$(chiama '{"host":"mai-visto.local"}')"
caso "200" 200 "$st"
grep -q "nessuna chiave memorizzata" "$WORK/out" \
  && echo "  ✓ lo dichiara invece di dire «fatto»" \
  || { echo "  ✗ risposta: $(cat "$WORK/out")"; ROSSI=$((ROSSI+1)); }

echo "== il caso vero: il pannello resettato =="
st="$(chiama '{"host":"tc620-prova.local","port":2222}')"
caso "200" 200 "$st"
caso "nessuna riga del pannello è rimasta" 0 "$(grep -c "tc620-prova" "$KH" || true)"
caso "l'host che non c'entra è intatto"    1 "$(grep -c "altro-dispositivo" "$KH" || true)"
[ -f "$KH.old" ] && echo "  ✓ l'originale resta in known_hosts.old" \
                 || { echo "  ✗ nessun backup"; ROSSI=$((ROSSI+1)); }
grep -q "device.hostkey_forget" <(curl -s "http://localhost:$APORT/api/audit") \
  && echo "  ✓ la rimozione è nell'audit" \
  || { echo "  ✗ non risulta nell'audit"; ROSSI=$((ROSSI+1)); }

[ "$ROSSI" -gt 0 ] && { echo "FALLITO — $ROSSI controlli rossi"; exit 1; }
echo "chiave host: tutto verde."
