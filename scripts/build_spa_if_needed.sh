#!/usr/bin/env bash
#
# Costruisce la SPA solo se serve. Lo chiamano `start_runtime.sh` e
# `start_editor.sh` prima di avviare il binario.
#
# PERCHÉ ESISTE
#
# I due script `start_*` compilavano **il Rust** da sé (`cargo build -p
# sws-runtime`) e per la SPA si limitavano ad avvisare:
#
#     [editor] ATTENZIONE: .../dist/index-admin.html non trovata — solo API
#     [editor]   Costruisci con: cd sws-editor && pnpm build
#
# Quell'asimmetria fa prendere abbagli, e li ha fatti prendere: metà del progetto
# si ricompila da sé e l'altra metà chiede il permesso, quindi si avvia una
# istanza che serve una SPA vecchia — o nessuna — senza accorgersene, e si passa
# dieci minuti a cercare nel codice una modifica che è semplicemente non
# arrivata nel browser.
#
# PERCHÉ UN FILE A SÉ E NON UNA FUNZIONE IN OGNI SCRIPT
#
# La convenzione locale sarebbe duplicare: `sync_branding` esiste identica in
# entrambi gli script. Per tre righe va bene; per la logica di «cosa rende la
# dist vecchia» no — è un elenco di sorgenti che cambia quando si aggiunge un
# entry point, e in questo progetto l'informazione duplicata ha già mentito più
# volte (la versione in quattro file, i conteggi delle guardie in
# `scripts/README.md`). Una copia sola, e chiamabile anche a mano.
#
# Uso:
#   ./scripts/build_spa_if_needed.sh            # costruisce se serve
#   ./scripts/build_spa_if_needed.sh --force    # costruisce sempre
#   ./scripts/build_spa_if_needed.sh --check    # dice solo se servirebbe (esce 1 se sì)
#
# Esce 0 se la dist è pronta (già o dopo la build), != 0 se non si è potuto
# costruire — il chiamante decide se avviare comunque in sola API.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ED="$REPO/sws-editor"
DIST="$ED/dist"
ETI="${SPA_LOG_PREFIX:-[spa]}"

FORCE=0
SOLO_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --check) SOLO_CHECK=1 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "$ETI argomento sconosciuto: $arg" >&2; exit 2 ;;
  esac
done

[ -d "$ED" ] || { echo "$ETI $ED non esiste" >&2; exit 1; }

# ── Gli entry point si scoprono, non si elencano ─────────────────────────────
#
# `index*.html` nella radice di sws-editor sono le pagine che vite costruisce
# (viewer, IDE, finestra dei log, e la chat staccata da quando c'è). Scoprirli
# con un glob invece di scriverli qui significa che aggiungerne uno non richiede
# di ricordarsi di questo file — ed è precisamente il genere di dimenticanza che
# lascerebbe la dist vecchia senza che niente lo dica.
ENTRY=()
for f in "$ED"/index*.html; do
  [ -f "$f" ] && ENTRY+=("$(basename "$f")")
done
if [ "${#ENTRY[@]}" -eq 0 ]; then
  echo "$ETI nessun index*.html in $ED: non c'è niente da costruire" >&2
  exit 1
fi

serve=0
motivo=""

# 1. Manca un entry point nella dist?
for e in "${ENTRY[@]}"; do
  if [ ! -f "$DIST/$e" ]; then
    serve=1; motivo="manca dist/$e"; break
  fi
done

# 2. Qualche sorgente è più recente della dist?
#
# Il riferimento è un entry HTML **specifico** e non «il file più recente in
# dist»: `sync_branding` (negli script start_*) copia dentro dist/branding a
# ogni avvio, quindi il file più recente sarebbe sempre quello e la dist
# risulterebbe sempre fresca. vite riscrive tutti gli entry a ogni build, così
# la data di quel file è la data della build.
#
# `public/branding` è escluso di proposito: il branding si cambia senza
# ricostruire (lo sincronizzano gli script start_*), e includerlo farebbe
# ricompilare a ogni cambio di marchio senza motivo.
if [ "$serve" -eq 0 ]; then
  RIF="$DIST/${ENTRY[0]}"
  recenti="$(find "$ED/src" "$ED"/index*.html "$ED"/vite.config.ts \
                  "$ED"/tsconfig*.json "$ED"/package.json "$ED"/pnpm-lock.yaml \
                  "$ED/public" \
                  -path "$ED/public/branding" -prune -o \
                  -newer "$RIF" -print 2>/dev/null | head -3)"
  if [ -n "$recenti" ]; then
    serve=1
    motivo="sorgenti più recenti della dist ($(printf '%s' "$recenti" | head -1 | sed "s|$REPO/||"), …)"
  fi
fi

[ "$FORCE" -eq 1 ] && { serve=1; motivo="--force"; }

if [ "$SOLO_CHECK" -eq 1 ]; then
  if [ "$serve" -eq 1 ]; then echo "$ETI da ricostruire: $motivo"; exit 1
  else echo "$ETI dist aggiornata"; exit 0; fi
fi

if [ "$serve" -eq 0 ]; then
  echo "$ETI dist aggiornata, niente da ricostruire"
  exit 0
fi

# ── Costruire ────────────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  echo "$ETI ERRORE: serve ricostruire la SPA ($motivo) ma pnpm non è nel PATH." >&2
  echo "$ETI          npm install -g pnpm" >&2
  exit 1
fi

if [ ! -d "$ED/node_modules" ]; then
  echo "$ETI node_modules assente: pnpm install…"
  (cd "$ED" && pnpm install) || {
    echo "$ETI ERRORE: pnpm install fallito." >&2; exit 1; }
fi

echo "$ETI ricostruisco la SPA ($motivo)…"
if (cd "$ED" && pnpm build); then
  echo "$ETI SPA ricostruita."
  exit 0
else
  # Non si finge riuscita: il chiamante deve poter decidere se avviare comunque
  # in sola API, e chi guarda deve sapere che sta servendo una dist vecchia.
  echo "$ETI ERRORE: pnpm build fallito. La dist NON è aggiornata." >&2
  exit 1
fi
