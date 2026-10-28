#!/usr/bin/env bash
#
# Il testo dell'IDE si legge, in tutti e due i temi?
#
# PERCHÉ ESISTE
#
# Il 2026-09-06 il maintainer ha segnalato che **col tema chiaro diverse scritte
# spariscono**: testo chiaro su fondo chiaro. Misurando, non erano due punti:
# erano **63 testi** sotto la soglia di leggibilità, e alcuni con contrasto
# **1,0** — cioè dello stesso identico colore dello sfondo.
#
# Le cause erano tre, tutte della stessa famiglia — un colore scelto guardando
# **un solo** tema:
#
#   * `--brand-border` usato come colore del TESTO in 153 punti. Col tema scuro
#     sembra un'etichetta attenuata; col chiaro il token diventa `#cbd5e1` e la
#     scritta sparisce sul bianco;
#   * inchiostri scritti a mano (`#fde68a` sulla banda d'avviso, `#bbf7d0` sui
#     pulsanti verdi) invece dei token `*-soft`, che invece si accoppiano
#     correttamente ai `*-bg` in entrambi i temi;
#   * i pastelli delle categorie della palette, scelti per lo sfondo scuro.
#
# Nessun test poteva vederlo: il contrasto non è una proprietà di un componente,
# è il rapporto fra due colori che si incontrano solo a schermo. Qui si guarda
# lì, in un browser vero, in tutti e due i temi.
#
# La soglia è quella di WCAG AA: 4,5:1 per il testo normale, 3:1 per quello
# grande o in grassetto.
#
# **Non misura il canvas**: là il colore di fondo non è un `background` CSS ma
# un `<rect>` fratello (il foglio, T-52), quindi risalire gli antenati troverebbe
# il tavolo e ogni testo del sinottico risulterebbe illeggibile mentre a occhio
# è giusto. Il canvas ha le sue regole (Q18) e le sue verifiche.
#
# Uso:
#   cargo build -p sws-runtime && (cd sws-editor && pnpm build)
#   ./scripts/check_contrasto.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
DIST="sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-contrasto.$$"
AP="${APORT:-8726}"

[ -x "$BIN" ]                   || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "manca $DIST — esegui: cd sws-editor && pnpm build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}

# **Il marchio del repo, non quello della macchina** (28-10-2026). Il marchio
# attivo sta in `dist/branding/active.json`, e il maintainer lo cambia per
# macchina — Pixsys in ufficio, SWS a casa — scrivendolo proprio lì. La prima
# misura della porta d'ingresso ha trovato un collegamento illeggibile in un
# arancione che era quello Pixsys: la stessa guardia, sulla macchina di casa,
# avrebbe misurato un altro colore. Una guardia che dice cose diverse a
# seconda di dove gira non è una guardia. Si serve una copia di `dist` col
# marchio scritto nel repo, e quello della macchina non si tocca.
mkdir -p "$WORK/www"
cp -a "$DIST/." "$WORK/www/"
cp "sws-editor/public/branding/active.json" "$WORK/www/branding/active.json"
DIST="$WORK/www"
trap 'for p in "$WORK"/rt*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; done; rm -rf "$WORK"' EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --www "$DIST" --senza-autenticazione --admin-port "$AP" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$AP — non è la misura che fallisce, è l'avvio" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

API="http://localhost:$AP/api"
# Un progetto con contenuto: su uno vuoto metà dei pannelli non si disegna, e la
# misura direbbe «tutto a posto» avendo guardato quasi niente.
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"contrasto","template":"demo-items-web"}' > /dev/null

curl -sf -X POST "$API/projects/contrasto/open" > /dev/null

male=0

# ── La porta d'ingresso (28-10-2026) ───────────────────────────────────────
#
# Primo accesso, accesso, scelta del progetto: le tre schermate che vede
# chiunque arrivi, e che fino a oggi questa guardia non aveva mai guardato —
# partiva sempre da un progetto aperto.
#
# Serve un **secondo** runtime, e non è un dettaglio. Il primo gira
# `--senza-autenticazione`, che è comodo per l'IDE ma salta proprio queste
# schermate: senza utenti mostra «primo accesso», con un utente mostra
# l'accesso, e il login va a `sws_auth` del progetto invece che all'archivio
# degli utenti, quindi non entra mai. Il secondo si comporta come quello vero —
# come `sws.soligo.net` — e la porta la si attraversa davvero, una schermata
# per volta, misurandole tutte e tre.
AP2=$((AP + 1))
mkdir -p "$WORK"/{config2,projects2}
"$BIN" --config "$WORK/config2" --projects-root "$WORK/projects2" \
  --templates-root "examples/templates" --www "$DIST" --admin-port "$AP2" > "$WORK/rt2.log" 2>&1 &
echo $! > "$WORK/rt2.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP2/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il secondo runtime di prova non risponde su :$AP2" >&2
  tail -20 "$WORK/rt2.log" >&2; exit 1
fi
API2="http://localhost:$AP2/api"

for tema in light dark; do
  IDE="http://localhost:$AP2" TEMA="$tema" SCHERMATA=primo-accesso \
    node sws-editor/scripts/contrasto_measure.mjs || male=1
done

# Il codice di primo accesso lo stampa il runtime all'avvio: è la prova che
# chi crea l'amministratore ha accesso alla macchina, e qui la macchina siamo noi.
codice=$(grep -oE "codice: [0-9a-f]+" "$WORK/rt2.log" | head -1 | cut -d' ' -f2)
curl -sf -X POST "$API2/identita/primo-amministratore" -H 'Content-Type: application/json' \
  -d "{\"codice\":\"$codice\",\"email\":\"contrasto@prova.it\",\"nome\":\"Prova\",\"password\":\"unapasswordlunga\"}" > /dev/null \
  || { echo "✗ non riesco a creare l'amministratore sul secondo runtime" >&2; exit 1; }

for tema in light dark; do
  IDE="http://localhost:$AP2" TEMA="$tema" SCHERMATA=accesso \
    node sws-editor/scripts/contrasto_measure.mjs || male=1
done

token=$(curl -sf -X POST "$API2/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"contrasto@prova.it","password":"unapasswordlunga"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
[ -n "$token" ] || { echo "✗ il login sul secondo runtime non ha dato un token" >&2; exit 1; }
curl -sf -X POST "$API2/projects" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"name":"contrasto","template":"demo-items-web"}' > /dev/null

for tema in light dark; do
  IDE="http://localhost:$AP2" TEMA="$tema" SCHERMATA=benvenuto TOKEN="$token" \
    node sws-editor/scripts/contrasto_measure.mjs || male=1
done

# ── L'IDE a progetto aperto, sul primo runtime (il caso di sempre) ──────────
for tema in light dark; do
  IDE="http://localhost:$AP" ADMIN="http://localhost:$AP" TEMA="$tema" \
    node sws-editor/scripts/contrasto_measure.mjs || male=1
done
if [ "$male" -ne 0 ]; then
  echo
  echo "    Un colore scelto guardando un solo tema. I token ci sono già:"
  echo "      testo attenuato   → --brand-text-subtle (non --brand-border!)"
  echo "      testo su *-bg     → il *-soft della stessa famiglia"
  echo "      testo su tinta piena → --brand-on-* (li calcola readableOn)"
  exit 1
fi
echo "  nessun testo sotto la soglia di leggibilità, in entrambi i temi."
