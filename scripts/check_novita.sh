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

# Entry limit: none while the declared version is an rc of that block; back at
# the final release (maintainer's rule, 2026-11-20).
python3 - "$FINTO" <<'PY' && ok "più di 15 voci passano finché si è in rc, e fermano la release ufficiale" || no "il limite delle voci non segue rc/release"
import sys; sys.path.insert(0, "scripts")
from pathlib import Path
import novita as n
v = n.carica(Path(sys.argv[1]))
v[0]["voci"] = [{"it": f"voce {i}", "en": f"entry {i}"} for i in range(n.MAX_VOCI + 1)]
rc = [p for p in n.controlla(v, "3.0.0-rc.2") if "al massimo" in p]
final = [p for p in n.controlla(v, "3.0.0") if "al massimo" in p]
other_rc = [p for p in n.controlla(v, "4.0.0-rc.1") if "al massimo" in p]
sys.exit(0 if not rc and final and other_rc else 1)
PY

# With the tags known (22-11-2026): a block still being stabilised on
# release/X.Y has no limit while main declares the next dev; once tagged, it has.
python3 - "$FINTO" <<'PY' && ok "un blocco non ancora rilasciato non ha limite mentre main è sulla dev successiva" || no "il limite non segue i tag delle release"
import sys; sys.path.insert(0, "scripts")
from pathlib import Path
import novita as n
v = n.carica(Path(sys.argv[1]))
v[0]["voci"] = [{"it": f"voce {i}", "en": f"entry {i}"} for i in range(n.MAX_VOCI + 1)]
stabilising = [p for p in n.controlla(v, "4.0.0-dev.0", {"2.0.0"}) if "al massimo" in p]
released = [p for p in n.controlla(v, "4.0.0-dev.0", {"2.0.0", "3.0.0"}) if "al massimo" in p]
final = [p for p in n.controlla(v, "3.0.0", {"2.0.0"}) if "al massimo" in p]
dev_without_block = [p for p in n.controlla(v, "4.0.0-dev.0", {"2.0.0"}) if "non ha Novità" in p]
rc_without_block = [p for p in n.controlla(v, "4.0.0-rc.1", {"2.0.0"}) if "non ha Novità" in p]
sys.exit(0 if not stabilising and released and final and not dev_without_block and rc_without_block else 1)
PY

echo
[ "$rossi" -eq 0 ] && { printf '\033[32mNovità: tutto verde (%d).\033[0m\n' "$verdi"; exit 0; }
printf '\033[31mNovità: %d rossi.\033[0m\n' "$rossi"; exit 1
