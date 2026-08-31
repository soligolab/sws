#!/usr/bin/env bash
#
# Tutti i template sono ancora allineati al runtime?
#
# PERCHÉ ESISTE
#
# I template sono la prima cosa che un cliente apre, e derivano dal runtime
# senza che niente li tenga agganciati: una funzione nuova, un campo rinominato,
# una regola nuova, e restano indietro in silenzio. `check_demo_templates.sh`
# copre solo i due gemelli "Demo Items"; gli altri nove non li guardava nessuno.
#
# I controlli qui sotto sono quelli che questa sessione ha visto fallire
# davvero, non un elenco teorico:
#
#   * `import` negli script — il runtime li esegue in RestrictedPython, che
#     blocca `__import__`. Sul PC di sviluppo RestrictedPython di solito NON
#     c'è, quindi lo stesso script passa lì e fallisce sul pannello a ogni tick.
#     È il difetto che si vede solo sul dispositivo (misurato il 2026-08-25).
#   * asset inesistenti — `src: logo.svg` puntava alla radice del runtime, dove
#     non c'è nulla: l'immagine era rotta anche sul web (2026-08-27).
#   * pagine senza `id`/`name` — il runtime le **scarta**, e `/api/synoptics`
#     continua a elencarle: il progetto sembra sano con pagine vuote (2026-08-25).
#   * campi interi con decimali — stesso effetto, la pagina viene rifiutata.
#   * tag usati e non dichiarati — i widget restano muti senza dirlo.
#   * `saved_by` in un template — un template non è "stato salvato da" una
#     versione, e col timbro alla creazione (2026-08-28) sarebbe un residuo.
#   * nessuna pagina — da quando il viewer LVGL parte senza `--page`, un
#     progetto senza sinottici non lo fa partire affatto.
#   * navbutton che puntano a pagine inesistenti — `target_page` è un **id**,
#     non un nome, e sbagliarlo dà uno schermo nero senza nessun messaggio
#     (2026-08-28: tutti e 16 quelli dei due template "Demo Items").
#   * pipe agganciate a oggetti che non esistono, o con una porta sconosciuta —
#     il capo resta dov'era o cade al centro, e la pipe finisce storta senza che
#     niente lo segnali (stesso silenzio dei navbutton rotti).
#   * celle di griglia che non disegnano niente — `objects:` non è un campo di
#     `GridCell` (il campo è `child:`), e nessuno dei due motori lo legge: la
#     griglia esce vuota, in silenzio, in entrambi.
#   * `home_page_id` mancante con più pagine — il viewer ripiega sulla prima in
#     ordine alfabetico, quindi a decidere cosa vede il cliente all'accensione è
#     l'alfabeto.
#
# Uso:  ./scripts/check_templates.sh     (esce != 0 se qualcosa non torna)
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import glob, os, re, sys, yaml

root = sys.argv[1]
TPL = f"{root}/examples/templates"
PUB = f"{root}/sws-editor/public"

fail = []
def problema(msg):
    print(f"  \033[31m✗\033[0m {msg}")
    fail.append(msg)

def ok(msg):
    print(f"  \033[32m✓\033[0m {msg}")

# I tipi disegnabili si leggono dalla fonte, non da una copia: una copia si
# disallinea, ed è esattamente il difetto che queste guardie esistono per
# impedire.
src = open(f"{root}/sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs").read()
m = re.search(r"const SUPPORTED_TYPES: &\[&str\] = &\[(.*?)\];", src, re.S)
LVGL = set(re.findall(r'"([a-z_]+)"', m.group(1)))
PALETTE = set(re.findall(r'type:\s*"([a-z_]+)"',
                         open(f"{root}/sws-editor/src/editor/LeftPanel.tsx").read()))

nomi = sorted(os.path.basename(p.rstrip("/")) for p in glob.glob(f"{TPL}/*/"))
print(f"\033[1m{len(nomi)} template, {len(PALETTE)} tipi in palette, {len(LVGL)} disegnabili da LVGL\033[0m\n")

# Campi che il runtime vuole interi: un decimale fa rifiutare la pagina.
INTERI = ("grid_rows", "grid_cols", "decimals", "font_weight", "colspan", "rowspan")

for nome in nomi:
    d = f"{TPL}/{nome}"
    try:
        prj = yaml.safe_load(open(f"{d}/project.yaml"))
    except Exception as e:
        problema(f"{nome}: project.yaml illeggibile — {e}")
        continue

    # ── script che si romperebbero nella sandbox del dispositivo ──
    for gruppo, etichetta in ((prj.get("global_scripts") or [], "script"),
                              (prj.get("functions") or [], "funzione")):
        for g in gruppo:
            for n, l in enumerate((g.get("code") or "").splitlines(), 1):
                if l.strip().startswith(("import ", "from ")):
                    problema(f"{nome}: {etichetta} '{g.get('id')}' riga {n}: "
                             f"`{l.strip()}` — RestrictedPython lo blocca sul dispositivo")

    if prj.get("saved_by"):
        problema(f"{nome}: ha `saved_by` ({prj['saved_by']}) — un template non è stato salvato da una versione")

    # ── pagine ──
    pagine = sorted(glob.glob(f"{d}/synoptics/*.yaml"))
    if not pagine:
        problema(f"{nome}: nessuna pagina synottico — il viewer LVGL non parte affatto")
        continue

    ids, usati_tag, tipi, nav_targets = set(), set(), set(), set()
    for f in pagine:
        base = os.path.basename(f)
        try:
            pag = yaml.safe_load(open(f))
        except Exception as e:
            problema(f"{nome}/{base}: YAML illeggibile — {e}")
            continue
        if not isinstance(pag, dict):
            problema(f"{nome}/{base}: non è una mappa YAML")
            continue
        if not pag.get("id") or not pag.get("name"):
            problema(f"{nome}/{base}: manca `id` o `name` — il runtime scarta la pagina in silenzio")
        if pag.get("id"):
            ids.add(pag["id"])
        id_oggetti = {o.get("id") for o in (pag.get("objects") or []) if o.get("id")}
        for o in (pag.get("objects") or []):
            if o.get("type"):
                tipi.add(o["type"])
            if o.get("type") == "navbutton" and o.get("target_page"):
                nav_targets.add(o["target_page"])
            # ── pipe agganciate a oggetti che non esistono ──
            #
            # `from_obj_id`/`to_obj_id` puntano a un id **della stessa pagina**.
            # Sbagliarli non fa fallire niente: il capo resta dov'era (scelta
            # deliberata, vedi `punti_ancorati`), quindi la pipe finisce storta
            # o nell'angolo, e nessuno lo dice. È lo stesso silenzio dei
            # navbutton verso pagine inesistenti.
            for campo in ("from_obj_id", "to_obj_id"):
                rif = o.get(campo)
                if rif and rif not in id_oggetti:
                    problema(f"{nome}/{base}: `{campo}: {rif}` non è un oggetto di questa "
                             f"pagina — il capo della pipe resta dov'era, storto e in silenzio")
            # ── `points` su un oggetto che non li legge ──
            #
            # `points` è un campo delle **pipe**. Una `line` conosce solo
            # `x`/`y` → `x2`/`y2` e li ignora in silenzio, in tutti e due i
            # motori: si ottiene un segmento orizzontale lungo cento pixel
            # invece della polilinea disegnata. Capitato il 2026-08-31
            # scrivendo la demo del movimento.
            if o.get("type") == "line" and o.get("points"):
                problema(f"{nome}/{base}: la linea '{o.get('id')}' ha `points:`, che una "
                         f"`line` non legge — usa `x2`/`y2`, o una `pipe`")

            # ── celle di griglia che non disegnano niente ──
            #
            # Una `GridCell` ha **un** contenuto: `child` (un oggetto centrato
            # nella cella) oppure `sub` (una suddivisione). `objects:` non è un
            # campo di `GridCell` — non nel motore LVGL e nemmeno nel web:
            # entrambi lo ignorano in silenzio, e la griglia esce vuota.
            #
            # I due modelli "Demo Items" l'hanno avuto per mesi, con la
            # didascalia «celle con oggetti dentro» sopra una griglia vuota in
            # tutti e due i motori. Trovato il 2026-08-31 guardando
            # un'istantanea, non leggendo lo YAML.
            for n_c, c in enumerate(o.get("grid_cells") or []):
                dove = f"cella ({c.get('row')},{c.get('col')})"
                if "objects" in c:
                    problema(f"{nome}/{base}: {o.get('id')} {dove} usa `objects:` — "
                             f"nessuno dei due motori lo legge; il campo è `child:`")
                elif not any(k in c for k in ("child", "sub", "bg_color")):
                    problema(f"{nome}/{base}: {o.get('id')} {dove} non ha né `child` né "
                             f"`sub` né `bg_color` — resta vuota")
            # Una porta sconosciuta cade al centro dell'oggetto invece che sul
            # lato voluto: la pipe entra nel mezzo della macchina.
            for campo in ("from_port", "to_port"):
                porta = o.get(campo)
                if porta and porta not in ("top", "bottom", "left", "right", "center"):
                    problema(f"{nome}/{base}: `{campo}: {porta}` non è una porta — "
                             f"il capo cade al centro dell'oggetto")
            for campo in INTERI:
                v = o.get(campo)
                if isinstance(v, float) and v != int(v):
                    problema(f"{nome}/{base}: `{campo}: {v}` ha decimali su un campo intero")
            s = o.get("src")
            if isinstance(s, str) and s.startswith("/") and not os.path.exists(PUB + s):
                problema(f"{nome}/{base}: `src: {s}` non esiste — l'immagine resta vuota")
            for k, v in o.items():
                if k.endswith("tag") and isinstance(v, str) and v:
                    usati_tag.add(v)

    # ── navbutton che portano nel vuoto ──
    #
    # `target_page` contiene l'**id** della pagina, non il nome: lo risolvono
    # così `pageLayout.ts` e `EditorShell.tsx`. Entrambi i template "Demo Items"
    # ci mettevano il nome — tutti e 16 i navbutton portavano a una pagina
    # inesistente e il viewer restava **nero**. Trovato dal maintainer premendo
    # un pulsante sul WP630 il 2026-08-28.
    rotti = sorted({t for t in nav_targets if t not in ids})
    if rotti:
        problema(f"{nome}: {len(rotti)} navbutton puntano a pagine inesistenti → {rotti[:3]}"
                 + (" …" if len(rotti) > 3 else "")
                 + f" (gli id veri sono {sorted(ids)[:3]})")

    fuori = sorted(tipi - PALETTE)
    if fuori:
        problema(f"{nome}: tipi che la palette non conosce → {fuori}")

    dichiarati = {t.get("id") for t in (prj.get("tags") or [])}
    mancanti = sorted(usati_tag - dichiarati)
    if mancanti:
        problema(f"{nome}: {len(mancanti)} tag usati e mai dichiarati → {mancanti[:4]}"
                 + (" …" if len(mancanti) > 4 else ""))

    # ── pagina iniziale ──
    home = (prj.get("page_layout") or {}).get("home_page_id")
    if len(pagine) > 1:
        if not home:
            problema(f"{nome}: {len(pagine)} pagine e nessun `home_page_id` — "
                     f"a decidere cosa si vede all'accensione è l'ordine alfabetico")
        elif home not in ids:
            problema(f"{nome}: `home_page_id: {home}` non è l'id di nessuna pagina")

    if not any(nome in f for f in [x for x in fail]):
        ok(f"{nome}: {len(pagine)} pagine, {len(tipi)} tipi, tutto a posto")

print()
if fail:
    print(f"\033[31m{len(fail)} problemi nei template.\033[0m")
    sys.exit(1)
print("\033[32mTutti i template sono allineati.\033[0m")
PY
