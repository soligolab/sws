#!/usr/bin/env bash
#
# Le unit systemd che spediamo hanno una trappola nota dentro?
#
# PERCHÉ ESISTE
#
# `sws-display.path` univa `PathChanged=` e `PathExists=` sullo stesso file,
# con `sws-display.service` `oneshot` e `RemainAfterExit=no`. Sembra una doppia
# rete: in realtà `PathExists` è una condizione **di livello**, non di fronte —
# appena il servizio finisce, il file esiste ancora, la condizione è ancora vera
# e systemd rilancia. Subito, in cerchio, finché non scatta il limite di
# riavvii; poi la unit resta `failed` per sempre.
#
# Sul WP630, il 2026-08-31, era failed da dieci secondi dopo l'accensione. Non
# se n'era accorto nessuno: quelle cinque volte il servizio aveva funzionato
# benissimo, e a mancare era solo la commutazione dopo un caricamento — cioè
# l'unica cosa per cui la unit esiste.
#
# Controlla:
#   1. la trappola di livello: `PathExists=` su un file che il servizio non
#      cancella, con `RemainAfterExit=no` — il ciclo garantito;
#   2. un `.path` che punta a una unit inesistente;
#   3. `ExecStart=` con un percorso relativo (systemd lo rifiuta al caricamento,
#      e l'errore si vede solo nel journal del dispositivo).
#
# Uso:  ./scripts/check_systemd_units.sh
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import glob, os, re, sys

root = sys.argv[1]
D = f"{root}/deploy/container"

fail = []
def problema(msg, spiega=None):
    print(f"  \033[31m✗\033[0m {msg}")
    if spiega:
        for r in spiega.splitlines():
            print(f"      {r}")
    fail.append(msg)

def direttive(testo):
    """Le direttive `Chiave=valore`, ignorando commenti e righe vuote."""
    out = []
    for riga in testo.splitlines():
        r = riga.strip()
        if not r or r.startswith("#") or r.startswith(";") or r.startswith("["):
            continue
        if "=" in r:
            k, v = r.split("=", 1)
            out.append((k.strip(), v.strip()))
    return out

unita = sorted(glob.glob(f"{D}/*.path") + glob.glob(f"{D}/*.service") + glob.glob(f"{D}/*.container"))
print(f"\033[1m{len(unita)} unit systemd in deploy/container\033[0m\n")

testi = {os.path.basename(p): open(p).read() for p in unita}

for nome, testo in testi.items():
    d = direttive(testo)
    chiavi = {k: v for k, v in d}

    # 1. la trappola di livello
    if nome.endswith(".path") and any(k == "PathExists" for k, _ in d):
        bersaglio = chiavi.get("PathExists", "")
        unit_svc = chiavi.get("Unit") or nome[:-5] + ".service"
        svc = testi.get(unit_svc, "")
        cancella = bersaglio and (f"rm {bersaglio}" in svc or f"rm -f {bersaglio}" in svc)
        resta = any(k == "RemainAfterExit" and v.lower() in ("yes", "true", "1")
                    for k, v in direttive(svc))
        if not cancella and not resta:
            problema(
                f"{nome}: `PathExists={bersaglio}` con `{unit_svc}` che non cancella il file "
                f"e non ha `RemainAfterExit=yes`",
                "PathExists è una condizione di LIVELLO: finita la unit il file esiste\n"
                "ancora, la condizione è ancora vera, systemd rilancia. In cerchio,\n"
                "finché scatta il limite di riavvii — poi la unit resta failed.\n"
                "`PathChanged=` da solo scatta anche alla prima creazione del file\n"
                "(provato sul WP630 il 2026-08-31): quasi sempre è tutto ciò che serve.")

    # 2. un .path che punta a una unit che non spediamo
    if nome.endswith(".path"):
        bersaglio_unit = chiavi.get("Unit", nome[:-5] + ".service")
        if bersaglio_unit not in testi:
            problema(f"{nome}: `Unit={bersaglio_unit}` non è fra le unit spedite")

    # 3. ExecStart relativo
    for k, v in d:
        if k.startswith("ExecStart") and v and not v.lstrip("-+!@").startswith("/"):
            problema(f"{nome}: `{k}={v}` non è un percorso assoluto — systemd rifiuta la unit")

if fail:
    print()
    print(f"\033[31m{len(fail)} problemi nelle unit.\033[0m")
    sys.exit(1)

print(f"  \033[32m✓\033[0m nessuna condizione di livello che possa ciclare")
print(f"  \033[32m✓\033[0m ogni `.path` punta a una unit che spediamo")
print(f"  \033[32m✓\033[0m ogni `ExecStart=` è un percorso assoluto")
print()
print("\033[32mLe unit systemd non hanno trappole note.\033[0m")
PY
