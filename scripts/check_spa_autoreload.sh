#!/usr/bin/env bash
#
# Verifica che il viewer si ricarichi da solo quando sul dispositivo arriva una
# SPA nuova (cioè dopo un `install-container.sh --www-only`).
#
# Perché esiste: sul WP620 il pannello ha continuato a mostrare la versione
# vecchia dopo un aggiornamento del frontend, e non c'era nessuno lì a premere
# ricarica. È l'abbaglio da non ripetere — "il deploy è andato" non significa
# "il pannello sta mostrando la versione nuova".
#
# Come simula il deploy: copia la dist, poi rinomina il chunk di entry con un
# hash diverso e aggiorna il riferimento in index.html. Vite rinomina i file per
# hash di contenuto a ogni build, quindi è lo stesso segnale che vede il watcher,
# e serve una sola build invece di due. Gli altri chunk restano coi loro nomi:
# sono importati per nome dall'entry, non da index.html.
#
# Uso:
#   pnpm --dir sws-editor build
#   cargo build -p sws-runtime
#   ./scripts/check_spa_autoreload.sh
#
# Dura ~45 s: l'intervallo del watcher è 30 s.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-spa-autoreload.$$"
VPORT="${VPORT:-8647}"
APORT="${APORT:-8648}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index.html" ] || { echo "manca $DIST — esegui: pnpm --dir sws-editor build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects,served}
cleanup() {
  [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cp -r "$DIST"/. "$WORK/served"/

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$WORK/served" \
  --viewer-port "$VPORT" --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$APORT/health" && break
  sleep 0.5
done

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"spa-autoreload","template":"demo-items-web"}' > /dev/null
curl -sf -X POST "$API/projects/spa-autoreload/open" > /dev/null

VIEWER="http://localhost:$VPORT" SERVED="$WORK/served" \
  node "$REPO/sws-editor/scripts/spa_autoreload_measure.mjs"
