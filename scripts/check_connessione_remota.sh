#!/usr/bin/env bash
#
# Connettersi a un dispositivo SENZA utenti non deve chiudere fuori l'editor.
#
# Il caso, segnalato dal maintainer il 2026-09-08: distribuisce sul pannello un
# progetto senza utenti, poi preme «Connetti» con le credenziali rimaste nel
# modulo da un dispositivo precedente. Il pannello non ha utenti, quindi il
# login fallisce — non perché la password sia sbagliata, ma perché non c'è
# nessuna password che vada bene. Il runtime locale rispondeva **401**, e il
# client tratta ogni 401 come «la TUA sessione è scaduta»: comparivano insieme
# «✗ unauthorized» e il modale di riautenticazione, su una sessione locale
# perfettamente viva e per un utente (admin) la cui password non poteva
# funzionare. Doppio vicolo cieco.
#
# Qui girano DUE runtime: uno con utenti (l'editor) e uno senza (il pannello).
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_connessione_remota.sh
#
# Runtime scratch dichiarati (porte 8671 «editor» e 8672 «pannello», dir
# temporanee), terminati dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-remoto.$$"
IDE="${IDE:-8671}"
PAN="${PAN:-8672}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{ide/config,ide/projects/lavoro,pan/config,pan/projects/pannello}

# Gli utenti appartengono al PROGETTO (aprirne uno scambia lo user store), non
# al runtime: senza un progetto sul disco l'admin da seminare non ha dove
# andare, e anche l'«editor» partirebbe in no-auth — cioè non proverebbe
# niente. Due progetti minimi, uno per parte.
for lato in ide/lavoro pan/pannello; do
  cat > "$WORK/${lato%%/*}/projects/${lato##*/}/project.yaml" <<YAML
meta:
  name: ${lato##*/}
  version: 0.1.0
tags: []
sources: []
YAML
done
cleanup() {
  for f in "$WORK"/ide.pid "$WORK"/pan.pid; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# L'editor: ha un admin, come la macchina di chi lavora.
SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin1234 \
"$BIN" --config "$WORK/ide/config" --projects-root "$WORK/ide/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$IDE" > "$WORK/ide.log" 2>&1 &
echo $! > "$WORK/ide.pid"

# Il pannello: nessun utente definito — è il caso della segnalazione.
"$BIN" --config "$WORK/pan/config" --projects-root "$WORK/pan/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$PAN" > "$WORK/pan.log" 2>&1 &
echo $! > "$WORK/pan.pid"

for p in "$IDE" "$PAN"; do
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$p/health" && break; sleep 0.5; done
done

python3 - "$IDE" "$PAN" <<'PY'
import json, sys, urllib.request, urllib.error
ide, pan = sys.argv[1], sys.argv[2]
API = f"http://localhost:{ide}/api"

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
tok = login["token"]
target = f"http://localhost:{pan}"

print("== il pannello non ha utenti, ma il modulo ha ancora le credenziali ==")
st, body = req("POST", "/remote/connect",
               {"url": target, "username": "user", "password": "unaqualsiasi"}, tok)
# IL punto: un 401 qui fa credere all'editor che sia scaduta la SUA sessione.
caso("la risposta NON è 401 (era il modale «Sessione scaduta»)", st != 401, f"status {st}")
caso("si connette lo stesso", st == 200 and body.get("ok") is True, f"{st}: {body}")
caso("...e dice che le credenziali sono state ignorate",
     isinstance(body, dict) and "non ha utenti" in (body.get("nota") or ""), f"{body}")

print("== la sessione dell'editor è rimasta viva ==")
st, _ = req("GET", "/auth/whoami", token=tok)
caso("whoami risponde ancora 200 col token di prima", st == 200, f"status {st}")

print("== senza credenziali, come sempre ==")
req("DELETE", "/remote/connect", None, tok)
st, body = req("POST", "/remote/connect", {"url": target}, tok)
caso("connessione anonima ok", st == 200 and body.get("ok") is True, f"{st}: {body}")

print("== e un dispositivo CON utenti rifiuta ancora, ma senza sbattere fuori ==")
req("DELETE", "/remote/connect", None, tok)
st, body = req("POST", "/remote/connect",
               {"url": f"http://localhost:{ide}", "username": "admin", "password": "sbagliata"}, tok)
caso("non è 401", st != 401, f"status {st}")
caso("dichiara ok:false", st == 200 and body.get("ok") is False, f"{st}: {body}")
caso("e spiega di chi è la colpa",
     "credenziali rifiutate" in (body.get("error") or ""), f"{body}")

sys.exit(1 if rossi else 0)
PY
rc=$?
[ $rc -eq 0 ] && echo "connessione remota: tutto verde." || echo "FALLITO"
exit $rc
