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

# Il debito dichiarato si **vede**, altrimenti non è dichiarato: è giallo, non
# rosso, e non fa fallire — ma compare a ogni giro finché non scende a zero.
debiti = []
def debito(msg):
    print(f"  \033[33m•\033[0m {msg}")
    debiti.append(msg)

def nota(msg):
    print(f"  \033[36m↓\033[0m {msg}")

# I tipi disegnabili si leggono dalla fonte, non da una copia: una copia si
# disallinea, ed è esattamente il difetto che queste guardie esistono per
# impedire.
src = open(f"{root}/sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs").read()
m = re.search(r"const SUPPORTED_TYPES: &\[&str\] = &\[(.*?)\];", src, re.S)
LVGL = set(re.findall(r'"([a-z_]+)"', m.group(1)))
PALETTE = set(re.findall(r'type:\s*"([a-z_]+)"',
                         open(f"{root}/sws-editor/src/editor/LeftPanel.tsx").read()))

# ── Le regole del parco template (17-09-2026) ────────────────────────────────
#
# Decise dal maintainer dopo la misura di tutti i template: R1 il formato, R2
# tre lingue davvero, R3 semplicità, R5 niente rete di nessuno. Il documento
# sta in `examples/templates/README.md`, il referto della discussione in
# `docs/archive/2026-09-17-regole-dei-template.md`.
#
# I tre elenchi qui sotto sono **debito dichiarato**, non assoluzioni: ogni voce
# ha il perché accanto, e devono tendere a vuoto. È la stessa scelta di
# `check_i18n_parita.sh` e di `check_release_coerente.sh` — un debito scritto si
# vede a ogni giro, uno taciuto cresce.

# R1 — formato di pagina. Decisione D1: la regola vale da subito per ciò che
# nasce, e questi si riflussano quando gli si mette mano per le altre regole.
R1_DEBITO = {
    # Vuoto dal 18-09-2026: l'ultimo fuori formato, `casa-locale`, è uscito dal
    # parco (era l'impianto di casa del maintainer, vive ora come suo progetto
    # locale). Ogni template è 1280×800.
}

# R2 — testo visibile che non passa dalla tabella lingue. Il numero è il
# **tetto**: se cresce la guardia fallisce, se cala va abbassato. Decisione D4:
# nessuna esenzione, banchi di protocollo compresi.
R2_DEBITO = {
    # Vuoto dal 17-09-2026, Passo 5: ogni testo visibile di ogni template passa
    # dalla tabella lingue, e ogni template dichiara it/en/es. Se ricompare una
    # riga qui, è un template che è tornato indietro.
}

# R3 — semplicità. Decisione D2: `homeassistant-pro` è l'eccezione dichiarata.
R3_PAGINE_MAX, R3_OGGETTI_MAX = 3, 60
R3_DEBITO = {
    # nome: (pagine, oggetti nella pagina più piena, perché)
    "homeassistant-pro":  (6, 107, "vetrina del «cosa si può fare», non punto di partenza — "
                                   "la parola «pro» nel nome è l'avviso (decisione del maintainer, 17-09-2026)"),
    "demo-items-lvgl":    (4, 0,   "inventario: 4 pagine per coprire 35 tipi di widget; nessuna pagina supera il tetto di oggetti"),
    "demo-items-web":     (4, 0,   "inventario: 4 pagine per coprire 35 tipi di widget; nessuna pagina supera il tetto di oggetti"),
    "homeassistant-demo": (3, 62,  "due oggetti sopra il tetto nella pagina di panoramica"),
}

# R5 — indirizzi. `localhost` e i nomi mDNS di prodotto (`homeassistant.local`)
# sono documentazione, non la rete di qualcuno; un IP privato letterale sì.
R5_PRIVATI = re.compile(r"\b(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d+\.\d+\b")
R5_SEGRETI = ("password", "bot_token", "token", "api_key", "secret", "passphrase")

# I campi di testo si leggono dalla **fonte** (`projectI18n.ts`), non da una
# copia: una copia si disallinea, ed è il difetto che queste guardie esistono
# per impedire.
_pi18n = open(f"{root}/sws-editor/src/i18n/projectI18n.ts").read()
CAMPI_TESTO = set(re.findall(r'"([a-z_]+)"',
    re.search(r"export const TEXT_FIELDS[^=]*=\s*\[(.*?)\];", _pi18n, re.S).group(1)))
CAMPI_TESTO.add("label")   # options[].label, table_rows[].label, bar_series[].label…

# Le unità di misura non si traducono: «kW» è «kW» in spagnolo, e tokenizzarle
# gonfierebbe la tabella lingue di voci che nessuno tradurrà mai. È l'elenco di
# eccezioni promesso dalla regola R2 — chiuso e corto di proposito: se serve
# un'unità nuova la si aggiunge qui, consapevolmente.
UNITA = {
    "W", "kW", "MW", "Wh", "kWh", "MWh", "VA", "kVA", "var", "kvar", "Ah", "mAh",
    "V", "mV", "kV", "A", "mA", "Hz", "kHz", "Ω", "ohm",
    "s", "ms", "µs", "min", "h", "d",
    "m", "mm", "cm", "km", "m²", "m³", "L", "l", "mL",
    "g", "kg", "t", "N", "Nm",
    "bar", "mbar", "Pa", "kPa", "hPa", "psi",
    "°C", "°F", "K", "%", "‰", "rpm", "ppm", "pH", "lux", "lx", "dB", "dBm",
    "m/s", "km/h", "L/min", "m³/h", "kWp",
}

def da_tradurre(v):
    """Una stringa che un operatore legge e che quindi deve passare dalla
    tabella. Restano fuori due cose, con la stessa regola di
    `sws_core::traduzione`: ciò che non ha lettere una volta tolti i segnaposti
    («%», «{value:.1f}»), e ciò che è **solo** unità di misura («{value} kW»)."""
    if not isinstance(v, str) or not v.strip() or "{{" in v:
        return False
    resto = re.sub(r"\{[^{}]*\}", " ", v)
    if not any(c.isalpha() for c in resto):
        return False
    parole = [w for w in re.split(r"[\s:;,()\[\]/]+", resto) if w and any(c.isalpha() for c in w)]
    return not all(w.strip(".") in UNITA for w in parole)

def testi_letterali(nodo, fuori=None):
    fuori = [] if fuori is None else fuori
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            if k in CAMPI_TESTO and da_tradurre(v):
                fuori.append(v)
            else:
                testi_letterali(v, fuori)
    elif isinstance(nodo, list):
        for x in nodo:
            testi_letterali(x, fuori)
    return fuori

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

    tipi_tag = {t.get("id"): t.get("data_type") for t in (prj.get("tags") or [])}
    ids, usati_tag, tipi, nav_targets = set(), set(), set(), set()
    formati, troppo_piene, letterali = [], [], []
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
        # R1/R3/R2: formato della pagina, quanti oggetti porta, e quanto
        # testo visibile non passa dalla tabella lingue.
        formati.append((base, pag.get("width"), pag.get("height")))
        n_ogg = len(pag.get("objects") or [])
        if n_ogg > R3_OGGETTI_MAX:
            troppo_piene.append((base, n_ogg))
        letterali += testi_letterali(pag.get("objects") or [])
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
            # ── `write_value` di un tipo che non è quello del tag ──
            #
            # Il server **non** converte: scrivendo la stringa `"true"` su un
            # tag dichiarato `bool`, il tag finisce a contenere una stringa
            # (misurato il 2026-08-31). Funziona per caso, perché chi lo rilegge
            # tratta una stringa non vuota come vera — finché qualcuno non lo
            # legge come booleano davvero.
            #
            # In YAML `write_value: 'true'` e `write_value: true` sono due cose
            # diverse, e la differenza è invisibile a chi legge in fretta.
            wv = o.get("write_value")
            t_obj = o.get("tag")
            if isinstance(wv, str) and t_obj in tipi_tag and tipi_tag[t_obj] == "bool" \
               and wv.lower() in ("true", "false"):
                problema(f"{nome}/{base}: '{o.get('id')}' scrive la stringa \"{wv}\" su "
                         f"'{t_obj}', dichiarato bool — il server non converte")

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

    # ── Niente copre la barra di navigazione (B13, 23-09-2026) ─────────────
    #
    # Nel template `homeassistant-pro` la fascia allarmi arrivava a y 774 e la
    # barra comincia a 738: ne copriva i primi 36 pixel, cioè i pulsanti con
    # cui si cambia pagina. Che un banner si sovrapponga al **contenuto** è
    # normale, è un overlay; che copra la **navigazione** no, perché il
    # pannello diventa inutilizzabile proprio quando c'è un allarme.
    #
    # Si guardano solo gli oggetti dichiarati DOPO la barra: l'ordine
    # nell'elenco è l'ordine di disegno, quindi un fondale dichiarato prima le
    # sta dietro e non la nasconde.
    for f_pag in pagine:
        try:
            pag = yaml.safe_load(open(f_pag))
        except Exception:
            continue  # già segnalata sopra
        if not isinstance(pag, dict):
            continue
        oggetti = pag.get("objects") or []
        for i, nav in enumerate(oggetti):
            if nav.get("type") != "page_navigator":
                continue
            nx, ny = nav.get("x", 0), nav.get("y", 0)
            nw, nh = nav.get("width") or 0, nav.get("height") or 0
            for o in oggetti[i + 1:]:
                ox, oy = o.get("x", 0), o.get("y", 0)
                ow, oh = o.get("width") or 0, o.get("height") or 0
                if ow == 0 or oh == 0:
                    continue  # testi e simboli senza box dichiarato
                if ox < nx + nw and ox + ow > nx and oy < ny + nh and oy + oh > ny:
                    problema(
                        f"{nome}: in «{pag.get('name')}» l'oggetto `{o.get('id')}` "
                        f"({o.get('type')}, y {oy}–{round(oy + oh, 1)}) copre la barra di "
                        f"navigazione `{nav.get('id')}` (y {ny}–{round(ny + nh, 1)}): "
                        "i pulsanti per cambiare pagina diventano incliccabili"
                    )

    fuori = sorted(tipi - PALETTE)
    if fuori:
        problema(f"{nome}: tipi che la palette non conosce → {fuori}")

    dichiarati = {t.get("id") for t in (prj.get("tags") or [])}
    # Fase 2 dei tag (22-09-2026): una variabile composita (`type_ref` o
    # `array`) si dichiara una volta e si usa per percorso —
    # `motore1.velocita`, `zone[2].t`. Senza questo, il primo template con una
    # struttura dentro griderebbe «tag mai dichiarato» su ogni sua foglia. Il
    # confine è lo stesso di `ePercorsoDiUnaRadice` nell'IDE: il prefisso vale
    # solo se finisce dove finisce l'id, su un punto o su una parentesi, così
    # `motore1bis` non passa per una foglia di `motore1`.
    radici = [t.get("id") or "" for t in (prj.get("tags") or [])
              if t.get("type_ref") or t.get("array")]
    def foglia_di_una_radice(u):
        return any(u.startswith(r) and u[len(r):len(r) + 1] in (".", "[") for r in radici)
    mancanti = sorted(u for u in (usati_tag - dichiarati) if not foglia_di_una_radice(u))
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

    # Un token `{{chiave}}` senza la sua voce nella tabella lingue.
    #
    # Il pannello e il browser lo mostrano **così com'è**, graffe comprese:
    # `{{t0007}}` sotto gli occhi dell'operatore. Aggiunto il 16-09-2026 dopo
    # averlo combinato: la migrazione delle chiavi dei template ha tokenizzato
    # i messaggi d'allarme di tre template lasciando `entries: []`, e nulla lo
    # avrebbe detto finché qualcuno non apriva quei progetti.
    tabella = prj.get("languages") or {}
    chiavi = {str(e.get("key", "")).strip() for e in (tabella.get("entries") or [])}
    usati = set()
    for percorso in [f"{d}/project.yaml"] + sorted(glob.glob(f"{d}/synoptics/*.yaml")):
        usati |= set(re.findall(r"\{\{\s*([^}\s]+)\s*\}\}", open(percorso).read()))
    orfani = sorted(usati - chiavi)
    if orfani:
        problema(f"{nome}: {len(orfani)} token senza voce in tabella "
                 f"({', '.join(orfani[:4])}{'…' if len(orfani) > 4 else ''}) — "
                 f"si vedono come {{{{chiave}}}} sul pannello")

    # ── R1: 16:10 a 1280×800 ────────────────────────────────────────────────
    fuori_formato = [f"{b} {w}×{h}" for b, w, h in formati if (w, h) != (1280, 800)]
    if fuori_formato and nome not in R1_DEBITO:
        problema(f"{nome}: R1 — {len(fuori_formato)} pagine non 1280×800 → "
                 f"{', '.join(fuori_formato[:3])}"
                 + (" …" if len(fuori_formato) > 3 else "")
                 + " (o si riflussa, o si dichiara in R1_DEBITO con il perché)")
    elif not fuori_formato and nome in R1_DEBITO:
        nota(f"{nome}: R1 — ora è tutto 1280×800, togli la riga da R1_DEBITO")
    elif fuori_formato:
        debito(f"{nome}: R1 — {R1_DEBITO[nome]}")

    # ── R2: ogni testo visibile passa dalla tabella lingue ──────────────────
    #
    # Il verso che mancava. La guardia sopra prende un token senza voce; questa
    # prende il contrario, cioè il testo che token non è — ed è il caso vero:
    # la Fase 7 del multilingua ha tokenizzato i **messaggi d'allarme**, e sei
    # template su dodici avevano ancora zero testo tradotto nei sinottici.
    tetto = R2_DEBITO.get(nome, 0)
    if len(letterali) > tetto:
        campione = ", ".join(repr(t[:28]) for t in letterali[:3])
        problema(f"{nome}: R2 — {len(letterali)} testi visibili non passano dalla "
                 f"tabella lingue (tetto dichiarato: {tetto}) → {campione}"
                 + (" …" if len(letterali) > 3 else ""))
    elif tetto and len(letterali) < tetto:
        nota(f"{nome}: R2 — scesi a {len(letterali)} letterali su {tetto} dichiarati, "
             f"abbassa il tetto in R2_DEBITO")
    elif tetto:
        debito(f"{nome}: R2 — {tetto} testi ancora da tokenizzare")

    # ── R2 bis: le tre lingue dichiarate ────────────────────────────────────
    langs = [str(x) for x in ((prj.get("languages") or {}).get("langs") or [])]
    mancano = [l for l in ("it", "en", "es") if l not in langs]
    if mancano and nome not in R2_DEBITO:
        problema(f"{nome}: R2 — mancano le lingue {mancano} (dichiarate: {langs or '—'})")
    elif mancano:
        debito(f"{nome}: R2 — mancano ancora le lingue {mancano}")

    # ── R3: semplice, e il numero lo dice ───────────────────────────────────
    sfonda = []
    if len(pagine) > R3_PAGINE_MAX:
        sfonda.append(f"{len(pagine)} pagine (max {R3_PAGINE_MAX})")
    for b, n in troppo_piene:
        sfonda.append(f"{b}: {n} oggetti (max {R3_OGGETTI_MAX})")
    piena = max([n for _, n in troppo_piene] + [0])
    if sfonda and nome not in R3_DEBITO:
        problema(f"{nome}: R3 — non è semplice: {'; '.join(sfonda[:3])}"
                 + (" …" if len(sfonda) > 3 else ""))
    elif nome in R3_DEBITO:
        pag_max, ogg_max, perche = R3_DEBITO[nome]
        # Il debito porta i numeri di oggi: così può solo scendere, e un
        # template dichiarato «grande» non diventa il posto dove crescere.
        if len(pagine) > pag_max or piena > ogg_max:
            problema(f"{nome}: R3 — è CRESCIUTO oltre il debito dichiarato "
                     f"({len(pagine)} pagine, {piena} oggetti nella più piena; "
                     f"dichiarati {pag_max} e {ogg_max})")
        elif len(pagine) < pag_max or piena < ogg_max:
            nota(f"{nome}: R3 — sceso a {len(pagine)} pagine / {piena} oggetti, "
                 f"abbassa i numeri in R3_DEBITO")
        elif sfonda:
            debito(f"{nome}: R3 — {perche}")

    # ── R5: un template non porta la rete di nessuno ────────────────────────
    #
    # Il 16-09-2026 aprire un progetto da `nebulizzatore-sandokan` ha prodotto
    # 1950 righe su 2000 di `connection refused`: quel template dichiara
    # `192.168.1.6`, il broker di casa del maintainer. Q58.
    # Anche i `.md`: un SETUP che scrive «il broker è a 192.168.1.6» consegna la
    # rete di qualcuno esattamente come il YAML. Restano leciti i segnaposto
    # (`192.168.1.X`), le reti di documentazione (RFC 5737, `192.0.2.0/24`) e i
    # nomi mDNS di prodotto.
    for percorso in [f"{d}/project.yaml"] + sorted(glob.glob(f"{d}/*.md")):
        ip = sorted(set(R5_PRIVATI.findall(open(percorso).read())))
        if ip:
            problema(f"{nome}/{os.path.basename(percorso)}: R5 — indirizzi di una rete "
                     f"vera nel template → {ip} (usa un nome riservato, `localhost`, "
                     f"una rete di documentazione o il nome mDNS del prodotto)")
    grezzo = open(f"{d}/project.yaml").read()
    for chiave in R5_SEGRETI:
        for m in re.finditer(rf"^\s*{chiave}\s*:\s*(\S.*)$", grezzo, re.M):
            val = m.group(1).strip().strip("\"'")
            if val and val not in ("~", "null"):
                problema(f"{nome}: R5 — `{chiave}` valorizzato in un template — "
                         f"un template si dà a chi con quell'impianto non c'entra niente")

    if not any(nome in f for f in [x for x in fail]):
        ok(f"{nome}: {len(pagine)} pagine, {len(tipi)} tipi, tutto a posto")

print()
if fail:
    print(f"\033[31m{len(fail)} problemi nei template.\033[0m")
    sys.exit(1)
if debiti:
    # Il totale, perché un debito sparso in trenta righe non si percepisce come
    # un numero — e questo deve scendere a zero, non stabilizzarsi.
    print(f"\033[33m{len(debiti)} eccezioni dichiarate alle regole del parco "
          f"(R1 formato, R2 lingue, R3 semplicità) — vedi examples/templates/README.md\033[0m")
print("\033[32mTutti i template sono allineati.\033[0m")
PY
