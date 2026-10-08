#!/usr/bin/env bash
#
# Nella console non si scrive passando su un campo.
#
# PERCHÉ ESISTE
#
# Tre volte in due giorni, nello stesso modo. Il 07-10-2026 il maintainer ha
# cercato un «Salva» nel pannello di un utente e non l'ha trovato: ogni
# comando si applicava da solo al click, senza conferma né riscontro. Corretto
# lì. L'08-10 è ricomparso nella scheda dell'azienda, dove cinque campi
# scrivevano `onChange`/`onBlur` — e lì sopra ci sono le **risorse
# concordate**: scriverle per sbaglio passando su un campo è peggio che
# scriverle tardi.
#
# Un'azione senza conferma né riscontro sembra non essere avvenuta. E se
# fallisce non lo dice nessuno, perché non c'è nessun punto in cui dirlo —
# è il gemello di `check_salvataggio_muto.sh`.
#
# COSA VERIFICA
#
#   Nessun `onChange`/`onBlur` di `sws-editor/src/console/` chiama
#   direttamente una scrittura (`api.amministrazione…`, `api.…Marchio`).
#   Le scritture stanno in una funzione di salvataggio, dietro un pulsante.
#
# Uso: ./scripts/check_console_salva.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "── Nella console si scrive col pulsante, non passandoci sopra ──"

mancanti=$(python3 - <<'PY'
import pathlib, re
cartella = pathlib.Path("sws-editor/src/console")
# Le chiamate che CAMBIANO qualcosa. Una lettura in un `onChange` e legittima
# (ricaricare un elenco quando cambia un filtro, per esempio).
scrive = re.compile(r'api\.[A-Za-z]*(Modifica|Crea|Elimina|Salva|Carica|Scrivi|Reimposta)[A-Za-z]*\(')
for f in sorted(cartella.glob("*.tsx")):
    s = f.read_text(encoding="utf-8")
    for m in re.finditer(r'on(Change|Blur)=\{', s):
        # Si legge fino alla graffa che chiude l'attributo.
        i = m.end() - 1
        livello = 0
        for j in range(i, min(len(s), i + 4000)):
            if s[j] == "{":
                livello += 1
            elif s[j] == "}":
                livello -= 1
                if livello == 0:
                    corpo = s[i:j]
                    if scrive.search(corpo):
                        print(f"{f}:{s[:m.start()].count(chr(10)) + 1}: on{m.group(1)}")
                    break
PY
)

if [ -z "$mancanti" ]; then
    n=$(grep -rcE "const salva = async|const crea = async" sws-editor/src/console/*.tsx 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    echo -e "  \033[32m✓\033[0m nessun campo scrive da sé ($n funzioni di salvataggio esplicite)"
    echo
    echo -e "\033[32mconsole: si salva con un pulsante.\033[0m"
    exit 0
else
    while IFS= read -r r; do
        echo -e "  \033[31m✗\033[0m $r  \033[2m(scrive passando sul campo)\033[0m"
    done <<< "$mancanti"
    echo
    echo "      Un comando che si applica da solo appena lo tocchi, senza"
    echo "      conferma né riscontro, sembra non essere avvenuto — e se"
    echo "      fallisce non c'è nessun punto in cui dirlo. Le modifiche"
    echo "      vanno in una bozza locale e si scrivono al «Salva», come in"
    echo "      \`Persone.tsx\` e \`Aziende.tsx\`."
    echo
    echo -e "\033[31mconsole: un campo scrive da sé.\033[0m"
    exit 1
fi
