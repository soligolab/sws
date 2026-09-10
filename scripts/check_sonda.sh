#!/usr/bin/env bash
# La sonda del dispositivo (Q52) deve girare con `sh -s` su qualunque Linux e
# stampare solo fatti.
#
# `deploy/container/sonda-dispositivo.sh` viaggia via ssh su stdin a `sh -s`:
# se un giorno ci finisse un bashismo, o un comando che legge stdin, sul
# dispositivo si vedrebbe solo «sonda interrotta» — e il PC di sviluppo, che ha
# bash, non se ne accorgerebbe mai. Qui la si esegue **su questo PC** con `sh`
# (dash su Debian: un POSIX severo), sia come file sia da stdin come farà ssh,
# e si pretende la forma dell'uscita. Il giudizio sui fatti è in Rust ed è
# coperto da `cargo test -p sws-web sonda::`.
#
# Uso:  ./scripts/check_sonda.sh    (esce != 0 se una regola cade)
set -uo pipefail
cd "$(dirname "$0")/.."

SONDA=deploy/container/sonda-dispositivo.sh
rosso=0
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
male() { echo -e "  \033[31m✗\033[0m $*"; rosso=1; }

[ -f "$SONDA" ] || { male "$SONDA non esiste"; echo -e "\033[31msonda: manca lo script.\033[0m"; exit 1; }

# 1. sintassi, con sh (POSIX) e bash
sh -n "$SONDA"   && ok "sh -n: sintassi POSIX valida"   || male "sh -n rifiuta lo script"
bash -n "$SONDA" && ok "bash -n: sintassi valida"        || male "bash -n rifiuta lo script"
head -1 "$SONDA" | grep -qx '#!/bin/sh' && ok "shebang #!/bin/sh" || male "lo shebang non è #!/bin/sh"
if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -s sh "$SONDA" && ok "shellcheck -s sh pulito" || male "shellcheck -s sh segnala qualcosa"
else
    ok "shellcheck assente: saltato (sh -n e l'esecuzione coprono il resto)"
fi

# 2. esecuzione come file e da stdin: stesso numero di righe, exit 0, solo SONDA
out_file=$(sh "$SONDA" 2>/tmp/sonda-stderr.$$); rc_file=$?
out_stdin=$(sh -s < "$SONDA" 2>/dev/null); rc_stdin=$?
[ "$rc_file" -eq 0 ]  && ok "esce 0 eseguita come file"  || male "exit $rc_file eseguita come file"
[ "$rc_stdin" -eq 0 ] && ok "esce 0 eseguita da stdin (come via ssh)" || male "exit $rc_stdin da stdin"
n_file=$(printf '%s\n' "$out_file" | grep -c .)
n_stdin=$(printf '%s\n' "$out_stdin" | grep -c .)
[ "$n_file" -eq "$n_stdin" ] && ok "stesse righe da file e da stdin ($n_file): nessun comando legge stdin" \
                              || male "righe diverse: file $n_file, stdin $n_stdin — qualcosa consuma lo script"
if printf '%s\n' "$out_file" | grep -qv '^SONDA [a-z_]*='; then
    male "righe che non sono «SONDA chiave=valore»:"; printf '%s\n' "$out_file" | grep -v '^SONDA [a-z_]*=' | sed 's/^/      /'
else
    ok "ogni riga è «SONDA chiave=valore»"
fi
for k in sonda_versione hostname arch utente uid podman spazio_kb subuid subgid linger systemd_user data_path data_stato container_sws fine; do
    printf '%s\n' "$out_file" | grep -q "^SONDA $k=" || male "manca il fatto «$k»"
done
printf '%s\n' "$out_file" | grep -q '^SONDA fine=1$' && ok "arriva in fondo (fine=1)" || male "non arriva a fine=1"
# La cartella dati arriva come $1 (l'editor passa quella del modulo): deve
# comparire nell'uscita, e per una cartella inesistente non creabile lo stato
# deve dirlo.
out_arg=$(sh -s -- /nonesiste/sws < "$SONDA" 2>/dev/null)
printf '%s\n' "$out_arg" | grep -q '^SONDA data_path=/nonesiste/sws$' && ok "la cartella dati passata come argomento è quella controllata" \
                                                                      || male "la cartella dati passata come argomento non viene usata"
if [ "$(id -u)" -eq 0 ]; then
    ok "eseguita da root: per root ogni cartella è creabile, il controllo sullo stato si salta"
else
    printf '%s\n' "$out_arg" | grep -q '^SONDA data_stato=assente-non-creabile$' && ok "una cartella impossibile risulta assente-non-creabile" \
                                                                                 || male "stato inatteso per una cartella impossibile: $(printf '%s\n' "$out_arg" | grep '^SONDA data_stato=')"
fi
[ -s /tmp/sonda-stderr.$$ ] && { male "scrive su stderr:"; sed 's/^/      /' /tmp/sonda-stderr.$$; } || ok "stderr vuoto"
rm -f /tmp/sonda-stderr.$$

if [ "$rosso" -ne 0 ]; then echo -e "\033[31msonda: qualcosa non va.\033[0m"; exit 1; fi
echo -e "\033[32msonda del dispositivo: tutto verde.\033[0m"
