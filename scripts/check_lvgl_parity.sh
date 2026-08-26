#!/usr/bin/env bash
#
# Verifica che il modello del viewer LVGL conosca tutti i campi che il mirror
# autorevole dichiara.
#
# PERCHÉ ESISTE
#
# `sws-web/src/synoptic.rs` è la definizione autorevole di un oggetto
# synottico; `sws-lvgl-viewer/src/model.rs` ne è il mirror lato pannello. Serde
# ignora in silenzio i campi che il mirror non dichiara: un campo aggiunto al
# web e dimenticato qui non produce alcun errore — produce un oggetto che sul
# pannello si disegna sbagliato, e nessuno lo collega alla modifica di settimane
# prima.
#
# È già successo, e in grande: la migrazione a `trend_tags[]` della 2.1.0 lasciò
# i trend LVGL a disegnare grafici vuoti per settimane. Il controllo che sarebbe
# servito è questo.
#
# COSA NON DICE
#
# Che un campo sia dichiarato non significa che venga disegnato. Sono due cose
# diverse: la prima la verifica questo script, la seconda si dichiara nel
# commento del campo in model.rs (`gap dichiarato`). Un campo dichiarato e non
# disegnato è un limite noto; un campo non dichiarato è un difetto silenzioso.
#
# Uso:
#   ./scripts/check_lvgl_parity.sh          elenca i campi mancanti, esce != 0
#   ./scripts/check_lvgl_parity.sh --stubs  stampa le righe Rust da incollare
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-check}"
exec python3 - "$MODE" <<'PY'
import re, sys

mode = sys.argv[1]
WEB = "sws-runtime/crates/sws-web/src/synoptic.rs"
LVGL = "sws-runtime/crates/sws-lvgl-viewer/src/model.rs"

def struct_body(path, name="SynopticObject"):
    s = open(path).read()
    m = re.search(r"pub struct %s \{(.*?)\n\}" % name, s, re.S)
    if not m:
        print("  ✗ struct %s non trovata in %s" % (name, path)); sys.exit(1)
    return m.group(1)

web_body, lvgl_body = struct_body(WEB), struct_body(LVGL)
web = re.findall(r"pub ([a-z_0-9]+):\s*([^,\n]+)", web_body)
have = set(re.findall(r"pub ([a-z_0-9]+)\s*:", lvgl_body))

missing = [(n, t.strip().rstrip(",")) for n, t in web if n not in have]
extra = sorted(have - {n for n, _ in web})

if mode == "--stubs":
    for n, t in missing:
        print("    pub %s: %s," % (n, t))
    sys.exit(0)

print("\n\033[1mParità dei campi fra il mirror autorevole e il modello LVGL\033[0m")
print("  autorevole (sws-web/src/synoptic.rs) : %d campi" % len(web))
print("  modello LVGL (model.rs)              : %d campi" % len(have))

ok = True
if missing:
    ok = False
    print("  \033[31m✗\033[0m %d campi dichiarati dal web e IGNORATI dal pannello:" % len(missing))
    for n, t in missing:
        print("      %-34s %s" % (n, t))
    print("      → serde li scarta in silenzio: l'oggetto si disegna sbagliato e nessuno")
    print("        lo collega alla modifica che li ha introdotti.")
    print("      → per gli abbozzi da incollare: ./scripts/check_lvgl_parity.sh --stubs")
else:
    print("  \033[32m✓\033[0m nessun campo del web è ignorato dal pannello")

if extra:
    ok = False
    print("  \033[31m✗\033[0m %d campi nel modello LVGL che il web non dichiara:" % len(extra))
    for n in extra:
        print("      %s" % n)
    print("      → o sono un residuo, o il web li ha rimossi e il mirror è rimasto indietro.")

print()
if not ok:
    print("\033[31mParità non raggiunta.\033[0m")
    sys.exit(1)
print("\033[32mIl modello LVGL conosce tutti i campi del mirror autorevole.\033[0m")
PY
