#!/usr/bin/env bash
#
# Q17 — la soglia `write_min_role` vale anche per le ricette, all-or-nothing.
#
# Perché esiste: fino al 2026-09-06 `POST /api/recipes/:id/apply` stava dietro
# il cancello Operator ma non consultava mai la soglia per-tag — un Operator
# poteva scrivere via ricetta un tag protetto Admin, cosa che il PUT e il WS
# gli negano dal F3.1. E l'apply non lasciava traccia nell'audit hash-chained:
# lo storico ricette si fidava dell'`applied_by` autodichiarato dal client.
#
# Nessun template del repo contiene ricette né `write_min_role`, quindi
# nessun'altra guardia può vedere una regressione qui: questa si porta il suo
# progetto, seminato su disco prima dell'avvio (la scheda Q17 lo pretendeva).
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_ricette.sh
#
# Runtime scratch dichiarato (porta 8667, dir temporanea, utenti admin+op
# SOLO suoi), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-ricette.$$"
APORT="${APORT:-8667}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects/q17/recipes}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

cat > "$WORK/projects/q17/project.yaml" <<'YAML'
meta:
  name: q17
  version: 0.1.0
tags:
  - id: ricetta.temp
    description: "setpoint libero"
    data_type: float
  - id: ricetta.pressione
    description: "setpoint libero"
    data_type: float
  - id: ricetta.limite
    description: "protetto: solo Admin puo' scriverlo"
    data_type: float
    write_min_role: Admin
sources: []
YAML
cat > "$WORK/projects/q17/recipes/lotto.yaml" <<'YAML'
id: lotto
name: "Lotto con tag protetto"
setpoints:
  - tag: ricetta.temp
    value: 50.0
  - tag: ricetta.limite
    value: 99.0
YAML
cat > "$WORK/projects/q17/recipes/libera.yaml" <<'YAML'
id: libera
name: "Solo setpoint liberi"
setpoints:
  - tag: ricetta.temp
    value: 42.0
  - tag: ricetta.pressione
    value: 7.0
YAML

SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin1234 \
"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

python3 - "http://localhost:$APORT/api" <<'PY'
import json, sys, urllib.request, urllib.error

API = sys.argv[1]
def req(method, path, body=None, token=None):
    r = urllib.request.Request(f"{API}{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode(errors="replace")

rossi = 0
def caso(nome, ok, extra=""):
    global rossi
    print(f"  {'✓' if ok else '✗'} {nome}" + ("" if ok else f" — {extra}"))
    if not ok: rossi += 1

_, login = req("POST", "/auth/login", {"username": "admin", "password": "admin1234"})
st, _ = req("POST", "/projects/q17/open", {}, login["token"])
assert st < 300, f"open q17: {st}"
# Aprire un progetto scambia lo user store (auth.swap_store) e INVALIDA le
# sessioni — trappola già documentata in sws-editor/e2e/_env.ts. Si rientra.
_, login = req("POST", "/auth/login", {"username": "admin", "password": "admin1234"})
adm = login["token"]
st, _ = req("POST", "/auth/users",
            {"username": "op", "password": "operatore1", "role": "Operator",
             "must_change_password": False}, adm)
assert st < 300, f"create op: {st}"
_, login = req("POST", "/auth/login", {"username": "op", "password": "operatore1"})
op = login["token"]

# 1 — l'Operator su una ricetta con un tag protetto: 403 che nomina il tag...
st, body = req("POST", "/recipes/lotto/apply", {"applied_by": "op"}, op)
caso("Operator su ricetta con tag protetto → 403", st == 403, f"status {st}: {body}")
caso("...e il 403 nomina il tag vietato",
     isinstance(body, dict) and "ricetta.limite" in body.get("denied", []), f"{body}")

# 2 — ...e ALL-OR-NOTHING: nemmeno il setpoint lecito è stato applicato.
_, t = req("GET", "/tags/ricetta.temp", token=op)
caso("all-or-nothing: il setpoint lecito NON è stato applicato",
     t["value"] == 0.0, f"ricetta.temp = {t['value']}")

# 3 — la ricetta senza tag protetti resta applicabile dall'Operator.
st, body = req("POST", "/recipes/libera/apply", {"applied_by": "op"}, op)
caso("Operator su ricetta libera → applica tutto",
     st == 200 and body.get("applied") == 2, f"status {st}: {body}")

# 4 — l'Admin applica anche la ricetta col tag protetto.
st, body = req("POST", "/recipes/lotto/apply", {"applied_by": "capo"}, adm)
caso("Admin sulla stessa ricetta → applica tutto",
     st == 200 and body.get("applied") == 2, f"status {st}: {body}")
_, t = req("GET", "/tags/ricetta.limite", token=adm)
caso("il tag protetto ha il valore della ricetta", t["value"] == 99.0, f"{t['value']}")

# 5 — l'audit firmato: il rifiuto e l'apply ci sono, con l'utente vero.
st, audit = req("GET", "/audit?limit=200", token=adm)
if st != 200:
    st, audit = req("GET", "/audit", token=adm)
voci = audit if isinstance(audit, list) else audit.get("entries", audit.get("items", []))
testo = json.dumps(voci)
caso("audit: recipe.apply_denied firmato dall'Operator",
     "recipe.apply_denied" in testo and '"op"' in testo, testo[:200])
caso("audit: recipe.apply firmato dall'utente autenticato (non dall'applied_by)",
     "recipe.apply" in testo and '"admin"' in testo, testo[:200])

sys.exit(1 if rossi else 0)
PY
rc=$?
[ $rc -eq 0 ] && echo "ricette: tutto verde." || echo "FALLITO"
exit $rc
