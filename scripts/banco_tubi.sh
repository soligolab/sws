#!/usr/bin/env bash
#
# Il banco fisso dei tubi d'acciaio (piano docs/plans/2026-11-10-assistente-secondo-giro.md, G1).
#
# Copia il progetto di prova (tests/fixtures/ai-bench/tubi-acciaio/) in una cartella nuova
# sotto sws/tmp/banco-tubi/, avvia un IDE usa e getta su una porta libera, lancia
# e2e/chat-tubi.spec.ts e spegne l'IDE alla fine, comunque vada.
#
#   ./scripts/banco_tubi.sh            agente finto (sinottico-tubi.json): gratis, deterministico
#   ./scripts/banco_tubi.sh --vero     modello vero, A PAGAMENTO: la chiave e il modello sono
#                                      quelli di .run-editor/config (o SWS_AI_CHIAVI=<cartella>);
#                                      SWS_AI_FORNITORE e SWS_AI_MODELLO li scelgono come al solito
#
# Col modello vero restano nella cartella della prova il resoconto del runtime (misure/,
# giri, token, costo, minuti), la foto della pagina (pagina.png) e i conteggi
# (conteggi.json): sono il materiale per il giudizio da 1 a 5 del maintainer.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
APORT="${APORT:-8680}"
VERO=0
[ "${1:-}" = "--vero" ] && VERO=1

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "manca $DIST — esegui: pnpm --dir sws-editor build" >&2; exit 1; }
if curl -s -o /dev/null "http://localhost:$APORT/health"; then
  echo "la porta $APORT è già occupata: APORT=<altra> $0" >&2; exit 1
fi

WORK="$REPO/tmp/banco-tubi/$(date +%Y-%m-%d-%H%M%S)$([ $VERO = 1 ] && echo -vero)"
mkdir -p "$WORK/config" "$WORK/projects" "$WORK/misure"
cp -r "$REPO/tests/fixtures/ai-bench/tubi-acciaio" "$WORK/projects/banco-tubi"

if [ $VERO = 1 ]; then
  CHIAVI="${SWS_AI_CHIAVI:-$REPO/.run-editor/config}"
  ls "$CHIAVI"/*.key > /dev/null 2>&1 || { echo "nessuna chiave in $CHIAVI" >&2; exit 1; }
  cp "$CHIAVI"/*.key "$WORK/config/"
  [ -f "$CHIAVI/ai.yaml" ] && cp "$CHIAVI/ai.yaml" "$WORK/config/"
  export SWS_AI_MISURE="$WORK/misure"
  unset SWS_AI_FAKE
else
  export SWS_AI_FAKE="$REPO/sws-runtime/crates/sws-web/tests/ai/sinottico-tubi.json"
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
curl -sf -o /dev/null "http://localhost:$APORT/health" || { echo "l'IDE non parte: $WORK/rt.log" >&2; exit 1; }

# Il primo amministratore, come in check_contrasto.sh: il codice lo stampa il runtime.
UTENTE="banco@prova.it"
PASSWORD="banco-tubi-1234"
codice=$(grep -oE "codice: [0-9a-f]+" "$WORK/rt.log" | head -1 | cut -d' ' -f2)
curl -sf -X POST "http://localhost:$APORT/api/identita/primo-amministratore" \
  -H 'Content-Type: application/json' \
  -d "{\"codice\":\"$codice\",\"email\":\"$UTENTE\",\"nome\":\"Banco\",\"password\":\"$PASSWORD\"}" > /dev/null \
  || { echo "non riesco a creare l'amministratore: $WORK/rt.log" >&2; exit 1; }

echo "== banco dei tubi ($([ $VERO = 1 ] && echo "modello vero" || echo "agente finto")) — $WORK =="
cd "$REPO/sws-editor"
SWS_E2E_ADMIN="http://localhost:$APORT" \
SWS_E2E_BASE_URL="http://localhost:$APORT" \
SWS_AI_VERO="$VERO" SWS_BANCO_DIR="$WORK" \
SWS_ADMIN_USER="$UTENTE" SWS_ADMIN_PASSWORD="$PASSWORD" \
  pnpm exec playwright test --project=chromium e2e/chat-tubi.spec.ts
ESITO=$?
echo "== materiale della prova in $WORK =="
exit $ESITO
