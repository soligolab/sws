#!/usr/bin/env bash
#
# Il segno delle unità scelte: l'installer e il runtime dicono gli stessi nomi.
#
# Perché esiste. Dal 23-10-2026 la versione dei quadlet installati è il minimo
# fra le unità CHE CONTANO, e a dire quali contano è un file che scrive
# l'installer — `unita-scelte.json` nella cartella di configurazione. Serviva
# perché un'unità opzionale (OpenPLC: «non è detto che a tutti i clienti
# serva») altrimenti varrebbe 0 per sempre, e il pannello chiederebbe un
# aggiornamento dei quadlet a ogni giro.
#
# I due lati devono nominare le stesse unità, e nessuno li tiene insieme:
#
#   - se il runtime guarda un'unità che l'installer non scrive mai nel segno,
#     quell'unità non viene contata da nessuna parte e la sua versione non la
#     controlla più nessuno;
#   - se cambia il nome del file, il runtime non lo trova e torna in silenzio
#     al comportamento vecchio. In silenzio è la parte cattiva: tutto continua
#     a funzionare, e il motivo per cui il file esisteva sparisce.
#
# Uso: ./scripts/check_unita_scelte.sh   (statica, nessuno stack)
set -uo pipefail
cd "$(dirname "$0")/.."

male=0
ok() { if [ "$1" = 1 ]; then printf '  \033[32m✓\033[0m %s\n' "$2"; else printf '  \033[31m✗\033[0m %s\n' "$2"; male=1; fi; }

RUST=sws-runtime/crates/sws-web/src/quadlet.rs
INST=deploy/container/install-container.sh

echo "== il segno delle unità scelte, da una parte e dall'altra =="

# 1. Il nome del file.
file_rust=$(grep -oP 'const FILE_UNITA: &str = "\K[^"]+' "$RUST")
[ -n "$file_rust" ] && ok 1 "il runtime cerca «$file_rust»" || { ok 0 "FILE_UNITA non si trova in $RUST"; exit 1; }
grep -q "$file_rust" "$INST" \
  && ok 1 "e l'installer scrive quello" \
  || ok 0 "l'installer non nomina «$file_rust»: il runtime non lo troverebbe e tornerebbe in silenzio al conto vecchio"

# 2. Le unità che il runtime conta, oltre al runtime stesso.
# L'array sta su una riga o su molte: si prende tutto fra le graffe quadre
# dopo l'uguale, e poi i nomi delle costanti.
mapfile -t attese < <(sed -n '/const ALTRE_UNITA/,/\];/p' "$RUST" \
    | tr '\n' ' ' | grep -oP '=\s*\[\K[^]]*' | tr ',' '\n' | tr -d ' ' | grep -E '^[A-Z_]+$')
# I nomi veri dietro quelle costanti.
nomi=()
for c in "${attese[@]}"; do
    n=$(grep -oP "const $c: &str = \"\K[^\"]+" "$RUST")
    [ -n "$n" ] && nomi+=("$n")
done
if [ "${#nomi[@]}" -eq 0 ]; then
    ok 0 "ALTRE_UNITA non si legge: la guardia non sta misurando niente"
else
    ok 1 "il runtime conta, oltre al runtime: ${nomi[*]}"
fi

# 3. Ognuna dev'essere fra quelle che l'installer può scrivere nel segno.
blocco=$(sed -n '/UNITA_SCELTE=/,/unita-scelte.json/p' "$INST")
for n in "${nomi[@]}"; do
    if grep -q "$n" <<<"$blocco"; then
        ok 1 "«$n» l'installer la può scrivere nel segno"
    else
        ok 0 "«$n» il runtime la conta ma l'installer non la scrive mai: nessuno controlla più la sua versione"
    fi
done

# 4. E il runtime stesso dev'esserci sempre, senza condizioni.
rt=$(grep -oP 'const RUNTIME: &str = "\K[^"]+' "$RUST")
grep -q "UNITA_SCELTE='\"$rt\"'" "$INST" \
  && ok 1 "«$rt» c'è sempre nel segno, senza condizioni" \
  || ok 0 "«$rt» non è il punto di partenza del segno: un segno senza il runtime non vuol dire niente"

[ "$male" -eq 0 ] && echo -e "\033[32minstaller e runtime nominano le stesse unità.\033[0m"
exit "$male"
