#!/usr/bin/env bash
# Nessuna password nel browser.
#
# Fino al 2026-09-09 l'IDE salvava in `localStorage`, in chiaro, la password del
# runtime remoto (`sws.runtime.targetPass`), quelle dei dispositivi registrati
# (`sws.saved-devices`, campo `pass`) e quelle SSH del modale «Installa runtime»
# (`sws.deploy.<host>`). `localStorage` è leggibile da qualunque script della
# stessa origine, resta su disco dopo la chiusura del browser e finisce nei
# backup del profilo. Tolte tutte e tre (Q48 e la sessione dopo); la regola vale
# da qui in avanti e questa guardia la fa rispettare: una password vive nello
# stato di un componente o in una mappa in memoria, e sparisce al reload.
#
# Cosa controlla, per grep sui sorgenti dell'editor (senza i test):
#   1. nessuna scrittura in localStorage/sessionStorage la cui riga nomini una
#      password (pass, password, Pass, PASS, pwd) — chiave o valore;
#   2. nessuna costante-chiave di storage che nomini una password;
#   3. `SavedDevice` non ha un campo `pass`;
#   4. la pulizia delle password lasciate dalle versioni vecchie è chiamata
#      all'avvio (`dimenticaPasswordLegacy` in `avvio.tsx`).
#
# Uso:  ./scripts/check_password_browser.sh    (esce != 0 se una regola cade)
set -uo pipefail
cd "$(dirname "$0")/.."

SRC=sws-editor/src
rosso=0
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
male() { echo -e "  \033[31m✗\033[0m $*"; rosso=1; }

# Sorgenti, senza test: i test devono poter scrivere password finte per provare
# la pulizia.
sorgenti() { grep -rl --include='*.ts' --include='*.tsx' -e . "$SRC" | grep -v '\.test\.'; }

# 1. scritture in storage che nominano una password
trovate=$(sorgenti | xargs grep -nE '(localStorage|sessionStorage)\.setItem\(' \
  | grep -iE 'pass|pwd' | grep -v 'passwordNelBrowser.ts' || true)
if [ -z "$trovate" ]; then
  ok "nessun setItem in localStorage/sessionStorage che nomini una password"
else
  male "una password sta finendo nello storage del browser:"; echo "$trovate" | sed 's/^/      /'
fi

# 2. costanti-chiave di storage che nominano una password
trovate=$(sorgenti | xargs grep -nE '^\s*(const|let)\s+\w*(PASS|Pass|pass|PWD|Pwd|pwd)\w*(_KEY|Key)\s*=' || true)
if [ -z "$trovate" ]; then
  ok "nessuna costante-chiave di storage per una password"
else
  male "una chiave di storage per una password è dichiarata:"; echo "$trovate" | sed 's/^/      /'
fi

# 3. SavedDevice senza pass
blocco=$(sed -n '/^export interface SavedDevice {/,/^}/p' "$SRC/types/index.ts")
if [ -z "$blocco" ]; then
  male "non trovo \`export interface SavedDevice\` in $SRC/types/index.ts: la guardia non sta guardando niente"
elif echo "$blocco" | grep -qE '^\s*pass(word)?\??:'; then
  male "SavedDevice ha di nuovo un campo password — quella lista vive in localStorage"
else
  ok "SavedDevice non porta la password"
fi

# 4. la pulizia è chiamata all'avvio
if grep -q 'dimenticaPasswordLegacy()' "$SRC/avvio.tsx"; then
  ok "la pulizia delle password vecchie gira all'avvio"
else
  male "avvio.tsx non chiama dimenticaPasswordLegacy(): le password delle versioni vecchie restano nel profilo"
fi

if [ "$rosso" -ne 0 ]; then
  echo -e "\033[31mpassword nel browser: qualcosa è tornato.\033[0m"; exit 1
fi
echo -e "\033[32mpassword nel browser: niente.\033[0m"
