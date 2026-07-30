#!/usr/bin/env bash
#
# Esegue la suite end-to-end contro un runtime avviato per l'occasione.
#
# Perché esiste: i 16 test in `sws-editor/e2e/` non potevano girare. Ogni spec
# aveva `https://localhost:8444` scritto dentro — HTTPS, che su un `.run/config`
# nuovo non è attivo — e la procedura di avvio viveva nei commenti del config,
# quindi nessuno l'ha mai eseguita e i selettori sono derivati in silenzio.
#
# Le credenziali admin sono obbligatorie: `start_runtime.sh` non semina alcun
# utente, e senza di esse il runtime parte in no-auth, dove il login che i test
# eseguono non ha nulla dietro.
#
# Uso:
#   pnpm --dir sws-editor build
#   ./scripts/check_e2e.sh                 # il gate (esclude gli screenshot)
#   ./scripts/check_e2e.sh --screenshots   # solo la cattura per la documentazione
#
# Richiede il browser di Playwright:
#   pnpm --dir sws-editor exec playwright install chromium
#
# LIMITE NOTO, da risolvere prima di usarlo come gate automatico: i test
# condividono UN solo runtime e ognuno crea e apre i propri progetti. Aprire un
# progetto cambia il progetto attivo per tutti e invalida le sessioni aperte
# (`auth.swap_store`), quindi i test si disturbano a vicenda e l'esito cambia
# fra esecuzioni: nella stessa giornata `bugcheck` è passato in un giro e
# fallito nel successivo, e `import-tags` il contrario. Serve isolare — un
# runtime per test, oppure un progetto per test senza mai riaprirlo — prima di
# poter leggere un fallimento come una regressione.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-e2e.$$"
VPORT="${VPORT:-8663}"
APORT="${APORT:-8664}"
PROJECT="chromium"
[ "${1:-}" = "--screenshots" ] && PROJECT="screenshots"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "manca $DIST — esegui: pnpm --dir sws-editor build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
cleanup() {
  [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin \
"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --viewer-port "$VPORT" --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$APORT/health" && break
  sleep 0.5
done

API="http://localhost:$APORT/api"
# Un progetto con contenuto: i test cliccano su oggetti del canvas, e su un
# progetto vuoto fallirebbero per assenza di bersagli, non per una regressione.
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"e2e","template":"demo-items"}' > /dev/null
curl -sf -X POST "$API/projects/e2e/open" > /dev/null

echo "== suite e2e (progetto Playwright: $PROJECT) =="
cd "$REPO/sws-editor"
SWS_E2E_ADMIN="http://localhost:$APORT" \
SWS_E2E_VIEWER="http://localhost:$VPORT" \
SWS_E2E_BASE_URL="http://localhost:$APORT" \
SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin \
  pnpm exec playwright test --project="$PROJECT" "$@"
