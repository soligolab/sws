#!/usr/bin/env bash
# Le intestazioni di sicurezza (C6, 17-10-2026): CSP, nosniff, referrer, HSTS in HTTPS,
# e i limiti alle richieste per indirizzo (limiti.rs), che stanno sugli stessi router.
#
# Uno strato che si toglie da un router non dà errori: le pagine continuano a
# funzionare, solo senza protezione. Qui si controlla che ogni router lo monti,
# che le pagine HTML dell'IDE non abbiano script in linea (con `script-src 'self'`
# il browser li bloccherebbe e l'IDE resterebbe bianco) e i test della politica.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

verdi=0; rossi=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; verdi=$((verdi+1)); }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; rossi=$((rossi+1)); }
printf '\033[1m── check_intestazioni ──\033[0m\n'

R=sws-runtime/crates/sws-web/src/router.rs
# `build` (IDE, viewer, gateway, porta stretta) e `build_runtime_inner` (viewer del pannello).
n="$(grep -c 'from_fn(crate::sicurezza_http::intestazioni)' "$R" || true)"
if [ "$n" -ge 2 ]; then ok "lo strato è montato su build e build_runtime_inner ($n)"
else no "lo strato è montato $n volte in router.rs, ne servono 2"; fi
# I limiti per indirizzo (C6, seconda metà): stessi due router.
n="$(grep -c 'crate::limiti::limita' "$R" || true)"
if [ "$n" -ge 2 ]; then ok "i limiti per indirizzo sono montati su build e build_runtime_inner ($n)"
else no "i limiti sono montati $n volte in router.rs, ne servono 2"; fi

for f in sws-editor/index*.html; do
  if python3 - "$f" <<'PY'
import re, sys
html = open(sys.argv[1]).read()
for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', html, re.S):
    if 'src=' not in m.group(1) and m.group(2).strip():
        sys.exit(1)
PY
  then ok "$f: nessuno script in linea"
  else no "$f: script in linea, la CSP lo blocca (spostalo in public/)"; fi
done

for modulo in sicurezza_http limiti; do
  if (cd sws-runtime && cargo test -q -p sws-web --lib "$modulo" >/dev/null 2>&1); then
    ok "test di $modulo"
  else
    no "cargo test -p sws-web $modulo è rosso"
  fi
done

echo
[ "$rossi" -eq 0 ] && { printf '\033[32mIntestazioni: tutto verde (%d).\033[0m\n' "$verdi"; exit 0; }
printf '\033[31mIntestazioni: %d rossi.\033[0m\n' "$rossi"; exit 1
