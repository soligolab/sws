#!/usr/bin/env bash
#
# Controlla i due template gemelli "Demo Items".
#
# Perché serve: i due template devono restare gemelli — stesse pagine, stessi
# id, stesse coordinate — e insieme devono coprire TUTTI i tipi di oggetto.
# Sono due proprietà che si rompono in silenzio: si aggiunge un tipo nuovo alla
# palette e nessuno se ne accorge, oppure si sposta un oggetto in una variante
# sola e il confronto fra i due motori smette di significare qualcosa.
#
# Cosa verifica:
#   1. copertura — il template Web tocca ogni tipo della palette, quello LVGL
#      ogni tipo di SUPPORTED_TYPES;
#   2. nessun tipo solo-web è finito nella variante LVGL;
#   3. parità — le pagine hanno gli stessi nomi e dimensioni, e ogni oggetto
#      presente in entrambe sta esattamente alle stesse coordinate;
#   4. coerenza fra le due liste di tipi supportati (motore Rust e palette TS),
#      che sono due letterali in due linguaggi tenuti allineati da un commento.
#
# Uso: ./scripts/check_demo_templates.sh
set -euo pipefail

cd "$(dirname "$0")/.."
exec python3 - "$PWD" <<'PY'
import sys, os, re, glob, yaml

root = sys.argv[1]
WEB = f"{root}/examples/templates/demo-items-web"
LVGL = f"{root}/examples/templates/demo-items-lvgl"
WEB_ONLY = {"image", "kpi_tile", "alarm_history", "data_log"}

fail = []
def check(ok, msg):
    print(("  \033[32m✓\033[0m " if ok else "  \033[31m✗\033[0m ") + msg)
    if not ok:
        fail.append(msg)

# ── le due liste di tipi supportati ──────────────────────────────────────────
rs = open(f"{root}/sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs").read()
engine = set(re.findall(r'"([a-z_0-9]+)"',
    re.search(r'const SUPPORTED_TYPES: &\[&str\] = &\[(.*?)\];', rs, re.S).group(1)))

tsx = open(f"{root}/sws-editor/src/editor/LeftPanel.tsx").read()
palette_lvgl = set(re.findall(r'"([a-z_0-9]+)"',
    re.search(r'const LVGL_SUPPORTED_TYPES = new Set<SynopticObject\["type"\]>\(\[(.*?)\]\)', tsx, re.S).group(1)))
palette_all = set(re.findall(r'type:\s*"([a-z_0-9]+)"', tsx))

print("\n\033[1mListe dei tipi\033[0m")
check(engine == palette_lvgl,
      f"SUPPORTED_TYPES (motore, {len(engine)}) == LVGL_SUPPORTED_TYPES (palette, {len(palette_lvgl)})")
if engine != palette_lvgl:
    print("      solo motore :", sorted(engine - palette_lvgl))
    print("      solo palette:", sorted(palette_lvgl - engine))
check(palette_all - engine == WEB_ONLY,
      f"i tipi solo-web sono esattamente {sorted(WEB_ONLY)}")

# ── lettura dei template ─────────────────────────────────────────────────────
def load(base):
    pages = {}
    for f in sorted(glob.glob(f"{base}/synoptics/*.yaml")):
        d = yaml.safe_load(open(f))
        pages[d["name"]] = d
    return pages

def objects_of(page):
    """Tutti gli oggetti, comprese le celle di griglia."""
    out = []
    def walk(objs):
        for o in objs or []:
            out.append(o)
            for cell in (o.get("grid_cells") or []):
                walk(cell.get("objects"))
    walk(page.get("objects"))
    return out

web, lvgl = load(WEB), load(LVGL)

print("\n\033[1mCopertura\033[0m")
web_types = {o["type"] for p in web.values() for o in objects_of(p)}
lvgl_types = {o["type"] for p in lvgl.values() for o in objects_of(p)}
check(palette_all <= web_types,
      f"Demo Items - Web copre tutti i {len(palette_all)} tipi della palette")
if palette_all - web_types:
    print("      mancano:", sorted(palette_all - web_types))
check(engine <= lvgl_types,
      f"Demo Items - LVGL copre tutti i {len(engine)} tipi supportati dal motore")
if engine - lvgl_types:
    print("      mancano:", sorted(engine - lvgl_types))
check(not (lvgl_types & WEB_ONLY),
      "Demo Items - LVGL non contiene tipi solo-web")
if lvgl_types & WEB_ONLY:
    print("      di troppo:", sorted(lvgl_types & WEB_ONLY))

print("\n\033[1mParità fra le due varianti\033[0m")
check(set(web) == set(lvgl), "stesse pagine nelle due varianti")
for name in sorted(set(web) & set(lvgl)):
    a, b = web[name], lvgl[name]
    check((a.get("width"), a.get("height")) == (b.get("width"), b.get("height")),
          f'"{name}": stessa dimensione')
    oa = {o["id"]: o for o in objects_of(a)}
    ob = {o["id"]: o for o in objects_of(b)}
    extra = set(ob) - set(oa)
    check(not extra, f'"{name}": la variante LVGL non aggiunge oggetti')
    if extra:
        print("      di troppo:", sorted(extra))
    moved = [i for i in set(oa) & set(ob)
             if (oa[i].get("x"), oa[i].get("y"), oa[i].get("width"), oa[i].get("height"))
             != (ob[i].get("x"), ob[i].get("y"), ob[i].get("width"), ob[i].get("height"))]
    check(not moved, f'"{name}": gli oggetti comuni stanno alle stesse coordinate')
    if moved:
        print("      spostati:", sorted(moved))

# ── forma accettata dal parser del runtime ───────────────────────────────────
#
# Questi due controlli nascono da due errori veri, entrambi invisibili a occhio
# e in YAML: una pagina senza `id` e un `grid_rows: 2.0` al posto di `2`. Il
# runtime li rifiuta con un 500 e SALTA il sinottico — l'elenco delle pagine
# continua a mostrarne il nome, perché legge i nomi dei file, quindi il progetto
# sembra sano e le pagine sono vuote.
#
# I nomi dei campi interi si leggono dal sorgente Rust invece di elencarli qui:
# così un campo intero aggiunto domani viene controllato senza toccare questo
# script.
syn = open(f"{root}/sws-runtime/crates/sws-web/src/synoptic.rs").read()
int_fields = set(re.findall(r'pub ([a-z_0-9]+):\s+Option<(?:u32|i32|usize|u16|u64|i16)>', syn))

print("\n\033[1mForma accettata dal runtime\033[0m")
bad_pages, bad_ints = [], []
for label, pages in (("Web", web), ("LVGL", lvgl)):
    for name, p in pages.items():
        if not p.get("id") or not p.get("name"):
            bad_pages.append(f"{label}/{name}")
        for o in objects_of(p):
            for f in int_fields:
                v = o.get(f)
                if isinstance(v, float):
                    bad_ints.append(f"{label}/{name}/{o['id']}.{f}={v}")
check(not bad_pages, "ogni pagina ha `id` e `name` (obbligatori in SynopticPage)")
if bad_pages:
    print("      senza id/name:", bad_pages)
check(not bad_ints, f"i {len(int_fields)} campi interi non contengono decimali")
if bad_ints:
    print("      decimali dove serve un intero:", bad_ints)

# ── i tag citati dalle pagine devono esistere nel progetto ───────────────────
print("\n\033[1mTag\033[0m")
for label, base, pages in (("Web", WEB, web), ("LVGL", LVGL, lvgl)):
    proj = yaml.safe_load(open(f"{base}/project.yaml"))
    declared = {t["id"] for t in (proj.get("tags") or [])}
    used = set()
    for p in pages.values():
        for o in objects_of(p):
            for k in ("tag", "y_tag", "state_tag", "fill_level_tag", "symbol_spin_tag", "alarm_tag"):
                if isinstance(o.get(k), str) and o[k]:
                    used.add(o[k])
            for key in ("trend_tags", "bar_series", "pie_slices", "table_rows"):
                for it in (o.get(key) or []):
                    if isinstance(it, dict) and it.get("tag"):
                        used.add(it["tag"])
            for spec in (o.get("bindings") or {}).values():
                if isinstance(spec, str):
                    used.add(spec)
                elif isinstance(spec, dict) and spec.get("tag"):
                    used.add(spec["tag"])
    missing = sorted(used - declared)
    check(not missing, f"{label}: ogni tag usato dalle pagine è dichiarato nel progetto")
    if missing:
        print("      non dichiarati:", missing)

print()
if fail:
    print(f"\033[31m{len(fail)} controlli falliti\033[0m")
    sys.exit(1)
print("\033[32mTutti i controlli superati\033[0m")
PY
