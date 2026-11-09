#!/usr/bin/env bash
#
# La fixture degli oggetti dei template è quella dei template?
#
# PERCHÉ ESISTE
#
# La guardia `sws-editor/tests/dipendenzeComplete.test.tsx` (piano «viewer
# leggero», 09-11-2026, passo 4) monta ogni oggetto dei template e controlla
# che legga dalla mappa dei valori solo i tag che `dipendenzeOggetto` dichiara:
# un tag non dichiarato il filtro di pagina non lo chiede, e l'oggetto resta
# fermo senza avvisi. I template sono YAML, e in `node_modules` un parser YAML
# non c'è (decisione 4.3 del piano: nessuna dipendenza npm nuova). Quindi gli
# oggetti arrivano al test da una fixture JSON scritta qui, con PyYAML come in
# `check_demo_templates.sh`.
#
# Una fixture che nessuno rigenera invecchia in silenzio: la guardia girerebbe
# su oggetti che i template non hanno più. Questo script la confronta coi
# template e fallisce se differisce.
#
# Cosa contiene, per `demo-items-web`, `demo-items-lvgl` (i 39 tipi),
# `grid-playground` e `montagna-rinnovabile`: le pagine (oggetti e sfondo da
# variabile), le cornici e i faceplate del progetto; più i faceplate di sistema
# di `sws-runtime/assets/faceplates/`.
#
# Uso:  ./scripts/check_fixture_template.sh              (controlla)
#       ./scripts/check_fixture_template.sh --aggiorna   (riscrive la fixture)
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" "${1:-}" <<'PY'
import glob, json, os, sys, yaml

root, modo = sys.argv[1], sys.argv[2]
FIXTURE = f"{root}/sws-editor/tests/fixtures/oggettiTemplate.json"
TEMPLATE = ["demo-items-web", "demo-items-lvgl", "grid-playground", "montagna-rinnovabile"]

def leggi(f):
    with open(f, encoding="utf-8") as h:
        return yaml.safe_load(h)

def nome(f):
    return os.path.basename(f)

def template(t):
    base = f"{root}/examples/templates/{t}"
    pagine = []
    for f in sorted(glob.glob(f"{base}/synoptics/*.yaml")):
        d = leggi(f)
        pagine.append({
            "file": nome(f),
            "background_tag": d.get("background_tag"),
            "oggetti": d.get("objects") or [],
        })
    cornici = [{"file": nome(f), "oggetti": (leggi(f).get("oggetti") or [])}
               for f in sorted(glob.glob(f"{base}/cornici/*.yaml"))]
    faceplates = [leggi(f) for f in sorted(glob.glob(f"{base}/faceplates/*.yaml"))]
    return {"pagine": pagine, "cornici": cornici, "faceplates": faceplates}

dati = {
    "_nota": "Generata da scripts/check_fixture_template.sh --aggiorna, dai template: non si modifica a mano.",
    "faceplate_di_sistema": [leggi(f) for f in sorted(glob.glob(f"{root}/sws-runtime/assets/faceplates/*.yaml"))],
    "template": {t: template(t) for t in TEMPLATE},
}
# `default=str` per le date che YAML riconosce da solo: nel JSON restano testo.
testo = json.dumps(dati, ensure_ascii=False, indent=1, default=str) + "\n"

if modo == "--aggiorna":
    with open(FIXTURE, "w", encoding="utf-8") as h:
        h.write(testo)
    n = sum(len(p["oggetti"]) for t in dati["template"].values() for p in t["pagine"])
    print(f"  fixture riscritta: {n} oggetti di pagina in {len(TEMPLATE)} template")
    sys.exit(0)

try:
    with open(FIXTURE, encoding="utf-8") as h:
        attuale = h.read()
except FileNotFoundError:
    attuale = None
if attuale == testo:
    print(f"  \033[32m✓\033[0m la fixture degli oggetti è quella dei template ({', '.join(TEMPLATE)})")
    sys.exit(0)
print(f"  \033[31m✗\033[0m {os.path.relpath(FIXTURE, root)} non è quella dei template")
print("      rigenerala con ./scripts/check_fixture_template.sh --aggiorna e committala")
sys.exit(1)
PY
