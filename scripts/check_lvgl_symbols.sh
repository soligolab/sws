#!/usr/bin/env bash
#
# La tabella dei simboli "vendored" del viewer LVGL è allineata a quella
# dell'editor, e i file esistono davvero?
#
# PERCHÉ ESISTE
#
# `svg_assets::VENDORED` in Rust è una copia a mano di `SYMBOLS` in
# `sws-editor/src/symbols/library.tsx`. Una copia a mano si disallinea, e qui il
# disallineamento è silenzioso in modo particolarmente sgradevole: un simbolo
# aggiunto solo all'editor si vede nell'IDE e **non** sul pannello, che è
# esattamente lo scenario in cui il progettista dà la colpa al pannello.
#
# Non basta nemmeno derivare il percorso dall'id: 7 voci su 11 hanno il file con
# un nome diverso (`battery` -> `battery-charging-high.svg`), perché arrivano da
# librerie esterne e conservano il nome d'origine.
#
# Uso:  ./scripts/check_lvgl_symbols.sh     (esce != 0 se qualcosa non torna)
set -euo pipefail
cd "$(dirname "$0")/.."

TSX="sws-editor/src/symbols/library.tsx"
RS="sws-runtime/crates/sws-lvgl-viewer/src/svg_assets.rs"
PUB="sws-editor/public"

# Editor: dalle voci `kind: "vendored"`, la coppia id + percorso.
ts_pairs() {
  grep -o 'id: "[a-z_0-9]*",[^}]*kind: "vendored", path: "[^"]*"' "$TSX" \
    | sed 's/.*id: "\([a-z_0-9]*\)".*path: "\([^"]*\)".*/\1 \2/' | sort
}
# Rust: dalle righe della tabella VENDORED, delimitata da `pub const VENDORED`
# e dal `];` che la chiude — senza il delimitatore si prenderebbero anche le
# tuple degli altri array del file.
rs_pairs() {
  awk '/^pub const VENDORED/{f=1; next} f&&/^\];/{exit} f' "$RS" \
    | sed -n 's/^ *("\([a-z_0-9]*\)", "\([^"]*\)"),.*/\1 \2/p' | sort
}

fail=0

printf '\033[1mTabella dei simboli vendored: editor vs viewer LVGL\033[0m\n'
diff_out="$(diff <(ts_pairs) <(rs_pairs) || true)"
if [ -n "$diff_out" ]; then
  printf '  \033[31m✗\033[0m le due tabelle non coincidono (< editor, > viewer LVGL):\n'
  printf '%s\n' "$diff_out" | sed 's/^/      /'
  printf '      Allinea %s a %s.\n' "$RS" "$TSX"
  fail=1
else
  printf '  \033[32m✓\033[0m %d simboli, identici da entrambe le parti\n' "$(ts_pairs | wc -l)"
fi

echo
printf '\033[1mI file esistono\033[0m\n'
missing=0
while read -r id path; do
  [ -z "$id" ] && continue
  if [ ! -f "$PUB$path" ]; then
    printf '  \033[31m✗\033[0m %s -> %s non esiste\n' "$id" "$PUB$path"
    missing=$((missing + 1))
  fi
done < <(ts_pairs)
if [ "$missing" -eq 0 ]; then
  printf '  \033[32m✓\033[0m tutti i file dei simboli sono al loro posto\n'
else
  fail=1
fi

# File presenti ma che nessuno usa: non è un errore — un simbolo può essere
# stato tolto dalla libreria senza cancellare il file — ma vale la pena dirlo,
# perché l'altra spiegazione possibile è una voce dimenticata.
echo
printf '\033[1mFile non referenziati\033[0m\n'
orfani=0
for f in "$PUB"/symbols/*.svg; do
  [ -e "$f" ] || continue
  if ! ts_pairs | grep -qF "/symbols/$(basename "$f")"; then
    printf '  \033[33m—\033[0m %s non è in libreria (rimosso, o voce dimenticata?)\n' "$(basename "$f")"
    orfani=$((orfani + 1))
  fi
done
[ "$orfani" -eq 0 ] && printf '  \033[32m✓\033[0m nessun file orfano\n'

echo
if [ "$fail" -ne 0 ]; then
  printf '\033[31mControllo dei simboli fallito.\033[0m\n'
  exit 1
fi
printf '\033[32mSimboli vendored allineati.\033[0m\n'
