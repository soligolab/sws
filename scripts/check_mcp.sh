#!/usr/bin/env bash
#
# `sws-runtime --mcp`: il progetto come server MCP in sola lettura, su stdio.
#
# Tre cose, e la prima e' quella che conta di piu':
#
#   1. **Su stdout c'e' solo il protocollo.** Su stdio il protocollo *e*
#      stdout: una riga JSON per messaggio. Qualunque altra cosa stampata li'
#      stacca il client, e il difetto non si vede nei log — e' il client a
#      chiudere. Il 22-10-2026, al primo avvio vero, il banner del primo
#      accesso ci ha messo sei righe davanti alla prima risposta.
#   2. Gli strumenti esposti sono gli undici di lettura, con `inputSchema`
#      (MCP) e non `input_schema` (API dei messaggi di Anthropic).
#   3. Uno strumento che esiste ma e' escluso apposta lo dichiara, invece di
#      passare per un errore di battitura.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_mcp.sh
#
# Runtime scratch dichiarato (nessuna porta: `--mcp` non ne apre), dir
# temporanea terminata dal trap.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-mcp.$$"
[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
trap 'rm -rf "$WORK"' EXIT
cp -r examples/templates/demo-items-web "$WORK/projects/demo"

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"guardia","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"elenca_pagine","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"proponi_modifica","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"leggi_pagina","arguments":{"nome":"non esiste"}}}' \
  '{"jsonrpc":"2.0","id":6,"method":"resources/list"}' \
  | timeout 120 "$BIN" --mcp --config "$WORK/config" --projects-root "$WORK/projects" \
      --project "$WORK/projects/demo" --templates-root "examples/templates" \
      > "$WORK/out.jsonl" 2> "$WORK/err.log"
esito=$?
if [ "$esito" -ne 0 ]; then
  echo "  ✗ il server MCP è uscito con $esito"; tail -20 "$WORK/err.log"; exit 1
fi

echo "== il progetto come server MCP in sola lettura =="
python3 - "$WORK/out.jsonl" <<'PY'
import json, sys
male = 0
def ok(c, m):
    global male
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: male = 1

righe = [r for r in open(sys.argv[1]).read().split("\n") if r.strip()]
sporche = []
msg = {}
for r in righe:
    try:
        m = json.loads(r)
    except Exception:
        sporche.append(r[:70]); continue
    msg[m.get("id")] = m

ok(not sporche, "su stdout c'è SOLO il protocollo" + (f" — righe estranee: {sporche[:3]}" if sporche else ""))
ok(len(msg) == 6, f"una risposta per ogni richiesta con id, e nessuna alla notifica (viste {len(msg)}, attese 6)")

h = msg.get(1, {}).get("result", {})
ok(h.get("protocolVersion") == "2025-06-18", "l'handshake conferma la versione chiesta")
ok("tools" in h.get("capabilities", {}), "dichiara la capacità `tools`")
ok(h.get("serverInfo", {}).get("name") == "sws", "si presenta come `sws`")

t = msg.get(2, {}).get("result", {}).get("tools", [])
ok(len(t) == 11, f"espone 11 strumenti di lettura (visti {len(t)})")
ok(all("inputSchema" in x for x in t), "ogni strumento ha `inputSchema` (MCP), non `input_schema`")
ok(not any(x["name"] in ("proponi_modifica", "istantanea_pagina") for x in t),
   "i due che non leggono e basta restano fuori")

c3 = msg.get(3, {}).get("result", {})
ok(c3.get("isError") is False and "Base e comandi" in c3.get("content", [{}])[0].get("text", ""),
   "`elenca_pagine` legge il progetto vero")

e4 = msg.get(4, {}).get("error", {})
ok(e4.get("code") == -32602 and "sola lettura" in e4.get("message", ""),
   "`proponi_modifica` è rifiutato, e dice che è una scelta")

c5 = msg.get(5, {}).get("result", {})
ok(c5.get("isError") is True,
   "l'errore di uno strumento torna come `isError`, non come errore JSON-RPC")

ok(msg.get(6, {}).get("error", {}).get("code") == -32601, "un metodo non implementato è -32601")
sys.exit(male)
PY
esito=$?
[ "$esito" -eq 0 ] && echo -e "\033[32mil server MCP parla, espone solo la lettura, e non sporca stdout.\033[0m"
exit "$esito"
