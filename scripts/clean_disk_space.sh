#!/usr/bin/env bash
# Libera spazio su disco cancellando build artifact rigenerabili.
#
# Nato da un crash reale del linker ("Bus error") con disco root al 100%: il
# linker mappa in memoria il file di output, e su disco pieno il kernel non
# riesce più a garantire le pagine mappate. `target/debug` (workspace +
# sws-kiosk + sws-lvgl-viewer, esclusi dal workspace e quindi mai toccati da
# un `cargo clean` sul principale) è di gran lunga il maggior consumatore.
#
# Default: cancella solo cose rigenerabili senza perdita di dati (target/debug,
# node_modules, immagini podman dangling). `target/release`, `.bak/` dei
# progetti, le cartelle `.run*` di test e la cache cargo NON vengono toccati
# di default — vedi --full-images/--cargo-cache per includerli esplicitamente.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

YES=0
FULL_IMAGES=0
CARGO_CACHE=0

for arg in "$@"; do
  case "$arg" in
    -y|--yes)        YES=1 ;;
    --full-images)   FULL_IMAGES=1 ;;
    --cargo-cache)   CARGO_CACHE=1 ;;
    -h|--help)
      cat <<EOF
Uso: $0 [-y|--yes] [--full-images] [--cargo-cache]

  -y, --yes        Nessuna conferma interattiva (per uso non presidiato).
  --full-images    Oltre alle immagini podman dangling, elenca anche le
                   immagini non taggate come versione corrente/latest e
                   chiede conferma per rimuoverle (immagini demo/vecchie
                   accumulate nel tempo — non fatto di default perché alcune
                   potrebbero servire ancora).
  --cargo-cache    Svuota anche ~/.cargo/registry (cache+sorgenti scaricate).
                   Impatta TUTTI i progetti Rust sulla macchina, non solo
                   questo repo: si rigenera scaricando di nuovo dal registry
                   al prossimo build, costa rete non tempo di compilazione.

Sempre escluso, solo riportato in dimensione: target/release, .bak/ dei
progetti, le cartelle .run* di test/dev.
EOF
      exit 0
      ;;
    *) echo "Argomento sconosciuto: $arg (usa --help)" >&2; exit 1 ;;
  esac
done

human_size() {
  du -sh "$1" 2>/dev/null | cut -f1
}

echo "=== Spazio prima della pulizia ==="
df -h / 2>/dev/null | sed 's/^/  /'
echo

echo "=== Candidati alla pulizia (default) ==="
DEBUG_DIRS=(
  "$REPO/sws-runtime/target/debug"
  "$REPO/sws-runtime/crates/sws-kiosk/target/debug"
  "$REPO/sws-runtime/crates/sws-lvgl-viewer/target/debug"
)
for d in "${DEBUG_DIRS[@]}"; do
  [ -d "$d" ] && echo "  $(human_size "$d")	$d"
done
NODE_MODULES="$REPO/sws-editor/node_modules"
[ -d "$NODE_MODULES" ] && echo "  $(human_size "$NODE_MODULES")	$NODE_MODULES"
if command -v podman >/dev/null 2>&1; then
  DANGLING=$(podman images -f dangling=true -q 2>/dev/null | wc -l | tr -d ' ')
  echo "  immagini podman dangling: $DANGLING"
fi
echo

echo "=== Solo per consapevolezza — NON toccato da questo script ==="
[ -d "$REPO/sws-runtime/target/release" ] && echo "  $(human_size "$REPO/sws-runtime/target/release")	$REPO/sws-runtime/target/release"
for d in "$REPO"/.run*; do
  [ -d "$d" ] && echo "  $(human_size "$d")	$d"
done
find "$REPO" -maxdepth 4 -type d -name ".bak" 2>/dev/null | while read -r d; do
  echo "  $(human_size "$d")	$d"
done
echo

if [ "$YES" -ne 1 ]; then
  read -r -p "Procedere con la pulizia di default sopra elencata? [y/N] " reply
  case "$reply" in
    y|Y|yes|si|s) ;;
    *) echo "Annullato."; exit 0 ;;
  esac
fi

echo
echo "=== Pulizia in corso ==="
for d in "${DEBUG_DIRS[@]}"; do
  if [ -d "$d" ]; then
    echo "  rimuovo $d"
    rm -rf "$d"
  fi
done
if [ -d "$NODE_MODULES" ]; then
  echo "  rimuovo $NODE_MODULES"
  rm -rf "$NODE_MODULES"
fi
if command -v podman >/dev/null 2>&1; then
  echo "  podman image prune (dangling)"
  podman image prune -f >/dev/null 2>&1 || true
fi

if [ "$FULL_IMAGES" -eq 1 ] && command -v podman >/dev/null 2>&1; then
  echo
  echo "=== Immagini podman non-dangling — scelta manuale ==="
  echo "Immagini presenti (le più recenti/con tag 'latest-*' sono probabilmente da tenere):"
  podman images | sed 's/^/  /'
  echo
  echo "Rimuovi manualmente quelle non più necessarie con:"
  echo "  podman rmi <IMAGE ID>"
  echo "(non cancellate automaticamente — un'immagine sbagliata rimossa non si riscarica da sola)."
fi

if [ "$CARGO_CACHE" -eq 1 ] && [ -d "$HOME/.cargo/registry" ]; then
  echo
  echo "  rimuovo $HOME/.cargo/registry (cache+sorgenti — si rigenera dal registry al prossimo build)"
  rm -rf "$HOME/.cargo/registry"
fi

echo
echo "=== Spazio dopo la pulizia ==="
df -h / 2>/dev/null | sed 's/^/  /'
echo
echo "Prossimo 'cargo build'/'cargo check' ricompila da zero (nessuna cache incrementale) — normale, non un errore."
