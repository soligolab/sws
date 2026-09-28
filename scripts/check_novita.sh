#!/usr/bin/env bash
# Le Novità che finiscono nell'immagine (NOVITA.yaml → etichette), in due lingue.
#
# Sostituisce check_changelog_etichetta.sh (28-09-2026): dall'immagine non esce
# più una sezione del CHANGELOG ma le voci brevi di NOVITA.yaml (decisioni 55-58
# del piano dell'aggiornamento). Il pannello le mostra **prima di aggiornare**:
# una voce senza l'inglese, o una versione senza Novità, si scopre qui e non
# davanti a un cliente.
#
# Controlla il file vero (due lingue, lunghezza, la versione dichiarata ha la sua
# voce) e, su un file finto, che una -rc legga la release a cui porta e che gli
# avvisi di compatibilità escano da soli.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

verdi=0; rossi=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; verdi=$((verdi+1)); }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; rossi=$((rossi+1)); }
printf '\033[1m── check_novita ──\033[0m\n'

VERSIONE="$(grep -m1 -oE '^version = "[^"]+"' sws-runtime/Cargo.toml | cut -d'"' -f2)"
if out="$(python3 scripts/novita.py --controlla "$VERSIONE" 2>&1)"; then
  ok "NOVITA.yaml: due lingue, voci brevi, e la $VERSIONE ha le sue Novità"
else
  no "NOVITA.yaml non va:"; printf '%s\n' "$out" | sed 's/^/      /'
fi

FINTO="$(mktemp)"; trap 'rm -f "$FINTO"' EXIT
cat > "$FINTO" <<'YAML'
versioni:
  - versione: "3.0.0"
    voci:
      - {it: "una cosa nuova", en: "a new thing"}
    compatibilita:
      - {it: "i progetti vanno riaperti", en: "projects must be reopened"}
  - versione: "2.0.0"
    voci:
      - {it: "una cosa vecchia", en: "an old thing"}
YAML
leggi() { python3 -c "import sys; sys.path.insert(0,'scripts'); import novita as n; from pathlib import Path; v=n.carica(Path('$FINTO')); print(n.testo(v, '$1', '$2', $3))"; }
[ "$(leggi 3.0.0-rc.4 en False)" = "- a new thing" ] && ok "una -rc legge la release a cui porta, nella lingua chiesta" || no "una -rc non legge la sua release"
[ "$(leggi 2.0.0 it False)" = "- una cosa vecchia" ] && ok "una release legge la sua voce" || no "una release non legge la sua voce"
[ "$(leggi 3.0.0 it True)" = "- i progetti vanno riaperti" ] && ok "gli avvisi di compatibilità escono da soli" || no "gli avvisi di compatibilità si mescolano al resto"

# La guardia deve accorgersi di una lingua mancante.
sed -i 's/, en: "a new thing"//' "$FINTO"
if python3 -c "import sys; sys.path.insert(0,'scripts'); import novita as n; from pathlib import Path; sys.exit(1 if n.controlla(n.carica(Path('$FINTO')), None) else 0)"; then
  no "una voce senza inglese passa il controllo"
else
  ok "una voce senza inglese non passa"
fi

echo
[ "$rossi" -eq 0 ] && { printf '\033[32mNovità: tutto verde (%d).\033[0m\n' "$verdi"; exit 0; }
printf '\033[31mNovità: %d rossi.\033[0m\n' "$rossi"; exit 1
