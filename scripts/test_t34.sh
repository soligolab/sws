#!/usr/bin/env bash
#
# Test automatico end-to-end per T-34.
# Avvia due istanze del runtime in background su porte temporanee,
# poi verifica via API: no-auth, auto-open, versionamento, deploy, elimina remoto.
#
# Prerequisiti: binario già compilato (cargo build -p sws-runtime)
# Uso:         ./scripts/test_t34.sh
#              RUST_LOG=error ./scripts/test_t34.sh   # log più silenziosi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$REPO_ROOT/sws-runtime/target/debug/sws-runtime"
TEMPLATES="$REPO_ROOT/examples/templates"

# Directory temporanee (rimosse alla fine)
EDITOR_DIR="$REPO_ROOT/.run-t34-editor"
RUNTIME_DIR="$REPO_ROOT/.run-t34-runtime"

# Porte temporanee (range 18xxx — improbabile conflitto con istanze esistenti)
EDITOR_PORT=18460
RUNTIME_PORT=18461

EDITOR_PID=""
RUNTIME_PID=""
PASS=0
FAIL=0

# ── colori ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass()  { echo -e "${GREEN}  ✓ $1${NC}";  PASS=$((PASS + 1));  }
fail()  { echo -e "${RED}  ✗ $1${NC}";   FAIL=$((FAIL + 1));  }
info()  { echo -e "${CYAN}▶ $1${NC}"; }
warn()  { echo -e "${YELLOW}  ! $1${NC}"; }

# ── cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  [ -n "$EDITOR_PID"  ] && kill "$EDITOR_PID"  2>/dev/null || true
  [ -n "$RUNTIME_PID" ] && kill "$RUNTIME_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$EDITOR_DIR" "$RUNTIME_DIR"
}
trap cleanup EXIT

# ── utilità ───────────────────────────────────────────────────────────────────

# Attende che il server risponda (qualsiasi HTTP response = server up)
wait_ready() {
  local url="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do
    curl -s --max-time 2 --connect-timeout 1 -o /dev/null "$url" 2>/dev/null && return 0
    sleep 0.4
  done
  echo "Timeout: $url non risponde" >&2
  return 1
}

# Legge un campo JSON da una stringa (usa python3)
jfield() {
  local json="$1" field="$2"
  echo "$json" | python3 -c \
    "import sys,json; v=json.load(sys.stdin).get('$field'); print('' if v is None else ('null' if v == None else v))" \
    2>/dev/null || echo ""
}

# Avvia l'istanza editor (solo porta admin, no viewer, no TLS)
start_editor() {
  mkdir -p "$EDITOR_DIR/config" "$EDITOR_DIR/projects" "$EDITOR_DIR/logs"
  "$BINARY" \
    --config         "$EDITOR_DIR/config"     \
    --projects-root  "$EDITOR_DIR/projects"   \
    --templates-root "$TEMPLATES"             \
    --admin-port     "$EDITOR_PORT"           \
    > "$EDITOR_DIR/logs/editor.log" 2>&1 &
  EDITOR_PID=$!
  wait_ready "http://localhost:$EDITOR_PORT/api/system" || { fail "Editor non parte"; exit 1; }
}

stop_editor() {
  [ -n "$EDITOR_PID" ] && kill "$EDITOR_PID" 2>/dev/null || true
  [ -n "$EDITOR_PID" ] && wait "$EDITOR_PID" 2>/dev/null || true
  EDITOR_PID=""
}

# Avvia l'istanza runtime (solo porta admin — i test usano solo l'API)
start_runtime() {
  mkdir -p "$RUNTIME_DIR/config" "$RUNTIME_DIR/projects" "$RUNTIME_DIR/logs"
  "$BINARY" \
    --config         "$RUNTIME_DIR/config"     \
    --projects-root  "$RUNTIME_DIR/projects"   \
    --templates-root "$TEMPLATES"              \
    --admin-port     "$RUNTIME_PORT"           \
    > "$RUNTIME_DIR/logs/runtime.log" 2>&1 &
  RUNTIME_PID=$!
  wait_ready "http://localhost:$RUNTIME_PORT/api/system" || { fail "Runtime non parte"; exit 1; }
}

stop_runtime() {
  [ -n "$RUNTIME_PID" ] && kill "$RUNTIME_PID" 2>/dev/null || true
  [ -n "$RUNTIME_PID" ] && wait "$RUNTIME_PID" 2>/dev/null || true
  RUNTIME_PID=""
}

# ── check prerequisiti ────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}   SWS T-34 — Test end-to-end automatico   ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

if [ ! -x "$BINARY" ]; then
  echo -e "${RED}Binario non trovato: $BINARY${NC}"
  echo "Compila prima con:  cd sws-runtime && cargo build -p sws-runtime"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 1 — No-auth: accesso senza token"
# ─────────────────────────────────────────────────────────────────────────────

start_editor

whoami_resp=$(curl -sf "http://localhost:$EDITOR_PORT/api/auth/whoami" 2>/dev/null || echo "{}")
role=$(jfield "$whoami_resp" "role")
username=$(jfield "$whoami_resp" "username")

if [ -n "$role" ] && [ "$role" != "" ]; then
  pass "whoami risponde 200 senza token (no-auth mode)"
else
  fail "whoami non risponde o richiede token — risposta: $whoami_resp"
fi

if [ "$role" = "Admin" ]; then
  pass "Ruolo sintetico = Admin"
else
  fail "Ruolo inatteso: '$role' (atteso: Admin)"
fi

# Verifica che la rotta admin richieda autenticazione quando ci sono utenti:
# in no-auth mode, NON deve restituire 401.
http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$EDITOR_PORT/api/system")
if [ "$http_code" = "200" ]; then
  pass "/api/system accessibile in no-auth (http $http_code)"
else
  fail "/api/system restituisce $http_code (atteso 200 in no-auth)"
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 2 — Creazione progetto + auto-open al riavvio"
# ─────────────────────────────────────────────────────────────────────────────

create_resp=$(curl -sf -X POST "http://localhost:$EDITOR_PORT/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"t34-test"}' 2>/dev/null || echo "{}")
proj_name=$(jfield "$create_resp" "name")
if [ "$proj_name" = "t34-test" ]; then
  pass "Progetto 't34-test' creato"
else
  fail "Creazione progetto fallita — risposta: $create_resp"
fi

open_resp=$(curl -sf -X POST "http://localhost:$EDITOR_PORT/api/projects/t34-test/open" \
  2>/dev/null || echo "{}")
if echo "$open_resp" | grep -q '"name"'; then
  pass "Progetto aperto"
else
  fail "Open progetto fallita — risposta: $open_resp"
fi

sys=$(curl -sf "http://localhost:$EDITOR_PORT/api/system" 2>/dev/null || echo "{}")
active=$(jfield "$sys" "active_project")
if [ "$active" = "t34-test" ]; then
  pass "active_project = t34-test"
else
  fail "active_project = '$active' (atteso: t34-test)"
fi

# Riavvio: verifica auto-open
stop_editor
start_editor

sys2=$(curl -sf "http://localhost:$EDITOR_PORT/api/system" 2>/dev/null || echo "{}")
active2=$(jfield "$sys2" "active_project")
if [ "$active2" = "t34-test" ]; then
  pass "Auto-open dopo riavvio: active_project = t34-test"
else
  fail "Auto-open fallito: active_project = '$active2'"
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 3 — Versionamento (saved_by + banner aggiorna)"
# ─────────────────────────────────────────────────────────────────────────────

# Trigger salvataggio: PUT tags con lista vuota
curl -sf -X PUT "http://localhost:$EDITOR_PORT/api/project/tags" \
  -H "Content-Type: application/json" \
  -d '{"tags":[]}' -o /dev/null 2>/dev/null || true
sleep 0.5

proj_yaml="$EDITOR_DIR/projects/t34-test/project.yaml"
if [ -f "$proj_yaml" ]; then
  saved_by=$(grep "^saved_by:" "$proj_yaml" | awk '{print $2}' || echo "")
  if [ -n "$saved_by" ]; then
    pass "saved_by presente in project.yaml: $saved_by"
  else
    warn "saved_by non trovato — provo migrate per forzare re-save"
    curl -sf -X POST "http://localhost:$EDITOR_PORT/api/project/migrate" -o /dev/null 2>/dev/null || true
    sleep 0.5
    saved_by=$(grep "^saved_by:" "$proj_yaml" | awk '{print $2}' || echo "")
    [ -n "$saved_by" ] && pass "saved_by dopo migrate: $saved_by" || fail "saved_by ancora assente"
  fi
else
  fail "project.yaml non trovato in $proj_yaml"
  saved_by=""
fi

# Simula versione vecchia → deve attivare project_needs_update
if [ -f "$proj_yaml" ] && [ -n "$saved_by" ]; then
  sed -i 's/^saved_by:.*/saved_by: 0.0.1/' "$proj_yaml"

  stop_editor
  start_editor

  sys3=$(curl -sf "http://localhost:$EDITOR_PORT/api/system" 2>/dev/null || echo "{}")
  needs_update=$(jfield "$sys3" "project_needs_update")
  if [ "$needs_update" = "True" ]; then
    pass "project_needs_update = true dopo downgrade versione"
  else
    fail "project_needs_update = '$needs_update' (atteso: True)"
  fi

  # Migrate (equivalente click "Aggiorna progetto")
  curl -sf -X POST "http://localhost:$EDITOR_PORT/api/project/migrate" -o /dev/null 2>/dev/null || true
  sleep 0.5

  sys4=$(curl -sf "http://localhost:$EDITOR_PORT/api/system" 2>/dev/null || echo "{}")
  needs_update2=$(jfield "$sys4" "project_needs_update")
  if [ "$needs_update2" = "False" ]; then
    pass "Migrate OK: project_needs_update = false"
  else
    fail "Dopo migrate: project_needs_update = '$needs_update2' (atteso: False)"
  fi
else
  warn "Test 3b (needs_update) saltato: project.yaml o saved_by non disponibili"
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 4 — Remote deploy (editor → runtime)"
# ─────────────────────────────────────────────────────────────────────────────

start_runtime

# Sul runtime: crea un progetto "da sovrascrivere"
curl -sf -X POST "http://localhost:$RUNTIME_PORT/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"old-project"}' -o /dev/null 2>/dev/null || true
curl -sf -X POST "http://localhost:$RUNTIME_PORT/api/projects/old-project/open" \
  -o /dev/null 2>/dev/null || true

sys_rt=$(curl -sf "http://localhost:$RUNTIME_PORT/api/system" 2>/dev/null || echo "{}")
rt_active=$(jfield "$sys_rt" "active_project")
if [ "$rt_active" = "old-project" ]; then
  pass "Runtime ha 'old-project' attivo prima del deploy"
else
  fail "Runtime pre-deploy: active='$rt_active' (atteso: old-project)"
fi

# Connetti editor al runtime
connect_resp=$(curl -sf -X POST "http://localhost:$EDITOR_PORT/api/remote/connect" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"http://localhost:$RUNTIME_PORT\"}" 2>/dev/null || echo "{}")
if echo "$connect_resp" | grep -q '"ok":true'; then
  pass "Editor connesso al runtime"
else
  fail "Connessione editor→runtime fallita: $connect_resp"
fi

# Deploy (body è testo streaming — curl lo drena tutto)
deploy_log=$(curl -sf -X POST "http://localhost:$EDITOR_PORT/api/remote/deploy" 2>/dev/null || echo "FAIL")
if echo "$deploy_log" | grep -qE "attivo sul runtime|Deploy completato"; then
  pass "Deploy completato con successo"
else
  warn "Log deploy:"
  echo "$deploy_log" | sed 's/^/    /'
  fail "Deploy: output inatteso (vedi sopra)"
fi

sleep 0.5
sys_rt2=$(curl -sf "http://localhost:$RUNTIME_PORT/api/system" 2>/dev/null || echo "{}")
rt_active2=$(jfield "$sys_rt2" "active_project")
if [ "$rt_active2" = "t34-test" ]; then
  pass "Runtime ha 't34-test' dopo deploy (old-project rimosso)"
else
  fail "Runtime post-deploy: active='$rt_active2' (atteso: t34-test)"
fi

# Verifica che old-project sia stato davvero rimosso dal disco del runtime
old_proj_dir="$RUNTIME_DIR/projects/old-project"
if [ ! -d "$old_proj_dir" ]; then
  pass "Directory 'old-project' rimossa dal runtime"
else
  fail "Directory 'old-project' ancora presente su disco del runtime"
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 5 — Elimina progetto remoto"
# ─────────────────────────────────────────────────────────────────────────────

del_http=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:$EDITOR_PORT/api/remote/project/delete" 2>/dev/null)
if [ "$del_http" = "204" ]; then
  pass "Elimina remoto: HTTP 204"
else
  fail "Elimina remoto: HTTP $del_http (atteso: 204)"
fi

sleep 0.5
sys_rt3=$(curl -sf "http://localhost:$RUNTIME_PORT/api/system" 2>/dev/null || echo "{}")
rt_active3=$(jfield "$sys_rt3" "active_project")

# jfield restituisce "" per null JSON → trattiamo "" come "null"
if [ -z "$rt_active3" ] || [ "$rt_active3" = "null" ]; then
  pass "active_project = null dopo elimina remoto"
else
  fail "active_project = '$rt_active3' (atteso: null)"
fi

rt_proj_count=$(ls "$RUNTIME_DIR/projects/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$rt_proj_count" = "0" ]; then
  pass "Directory projects/ del runtime vuota"
else
  fail "Runtime projects/ ha ancora $rt_proj_count elementi"
fi

# ─────────────────────────────────────────────────────────────────────────────
info "Test 6 — Export/import ZIP preserva tag (Issue #2)"
# ─────────────────────────────────────────────────────────────────────────────

# Prima riapri il progetto t34-test nell'editor (potrebbe essere stato
# disconnesso dalla sessione di deploy).
curl -sf -X POST "http://localhost:$EDITOR_PORT/api/projects/t34-test/open" \
  -o /dev/null 2>/dev/null || true
sleep 0.3

# Aggiungi un tag al progetto editor.
curl -sf -X PUT "http://localhost:$EDITOR_PORT/api/project/tags" \
  -H "Content-Type: application/json" \
  -d '[{"id":"pump_speed","description":"Velocità pompa","data_type":"float"}]' \
  -o /dev/null 2>/dev/null || true

# Esporta il progetto come ZIP.
EXPORT_ZIP="$EDITOR_DIR/test_export.zip"
http_export=$(curl -s -o "$EXPORT_ZIP" -w "%{http_code}" \
  "http://localhost:$EDITOR_PORT/api/project/export" 2>/dev/null)
zip_size=$(wc -c < "$EXPORT_ZIP" 2>/dev/null || echo 0)

if [ "$http_export" = "200" ] && [ "$zip_size" -gt 100 ]; then
  pass "Export ZIP creato (HTTP $http_export, $zip_size bytes)"
else
  fail "Export fallito: HTTP $http_export, $zip_size bytes"
fi

# Crea un nuovo progetto vuoto, aprilo, importa lo ZIP.
curl -sf -X POST "http://localhost:$EDITOR_PORT/api/projects" \
  -H "Content-Type: application/json" -d '{"name":"import-test"}' -o /dev/null 2>/dev/null || true
curl -sf -X POST "http://localhost:$EDITOR_PORT/api/projects/import-test/open" \
  -o /dev/null 2>/dev/null || true

http_import=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "http://localhost:$EDITOR_PORT/api/project/import" \
  --data-binary @"$EXPORT_ZIP" \
  -H "Content-Type: application/zip" 2>/dev/null)

if [ "$http_import" = "204" ]; then
  pass "Import ZIP: HTTP 204"
else
  fail "Import ZIP fallito: HTTP $http_import"
fi

# Verifica che i tag siano presenti dopo l'import.
proj_after=$(curl -sf "http://localhost:$EDITOR_PORT/api/project" 2>/dev/null || echo "{}")
tag_count=$(echo "$proj_after" | python3 -c \
  "import sys,json; print(len(json.load(sys.stdin).get('tags',[])))" 2>/dev/null || echo 0)

if [ "$tag_count" -gt 0 ]; then
  pass "Import: $tag_count tag presenti in GET /api/project dopo import"
else
  fail "Import: nessun tag in GET /api/project dopo import (Issue #2)"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ✓ Tutti i test passati: $PASS/$((PASS+FAIL))${NC}"
else
  echo -e "${RED}  ✗ $FAIL falliti, $PASS passati su $((PASS+FAIL)) totali${NC}"
fi
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
