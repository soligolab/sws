#!/usr/bin/env bash
#
# Una riga MQTT senza topic non arriva né al disco né al broker.
#
# Perché esiste: il 2026-09-07, sul progetto Sandokan, la sorgente `mqtt-casa`
# aveva 28 righe e la prima col `topic: ''` — lasciata dallo sfoglia-broker.
# SWS la sottoscriveva così com'era, il filtro a lunghezza zero è un errore di
# protocollo MQTT (3.1.1 §4.7.3) e mosquitto chiudeva la connessione 2 ms dopo
# la SUBSCRIBE. Il costo non era la riga: morivano tutti e 28 i topic, in loop
# ogni 5 secondi, e il log diceva solo «Broken pipe» — che manda a cercare la
# rete, il broker o il container. Una serata.
#
# Qui si prova la catena che impedisce il ritorno del difetto:
#   1. il salvataggio delle Sorgenti pota le righe vuote PRIMA del disco
#      (quindi anche prima del deploy sul dispositivo);
#   2. il validatore le segnala come errore, con il perché;
#   3. una riga con topic buono ma senza tag resta, ed è solo un avviso.
# La tolleranza del runtime (salta e continua) è coperta dai unit test del
# plugin: provarla qui vorrebbe un broker vero.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_mqtt_topic_vuoto.sh
#
# Runtime scratch dichiarato (porta 8668, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-mqttvuoto.$$"
APORT="${APORT:-8668}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"vuoto","template":"demo-items-web"}' > /dev/null
curl -sf -X POST "$API/projects/vuoto/open" > /dev/null

python3 - "$API" <<'PY'
import json, sys, urllib.request, urllib.error
API = sys.argv[1]

def req(method, path, body=None):
    r = urllib.request.Request(f"{API}{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
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

# La sorgente com'era su Sandokan: righe vuote in testa, roba buona in coda.
sorgente = {
    "kind": "mqtt", "id": "mqtt-casa", "host": "192.168.1.6", "port": 1883,
    "client_id": "sws-prova",
    "topics": [
        {"tag": "", "topic": ""},                              # la killer
        {"tag": "", "topic": "   "},                           # idem, mascherata
        {"tag": "", "topic": "homeassistant/sensore/config"},  # sottoscrive e butta
        {"tag": "demo.sim.ramp", "topic": "casa/rampa"},       # buona
    ],
}

print("== il salvataggio pota prima del disco (e quindi prima del deploy) ==")
st, _ = req("PUT", "/project/sources", [sorgente])
caso("PUT /api/project/sources accettato", st in (200, 204), f"status {st}")

st, prog = req("GET", "/project")
topics = next((s["topics"] for s in prog.get("sources", []) if s.get("id") == "mqtt-casa"), None)
caso("la sorgente è sul disco", topics is not None, f"{prog.get('sources')}")
if topics is not None:
    vuoti = [t for t in topics if not (t.get("topic") or "").strip()]
    caso("nessuna riga senza topic è arrivata al disco", not vuoti, f"{vuoti}")
    caso("le righe buone sono rimaste tutte e due", len(topics) == 2, f"{len(topics)}: {topics}")

print("== il validatore lo dice, invece di lasciarlo scoprire al broker ==")
st, out = req("POST", "/project/validate", {"project": {**prog, "sources": [sorgente]}})
rilievi = out.get("findings", out) if isinstance(out, dict) else out
testo = json.dumps(rilievi, ensure_ascii=False)
caso("errore sulla riga senza topic", "topics[0].topic" in testo, testo[:300])
caso("...e spiega che muore l'intera sorgente", "intera sorgente" in testo, testo[:300])
caso("avviso sulla riga sottoscritta ma senza tag",
     any(r.get("path","").endswith("topics[2].tag") and r.get("severity") == "warning"
         for r in rilievi), testo[:300])

sys.exit(1 if rossi else 0)
PY
rc=$?
[ $rc -eq 0 ] && echo "riga MQTT vuota: tutto verde." || echo "FALLITO"
exit $rc
