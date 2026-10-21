#!/usr/bin/env python3
"""Generatore della libreria di simboli SCADA 2.5D.

Piano: docs/archive/2026-10-14-motore-simboli-lib.md (Fase 1, «Formato»). Gli SVG
in `sws-editor/public/symbols/lib/` e il loro `manifest.json` escono **solo** da
qui: non si ritoccano a mano, si cambia il disegno in `disegni.py` e si rigenera.

    python3 scripts/simboli/genera.py              # rigenera
    python3 scripts/simboli/genera.py --controlla  # rigenera in una cartella temporanea,
                                                   # confronta e verifica le regole

IL FORMATO, IN BREVE

- I figli dell'`<svg>` sono **strati** (`data-layer`), nell'ordine in cui si
  disegnano: statici (`layer-0`, `layer-1`…) e parti vive (`body`, `level`,
  `rotor`, `needle`, `lever`, `lamp-*`). Il pannello LVGL rasterizza ogni strato
  per conto suo; il web li comanda per id.
- Ogni forma ha un **colore piatto** preso da un materiale (`data-mat`, o
  `data-mat-stroke` per i tratti) e, se ha volume, un **velo** sopra (`data-shade`):
  bianchi e neri trasparenti che danno la luce. Lo stile del progetto ritinge i
  materiali e regola l'opacità dei veli (volume 0 = piatto, stile ISA-101).
- Il contorno è sugli strati (`stroke` del gruppo) e scala col disegno.
- Vietati: `<text>` (il pannello non ha font), `<style>` e `animate*` (li toglie il
  sanitizer), filtri e raster (resvg li salta in silenzio). Nessun colore fuori dai
  materiali, salvo il bianco e il nero dei veli.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.normpath(os.path.join(QUI, "..", ".."))
USCITA = os.path.join(RADICE, "sws-editor", "public", "symbols", "lib")

CONTORNO = "#1c2329"

# Materiali: nome → colore predefinito. Sono le chiavi che lo stile del progetto
# può ritingere; un disegno non usa altri colori.
MATERIALI = {
    "steel": "#9aa5af",
    "steel-dark": "#4a545d",
    "stainless": "#b4bec7",
    "rubber": "#2a2d31",
    "glass-dark": "#1d2a35",
    "liquid": "#2b8fd6",
    "dial": "#eef1f3",
    "porcelain": "#8c4a2f",
    "porcelain-shed": "#a0583a",
    "label": "#d7dde2",
    "signal-red": "#c8352e",
    "safety-yellow": "#e3a51a",
    "warning-yellow": "#e0a91b",
    "gauge-green": "#3fae5a",
    "lamp-green": "#3fb950",
    "lamp-amber": "#e0a91b",
    "lamp-red": "#d13c32",
    "lamp-green-off": "#2f5a39",
    "lamp-amber-off": "#6e5a2c",
    "lamp-red-off": "#6b3a37",
    "pv-cell": "#1f3a5f",
    "pv-grid": "#7f9fc6",
    "impeller": "#1d3f62",
    "impeller-vane": "#9cc1e6",
    "body-pump": "#2f6fa8",
    "body-motor": "#5d6f7e",
    "cabinet": "#c8cdd2",
    "transformer": "#8a9196",
    "bulk": "#b9a37e",
    "body-boiler": "#a83a32",
    "body-furnace": "#6b4a3a",
    "flame": "#ff8c1a",
    "flame-core": "#ffd34d",
    "copper": "#b87333",
    "charge": "#3fb950",
    "instrument": "#4a7fb0",
    "appliance": "#e2e6ea",
    "wall": "#c9c2b6",
    "glass": "#9cc7e3",
    "gas": "#2e7d4f",
    "wood": "#b98a55",
    "cardboard": "#c49a63",
}

# Veli: solo bianco e nero con opacità. I valori dei metalli sono calcolati
# perché colore piatto + velo riproduca le sfumature approvate sulla tavola del
# 12-10 (dove l'acciaio aveva i colori incorporati).
VELI = {
    "paint-v": ("linear", {"x1": 0, "y1": 0, "x2": 0, "y2": 1}, [(0, "#000", .25), (.2, "#fff", .5), (.45, "#fff", .08), (.75, "#000", .12), (1, "#000", .45)]),
    "paint-h": ("linear", {"x1": 0, "y1": 0, "x2": 1, "y2": 0}, [(0, "#000", .25), (.2, "#fff", .5), (.45, "#fff", .08), (.75, "#000", .12), (1, "#000", .45)]),
    "paint-r": ("radial", {"cx": .36, "cy": .3, "r": .75}, [(0, "#fff", .55), (.5, "#fff", .05), (1, "#000", .45)]),
    "paint-d": ("linear", {"x1": 0, "y1": 0, "x2": 1, "y2": 1}, [(0, "#fff", .35), (.5, "#fff", 0), (1, "#000", .3)]),
    "metal-v": ("linear", {"x1": 0, "y1": 0, "x2": 0, "y2": 1}, [(0, "#000", .42), (.18, "#fff", .85), (.45, "#fff", .25), (.8, "#000", .19), (1, "#000", .49)]),
    "metal-h": ("linear", {"x1": 0, "y1": 0, "x2": 1, "y2": 0}, [(0, "#000", .42), (.18, "#fff", .85), (.45, "#fff", .25), (.8, "#000", .19), (1, "#000", .49)]),
    "metal-r": ("radial", {"cx": .35, "cy": .3, "r": .8}, [(0, "#fff", .9), (.5, "#fff", .13), (1, "#000", .46)]),
    "dark-v": ("linear", {"x1": 0, "y1": 0, "x2": 0, "y2": 1}, [(0, "#fff", .1), (.2, "#fff", .37), (.6, "#000", .17), (1, "#000", .48)]),
    "dark-h": ("linear", {"x1": 0, "y1": 0, "x2": 1, "y2": 0}, [(0, "#fff", .1), (.2, "#fff", .37), (.6, "#000", .17), (1, "#000", .48)]),
    "rubber-r": ("radial", {"cx": .4, "cy": .35, "r": .7}, [(0, "#fff", .23), (.7, "#fff", 0), (1, "#000", .52)]),
    "dial-r": ("radial", {"cx": .4, "cy": .35, "r": .75}, [(0, "#fff", 1), (.7, "#fff", 0), (1, "#000", .14)]),
    "glass-r": ("radial", {"cx": .35, "cy": .3, "r": .7}, [(0, "#fff", .9), (.3, "#fff", .25), (1, "#fff", 0)]),
}

FAMIGLIE = ("process", "electrical", "machines", "building")

# Etichette del picker: famiglia e tipologia (`kind` nel manifesto). Stanno in
# it.json/en.json sotto `symbols.lib.famiglia` e `symbols.lib.tipo`; la guardia
# verifica che ci siano, uguali a queste.
ETICHETTE_FAMIGLIA = {
    "process": ("Processo e fluidi", "Process and fluids"),
    "electrical": ("Elettrico ed energia", "Electrical and power"),
    "machines": ("Macchine e movimentazione", "Machines and handling"),
    "building": ("Edificio e HVAC", "Building and HVAC"),
}
ETICHETTE_TIPO = {
    "pumps": ("Pompe", "Pumps"),
    "valves": ("Valvole", "Valves"),
    "tanks": ("Serbatoi e reattori", "Tanks and reactors"),
    "heat-exchange": ("Scambio termico", "Heat exchange"),
    "filters": ("Filtri e separatori", "Filters and separators"),
    "instruments": ("Strumenti", "Instruments"),
    "piping": ("Tubi e raccordi", "Piping and fittings"),
    "motors": ("Motori", "Motors"),
    "cabinets": ("Quadri e automazione", "Cabinets and automation"),
    "distribution": ("Distribuzione", "Distribution"),
    "generation": ("Generazione e accumulo", "Generation and storage"),
    "conveyors": ("Nastri", "Conveyors"),
    "handling": ("Movimentazione", "Handling"),
    "machines": ("Macchine e aria", "Machines and air"),
    "sensors": ("Sensori", "Sensors"),
    "signalling": ("Segnalazione", "Signalling"),
    "hvac": ("HVAC", "HVAC"),
    "building": ("Edificio", "Building"),
}
TIPI_PARTE = ("level", "rotor", "needle", "lever", "lamp")


def fmt(v) -> str:
    """Numero → testo stabile: al più due decimali, niente zeri in coda."""
    if isinstance(v, str):
        return v
    s = f"{float(v):.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def attrs(d: dict) -> str:
    """Attributi in ordine di inserimento; `stroke_width` → `stroke-width`."""
    return "".join(f' {k.replace("_", "-")}="{fmt(v)}"' for k, v in d.items() if v is not None)


class Simbolo:
    """Un simbolo in costruzione. I metodi aggiungono elementi allo strato corrente."""

    def __init__(self, family, slug, w, h, *, tipo, body, it, en, replaces=None):
        assert family in FAMIGLIE, family
        self.family, self.slug, self.w, self.h = family, slug, w, h
        self.tipo, self.body_mat, self.it, self.en, self.replaces = tipo, body, it, en, replaces
        self.defs: list[str] = []
        self.veli_usati: list[str] = []
        self.strati: list[tuple[str, dict, list[str]]] = []
        self.parti: list[dict] = []
        # Bocche (15-10-2026, piano docs/archive/2026-10-15-tubazioni-bocche-e-stili.md):
        # tronchetti e flange disegnati, da cui `porte()` ricava dove si aggancia
        # una tubazione; più quelle dichiarate a mano dove l'inferenza non basta.
        self.tronchetti: list[tuple[float, float, float, float]] = []
        self.flange: list[tuple[float, float, float, float]] = []
        self.bocche_dichiarate: list[dict] = []
        self.n = 0
        self.statico()

    # ── strati ──────────────────────────────────────────────────────────────
    def statico(self):
        nome = f"layer-{sum(1 for s in self.strati if s[0].startswith('layer-'))}"
        self.strati.append((nome, {"data-layer": "static"}, []))

    def corpo(self):
        """Lo strato `body`: il colore lo dà il gruppo (materiale o stato)."""
        self.strati.append(("body", {"data-layer": "part", "data-mat": self.body_mat,
                                     "fill": MATERIALI[self.body_mat]}, []))

    def parte(self, pid, tipo, **geo):
        assert tipo in TIPI_PARTE, tipo
        self.parti.append({"id": pid, "kind": tipo, **geo})
        self.strati.append((pid, {"data-layer": "part"}, []))

    def _qui(self) -> list[str]:
        return self.strati[-1][2]

    # ── forme ───────────────────────────────────────────────────────────────
    def _velo(self, nome):
        if nome not in VELI:
            raise KeyError(nome)
        if nome not in self.veli_usati:
            self.veli_usati.append(nome)
        return f"url(#{self.slug}-{nome})"

    def forma(self, tag, geo: dict, mat=None, velo=None, **extra):
        """Forma piena. `mat=None` eredita il colore dal gruppo (dentro `body`)."""
        a = {}
        if mat:
            a = {"fill": MATERIALI[mat], "data-mat": mat}
        if velo is None:
            self._qui().append(f"<{tag}{attrs(geo)}{attrs(a)}{attrs(extra)}/>")
            return
        self.n += 1
        ref = f"{self.slug}-g{self.n}"
        self.defs.append(f'<{tag} id="{ref}"{attrs(geo)}/>')
        self._qui().append(f'<use href="#{ref}"{attrs(a)}{attrs(extra)}/>')
        self._qui().append(f'<use href="#{ref}" fill="{self._velo(velo)}" stroke="none" opacity="1" data-shade="{velo}"/>')

    def luce(self, tag, geo: dict, velo="glass-r", opacita=1):
        """Riflesso (vetro, lente): un velo senza forma piena sotto."""
        # L'intensità propria va in fill-opacity: `opacity` dei veli è del volume.
        fo = "" if opacita == 1 else f' fill-opacity="{fmt(opacita)}"'
        self._qui().append(f'<{tag}{attrs(geo)} fill="{self._velo(velo)}"{fo} stroke="none" opacity="1" data-shade="{velo}"/>')

    def riflesso(self, tag, geo: dict, opacita=.18):
        self._qui().append(f'<{tag}{attrs(geo)} fill="#fff" fill-opacity="{fmt(opacita)}" stroke="none" opacity="1" data-shade="highlight"/>')

    def tratto(self, d, mat=None, **extra):
        """Linea senza riempimento: col contorno dello strato o col colore di un materiale."""
        a = {"fill": "none"}
        if mat:
            a.update({"stroke": MATERIALI[mat], "data-mat-stroke": mat})
        self._qui().append(f'<path d="{d}"{attrs(a)}{attrs(extra)}/>')

    # ── bocche ──────────────────────────────────────────────────────────────
    def bocca(self, x, y, side, d, pid=None):
        """Una bocca dichiarata a mano: (x, y) sul bordo, `side` il lato d'uscita."""
        assert side in LATI, side
        self.bocche_dichiarate.append({"id": pid, "x": x, "y": y, "side": side, "d": d})

    def porte(self) -> list[dict]:
        """Le bocche del disegno: ogni flangia **sul bordo** del viewBox (entro
        `TOLLERANZA_BORDO`) è una bocca, col punto sul bordo esterno della piastra,
        centrata sul tronchetto che la tocca (o sulla piastra, se non ce n'è) e il
        diametro del tronchetto. Le flange interne sono disegno, non bocche."""
        trovate = []
        for (x, y, w, h) in self.flange:
            if h >= w:  # piastra verticale: tubo orizzontale, bocca a sinistra o a destra
                dist = {"left": x, "right": self.w - (x + w)}
            else:
                dist = {"top": y, "bottom": self.h - (y + h)}
            side = min(dist, key=dist.get)
            if dist[side] > TOLLERANZA_BORDO:
                continue
            orizz = side in ("left", "right")
            tubo = None
            for (tx, ty, tw, th) in self.tronchetti:
                if orizz and tw > th and ty >= y - .5 and ty + th <= y + h + .5 and (abs(tx - (x + w)) < 1 or abs(tx + tw - x) < 1 or tx <= x <= tx + tw):
                    tubo = (tx, ty, tw, th)
                if not orizz and th >= tw and tx >= x - .5 and tx + tw <= x + w + .5 and (abs(ty - (y + h)) < 1 or abs(ty + th - y) < 1 or ty <= y <= ty + th):
                    tubo = (tx, ty, tw, th)
            if orizz:
                cy, d = ((tubo[1] + tubo[3] / 2), tubo[3]) if tubo else (y + h / 2, h - 6)
                px = 0 if side == "left" else self.w
                trovate.append({"x": px, "y": round(cy, 2), "side": side, "d": d})
            else:
                cx, d = ((tubo[0] + tubo[2] / 2), tubo[2]) if tubo else (x + w / 2, w - 6)
                py = 0 if side == "top" else self.h
                trovate.append({"x": round(cx, 2), "y": py, "side": side, "d": d})
        trovate += [{k: v for k, v in b.items() if k != "id"} | ({"_id": b["id"]} if b["id"] else {}) for b in self.bocche_dichiarate]
        # Una sola bocca per punto, poi gli id stabili per lato: `n-left`, `n-left-2`…
        uniche = []
        for b in trovate:
            if not any(u["side"] == b["side"] and abs(u["x"] - b["x"]) < 1 and abs(u["y"] - b["y"]) < 1 for u in uniche):
                uniche.append(b)
        out = []
        for side in LATI:
            del_lato = sorted((b for b in uniche if b["side"] == side), key=lambda b: (b["x"], b["y"]))
            for i, b in enumerate(del_lato):
                pid = b.pop("_id", None) or (f"n-{side}" if i == 0 else f"n-{side}-{i + 1}")
                out.append({"id": pid, **b})
        return out

    # ── uscita ──────────────────────────────────────────────────────────────
    def svg(self) -> str:
        righe = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">']
        righe.append("  <defs>")
        for nome in self.veli_usati:
            kind, geo, stops = VELI[nome]
            righe.append(f'    <{kind}Gradient id="{self.slug}-{nome}"{attrs(geo)}>')
            for o, c, a in stops:
                righe.append(f'      <stop offset="{fmt(o)}" stop-color="{c}" stop-opacity="{fmt(a)}"/>')
            righe.append(f"    </{kind}Gradient>")
        righe += [f"    {d}" for d in self.defs]
        righe.append("  </defs>")
        for nome, a, corpo in self.strati:
            if not corpo:
                continue
            base = {"id": nome, **a, "stroke": CONTORNO, "stroke-width": 1, "stroke-linejoin": "round"}
            righe.append(f"  <g{attrs(base)}>")
            righe += [f"    {e}" for e in corpo]
            righe.append("  </g>")
        righe.append("</svg>")
        return "\n".join(righe) + "\n"

    def voce(self) -> dict:
        v = {"id": f"lib:{self.family}/{self.slug}", "file": f"{self.family}/{self.slug}.svg",
             "family": self.family, "kind": self.tipo,
             "label": f"symbols.lib.{self.family}.{self.slug}",
             "viewBox": [self.w, self.h], "body": self.body_mat,
             "materials": sorted({m for m in re.findall(r'data-mat(?:-stroke)?="([^"]+)"', self.svg())}),
             "parts": self.parti}
        if porte := self.porte():
            v["ports"] = porte
        if self.replaces:
            v["replaces"] = self.replaces
        return v


# ── scrittura e controllo ──────────────────────────────────────────────────

# Le bocche: i lati possibili, e quanto una flangia può stare lontana dal bordo
# del viewBox per contare come bocca (le piastre sono a filo, o quasi).
LATI = ("left", "top", "right", "bottom")
TOLLERANZA_BORDO = 2


def costruisci():
    import disegni  # noqa: E402  (stessa cartella)
    simboli = disegni.tutti()
    ids = [s.slug for s in simboli]
    doppi = {x for x in ids if ids.count(x) > 1}
    if doppi:
        raise SystemExit(f"slug ripetuti: {sorted(doppi)}")
    return sorted(simboli, key=lambda s: (FAMIGLIE.index(s.family), s.slug))


def scrivi(dest: str, simboli) -> None:
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    file = {}
    for s in simboli:
        file[f"{s.family}/{s.slug}.svg"] = s.svg()
    h = hashlib.sha256()
    for k in sorted(file):
        h.update(k.encode())
        h.update(file[k].encode())
    manifest = {
        "_comment": "Generato da scripts/simboli/genera.py — non modificare a mano.",
        "version": h.hexdigest()[:12],
        "materials": MATERIALI,
        "symbols": [s.voce() for s in simboli],
    }
    for k, testo in file.items():
        p = os.path.join(dest, k)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(testo)
    with open(os.path.join(dest, "manifest.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


# Gli id dei simboli builtin che esistevano prima della libreria. Dalla Fase 6b
# (14-10-2026) non c'è più un disegno a mano per nessuno: sono **alias** di un
# disegno della libreria (`replaces`), e stanno nei progetti dei clienti. Ognuno
# deve avere esattamente un sostituto, per sempre: l'elenco è chiuso e non si
# accorcia mai.
BUILTIN_STORICI = (
    "pump", "valve", "motor", "tank", "fan", "compressor", "level_sensor", "flow_meter",
    "pressure_indicator", "breaker", "mixer", "heat_pump", "temperature_sensor", "boiler",
    "agitator", "cooling_tower", "valve_motorized", "valve_pneumatic", "check_valve",
    "valve_3way", "relief_valve", "strainer", "blower", "silo", "conveyor", "cyclone",
    "column", "furnace", "chiller", "heat_exchanger", "separator", "reactor", "filter",
    "solar_panel", "battery", "transmission_tower", "home_lightning", "garage",
    "window_open", "roller_shade",
)


def _builtin_ids() -> set[str]:
    return set(BUILTIN_STORICI)


def _chiave(d: dict, chiave: str):
    for parte in chiave.split("."):
        if not isinstance(d, dict) or parte not in d:
            return None
        d = d[parte]
    return d


VIETATI = re.compile(r"<(text|tspan|style|script|image|filter|fe[A-Z]\w*|animate\w*|set|foreignObject)\b")


def regole(simboli) -> list[str]:
    male = []
    builtin = _builtin_ids()
    lingue = {l: json.load(open(os.path.join(RADICE, "sws-editor", "src", "i18n", f"{l}.json"), encoding="utf-8")) for l in ("it", "en")}
    sostituiti = {}
    for s in simboli:
        testo, nome = s.svg(), f"{s.family}/{s.slug}"
        if m := VIETATI.search(testo):
            male.append(f"{nome}: elemento vietato <{m.group(1)}>")
        for c in re.findall(r'stop-color="([^"]+)"', testo):
            if c not in ("#fff", "#000"):
                male.append(f"{nome}: un velo usa {c} (solo #fff e #000)")
        for el in re.findall(r"<[a-z][^>]*>", testo):
            for attr in ("fill", "stroke"):
                v = re.search(rf'\s{attr}="(#[0-9a-fA-F]{{3,8}})"', el)
                if not v:
                    continue
                c = v.group(1)
                if attr == "stroke" and c == CONTORNO and "data-layer=" in el:
                    continue
                if attr == "fill" and "data-shade=" in el and c == "#fff":
                    continue
                chiave = "data-mat=" if attr == "fill" else "data-mat-stroke="
                mm = re.search(rf'{chiave}"([^"]+)"', el)
                if not mm:
                    male.append(f"{nome}: {attr} {c} senza materiale in {el[:60]}…")
                elif MATERIALI.get(mm.group(1)) != c:
                    male.append(f"{nome}: {attr} {c} non è il colore del materiale {mm.group(1)}")
        for el in re.findall(r"<[a-z][^>]*data-shade=[^>]*>", testo):
            if ' opacity="1"' not in el:
                male.append(f"{nome}: un velo deve nascere con opacity=\"1\" (è il volume): {el[:60]}…")
        ids = set(re.findall(r'\sid="([^"]+)"', testo))
        if "body" not in ids:
            male.append(f"{nome}: manca lo strato body")
        for p in s.parti:
            if p["id"] not in ids:
                male.append(f"{nome}: la parte {p['id']} è nel manifesto ma non nell'SVG")
        for lid in ids:
            if (lid.startswith("lamp-") or lid in TIPI_PARTE) and lid not in {p["id"] for p in s.parti}:
                male.append(f"{nome}: lo strato {lid} non è dichiarato come parte")
        porte = s.porte()
        dichiarate = {(b["x"], b["y"]) for b in s.bocche_dichiarate}
        if len({p["id"] for p in porte}) != len(porte):
            male.append(f"{nome}: due bocche con lo stesso id")
        for p in porte:
            if (p["x"], p["y"]) in dichiarate:
                # Dichiarata a mano: può stare dentro il disegno (lo scarico del silo
                # fra le gambe), ma non fuori.
                if not (0 <= p["x"] <= s.w and 0 <= p["y"] <= s.h):
                    male.append(f"{nome}: la bocca {p['id']} sta fuori dal disegno ({p['x']}, {p['y']})")
                continue
            sul_bordo = {"left": p["x"] == 0, "right": p["x"] == s.w, "top": p["y"] == 0, "bottom": p["y"] == s.h}[p["side"]]
            if not sul_bordo or not (0 <= p["x"] <= s.w and 0 <= p["y"] <= s.h):
                male.append(f"{nome}: la bocca {p['id']} non sta sul bordo {p['side']} ({p['x']}, {p['y']})")
            if not p["d"] > 0:
                male.append(f"{nome}: la bocca {p['id']} ha diametro {p['d']}")
        if max(s.w, s.h) > 512:
            male.append(f"{nome}: viewBox {s.w}×{s.h} oltre i 512 del pannello")
        if s.w % 10 or s.h % 10:
            male.append(f"{nome}: viewBox {s.w}×{s.h} non multiplo di 10")
        if s.replaces:
            if s.replaces not in builtin:
                male.append(f"{nome}: replaces «{s.replaces}» non è un builtin")
            if s.replaces in sostituiti:
                male.append(f"{nome}: «{s.replaces}» è già sostituito da {sostituiti[s.replaces]}")
            sostituiti[s.replaces] = nome
        if s.tipo not in ETICHETTE_TIPO:
            male.append(f"{nome}: tipologia «{s.tipo}» senza etichetta in ETICHETTE_TIPO")
        chiave = f"symbols.lib.{s.family}.{s.slug}"
        for l, atteso in (("it", s.it), ("en", s.en)):
            trovato = _chiave(lingue[l], chiave)
            if trovato != atteso:
                male.append(f"{nome}: {l}.json «{chiave}» = {trovato!r}, il generatore dice {atteso!r}")
    for b in BUILTIN_STORICI:
        if b not in sostituiti:
            male.append(f"il builtin storico «{b}» non ha un sostituto (replaces): i progetti che lo usano mostrerebbero il segnaposto")
    usate = {"famiglia": {s.family for s in simboli}, "tipo": {s.tipo for s in simboli}}
    for gruppo, tabella in (("famiglia", ETICHETTE_FAMIGLIA), ("tipo", ETICHETTE_TIPO)):
        for k in sorted(usate[gruppo]):
            for i, l in enumerate(("it", "en")):
                trovato = _chiave(lingue[l], f"symbols.lib.{gruppo}.{k}")
                if k in tabella and trovato != tabella[k][i]:
                    male.append(f"{l}.json «symbols.lib.{gruppo}.{k}» = {trovato!r}, il generatore dice {tabella[k][i]!r}")
    return male


def confronta(a: str, b: str) -> list[str]:
    diff = []
    def elenco(d):
        out = set()
        for r, _, fs in os.walk(d):
            for f in fs:
                out.add(os.path.relpath(os.path.join(r, f), d))
        return out
    fa, fb = elenco(a), elenco(b)
    for f in sorted(fa - fb):
        diff.append(f"in più nel repo (il generatore non lo produce): {f}")
    for f in sorted(fb - fa):
        diff.append(f"manca nel repo: {f}")
    for f in sorted(fa & fb):
        if open(os.path.join(a, f), "rb").read() != open(os.path.join(b, f), "rb").read():
            diff.append(f"diverso da quello generato: {f}")
    return diff


def main(argv):
    sys.path.insert(0, QUI)
    simboli = costruisci()
    if "--controlla" in argv:
        male = regole(simboli)
        with tempfile.TemporaryDirectory() as tmp:
            scrivi(os.path.join(tmp, "lib"), simboli)
            if not os.path.isdir(USCITA):
                male.append(f"manca {os.path.relpath(USCITA, RADICE)}")
            else:
                male += confronta(USCITA, os.path.join(tmp, "lib"))
        for m in male:
            print(f"  \033[31m✗\033[0m {m}")
        if male:
            print("  Si rigenera con: python3 scripts/simboli/genera.py")
            return 1
        print(f"  \033[32m✓\033[0m {len(simboli)} simboli: file allineati al generatore, regole rispettate")
        return 0
    male = regole(simboli)
    scrivi(USCITA, simboli)
    print(f"{len(simboli)} simboli in {os.path.relpath(USCITA, RADICE)}")
    for m in male:
        print(f"  attenzione: {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
