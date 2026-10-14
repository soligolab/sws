#!/usr/bin/env python3
"""Genera i campioni della libreria SCADA 2.5D (uno per tipologia).

Convenzioni (bozza di specifica):
- viewBox in multipli di 10 (snap dell'editor), attacchi tubo con asse su multipli di 10,
  a filo del bordo; tubo standard 8 px -> bocchello 10, flangia 14-16 x 4.
- luce dall'alto a sinistra; nessun filtro, nessun <text>, nessun <style>, nessun raster.
- `<g id="body">`: colore piatto ereditato dai figli (ricolorabile per stato) + overlay
  `body-shade` di bianchi/neri trasparenti che dà il volume anche dopo la ricolorazione.
- parti mobili in gruppi con id fissi: rotor, lever, needle, level, lamp-*.
- id dei gradienti prefissati col nome del file (inline senza collisioni).
"""
import math, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "svg"
LINE = "#1c2329"

GRAD = {
 "steel-v": ('linear', 'x1="0" y1="0" x2="0" y2="1"', [(0,"#56616b",1),(.18,"#eef2f5",1),(.45,"#b3bcc4",1),(.8,"#7b8690",1),(1,"#4b555e",1)]),
 "steel-h": ('linear', 'x1="0" y1="0" x2="1" y2="0"', [(0,"#56616b",1),(.18,"#eef2f5",1),(.45,"#b3bcc4",1),(.8,"#7b8690",1),(1,"#4b555e",1)]),
 "dark-v":  ('linear', 'x1="0" y1="0" x2="0" y2="1"', [(0,"#5c656e",1),(.2,"#8a939b",1),(.6,"#3e464d",1),(1,"#262c31",1)]),
 "dark-h":  ('linear', 'x1="0" y1="0" x2="1" y2="0"', [(0,"#5c656e",1),(.2,"#8a939b",1),(.6,"#3e464d",1),(1,"#262c31",1)]),
 "steel-r": ('radial', 'cx=".35" cy=".3" r=".8"', [(0,"#f4f7f9",1),(.5,"#a7b1ba",1),(1,"#4f5a63",1)]),
 "rubber-r":('radial', 'cx=".4" cy=".35" r=".7"', [(0,"#5a6066",1),(.7,"#2a2d31",1),(1,"#141618",1)]),
 "shade-v": ('linear', 'x1="0" y1="0" x2="0" y2="1"', [(0,"#000",.25),(.2,"#fff",.5),(.45,"#fff",.08),(.75,"#000",.12),(1,"#000",.45)]),
 "shade-h": ('linear', 'x1="0" y1="0" x2="1" y2="0"', [(0,"#000",.25),(.2,"#fff",.5),(.45,"#fff",.08),(.75,"#000",.12),(1,"#000",.45)]),
 "shade-r": ('radial', 'cx=".36" cy=".3" r=".75"', [(0,"#fff",.55),(.5,"#fff",.05),(1,"#000",.45)]),
 "shade-d": ('linear', 'x1="0" y1="0" x2="1" y2="1"', [(0,"#fff",.35),(.5,"#fff",0),(1,"#000",.3)]),
 "glass-r": ('radial', 'cx=".35" cy=".3" r=".7"', [(0,"#fff",.9),(.3,"#fff",.25),(1,"#fff",0)]),
 "dial-r":  ('radial', 'cx=".4" cy=".35" r=".75"', [(0,"#ffffff",1),(.7,"#eef1f3",1),(1,"#c9d0d6",1)]),
}

class Sym:
    def __init__(self, slug, w, h):
        self.p, self.w, self.h = slug, w, h
        self.defs, self.parts, self.n = [], [], 0
    def g(self, name):
        return f"url(#{self.p}-{name})"
    def add(self, xml):
        self.parts.append(xml)
    def layer(self, gid, color, shapes):
        """Gruppo ricolorabile: forme piatte (fill ereditato) + overlay di volume."""
        uses, shades = [], []
        for xml, ov in shapes:
            self.n += 1
            ref = f"{self.p}-s{self.n}"
            tag, rest = xml.split(" ", 1)
            self.defs.append(f'{tag} id="{ref}" {rest}')
            uses.append(f'<use href="#{ref}"/>')
            if ov:
                shades.append(f'<use href="#{ref}" fill="{self.g(ov)}"/>')
        self.add(f'<g id="{gid}" fill="{color}">' + "".join(uses) + "</g>")
        if shades:
            self.add(f'<g id="{gid}-shade" stroke="none">' + "".join(shades) + "</g>")
    def render(self):
        body = "\n  ".join(self.parts)
        used = [k for k in GRAD if f"#{self.p}-{k})" in body]
        gd = []
        for k in used:
            kind, attrs, stops = GRAD[k]
            st = "".join(f'<stop offset="{o}" stop-color="{c}"' + (f' stop-opacity="{a}"' if a != 1 else "") + "/>" for o, c, a in stops)
            gd.append(f'<{kind}Gradient id="{self.p}-{k}" {attrs}>{st}</{kind}Gradient>')
        defs = "\n    ".join(gd + self.defs)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">\n'
                f'  <defs>\n    {defs}\n  </defs>\n'
                f'  <g stroke="{LINE}" stroke-width="1" stroke-linejoin="round">\n  {body}\n  </g>\n</svg>\n')

def flange_h(s, x, y, w=4, h=16):   # piastra verticale (luce da sinistra)
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="0.8" fill="{s.g("steel-h")}"/>'
def flange_v(s, x, y, w=16, h=4):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="0.8" fill="{s.g("steel-v")}"/>'
def stub_h(s, x, y, w, h=10):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{s.g("steel-v")}"/>'
def stub_v(s, x, y, h, w=10):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{s.g("steel-h")}"/>'
def arc_pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy - r * math.sin(a)

S = {}

# ── Processo e fluidi ────────────────────────────────────────────────────────
s = Sym("pompa-centrifuga", 80, 80)
s.add(stub_h(s, 4, 45, 20) + flange_h(s, 0, 42))
s.add(stub_v(s, 45, 4, 32) + flange_v(s, 42, 0))
s.add(f'<path d="M30 66 L50 66 L55 74 L25 74 Z" fill="{s.g("dark-v")}"/>'
      f'<rect x="12" y="74" width="56" height="6" rx="1" fill="{s.g("dark-v")}"/>')
s.layer("body", "#2f6fa8", [('<circle cx="40" cy="50" r="20"/>', "shade-r")])
s.add('<g stroke="none" fill="#1c2329" fill-opacity=".45">' + "".join(
      f'<circle cx="{40+16.5*math.cos(math.radians(a)):.1f}" cy="{50+16.5*math.sin(math.radians(a)):.1f}" r="1.1"/>' for a in range(0, 360, 45)) + "</g>")
vanes = "".join(f'<path d="M{40+3*math.cos(math.radians(a)):.1f} {50+3*math.sin(math.radians(a)):.1f} Q{40+7*math.cos(math.radians(a+40)):.1f} {50+7*math.sin(math.radians(a+40)):.1f} {40+9*math.cos(math.radians(a+70)):.1f} {50+9*math.sin(math.radians(a+70)):.1f}"/>' for a in range(0, 360, 60))
s.add(f'<g id="rotor"><circle cx="40" cy="50" r="10.5" fill="#1d3f62"/>'
      f'<g fill="none" stroke="#9cc1e6" stroke-width="1.4" stroke-linecap="round">{vanes}</g>'
      f'<circle cx="40" cy="50" r="3.2" fill="{s.g("steel-r")}"/></g>')
S["pompe"] = s

s = Sym("valvola-sfera", 60, 60)
s.add(stub_h(s, 4, 35, 14) + flange_h(s, 0, 32) + stub_h(s, 42, 35, 14) + flange_h(s, 56, 32))
s.add(f'<rect x="27" y="17" width="6" height="8" fill="{s.g("steel-h")}"/>')
s.layer("body", "#6b7c8a", [('<rect x="25" y="22" width="10" height="9" rx="1.5"/>', "shade-h"),
                            ('<rect x="16" y="28" width="28" height="24" rx="8"/>', "shade-v")])
s.add('<path d="M22 40 L38 40" stroke-opacity=".35" fill="none"/>')
s.layer("lever", "#c8352e", [('<rect x="22" y="10" width="36" height="7" rx="2"/>', "shade-v")])
s.add(f'<circle cx="30" cy="13.5" r="4" fill="{s.g("steel-r")}"/>')
S["valvole"] = s

s = Sym("serbatoio-verticale", 80, 160)
s.add(stub_v(s, 35, 4, 12) + flange_v(s, 33, 0, 14))
s.add(stub_h(s, 66, 125, 10) + flange_h(s, 76, 122))
s.add(f'<rect x="14" y="134" width="6" height="22" fill="{s.g("dark-h")}"/><rect x="60" y="134" width="6" height="22" fill="{s.g("dark-h")}"/>'
      f'<rect x="10" y="155" width="14" height="5" rx="1" fill="{s.g("dark-v")}"/><rect x="56" y="155" width="14" height="5" rx="1" fill="{s.g("dark-v")}"/>')
s.layer("body", "#b4bec7", [('<path d="M10 32 Q10 14 40 12 Q70 14 70 32 L70 128 Q70 146 40 148 Q10 146 10 128 Z"/>', "shade-h")])
s.add('<g fill="none" stroke-opacity=".3"><path d="M10 32 L70 32"/><path d="M10 128 L70 128"/><path d="M10 80 L70 80"/></g>')
s.add('<rect x="30" y="38" width="20" height="84" rx="3" fill="#1d2a35"/>')
s.layer("level", "#2b8fd6", [('<rect x="31" y="72" width="18" height="49" rx="2"/>', "shade-h")])
s.add(f'<rect x="33" y="40" width="4" height="80" rx="2" stroke="none" fill="#fff" fill-opacity=".18"/>')
S["serbatoi"] = s

s = Sym("scambiatore-fascio-tubiero", 160, 80)
s.add(stub_v(s, 15, 4, 12) + flange_v(s, 12, 0) + stub_v(s, 15, 60, 16) + flange_v(s, 12, 76))
s.add(stub_v(s, 55, 4, 14) + flange_v(s, 52, 0) + stub_v(s, 115, 58, 18) + flange_v(s, 112, 76))
s.add(f'<path d="M44 58 L60 58 L64 76 L40 76 Z" fill="{s.g("dark-v")}"/><path d="M84 58 L100 58 L104 76 L80 76 Z" fill="{s.g("dark-v")}"/>'
      f'<rect x="36" y="76" width="32" height="4" rx="1" fill="{s.g("dark-v")}"/><rect x="76" y="76" width="32" height="4" rx="1" fill="{s.g("dark-v")}"/>')
s.add(f'<rect x="4" y="10" width="6" height="56" rx="1" fill="{s.g("steel-h")}"/>')
s.layer("body", "#b4bec7", [('<rect x="10" y="14" width="18" height="48"/>', "shade-v"),
                            ('<rect x="32" y="16" width="104" height="44"/>', "shade-v"),
                            ('<path d="M136 16 Q156 16 156 38 Q156 60 136 60 Z"/>', "shade-v")])
s.add(f'<rect x="28" y="10" width="4" height="56" rx="0.8" fill="{s.g("steel-h")}"/><rect x="134" y="12" width="4" height="52" rx="0.8" fill="{s.g("steel-h")}"/>')
s.add('<g fill="none" stroke-opacity=".22" stroke-dasharray="6 3">' + "".join(f'<path d="M36 {y} L130 {y}"/>' for y in (24, 31, 38, 45, 52)) + "</g>")
S["scambiatori"] = s

s = Sym("filtro-cartuccia", 60, 120)
s.add(stub_h(s, 4, 35, 8) + flange_h(s, 0, 32) + stub_h(s, 48, 35, 8) + flange_h(s, 56, 32))
s.add(f'<rect x="12" y="98" width="4" height="22" fill="{s.g("dark-h")}"/><rect x="44" y="98" width="4" height="22" fill="{s.g("dark-h")}"/>')
s.add(stub_v(s, 27, 100, 10, 6) + f'<rect x="24" y="108" width="12" height="5" rx="1" fill="#c8352e"/>')
s.add(f'<rect x="28.5" y="2" width="3" height="10" fill="{s.g("steel-h")}"/><circle cx="30" cy="6" r="5" fill="{s.g("dial-r")}"/>')
s.layer("body", "#b4bec7", [('<path d="M12 22 Q12 10 30 10 Q48 10 48 22 Z"/>', "shade-h"),
                            ('<path d="M10 26 L50 26 L50 92 Q50 102 30 102 Q10 102 10 92 Z"/>', "shade-h")])
s.add(f'<rect x="8" y="21" width="44" height="6" rx="1.5" fill="{s.g("steel-v")}"/>')
s.add('<g fill="none" stroke-opacity=".25">' + "".join(f'<path d="M{x} 50 L{x} 88"/>' for x in range(18, 44, 4)) + "</g>")
S["filtri e separatori"] = s

s = Sym("manometro", 60, 60)
s.add(f'<rect x="27" y="52" width="6" height="8" fill="{s.g("steel-h")}"/>'
      f'<path d="M23 46 L37 46 L38 49 L37 53 L23 53 L22 49 Z" fill="{s.g("steel-v")}"/>')
s.layer("body", "#9aa5af", [('<circle cx="30" cy="26" r="23"/>', "shade-r")])
s.add(f'<circle cx="30" cy="26" r="19" fill="{s.g("dial-r")}"/>')
def arc(cx, cy, r, a0, a1):
    (x0, y0), (x1, y1) = arc_pt(cx, cy, r, a0), arc_pt(cx, cy, r, a1)
    return f"M{x0:.2f} {y0:.2f} A{r} {r} 0 {1 if abs(a1-a0) > 180 else 0} 1 {x1:.2f} {y1:.2f}"
s.add(f'<g fill="none" stroke-width="2.4" stroke-linecap="butt"><path d="{arc(30,26,15.5,225,9)}" stroke="#3fae5a"/>'
      f'<path d="{arc(30,26,15.5,9,-18)}" stroke="#e0a91b"/><path d="{arc(30,26,15.5,-18,-45)}" stroke="#d13c32"/></g>')
ticks = []
for i in range(11):
    a = 225 - 27 * i
    (x0, y0), (x1, y1) = arc_pt(30, 26, 17.5, a), arc_pt(30, 26, 13 if i % 5 == 0 else 14.5, a)
    ticks.append(f'<path d="M{x0:.2f} {y0:.2f} L{x1:.2f} {y1:.2f}"/>')
s.add('<g stroke-width="0.9" stroke-linecap="round">' + "".join(ticks) + "</g>")
nx, ny = arc_pt(30, 26, 14, 225 - 27 * 6)
s.add(f'<g id="needle"><path d="M30 26 L{nx:.2f} {ny:.2f}" stroke="#c8352e" stroke-width="1.6" stroke-linecap="round"/><circle cx="30" cy="26" r="2.2" fill="{s.g("steel-r")}"/></g>')
s.add(f'<circle cx="30" cy="26" r="19" stroke="none" fill="{s.g("glass-r")}" fill-opacity=".5"/>')
S["strumenti"] = s

s = Sym("curva-90", 60, 60)
s.layer("body", "#9aa5af", [('<rect x="4" y="25" width="6" height="10"/>', "shade-v"),
                            ('<path d="M10 25 A25 25 0 0 1 35 50 L25 50 A15 15 0 0 0 10 35 Z"/>', "shade-r"),
                            ('<rect x="25" y="50" width="10" height="6"/>', "shade-h")])
s.add(flange_h(s, 0, 22) + flange_v(s, 22, 56))
S["tubi e raccordi"] = s

# ── Elettrico ed energia ─────────────────────────────────────────────────────
s = Sym("motore-elettrico", 120, 60)
s.add(f'<path d="M30 50 L40 50 L42 58 L28 58 Z" fill="{s.g("dark-v")}"/><path d="M76 50 L86 50 L88 58 L74 58 Z" fill="{s.g("dark-v")}"/>')
s.add(f'<rect x="100" y="25" width="20" height="10" fill="{s.g("steel-v")}"/><path d="M104 28 L116 28" stroke-opacity=".5" fill="none"/>')
s.add(f'<rect x="90" y="14" width="10" height="32" rx="2" fill="{s.g("steel-v")}"/>')
s.add(f'<rect x="4" y="12" width="20" height="36" rx="5" fill="{s.g("dark-v")}"/>'
      '<g fill="none" stroke="#11161a" stroke-opacity=".6">' + "".join(f'<path d="M{x} 17 L{x} 43"/>' for x in (9, 13, 17, 21)) + "</g>")
s.layer("body", "#5d6f7e", [('<rect x="46" y="1" width="26" height="9" rx="1.5"/>', "shade-d"),
                            ('<rect x="24" y="8" width="66" height="44" rx="4"/>', "shade-v")])
s.add('<g fill="none" stroke-opacity=".35">' + "".join(f'<path d="M27 {y} L87 {y}"/>' for y in range(14, 48, 5)) + "</g>")
s.add(f'<rect x="52" y="30" width="16" height="9" rx="1" fill="#d7dde2" stroke-width=".8"/>')
S["motori"] = s

s = Sym("quadro-elettrico", 80, 120)
s.add(f'<rect x="6" y="110" width="68" height="10" rx="1" fill="{s.g("dark-v")}"/>')
s.layer("body", "#c8cdd2", [('<rect x="4" y="6" width="72" height="105" rx="2"/>', "shade-d")])
s.add(f'<rect x="2" y="2" width="76" height="6" rx="1.5" fill="{s.g("steel-v")}"/>')
s.add('<rect x="8.5" y="11.5" width="63" height="95" rx="1.5" fill="none" stroke-opacity=".45"/>')
s.add(f'<rect x="63" y="52" width="4.5" height="18" rx="2" fill="{s.g("dark-h")}"/>')
s.add('<rect x="16" y="20" width="40" height="22" rx="2" fill="#26313b"/>')
for i, (lid, col) in enumerate((("lamp-1", "#3fb950"), ("lamp-2", "#e0a91b"), ("lamp-3", "#d13c32"))):
    cx = 25 + 11 * i
    s.add(f'<g id="{lid}"><circle cx="{cx}" cy="31" r="4.5" fill="{col}"/><circle cx="{cx}" cy="31" r="4.5" stroke="none" fill="{s.g("glass-r")}"/></g>')
s.add(f'<circle cx="36" cy="58" r="7" fill="#e0a91b"/><circle cx="36" cy="58" r="4.8" fill="#c8352e"/><circle cx="36" cy="58" r="4.8" stroke="none" fill="{s.g("shade-r")}"/>')
s.add('<path d="M36 72 L44 85 L28 85 Z" fill="#e0a91b"/><path d="M37 75 L33.5 80.5 L36.5 80.5 L35 84" fill="none" stroke-width=".9"/>')
s.add('<g fill="none" stroke-opacity=".5">' + "".join(f'<path d="M20 {y} L52 {y}"/>' for y in range(91, 103, 3)) + "</g>")
S["quadri e automazione"] = s

s = Sym("trasformatore", 100, 100)
s.add(f'<rect x="12" y="86" width="76" height="6" rx="1" fill="{s.g("dark-v")}"/>')
fins = "".join(f'<rect x="{x}" y="40" width="2.2" height="42" fill="{s.g("steel-h")}" stroke-width=".6"/>' for x in (4, 7.5, 11, 82.8, 86.3, 89.8, 93.3))
s.add(f'<rect x="3" y="44" width="94" height="3" fill="{s.g("steel-v")}"/><rect x="3" y="74" width="94" height="3" fill="{s.g("steel-v")}"/>' + fins)
s.layer("body", "#8a9196", [('<rect x="15" y="34" width="70" height="52" rx="2"/>', "shade-d")])
s.add(f'<rect x="13" y="31" width="74" height="5" rx="1" fill="{s.g("steel-v")}"/>')
for x in (30, 50, 70):
    sheds = "".join(f'<ellipse cx="{x}" cy="{y}" rx="6" ry="2" fill="#a0583a"/>' for y in (26, 20, 14))
    s.add(f'<rect x="{x-3}" y="8" width="6" height="24" fill="#8c4a2f"/>{sheds}<rect x="{x-2}" y="2" width="4" height="7" fill="{s.g("steel-h")}"/>')
s.add('<path d="M50 50 L58 63 L42 63 Z" fill="#e0a91b"/><path d="M51 53 L47.5 58.5 L50.5 58.5 L49 62" fill="none" stroke-width=".9"/>')
S["distribuzione"] = s

s = Sym("pannello-fotovoltaico", 100, 80)
s.add(f'<path d="M30 60 L24 78 M70 60 L76 78" stroke="#3e464d" stroke-width="4" stroke-linecap="round"/><path d="M26 74 L74 74" stroke="#3e464d" stroke-width="2.5"/>')
s.add(f'<rect x="3" y="3" width="94" height="58" rx="1.5" fill="{s.g("steel-v")}"/>')
s.layer("body", "#1f3a5f", [('<rect x="6" y="6" width="88" height="52"/>', "shade-d")])
s.add('<g fill="none" stroke="#7f9fc6" stroke-opacity=".55" stroke-width=".7">' +
      "".join(f'<path d="M{6+88*i/8:.1f} 6 L{6+88*i/8:.1f} 58"/>' for i in range(1, 8)) +
      "".join(f'<path d="M6 {6+52*j/5:.1f} L94 {6+52*j/5:.1f}"/>' for j in range(1, 5)) + "</g>")
s.add('<path d="M6 6 L40 6 L14 58 L6 58 Z" stroke="none" fill="#fff" fill-opacity=".08"/>')
S["generazione e accumulo"] = s

# ── Macchine e movimentazione ────────────────────────────────────────────────
s = Sym("nastro-trasportatore", 160, 60)
s.add(f'<rect x="24" y="30" width="6" height="26" fill="{s.g("dark-h")}"/><rect x="130" y="30" width="6" height="26" fill="{s.g("dark-h")}"/>'
      f'<path d="M30 36 L130 50 M30 50 L130 36" stroke="#3e464d" stroke-width="2"/>'
      f'<rect x="20" y="55" width="14" height="5" rx="1" fill="{s.g("dark-v")}"/><rect x="126" y="55" width="14" height="5" rx="1" fill="{s.g("dark-v")}"/>')
s.add(f'<rect x="4" y="8" width="152" height="24" rx="12" fill="{s.g("rubber-r")}"/>')
for i, cx in enumerate((16, 144)):
    s.add(f'<g id="rotor-{i+1}"><circle cx="{cx}" cy="20" r="9.5" fill="{s.g("steel-r")}"/>'
          f'<path d="M{cx-7} 20 L{cx+7} 20 M{cx} 13 L{cx} 27" stroke-opacity=".5"/><circle cx="{cx}" cy="20" r="2.5" fill="#3e464d"/></g>')
s.layer("body", "#5d6f7e", [('<rect x="26" y="13" width="108" height="14" rx="1.5"/>', "shade-v")])
s.add('<g stroke="none" fill="#1c2329" fill-opacity=".5">' + "".join(f'<circle cx="{x}" cy="20" r="1.2"/>' for x in range(36, 130, 16)) + "</g>")
S["nastri"] = s

s = Sym("carrello-elevatore", 120, 100)
s.add(f'<rect x="86" y="6" width="6" height="78" fill="{s.g("dark-h")}"/><rect x="92" y="54" width="5" height="28" fill="{s.g("dark-h")}"/>'
      f'<path d="M95 78 L118 78 L118 82 L93 82 Z" fill="{s.g("steel-v")}"/>')
s.add('<path d="M32 52 L35 16 M75 52 L72 16" stroke="#2b3238" stroke-width="3.5" stroke-linecap="round" fill="none"/>'
      f'<rect x="29" y="12" width="48" height="5" rx="1.5" fill="{s.g("dark-v")}"/>')
s.add('<path d="M40 52 L42 38 L52 38 L50 46 L56 52 Z" fill="#2a2d31"/><path d="M60 40 L66 52" stroke="#2a2d31" stroke-width="2.5" stroke-linecap="round"/>')
s.layer("body", "#e3a51a", [('<path d="M18 52 L84 52 L84 80 L14 80 Q8 80 8 72 L8 62 Q8 52 18 52 Z"/>', "shade-v")])
s.add('<path d="M10 70 L84 70" stroke-opacity=".35" fill="none"/>')
for cx, cy, r in ((68, 86, 12), (26, 88, 10)):
    s.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{s.g("rubber-r")}"/><circle cx="{cx}" cy="{cy}" r="{r*.45:.1f}" fill="{s.g("steel-r")}"/>')
S["movimentazione"] = s

s = Sym("ventilatore-centrifugo", 100, 100)
s.add(f'<rect x="22" y="94" width="56" height="6" rx="1" fill="{s.g("dark-v")}"/>')
s.add(flange_v(s, 48, 4, 44))
s.layer("body", "#2f6fa8", [('<path d="M90 56 A40 40 0 1 1 50 16 L50 8 L90 8 Z"/>', "shade-r")])
blades = "".join(f'<path d="M{50+5*math.cos(math.radians(a)):.1f} {56+5*math.sin(math.radians(a)):.1f} Q{50+10*math.cos(math.radians(a+25)):.1f} {56+10*math.sin(math.radians(a+25)):.1f} {50+13*math.cos(math.radians(a+45)):.1f} {56+13*math.sin(math.radians(a+45)):.1f}"/>' for a in range(0, 360, 45))
s.add(f'<circle cx="50" cy="56" r="16" fill="{s.g("steel-r")}"/>'
      f'<g id="rotor"><circle cx="50" cy="56" r="13.5" fill="#1d3f62"/><g fill="none" stroke="#9cc1e6" stroke-width="1.4" stroke-linecap="round">{blades}</g>'
      f'<circle cx="50" cy="56" r="3.5" fill="{s.g("steel-r")}"/></g>')
S["macchine"] = s

s = Sym("fotocellula", 60, 40)
s.add('<path d="M0 20 L4 20" stroke="#2a2d31" stroke-width="4"/>'
      f'<rect x="3" y="14" width="7" height="12" rx="1.5" fill="{s.g("dark-v")}"/>')
s.layer("body", "#e3a51a", [('<rect x="10" y="6" width="34" height="28" rx="3"/>', "shade-d")])
s.add(f'<rect x="44" y="10" width="7" height="20" rx="1.5" fill="#1d2a35"/><rect x="44" y="10" width="7" height="20" rx="1.5" stroke="none" fill="{s.g("glass-r")}" fill-opacity=".6"/>')
s.add(f'<g id="led"><circle cx="17" cy="12" r="2.3" fill="#3fb950"/><circle cx="17" cy="12" r="2.3" stroke="none" fill="{s.g("glass-r")}"/></g>')
s.add('<g stroke="#d13c32" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".8"><path d="M54 15 L59 13"/><path d="M54 20 L59.5 20"/><path d="M54 25 L59 27"/></g>')
S["sensori"] = s

s = Sym("colonna-luminosa", 30, 100)
s.add(f'<rect x="4" y="92" width="22" height="8" rx="1.5" fill="{s.g("dark-v")}"/><rect x="12" y="68" width="6" height="25" fill="{s.g("steel-h")}"/>')
s.layer("body", "#3e464d", [('<path d="M6 14 Q6 6 15 6 Q24 6 24 14 Z"/>', "shade-h"),
                            ('<rect x="5" y="66" width="20" height="5" rx="1"/>', "shade-h")])
for i, (lid, col) in enumerate((("lamp-red", "#d13c32"), ("lamp-amber", "#e0a91b"), ("lamp-green", "#3fb950"))):
    y = 15 + 17 * i
    s.add(f'<g id="{lid}"><rect x="6" y="{y}" width="18" height="15" rx="1" fill="{col}"/><rect x="6" y="{y}" width="18" height="15" rx="1" stroke="none" fill="{s.g("shade-h")}"/>'
          f'<rect x="9" y="{y+2}" width="3" height="11" rx="1.5" stroke="none" fill="#fff" fill-opacity=".35"/></g>')
    s.add(f'<rect x="5" y="{y-1.5+ (0 if i else 0)}" width="20" height="2" rx=".8" fill="#3e464d"/>' if i else "")
S["segnalazione"] = s

os.makedirs(OUT, exist_ok=True)
for cat, sym in S.items():
    open(os.path.join(OUT, sym.p + ".svg"), "w").write(sym.render())
    print(f"{cat}\t{sym.p}.svg\t{sym.w}x{sym.h}")
