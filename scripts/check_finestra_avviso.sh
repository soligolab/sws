#!/usr/bin/env bash
#
# I pop-up del browser (`alert`, `confirm`, `prompt`) non tornano.
#
# PERCHÉ ESISTE
#
# Il 04-11-2026 il maintainer: «ora per i pop-up usi quelli nativi del browser e
# sembrano errori, la gente diffida dei pop-up del browser». Al loro posto c'è la
# Finestra di avviso (`sws-editor/src/finestraAvviso/`: `avviso`, `conferma`,
# `chiedi`, `scegli`, `modulo`), piano docs/plans/2026-11-04-finestra-di-avviso.md.
# Quel giorno le chiamate erano 106 in 41 file; si tolgono in tre sessioni
# (F1, F2, F3). Questa guardia conta, file per file, quelle che restano: ogni
# file ha il suo tetto, il tetto può solo scendere, e un file senza tetto deve
# stare a zero. A fine F3 la tabella è vuota.
#
# Il conto è un'euristica sul testo, coi commenti tolti: `confirm(` e
# `window.confirm(`, non `oggetto.confirm(` né `onConfirm(`.
#
# Uso:  ./scripts/check_finestra_avviso.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - <<'PY'
import os, re, sys

# Il tetto di ogni file: le chiamate che può ancora avere. Si abbassa a mano
# quando un file ne perde, e la riga sparisce quando arriva a zero.
TETTI = {
    "src/canvas/SvgCanvas.tsx": 11,          # F3: il viewer
    "src/editor/LeftPanel.tsx": 10,          # F2
    "src/config/schede/RuntimeConnectionTab.tsx": 5,  # F2: deploy
    "src/editor/EditorShell.tsx": 4,         # F2 (il motore è già passato, 05-11)
    "src/config/schede/DatastoresTab.tsx": 4,  # F2
    "src/console/Pannelli.tsx": 4,           # F3: console
    "src/config/schede/DevicesTab.tsx": 3,   # F2: deploy
    "src/config/schede/GitTab.tsx": 3,       # F2
    "src/store/index.ts": 3,                 # F2: deploy
    "src/App.tsx": 2,                        # F2: deploy
    "src/boot/AggiornamentoRuntime.tsx": 2,  # F2: deploy
    "src/editor/CampoTestoTradotto.tsx": 2,  # F2
    "src/boot/FinestraAggiornamento.tsx": 1, # F2: deploy
    "src/components/BannerProvaGit.tsx": 1,  # F2
    "src/config/schede/AlarmsTab.tsx": 1,    # F2
    "src/config/sorgenti/MqttSourceCard.tsx": 1,  # F2
    "src/console/Aziende.tsx": 1,            # F3: console
    "src/console/Persone.tsx": 1,            # F3: console
    "src/console/Risorse.tsx": 1,            # F3: console
    "src/cornici/ProprietaCornice.tsx": 1,   # F2
    "src/deployServeAdmin.ts": 1,            # F2: deploy
    "src/editor/CampoSfondoArea.tsx": 1,     # F2
    "src/faceplate/ProprietaFaceplate.tsx": 1,  # F2
    "src/planimetrie/PlanimetriaEditor.tsx": 1, # F2
}

pop = re.compile(r"(?<![\w.$])(?:window\.)?(confirm|alert|prompt)\s*\(")
conti = {}
for radice, _, file in os.walk("sws-editor/src"):
    for f in file:
        if not f.endswith((".ts", ".tsx")):
            continue
        p = os.path.join(radice, f)
        s = open(p, encoding="utf-8").read()
        s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
        s = re.sub(r"(^|[^:])//.*", r"\1", s)
        n = len(pop.findall(s))
        if n:
            conti[p[len("sws-editor/"):]] = n

rossi = []
for p, n in sorted(conti.items()):
    tetto = TETTI.get(p, 0)
    if n > tetto:
        rossi.append(f"{p}: {n} pop-up del browser, tetto {tetto} — usa la Finestra di avviso (src/finestraAvviso/)")
for p, tetto in sorted(TETTI.items()):
    n = conti.get(p, 0)
    if n < tetto:
        rossi.append(f"{p}: {n} pop-up, tetto {tetto} — abbassa il tetto in {sys.argv[0] if len(sys.argv) > 1 else 'scripts/check_finestra_avviso.sh'}")

tot = sum(conti.values())
if rossi:
    for r in rossi:
        print(f"  \033[31m✗\033[0m {r}")
    print(f"\033[31mFinestra di avviso: {len(rossi)} problemi ({tot} pop-up del browser restano).\033[0m")
    sys.exit(1)
print(f"\033[32mFinestra di avviso: {tot} pop-up del browser restano, ognuno sotto il suo tetto.\033[0m")
PY
