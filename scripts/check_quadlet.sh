#!/usr/bin/env bash
#
# La versione dei quadlet: ogni cambio di un quadlet alza il numero.
#
# PERCHÉ ESISTE
#
# `podman auto-update` sostituisce l'immagine, non i quadlet sul pannello.
# Dal 02-10-2026 (docs/archive/2026-10-02-quadlet-che-viaggia.md) i quadlet
# viaggiano dentro l'immagine, e il pannello confronta il numero `[quadlet N]`
# della `Description` di quelli installati con quello dei quadlet dell'immagine
# che gira: se è più basso, dice «configurazione del servizio da aggiornare» e la
# sa riscrivere. Funziona solo se ogni cambio di un quadlet alza il numero — un
# cambio dimenticato è una riga che non arriva mai, senza che nessuno lo sappia:
# è il difetto da cui il piano è nato (Timezone=local, il bus utente, la cartella
# dati del viewer, arrivati solo reinstallando).
#
# Controlla:
#   1. i due quadlet hanno `[quadlet N]` nella Description, con lo STESSO N;
#   2. il contenuto di ciascuno coincide con l'hash registrato per quel numero in
#      tests/fixtures/quadlet-versioni.json — un file cambiato con lo stesso
#      numero è rosso;
#   3. l'immagine li porta con sé (Containerfile) e l'installer sa riscriverli
#      da soli (`--solo-unita`);
#   4. accanto viaggia `immagini.sh` (stato, pulizia e ritorno dopo un
#      aggiornamento, 03-10-2026), provato su un pannello finto.
#
# Uso:
#   ./scripts/check_quadlet.sh            controlla
#   ./scripts/check_quadlet.sh --aggiorna  dopo aver alzato N: registra i nuovi hash
set -uo pipefail
cd "$(dirname "$0")/.."

exec python3 - "${1:-}" <<'PY'
import hashlib, json, re, subprocess, sys

FILE = ["deploy/container/sws-runtime.container", "deploy/container/sws-lvgl-viewer.container"]
FIXTURE = "tests/fixtures/quadlet-versioni.json"
aggiorna = sys.argv[1] == "--aggiorna"
ESITO = 0
def ok(m):  print("  \033[32m✓\033[0m " + m)
def ko(m):
    global ESITO
    print("  \033[31m✗\033[0m " + m); ESITO = 1

print("\n\033[1mLa versione dei quadlet\033[0m")
versioni, hash_ = {}, {}
for f in FILE:
    testo = open(f, encoding="utf-8").read()
    m = re.search(r"^Description=.*\[quadlet (\d+)\]\s*$", testo, re.M)
    if not m:
        ko(f"{f}: manca `[quadlet N]` nella Description")
        continue
    versioni[f] = int(m.group(1))
    hash_[f] = hashlib.sha256(testo.encode()).hexdigest()

if len(set(versioni.values())) > 1:
    ko(f"i due quadlet hanno numeri diversi: {versioni}")
elif versioni:
    ok(f"stesso numero sui due quadlet: {next(iter(versioni.values()))}")

if aggiorna and ESITO == 0:
    # Non si registra un file cambiato con lo stesso numero: sarebbe proprio
    # il cambio dimenticato che questa guardia esiste per vedere.
    try:
        vecchio = json.load(open(FIXTURE, encoding="utf-8"))["quadlet"]
    except FileNotFoundError:
        vecchio = {}
    for f in FILE:
        r = vecchio.get(f)
        if r and r["sha256"] != hash_[f] and r["versione"] == versioni[f]:
            ko(f"{f}: cambiato ma il numero è ancora {versioni[f]} — alza prima `[quadlet N]` in entrambi")
    if ESITO:
        sys.exit(ESITO)
    dati = {"_perche": "Hash dei quadlet per numero di versione: scripts/check_quadlet.sh. Si rigenera con --aggiorna DOPO aver alzato il numero.",
            "quadlet": {f: {"versione": versioni[f], "sha256": hash_[f]} for f in FILE}}
    open(FIXTURE, "w", encoding="utf-8").write(json.dumps(dati, indent=2, ensure_ascii=False) + "\n")
    ok(f"{FIXTURE} aggiornata")
    sys.exit(0)

try:
    reg = json.load(open(FIXTURE, encoding="utf-8"))["quadlet"]
except FileNotFoundError:
    reg = {}
    ko(f"manca {FIXTURE}: lancia ./scripts/check_quadlet.sh --aggiorna")
for f in versioni:
    r = reg.get(f)
    if not r:
        ko(f"{f}: non registrato in {FIXTURE}")
    elif r["sha256"] != hash_[f]:
        if r["versione"] == versioni[f]:
            ko(f"{f}: cambiato ma il numero è ancora {versioni[f]} — alza `[quadlet N]` in ENTRAMBI i quadlet, "
               f"poi ./scripts/check_quadlet.sh --aggiorna")
        else:
            ko(f"{f}: numero alzato a {versioni[f]} ma la fixture dice {r['versione']} — ./scripts/check_quadlet.sh --aggiorna")
    else:
        ok(f"{f}: contenuto registrato per la versione {versioni[f]}")

for cf in ["deploy/container/Containerfile.aarch64", "deploy/container/Containerfile.x86_64"]:
    t = open(cf, encoding="utf-8").read()
    if "/usr/share/sws/quadlet" in t:
        ok(f"{cf}: l'immagine porta i quadlet")
    else:
        ko(f"{cf}: non copia i quadlet in /usr/share/sws/quadlet")
inst = open("deploy/container/install-container.sh", encoding="utf-8").read()
if "--solo-unita" in inst:
    ok("install-container.sh sa riscrivere solo le unità (--solo-unita)")
    r = subprocess.run(["bash", "tests/shell/solo-unita.sh"], capture_output=True, text=True)
    for riga in r.stdout.strip().splitlines():
        print("  " + riga.strip() if not riga.startswith("  ") else riga)
    if r.returncode != 0:
        ko("--solo-unita su un pannello finto: vedi sopra")
else:
    ko("install-container.sh non ha --solo-unita")

# Lo script delle immagini (03-10-2026): viaggia accanto ai quadlet, e la sua
# pulizia e il suo ritorno si provano su un pannello finto.
for b in ["scripts/build_container.sh", "scripts/build_container_x86_64.sh"]:
    if "deploy/container/immagini.sh" in open(b, encoding="utf-8").read():
        ok(f"{b}: l'immagine porta immagini.sh")
    else:
        ko(f"{b}: non mette immagini.sh in /usr/share/sws/quadlet")
r = subprocess.run(["bash", "tests/shell/immagini.sh"], capture_output=True, text=True)
for riga in r.stdout.strip().splitlines():
    print(riga if riga.startswith("  ") else "  " + riga.strip())
if r.returncode != 0:
    ko("immagini.sh su un pannello finto: vedi sopra")

print()
print("\033[32mquadlet: versione coerente.\033[0m" if ESITO == 0 else "\033[31mquadlet: la versione non dice il vero.\033[0m")
sys.exit(ESITO)
PY
