#!/usr/bin/env bash
#
# Un salvataggio che fallisce lo dice. Tutti.
#
# PERCHÉ ESISTE
#
# L'08-10-2026 il maintainer ha segnalato che il `Period` di un generatore
# sembrava ignorato nell'IDE mentre sul dispositivo era corretto. Il codice del
# generatore era giusto — misurato: 3,02 s su 3000 ms dichiarati — e anche il
# salvataggio riapplicava i generatori senza riaprire il progetto.
#
# Il meccanismo che produce quel sintomo è un altro: le schede della
# configurazione salvavano dentro `try { … } finally { setSaving(false) }`,
# **senza `catch`**. Un rifiuto — un 409 per conflitto di versione, un 401, un
# 503 — spariva: nessun messaggio, nessun segno, solo il pulsante che smetteva
# di girare. Il campo continuava a mostrare il valore appena scritto e il
# runtime restava com'era, cioè l'interfaccia diceva una cosa e il sistema ne
# faceva un'altra.
#
# Erano **cinque** schede: variabili, allarmi, protocolli, ricette, tipi.
#
# COSA VERIFICA
#
#   Nessuna funzione di `sws-editor/src/config/schede/` fa `await api.<scrive>`
#   dentro un `try` che si chiude con `finally` senza `catch`.
#
# Uso: ./scripts/check_salvataggio_muto.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "── Un salvataggio che fallisce lo dice ──"

mancanti=$(python3 - <<'PY'
import re, pathlib
cartella = pathlib.Path("sws-editor/src/config/schede")
# `api.update…`, `api.save…`, `api.crea…`, `api.salva…`, `api.delete…`: le
# chiamate che CAMBIANO qualcosa sul server. Una lettura che fallisce e un
# altro discorso — l'elenco resta vuoto e si vede.
scrive = r'await api\.(update|save|salva|crea|delete|rinomina|duplica)[A-Za-z]*\('
# Un `try { … }` con dentro una scrittura, seguito da `finally` invece che da
# `catch`. Le graffe annidate si tollerano a un livello: basta per questi file.
blocco = re.compile(r'try \{(?:[^{}]|\{[^{}]*\})*?' + scrive + r'(?:[^{}]|\{[^{}]*\})*?\}\s*(catch|finally)', re.S)
for f in sorted(cartella.glob("*.tsx")):
    s = f.read_text(encoding="utf-8")
    for m in blocco.finditer(s):
        if m.group(2) == "finally":
            print(f"{f}:{s[:m.start()].count(chr(10)) + 1}")
PY
)

if [ -z "$mancanti" ]; then
    n=$(grep -rc "segnalaSalvataggioFallito" sws-editor/src/config/schede/*.tsx 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    echo -e "  \033[32m✓\033[0m ogni salvataggio ha un \`catch\` ($n usano \`segnalaSalvataggioFallito\`)"
    echo
    echo -e "\033[32msalvataggi: nessun rifiuto sparisce in silenzio.\033[0m"
    exit 0
else
    while IFS= read -r r; do
        echo -e "  \033[31m✗\033[0m $r  \033[2m(try/finally senza catch attorno a una scrittura)\033[0m"
    done <<< "$mancanti"
    echo
    echo "      Un salvataggio rifiutato va mostrato. C'è già il posto:"
    echo "      \`segnalaSalvataggioFallito(e)\` in \`@/config/salvataggioFallito\`,"
    echo "      che instrada su \`saveStatus\`/\`saveError\` (l'intestazione) e su"
    echo "      \`saveConflict\` (il banner di App.tsx) quando è un conflitto."
    echo
    echo -e "\033[31msalvataggi: un rifiuto sparisce in silenzio.\033[0m"
    exit 1
fi
