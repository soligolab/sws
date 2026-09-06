#!/usr/bin/env bash
#
# Le domande aperte sono integre fra file vivo e archivio?
#
# PERCHÉ ESISTE
#
# Il 2026-09-06 `docs/OPEN_QUESTIONS.md` è stato diviso: le schede decise,
# realizzate e verificate sono andate in `docs/history/OPEN_QUESTIONS-chiuse.md`,
# le altre sono rimaste. Un'operazione così — spostare 21 blocchi su 41 con uno
# script — perde una scheda nel modo più silenzioso possibile: il file resta
# leggibile, i conti tornano quasi, e chi cerca «Q22» fra sei mesi trova il
# nulla. E `STATUS.md` cita i numeri di scheda in ~28 punti: un numero sparito è
# un rimando che mente.
#
# COSA PRETENDE
#
#   1. vivo + archivio contengono **ogni** numero da Q1 al massimo assegnato,
#      senza buchi e senza doppioni (i numeri non si riusano mai);
#   2. ogni `Q<n>` citato da STATUS.md, TESTING_GUIDE.md, CONTEXT.md e dai
#      `TODO(open-question)` del codice esiste in uno dei due file;
#   3. ogni scheda archiviata ha il timbro «Archiviata il … verificata sul
#      codice»: l'archivio è attendibile solo finché ci si entra così.
#
# Uso:  ./scripts/check_documenti.sh
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys, glob

root = sys.argv[1]
VIVO = f"{root}/docs/OPEN_QUESTIONS.md"
ARCH = f"{root}/docs/history/OPEN_QUESTIONS-chiuse.md"

def schede(path):
    testo = open(path, encoding="utf-8").read()
    return testo, [int(m) for m in re.findall(r"^## Q(\d+) ", testo, re.M)]

male = False
t_vivo, q_vivo = schede(VIVO)
try:
    t_arch, q_arch = schede(ARCH)
except FileNotFoundError:
    print(f"  \033[31m✗\033[0m manca {ARCH}: o l'archivio è stato spostato, o questa guardia")
    print( "      sta guardando un checkout precedente alla divisione del 2026-09-06.")
    sys.exit(1)

# 1 — nessun buco, nessun doppione
tutti = sorted(q_vivo + q_arch)
massimo = max(tutti)
doppi = sorted({n for n in tutti if tutti.count(n) > 1})
buchi = [n for n in range(1, massimo + 1) if n not in tutti]
if doppi:
    print(f"  \033[31m✗\033[0m schede in ENTRAMBI i file: {doppi} — una scheda vive in un posto solo")
    male = True
if buchi:
    print(f"  \033[31m✗\033[0m numeri mancanti: {buchi} su Q1..Q{massimo}")
    print( "      O una scheda è andata persa in uno spostamento, o un numero è stato saltato.")
    print( "      I numeri non si riusano e non si bucano: chi cerca Qn fra sei mesi deve trovarla.")
    male = True

# 2 — i rimandi risolvono
citazioni = set()
sorgenti = [f"{root}/STATUS.md", f"{root}/docs/TESTING_GUIDE.md", f"{root}/docs/CONTEXT.md"]
sorgenti += glob.glob(f"{root}/sws-runtime/crates/*/src/**/*.rs", recursive=True)
sorgenti += glob.glob(f"{root}/sws-editor/src/**/*.ts*", recursive=True)
for f in sorgenti:
    try:
        testo = open(f, encoding="utf-8").read()
    except OSError:
        continue
    if f.endswith((".rs", ".ts", ".tsx")):
        # nel codice contano solo i TODO(open-question), non ogni "Q8" di passaggio
        for m in re.finditer(r"TODO\(open-question\)[^\n]*?Q(\d+)", testo):
            citazioni.add((int(m.group(1)), f))
    else:
        for m in re.finditer(r"\bQ(\d\d?)\b", testo):
            citazioni.add((int(m.group(1)), f))
presenti = set(tutti)
morti = sorted({(n, f) for n, f in citazioni if n not in presenti})
if morti:
    print(f"  \033[31m✗\033[0m rimandi a schede che non esistono in nessuno dei due file:")
    for n, f in morti[:10]:
        print(f"      Q{n} citata in {f.replace(root + '/', '')}")
    male = True

# 3 — l'archivio è timbrato
timbri = len(re.findall(r"^> \*\*Archiviata il ", t_arch, re.M))
if timbri != len(q_arch):
    print(f"  \033[31m✗\033[0m {len(q_arch)} schede in archivio ma {timbri} timbri «Archiviata il …»")
    print( "      Una scheda senza timbro è entrata senza la verifica sul codice, che è il")
    print( "      patto che rende l'archivio attendibile.")
    male = True

if male:
    sys.exit(1)
print(f"  \033[32m✓\033[0m domande integre: {len(q_vivo)} vive + {len(q_arch)} archiviate = Q1..Q{massimo}, "
      f"senza buchi né doppioni; rimandi e timbri a posto")
PY
