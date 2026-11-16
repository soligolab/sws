#!/usr/bin/env bash
#
# The fixed bench of the house (plan docs/archive/2026-11-10-assistente-secondo-giro.md, G2).
# Twin of banco_tubi.sh, on the other bench.
#
# Copies the bench project (tests/fixtures/ai-bench/house/) into a new folder
# under sws/tmp/bench-house/, starts a throwaway IDE on a free port, runs
# e2e/chat-house.spec.ts and stops the IDE at the end, whatever happens.
#
#   ./scripts/bench_house.sh           fake agent (house-floor-plan.json): free, deterministic
#   ./scripts/bench_house.sh --real    real model, IT COSTS MONEY: key and model are the ones
#                                      of .run-editor/config (or SWS_AI_CHIAVI=<folder>);
#                                      SWS_AI_FORNITORE and SWS_AI_MODELLO choose them as usual
#
# With the real model the folder of the trial keeps the report of the runtime
# (misure/: rounds, tokens, cost, minutes), the picture of the page (page.png)
# and the counts (counts.json): the material for the maintainer's 1-to-5 vote.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
APORT="${APORT:-8681}"
REAL=0
[ "${1:-}" = "--real" ] && REAL=1

[ -x "$BIN" ] || { echo "missing $BIN — run: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "missing $DIST — run: pnpm --dir sws-editor build" >&2; exit 1; }
if curl -s -o /dev/null "http://localhost:$APORT/health"; then
  echo "port $APORT is taken: APORT=<another> $0" >&2; exit 1
fi

WORK="$REPO/tmp/bench-house/$(date +%Y-%m-%d-%H%M%S)$([ $REAL = 1 ] && echo -real)"
mkdir -p "$WORK/config" "$WORK/projects" "$WORK/misure"
cp -r "$REPO/tests/fixtures/ai-bench/house" "$WORK/projects/bench-house"

if [ $REAL = 1 ]; then
  KEYS="${SWS_AI_CHIAVI:-$REPO/.run-editor/config}"
  ls "$KEYS"/*.key > /dev/null 2>&1 || { echo "no key in $KEYS" >&2; exit 1; }
  cp "$KEYS"/*.key "$WORK/config/"
  [ -f "$KEYS/ai.yaml" ] && cp "$KEYS/ai.yaml" "$WORK/config/"
  export SWS_AI_MISURE="$WORK/misure"
  unset SWS_AI_FAKE
else
  export SWS_AI_FAKE="$REPO/sws-runtime/crates/sws-web/tests/ai/house-floor-plan.json"
fi

cleanup() {
  [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null
  rm -f "$WORK/rt.pid"
}
trap cleanup EXIT

if [ -z "${SWS_SCRIPT_SENZA_SANDBOX:-}" ] && ! python3 -c 'import RestrictedPython' 2>/dev/null; then
  export SWS_SCRIPT_SENZA_SANDBOX=1
fi
"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$APORT/health" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://localhost:$APORT/health" || { echo "the IDE does not start: $WORK/rt.log" >&2; exit 1; }

# The first administrator, as in check_contrasto.sh: the runtime prints the code.
ADMIN_USER="bench@prova.it"
ADMIN_PASSWORD="bench-house-1234"
code=$(grep -oE "codice: [0-9a-f]+" "$WORK/rt.log" | head -1 | cut -d' ' -f2)
curl -sf -X POST "http://localhost:$APORT/api/identita/primo-amministratore" \
  -H 'Content-Type: application/json' \
  -d "{\"codice\":\"$code\",\"email\":\"$ADMIN_USER\",\"nome\":\"Bench\",\"password\":\"$ADMIN_PASSWORD\"}" > /dev/null \
  || { echo "cannot create the administrator: $WORK/rt.log" >&2; exit 1; }

echo "== bench of the house ($([ $REAL = 1 ] && echo "real model" || echo "fake agent")) — $WORK =="
cd "$REPO/sws-editor"
SWS_E2E_ADMIN="http://localhost:$APORT" \
SWS_E2E_BASE_URL="http://localhost:$APORT" \
SWS_AI_VERO="$REAL" SWS_BENCH_DIR="$WORK" \
SWS_ADMIN_USER="$ADMIN_USER" SWS_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  pnpm exec playwright test --project=chromium e2e/chat-house.spec.ts
RESULT=$?
echo "== material of the trial in $WORK =="
exit $RESULT
