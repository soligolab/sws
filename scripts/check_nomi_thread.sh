#!/usr/bin/env bash
#
# I nomi dei thread stanno in 15 caratteri (27-10-2026).
#
# PERCHÉ ESISTE
#
# `TASK_COMM_LEN` è 16 col terminatore: quindici caratteri utili, e il kernel
# **tronca in silenzio**. Non c'è errore, non c'è avviso: in `htop` compare un
# nome tagliato, e due thread con lo stesso prefisso diventano la stessa riga.
#
# Il 27-10-2026, guardando htop sul WP630 subito dopo aver dato un nome a ogni
# lavoro, il maintainer ha visto `sws-aggiornamen`. Il nome vero era
# `sws-aggiornamento`, diciassette caratteri, scritto mesi prima. Il limite era
# documentato in `sws-core/src/motori.rs` e c'era pure un test, ma quel test
# elencava i nomi **a mano**: i nomi vecchi non li guardava nessuno.
#
# COSA CONTROLLA
#
# Ogni nome di thread letterale nel Rust del workspace:
#   - `std::thread::Builder::new().name("...")`
#   - `.thread_name("...")` dei runtime tokio
#   - i nomi passati a `sws_core::motori::motore("...", ...)`
#
# Uso:  ./scripts/check_nomi_thread.sh      (esce != 0 se un nome sfora)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

printf '\033[1m── check_nomi_thread ──\033[0m\n'

if esito="$(python3 - <<'PY'
import re, pathlib, sys

MASSIMO = 15
SCHEMI = [
    re.compile(r'\.name\(\s*"([^"]*)"'),
    re.compile(r'\.thread_name\(\s*"([^"]*)"'),
    re.compile(r'motori::motore\(\s*"([^"]*)"'),
]

quanti = 0
lunghi = []
for f in sorted(pathlib.Path("sws-runtime/crates").rglob("*.rs")):
    for n, riga in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        for s in SCHEMI:
            for m in s.finditer(riga):
                nome = m.group(1)
                quanti += 1
                if len(nome) > MASSIMO:
                    lunghi.append(f"{f}:{n} «{nome}» è {len(nome)} caratteri: il kernel lo mostra «{nome[:MASSIMO]}»")

if lunghi:
    print("\n".join(lunghi))
    sys.exit(1)
print(f"{quanti} nomi di thread, tutti entro i {MASSIMO} caratteri di TASK_COMM_LEN")
PY
)"; then
    printf '  \033[32m✓\033[0m %s\n\n' "$esito"
    printf '\033[32mnomi dei thread: nessuno troncato dal kernel.\033[0m\n'
else
    while IFS= read -r l; do printf '  \033[31m✗\033[0m %s\n' "$l"; done <<< "$esito"
    echo
    printf '\033[31mnomi dei thread: qualcuno sfora i 15 caratteri.\033[0m\n'
    exit 1
fi
