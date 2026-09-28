#!/usr/bin/env bash
# L'estrazione del changelog che finisce nell'etichetta dell'immagine.
#
# Il runtime mostra queste righe **prima** di aggiornare un pannello
# (decisioni 42-43): se l'estrazione sbaglia sezione, chi guarda legge le
# novità di un'altra versione e decide su quelle. Gli avvisi di
# compatibilità sono la parte che non si deve perdere saltando versioni,
# quindi hanno un controllo loro.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

verdi=0; rossi=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; verdi=$((verdi+1)); }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; rossi=$((rossi+1)); }

printf '\033[1m── check_changelog_etichetta ──\033[0m\n'

FINTO="$(mktemp)"; trap 'rm -f "$FINTO"' EXIT
cat > "$FINTO" <<'MD'
# Changelog

## [Unreleased]

### Added
- una cosa nuova

### ⚠ Compatibilità
- i progetti vecchi vanno riaperti e salvati

## [2.11.0] — 2026-09-21

### Fixed
- una cosa vecchia
MD

sez_unrel="$(python3 scripts/changelog_sezione.py 2.12.0-rc.3 "$FINTO")"
case "$sez_unrel" in
  *"una cosa nuova"*) case "$sez_unrel" in
      *"una cosa vecchia"*) no "una -rc legge [Unreleased] ma si porta dietro la versione dopo" ;;
      *) ok "una -rc legge [Unreleased], e si ferma alla versione dopo" ;;
    esac ;;
  *) no "una -rc non ha letto [Unreleased]" ;;
esac

sez_rel="$(python3 scripts/changelog_sezione.py 2.11.0 "$FINTO")"
case "$sez_rel" in
  *"una cosa vecchia"*) ok "una release legge la sua sezione" ;;
  *) no "una release non ha letto la sua sezione" ;;
esac

compat="$(python3 scripts/changelog_sezione.py 2.12.0-rc.3 --compat "$FINTO")"
case "$compat" in
  *"vanno riaperti"*) case "$compat" in
      *"una cosa nuova"*) no "gli avvisi di compatibilità si portano dietro il resto della sezione" ;;
      *) ok "gli avvisi di compatibilità escono da soli" ;;
    esac ;;
  *) no "gli avvisi di compatibilità non si trovano" ;;
esac

# Una versione che nel changelog non c'è: la build non si ferma.
vuota="$(python3 scripts/changelog_sezione.py 9.9.9 "$FINTO")"
[ -z "$vuota" ] && ok "una versione senza sezione dà stringa vuota, non un errore" \
                || no "una versione senza sezione avrebbe dovuto dare vuoto"

# E il CHANGELOG vero: la versione dichiarata deve avere qualcosa da dire.
VERS="$(grep -m1 -oE '^version = "[^"]+"' sws-runtime/Cargo.toml | cut -d'"' -f2)"
reale="$(python3 scripts/changelog_sezione.py "$VERS" CHANGELOG.md)"
[ -n "$reale" ] && ok "la versione dichiarata ($VERS) ha una sezione non vuota" \
                || no "la versione dichiarata ($VERS) non ha niente nel CHANGELOG"

# ── Il formato degli avvisi (decisione 43) ───────────────────────────────────
#
# Il titolo dev'essere esattamente «### ⚠ Compatibilità»: l'estrazione lo cerca
# così, e una variante — «### Compatibilita», «#### ⚠ Compatibilità», il
# simbolo mancante — non verrebbe letta e l'avviso non arriverebbe a chi
# aggiorna. Un avviso che non compare è peggio di un avviso assente: chi
# scrive crede di averlo dato.
varianti="$(grep -nE '^#+ *.{0,3}[Cc]ompatibilit' CHANGELOG.md | grep -v '^[0-9]*:### ⚠ Compatibilità$' || true)"
if [ -z "$varianti" ]; then
  ok "nessuna intestazione di compatibilità scritta in un modo che l'estrazione non legge"
else
  no "intestazioni di compatibilità fuori formato (atteso «### ⚠ Compatibilità»):"
  printf '      %s\n' "$varianti" | head -5
fi

printf '\033[32mchangelog nell'\''etichetta: %d/%d controlli verdi.\033[0m\n' "$verdi" "$((verdi+rossi))"
[ "$rossi" -eq 0 ]
