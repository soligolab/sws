#!/usr/bin/env bash
#
# I campi numerici dell'editor passano tutti da `CampoNumero`?
#
# PERCHÉ ESISTE
#
# Un `<input type="number">` controllato non sa tenere un testo a metà: con «-»
# il browser riporta `value === ""`, e il gestore scriveva «non impostato» (o
# uno 0, dove faceva `Number(…)`), mentre React rimetteva il ripiego nel campo.
# Un numero negativo si scriveva solo con le freccette. Visto il 31-10-2026 sul
# Min di uno slider bipolare in CasaDomotica; i campi così erano 105.
# `sws-editor/src/components/CampoNumero.tsx` tiene il testo a metà e lo passa
# solo quando è un numero (piano docs/plans/2026-10-31-campi-numerici.md).
#
# COSA PRETENDE
#
#   nessun `type="number"` nei .tsx di sws-editor/src fuori da CampoNumero.tsx,
#   commenti esclusi.
#
# Uso:  ./scripts/check_campi_numerici.sh
set -euo pipefail
cd "$(dirname "$0")/.."
trovati=$(grep -rn --include='*.tsx' 'type="number"' sws-editor/src \
  | grep -v '^sws-editor/src/components/CampoNumero.tsx:' \
  | grep -Ev '^[^:]+:[0-9]+:\s*(//|\*|/\*|\{/\*)' || true)
if [ -n "$trovati" ]; then
  echo "  ✗ campi numerici fuori da CampoNumero (il «-» da tastiera si perde):"
  echo "$trovati" | sed 's/^/      /'
  exit 1
fi
n=$(grep -rn --include='*.tsx' '<CampoNumero' sws-editor/src | wc -l)
echo "  ✓ nessun <input type=\"number\"> a mano: $n campi passano da CampoNumero"
