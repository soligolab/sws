#!/usr/bin/env bash
#
# La prova di un commit vecchio blocca davvero ogni salvataggio? E il fork, e
# «Riparti da qui», fanno quello che dicono?
#
# Perché esiste: il blocco dei salvataggi durante una prova (piano
# `docs/plans/2026-09-26-gestore-repository-progetto.md`, Fase 2) è **un
# filtro solo** davanti a tutte le rotte — `blocca_in_prova` in `router.rs` —
# perché i file del progetto si scrivono da una dozzina di handler diversi. È
# esattamente il tipo di cosa che si rompe in silenzio: basta che qualcuno
# sposti il `.layer(...)` dopo il `with_state`, o che una rotta nuova nasca
# fuori da `/api/project/`, e un salvataggio fatto durante la prova finisce su
# nessun ramo e sparisce al ritorno. I test di `git_deploy.rs` provano le
# funzioni; qui si prova il runtime vero, via HTTP.
#
# Provata rossa il 26-09-2026 con due falsificazioni sul codice vero: tolto
# `/api/synoptics` dalle rotte bloccate, il PUT di un sinottico in prova è
# passato (204); tolto il `.layer(blocca_in_prova)`, il controllo iniziale ha
# contato 0 montaggi.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_git_progetto.sh
#
# Runtime scratch dichiarato (porta 8674, dir temporanea, modalità IDE: nessun
# login), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-git-progetto.$$"
APORT="${APORT:-8674}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
command -v git >/dev/null || { echo "manca git" >&2; exit 1; }

echo "== il filtro è montato, una volta sola, davanti alle rotte =="
n=$(grep -c 'from_fn_with_state(state.clone(), blocca_in_prova)' "$REPO/sws-runtime/crates/sws-web/src/router.rs" || true)
if [ "$n" = "1" ]; then echo "  ✓ blocca_in_prova montato sul router admin"; else echo "  ✗ blocca_in_prova montato $n volte (atteso 1)"; exit 1; fi

mkdir -p "$WORK"/{config,projects/prova}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

P="$WORK/projects/prova"
scrivi_progetto() {
  cat > "$P/project.yaml" <<YAML
meta:
  name: prova
  version: 0.1.0
tags:
  - id: t1
    data_type: float
sources: []
alarms:
  - id: a1
    tag: t1
    levels:
      - condition: { kind: above, threshold: $1 }
        severity: Warning
        message: "soglia $1"
YAML
}
g() { git -C "$P" -c user.name=Prova -c user.email=prova@sws.test "$@"; }
scrivi_progetto 10; g init -q -b main; g add -A; g commit -q -m "primo"
scrivi_progetto 20; g commit -q -am "secondo"
# L'identità nel repository: «Riparti da qui» committa dal runtime, e una
# macchina di CI non ha un ~/.gitconfig.
g config user.name Prova; g config user.email prova@sws.test

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$APORT" \
  --project "$P" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

# Aprire il progetto può riscriverne project.yaml (normalizzazione, versione):
# si committa, così la prova parte da un albero pulito come farebbe l'utente.
sleep 1
if [ -n "$(g status --porcelain)" ]; then g add -A; g commit -q -m "normalizzato all'apertura"; fi

python3 - "http://localhost:$APORT/api" "$P" "$WORK/projects" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error
API, P, ROOT = sys.argv[1], sys.argv[2], sys.argv[3]
def req(method, path, body=None):
    r = urllib.request.Request(f"{API}{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read()
            try: return resp.status, (json.loads(t) if t else None)
            except Exception: return resp.status, t.decode(errors="replace")
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode(errors="replace")
def git(*a, cwd=P):
    return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True).stdout.strip()
rossi = 0
def caso(nome, ok, extra=""):
    global rossi
    print(f"  {'✓' if ok else '✗'} {nome}" + ("" if ok else f" — {extra}"))
    if not ok: rossi += 1
def soglia():
    return open(os.path.join(P, "project.yaml")).read()

primo = git("rev-list", "--max-parents=0", "HEAD")
_, progetto = req("GET", "/project")
allarmi = progetto["alarms"]

print("== entrare in prova ==")
st, prova = req("POST", "/project/git/prova", {"sha": primo})
caso("prova sul primo commit → 200", st == 200, f"{st}: {prova}")
_, stato = req("GET", "/project/git-status")
caso("lo stato dice «prova in corso»", bool(stato and stato.get("prova")), f"{stato}")
caso("i file sono quelli del primo commit", "threshold: 10" in soglia(), soglia()[-200:])

print("== durante la prova non si salva niente ==")
for metodo, rotta, corpo in [
    ("PUT", "/project/alarms", allarmi),
    ("PUT", "/project/tags", progetto["tags"]),
    ("POST", "/project/git/commit", {"message": "non deve passare"}),
    ("POST", "/project/deploy", None),
    ("PUT", "/synoptics/Nuova", {"id": "n", "name": "Nuova", "objects": []}),
]:
    st, body = req(metodo, rotta, corpo)
    caso(f"{metodo} {rotta} → 409", st == 409, f"{st}: {str(body)[:160]}")
caso("il 409 dice come uscirne", "Torna all'ultima" in str(req("PUT", "/project/alarms", allarmi)[1]))
caso("l'albero non è stato toccato", git("status", "--porcelain", "--untracked-files=no") == "",
     git("status", "--porcelain"))

print("== restano aperte le rotte che non scrivono il progetto ==")
st, _ = req("POST", "/project/validate", {})
caso("POST /project/validate non è bloccata", st != 409, f"{st}")
st, _ = req("POST", "/recipes/nessuna/apply", {})
caso("POST /recipes/:id/apply non è bloccata", st != 409, f"{st}")

print("== il fork, anche durante la prova ==")
st, body = req("POST", "/project/git/fork", {"sha": primo, "new_name": "gemello"})
caso("fork dal primo commit → 201", st == 201, f"{st}: {body}")
F = os.path.join(ROOT, "gemello")
caso("il fork ha la storia fino a quel commit", git("rev-list", "--count", "HEAD", cwd=F) == "1",
     git("log", "--oneline", cwd=F))
caso("il fork non ha origin", git("remote", cwd=F) == "", git("remote", "-v", cwd=F))
st, _ = req("POST", "/project/git/fork", {"sha": primo, "new_name": "gemello"})
caso("stesso nome → 409", st == 409, f"{st}")

print("== «Riparti da qui» ==")
prima = int(git("rev-list", "--count", "main"))
st, body = req("POST", "/project/git/prova/riparti")
caso("riparti → 200", st == 200, f"{st}: {body}")
_, stato = req("GET", "/project/git-status")
caso("la prova è finita, di nuovo su main", not stato.get("prova") and stato.get("branch") == "main", f"{stato}")
caso("un commit in più, la storia intera", int(git("rev-list", "--count", "main")) == prima + 1,
     git("log", "--oneline"))
caso("il commit nuovo dice cosa ripristina", git("log", "-1", "--format=%s").startswith("Ripristinata la versione"),
     git("log", "-1", "--format=%s"))
caso("i file sono quelli del primo commit", "threshold: 10" in soglia(), soglia()[-200:])

print("== dopo la prova si salva di nuovo ==")
st, body = req("PUT", "/project/alarms", allarmi)
caso("PUT /project/alarms → 2xx", 200 <= st < 300, f"{st}: {body}")

print()
if rossi:
    print(f"✗ git del progetto: {rossi} controlli rossi"); sys.exit(1)
print("✓ git del progetto: prova, blocco dei salvataggi, fork e «Riparti da qui» come promesso")
PY
