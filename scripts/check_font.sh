#!/usr/bin/env bash
# L'elenco dei font (18-10-2026): una tabella, tests/fixtures/font.json, che il browser e il
# pannello LVGL leggono ognuno a modo suo. Si controlla che non si separino:
#   - ogni famiglia ha il suo @font-face in public/fonts/font.css, verso un .woff2 che esiste, e
#     index.html (viewer) e index-admin.html (IDE) lo richiamano;
#   - ogni font non di sistema ha il suo .ttf negli asset del viewer LVGL, e l'immagine lo porta;
#   - le licenze viaggiano con i file.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

verdi=0; rossi=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; verdi=$((verdi+1)); }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; rossi=$((rossi+1)); }
printf '\033[1m── check_font ──\033[0m\n'

if out="$(python3 - <<'PY'
import json, os, re, sys
fx = json.load(open("tests/fixtures/font.json"))
html = open("sws-editor/public/fonts/font.css").read()
for pagina in ("sws-editor/index.html", "sws-editor/index-admin.html"):
    if '<link rel="stylesheet" href="/fonts/font.css" />' not in open(pagina).read():
        print(f"{pagina} non richiama /fonts/font.css: lì i font dell'elenco non si vedono")
        sys.exit(1)
facce = set(re.findall(r'@font-face \{ font-family: "([^"]+)"; src: url\("/fonts/([^"]+)\.woff2"\) format\("woff2"\); font-weight: (normal|bold);', html))
problemi = []
attese = set()
for f in fx["famiglie"]:
    # Senza grassetto, il bold è il regolare: il browser non lo sintetizza.
    for peso, nome in (("normal", f["file"]["regolare"]), ("bold", f["file"]["grassetto"] or f["file"]["regolare"])):
        attese.add((f["css"], nome, peso))
        if not os.path.exists(f"sws-editor/public/fonts/{nome}.woff2"):
            problemi.append(f"manca sws-editor/public/fonts/{nome}.woff2")
        if not f["sistema"] and not os.path.exists(f"sws-runtime/crates/sws-lvgl-viewer/assets/fonts/{nome}.ttf"):
            problemi.append(f"manca sws-runtime/crates/sws-lvgl-viewer/assets/fonts/{nome}.ttf")
for x in sorted(attese - facce):
    problemi.append(f"font.css non ha il @font-face di {x}")
for x in sorted(facce - attese):
    problemi.append(f"font.css ha un @font-face che la fixture non conosce: {x}")
for a in fx["alias"].values():
    if a not in {f["id"] for f in fx["famiglie"]}:
        problemi.append(f"alias verso una famiglia che non c'è: {a}")
print("\n".join(problemi))
sys.exit(1 if problemi else 0)
PY
)"; then ok "fixture, font.css (richiamato da viewer e IDE), .woff2 e .ttf coincidono"
else no "l'elenco dei font non torna:"; printf '%s\n' "$out" | sed 's/^/      /'; fi

for f in sws-editor/public/fonts/DejaVu-LICENSE.txt sws-editor/public/fonts/DSEG-LICENSE.txt sws-editor/public/fonts/DotGothic16-OFL.txt \
         sws-runtime/crates/sws-lvgl-viewer/assets/fonts/DSEG-LICENSE.txt sws-runtime/crates/sws-lvgl-viewer/assets/fonts/DotGothic16-OFL.txt; do
  [ -s "$f" ] && ok "licenza: $f" || no "manca la licenza $f"
done

if grep -q 'assets/fonts/DSEG\*.ttf' scripts/build_container.sh && grep -q 'DotGothic16-Regular.ttf' scripts/build_container.sh; then
  ok "l'immagine del pannello porta i font dell'elenco"
else
  no "scripts/build_container.sh non copia DSEG e DotGothic16 in /etc/sws/fonts"
fi

echo
[ "$rossi" -eq 0 ] && { printf '\033[32mFont: tutto verde (%d).\033[0m\n' "$verdi"; exit 0; }
printf '\033[31mFont: %d rossi.\033[0m\n' "$rossi"; exit 1
