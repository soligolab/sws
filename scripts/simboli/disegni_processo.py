"""Fase 7, lotto 1: il resto di «Processo e fluidi» (pompe, valvole, serbatoi,
scambio termico, filtri, strumenti, tubi e raccordi). Stesse regole di
`disegni.py`; nessuno di questi sostituisce un builtin.
"""
import math

from genera import Simbolo
from disegni import C, E, P, R, f2, flangia_o, flangia_v, girante, polare, tubo_o, tubo_v
from disegni_sostitutivi import corpo_valvola, petali


def volantino(s, cx, cy, r, mat="signal-red"):
    """Un volantino visto di fronte: corona e tre razze."""
    s.forma(*C(cx, cy, r), mat=mat, velo="paint-r")
    s.forma(*C(cx, cy, r - 3), fill="none", stroke_opacity=.5)
    for a in (90, 210, 330):
        x, y = polare(cx, cy, r - 2, a)
        s.tratto(f"M{cx} {cy} L{f2(x)} {f2(y)}", stroke_width=1.6, stroke_linecap="round")
    s.forma(*C(cx, cy, 2.6), mat="steel", velo="metal-r")


def nervature(s, x0, x1, y0, y1, passo, verticali=True, opacita=.35):
    if verticali:
        for x in range(x0, x1, passo):
            s.tratto(f"M{x} {y0} L{x} {y1}", stroke_opacity=opacita)
    else:
        for y in range(y0, y1, passo):
            s.tratto(f"M{x0} {y} L{x1} {y}", stroke_opacity=opacita)


# ── Pompe ───────────────────────────────────────────────────────────────────

def inline_pump():
    s = Simbolo("process", "inline-pump", 60, 110, tipo="pumps", body="body-pump", it="Pompa in linea", en="Inline pump")
    tubo_o(s, 4, 85, 10); flangia_v(s, 0, 82)
    tubo_o(s, 46, 85, 10); flangia_v(s, 56, 82)
    s.forma(*R(16, 4, 28, 56, 4), mat="body-motor", velo="paint-h")
    nervature(s, 20, 41, 10, 54, 4)
    s.forma(*P("M22 60 L38 60 L40 74 L20 74 Z"), mat="steel-dark", velo="dark-h")
    s.corpo()
    s.forma(*R(12, 72, 36, 32, 8), velo="paint-r")
    s.statico()
    s.forma(*R(10, 70, 40, 5, 1), mat="steel", velo="metal-v")
    return s


def submersible_pump():
    s = Simbolo("process", "submersible-pump", 50, 120, tipo="pumps", body="body-pump", it="Pompa sommersa", en="Submersible pump")
    tubo_v(s, 20, 4, 18); flangia_o(s, 17, 0)
    s.tratto("M36 18 Q46 30 44 60", mat="rubber", stroke_width=2.2)
    s.corpo()
    s.forma(*R(12, 20, 26, 34, 6), velo="paint-h")
    s.statico()
    s.forma(*R(10, 52, 30, 8, 2), mat="steel", velo="metal-v")
    for y in range(54, 59, 3):
        s.tratto(f"M14 {y} L36 {y}", stroke_opacity=.5)
    s.forma(*R(12, 60, 26, 56, 8), mat="body-motor", velo="paint-h")
    nervature(s, 16, 36, 66, 112, 4)
    return s


def gear_pump():
    s = Simbolo("process", "gear-pump", 80, 70, tipo="pumps", body="body-pump", it="Pompa a ingranaggi", en="Gear pump")
    tubo_o(s, 4, 35, 12); flangia_v(s, 0, 32)
    tubo_o(s, 64, 35, 12); flangia_v(s, 76, 32)
    s.forma(*R(10, 60, 60, 10, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(16, 12, 48, 50, 10), velo="paint-v")
    s.statico()
    for cx in (33, 47):
        s.forma(*C(cx, 37, 10), mat="steel", velo="metal-r")
        for i in range(10):
            a = i * 36
            x0, y0 = polare(cx, 37, 8, a)
            x1, y1 = polare(cx, 37, 11, a)
            s.tratto(f"M{f2(x0)} {f2(y0)} L{f2(x1)} {f2(y1)}", stroke_width=1.6)
        s.forma(*C(cx, 37, 2.4), mat="steel-dark")
    return s


def screw_pump():
    s = Simbolo("process", "screw-pump", 140, 70, tipo="pumps", body="body-pump", it="Pompa a vite", en="Screw pump")
    tubo_v(s, 45, 4, 14); flangia_o(s, 42, 0)
    tubo_o(s, 124, 35, 12); flangia_v(s, 136, 32)
    s.forma(*R(4, 60, 132, 10, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(6, 22, 24, 34, 4), mat="body-motor", velo="paint-v")
    nervature(s, 10, 27, 27, 52, 4)
    s.forma(*R(30, 33, 8, 12), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(38, 18, 30, 42, 6), velo="paint-v")
    s.forma(*R(68, 26, 58, 26, 8), velo="paint-v")
    s.statico()
    s.tratto("M72 39 Q78 30 84 39 Q90 48 96 39 Q102 30 108 39 Q114 48 120 39", stroke_opacity=.5, stroke_width=1.4)
    return s


def diaphragm_pump():
    s = Simbolo("process", "diaphragm-pump", 90, 100, tipo="pumps", body="body-pump", it="Pompa a membrana", en="Diaphragm pump")
    tubo_v(s, 40, 4, 10); flangia_o(s, 37, 0)
    tubo_v(s, 40, 86, 10); flangia_o(s, 37, 96)
    s.forma(*R(12, 12, 66, 10, 4), mat="steel", velo="metal-v")
    s.forma(*R(12, 78, 66, 10, 4), mat="steel", velo="metal-v")
    s.forma(*R(38, 40, 14, 20, 2), mat="steel-dark", velo="dark-h")
    s.corpo()
    s.forma(*C(24, 50, 18), velo="paint-r")
    s.forma(*C(66, 50, 18), velo="paint-r")
    s.statico()
    for cx in (24, 66):
        s.forma(*C(cx, 50, 11), fill="none", stroke_opacity=.45)
        s.forma(*C(cx, 50, 3), mat="steel", velo="metal-r")
    return s


def peristaltic_pump():
    s = Simbolo("process", "peristaltic-pump", 80, 90, tipo="pumps", body="appliance", it="Pompa peristaltica", en="Peristaltic pump")
    tubo_v(s, 15, 76, 14); tubo_v(s, 55, 76, 14)
    s.corpo()
    s.forma(*R(6, 4, 68, 74, 6), velo="paint-d")
    s.statico()
    s.forma(*C(40, 38, 26), mat="glass-dark")
    s.tratto("M20 78 L20 46 A20 20 0 0 1 60 46 L60 78", mat="rubber", stroke_width=5, stroke_linecap="butt")
    s.parte("rotor", "rotor", cx=40, cy=38, symmetry=120)
    s.forma(*P("M40 38 L40 22 M40 38 L26.1 46 M40 38 L53.9 46"), mat="steel", stroke_width=3)
    for a in (90, 210, 330):
        x, y = polare(40, 38, 16, a)
        s.forma(*C(f2(x), f2(y), 4.5), mat="steel", velo="metal-r")
    s.forma(*C(40, 38, 4), mat="steel-dark")
    s.statico()
    s.luce(*C(40, 38, 26), opacita=.35)
    return s


def dosing_pump():
    s = Simbolo("process", "dosing-pump", 70, 90, tipo="pumps", body="safety-yellow", it="Pompa dosatrice", en="Dosing pump")
    tubo_v(s, 47, 4, 14, w=6); tubo_v(s, 47, 72, 14, w=6)
    s.forma(*R(4, 78, 62, 12, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(38, 18, 24, 54, 4), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(6, 24, 34, 54, 5), velo="paint-d")
    s.statico()
    s.forma(*R(12, 32, 22, 12, 2), mat="glass-dark")
    s.tratto("M15 38 L31 38", mat="lamp-green", stroke_width=1.6, stroke_linecap="round")
    s.forma(*C(23, 60, 7), mat="steel-dark", velo="dark-v")
    s.tratto("M23 60 L23 54", mat="label", stroke_width=1.6, stroke_linecap="round")
    return s


def piston_pump():
    s = Simbolo("process", "piston-pump", 110, 80, tipo="pumps", body="body-pump", it="Pompa a pistoni", en="Piston pump")
    tubo_v(s, 85, 4, 12); flangia_o(s, 82, 0)
    tubo_v(s, 85, 66, 10)
    s.forma(*R(4, 70, 102, 10, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(52, 34, 22, 14), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(8, 20, 46, 50, 6), velo="paint-v")
    s.forma(*R(72, 14, 30, 56, 4), velo="paint-v")
    s.statico()
    s.tratto("M78 26 L96 26 M78 41 L96 41 M78 56 L96 56", stroke_opacity=.45)
    s.forma(*C(31, 45, 11), fill="none", stroke_opacity=.45)
    return s


# ── Valvole ─────────────────────────────────────────────────────────────────

def butterfly_valve():
    s = Simbolo("process", "butterfly-valve", 60, 70, tipo="valves", body="steel", it="Valvola a farfalla", en="Butterfly valve")
    corpo_valvola(s, 50, x0=22, x1=38)
    s.forma(*R(27, 26, 6, 14), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(22, 34, 16, 32, 4), velo="paint-h")
    s.statico()
    s.forma(*E(30, 50, 3, 12), mat="steel", velo="metal-h")
    s.parte("lever", "lever", cx=30, cy=24, open=0, closed=-90)
    s.forma(*R(24, 20.5, 28, 7, 2), mat="signal-red", velo="paint-v")
    s.forma(*C(30, 24, 4), mat="steel", velo="metal-r")
    return s


def _corpo_con_cappello(s, cy):
    s.corpo()
    s.forma(*R(22, cy - 26, 16, 16, 2), velo="paint-h")
    s.forma(*R(16, cy - 12, 28, 24, 8), velo="paint-v")
    s.statico()
    s.tratto(f"M22 {cy} L38 {cy}", stroke_opacity=.35)


def gate_valve():
    s = Simbolo("process", "gate-valve", 60, 90, tipo="valves", body="steel", it="Saracinesca", en="Gate valve")
    corpo_valvola(s, 70)
    s.forma(*R(28.5, 14, 3, 32), mat="steel", velo="metal-h")
    _corpo_con_cappello(s, 70)
    s.forma(*R(24, 40, 12, 6, 1.5), mat="steel", velo="metal-v")
    s.forma(*E(30, 12, 18, 5), mat="signal-red", velo="paint-v")
    s.forma(*E(30, 12, 13, 2.5), mat="steel-dark", stroke="none")
    s.forma(*R(28.5, 2, 3, 10), mat="steel", velo="metal-h")
    return s


def globe_valve():
    s = Simbolo("process", "globe-valve", 60, 90, tipo="valves", body="steel", it="Valvola a globo", en="Globe valve")
    corpo_valvola(s, 70)
    s.forma(*R(28.5, 14, 3, 32), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(22, 44, 16, 14, 2), velo="paint-h")
    s.forma(*C(30, 70, 15), velo="paint-r")
    s.statico()
    s.tratto("M18 70 Q24 62 30 70 Q36 78 42 70", stroke_opacity=.5)
    s.forma(*E(30, 14, 18, 5), mat="signal-red", velo="paint-v")
    s.forma(*E(30, 14, 13, 2.5), mat="steel-dark", stroke="none")
    return s


def pressure_reducing_valve():
    s = Simbolo("process", "pressure-reducing-valve", 60, 90, tipo="valves", body="steel", it="Riduttore di pressione", en="Pressure reducing valve")
    corpo_valvola(s, 70)
    s.forma(*R(28, 2, 4, 12), mat="steel", velo="metal-h")
    s.forma(*R(20, 12, 20, 32, 3), mat="body-pump", velo="paint-h")
    s.tratto("M24 18 L36 22 L24 26 L36 30 L24 34 L36 38", stroke_width=1, stroke_opacity=.7)
    _corpo_con_cappello(s, 70)
    return s


def needle_valve():
    s = Simbolo("process", "needle-valve", 60, 60, tipo="valves", body="steel", it="Valvola a spillo", en="Needle valve")
    corpo_valvola(s, 40, x0=18, x1=42)
    s.forma(*R(27, 10, 6, 18), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*P("M18 30 L42 30 L46 40 L42 50 L18 50 L14 40 Z"), velo="paint-v")
    s.forma(*R(24, 22, 12, 9, 1.5), velo="paint-h")
    s.statico()
    s.forma(*R(14, 6, 32, 6, 3), mat="signal-red", velo="paint-v")
    return s


def solenoid_valve():
    s = Simbolo("process", "solenoid-valve", 60, 80, tipo="valves", body="steel", it="Elettrovalvola", en="Solenoid valve")
    corpo_valvola(s, 60)
    s.forma(*R(27, 36, 6, 10), mat="steel", velo="metal-h")
    s.tratto("M46 18 Q56 18 56 8", mat="rubber", stroke_width=2.2)
    s.forma(*R(14, 6, 32, 30, 3), mat="steel-dark", velo="dark-v")
    s.forma(*R(42, 14, 6, 8, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M20 14 L40 14 M20 20 L40 20 M20 26 L40 26", stroke_opacity=.35)
    s.corpo()
    s.forma(*R(16, 44, 28, 26, 6), velo="paint-v")
    s.parte("led", "lamp")
    s.forma(*C(30, 30, 2.4), mat="lamp-amber")
    s.luce(*C(30, 30, 2.4))
    return s


def handwheel_valve():
    s = Simbolo("process", "handwheel-valve", 60, 90, tipo="valves", body="steel", it="Valvola a volantino", en="Handwheel valve")
    corpo_valvola(s, 70)
    s.forma(*R(28.5, 30, 3, 16), mat="steel", velo="metal-h")
    _corpo_con_cappello(s, 70)
    volantino(s, 30, 18, 16)
    return s


# ── Serbatoi e contenitori ──────────────────────────────────────────────────

def horizontal_tank():
    s = Simbolo("process", "horizontal-tank", 160, 80, tipo="tanks", body="stainless", it="Serbatoio orizzontale", en="Horizontal tank")
    tubo_v(s, 45, 4, 14); flangia_o(s, 42, 0)
    tubo_v(s, 115, 60, 16); flangia_o(s, 112, 76)
    for x in (40, 120):
        s.forma(*P(f"M{x - 10} 60 L{x + 10} 60 L{x + 14} 76 L{x - 14} 76 Z"), mat="steel-dark", velo="dark-v")
        s.forma(*R(x - 18, 76, 36, 4, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M30 16 L130 16 Q152 16 152 40 Q152 64 130 64 L30 64 Q8 64 8 40 Q8 16 30 16 Z"), velo="paint-v")
    s.statico()
    s.tratto("M30 17 L30 63 M130 17 L130 63", stroke_opacity=.3)
    s.forma(*R(56, 24, 48, 32, 4), mat="glass-dark")
    s.parte("level", "level", x=57, y=25, w=46, h=30)
    s.forma(*R(57, 25, 46, 30, 3), mat="liquid", velo="paint-v")
    s.statico()
    s.riflesso(*R(57, 26, 46, 3, 1.5))
    return s


def tank_on_legs():
    s = Simbolo("process", "tank-on-legs", 80, 150, tipo="tanks", body="stainless", it="Serbatoio su gambe", en="Tank on legs")
    tubo_v(s, 35, 4, 12); flangia_o(s, 33, 0, 14)
    tubo_v(s, 35, 98, 40); flangia_o(s, 33, 136, 14)
    for x in (12, 62):
        s.forma(*R(x, 80, 6, 66), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 3, 145, 12, 5, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M18 120 L62 100 M18 100 L62 120", mat="steel-dark", stroke_width=1.6)
    s.corpo()
    s.forma(*P("M10 30 Q10 14 40 12 Q70 14 70 30 L70 86 Q70 102 40 104 Q10 102 10 86 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(31, 26, 18, 66, 3), mat="glass-dark")
    s.parte("level", "level", x=32, y=28, w=16, h=62)
    s.forma(*R(32, 28, 16, 62, 2), mat="liquid", velo="paint-h")
    s.statico()
    s.riflesso(*R(34, 28, 3, 62, 1.5))
    return s


def conical_tank():
    s = Simbolo("process", "conical-tank", 80, 160, tipo="tanks", body="stainless", it="Serbatoio a fondo conico", en="Conical tank")
    tubo_v(s, 35, 4, 12); flangia_o(s, 33, 0, 14)
    tubo_v(s, 35, 130, 16); flangia_o(s, 33, 146, 14)
    for x in (8, 66):
        s.forma(*R(x, 86, 6, 70), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 3, 155, 12, 5, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M10 28 Q10 14 40 12 Q70 14 70 28 L70 96 L44 132 L36 132 L10 96 Z"), velo="paint-h")
    s.statico()
    s.tratto("M10 96 L70 96", stroke_opacity=.3)
    s.forma(*R(31, 24, 18, 68, 3), mat="glass-dark")
    s.parte("level", "level", x=32, y=26, w=16, h=64)
    s.forma(*R(32, 26, 16, 64, 2), mat="liquid", velo="paint-h")
    s.statico()
    s.riflesso(*R(34, 26, 3, 64, 1.5))
    return s


def hopper():
    s = Simbolo("process", "hopper", 100, 120, tipo="tanks", body="steel", it="Tramoggia", en="Hopper")
    tubo_v(s, 45, 100, 20, w=10)
    s.forma(*R(36, 96, 28, 6, 1), mat="signal-red", velo="paint-v")
    s.corpo()
    s.forma(*P("M6 8 L94 8 L94 40 L56 96 L44 96 L6 40 Z"), velo="metal-h")
    s.statico()
    s.forma(*R(4, 4, 92, 6, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M6 40 L94 40", stroke_opacity=.35)
    s.forma(*P("M20 12 L80 12 L80 38 L54 76 L46 76 L20 38 Z"), mat="glass-dark")
    s.parte("level", "level", x=20, y=12, w=60, h=64)
    s.forma(*P("M20 12 L80 12 L80 38 L54 76 L46 76 L20 38 Z"), mat="bulk", velo="paint-h")
    return s


def open_basin():
    s = Simbolo("process", "open-basin", 140, 70, tipo="tanks", body="wall", it="Vasca", en="Open basin")
    tubo_o(s, 0, 15, 14); flangia_v(s, 0, 12)
    tubo_o(s, 126, 45, 14); flangia_v(s, 136, 42)
    s.corpo()
    s.forma(*P("M4 6 L18 6 L18 56 L122 56 L122 6 L136 6 L136 70 L4 70 Z"), velo="paint-d")
    s.statico()
    s.forma(*R(18, 6, 104, 50), mat="glass-dark", stroke="none")
    s.parte("level", "level", x=18, y=10, w=104, h=46)
    s.forma(*R(18, 10, 104, 46), mat="liquid", velo="paint-v", stroke="none")
    s.statico()
    s.tratto("M24 20 Q32 17 40 20 Q48 23 56 20 M74 30 Q82 27 90 30 Q98 33 106 30", mat="glass", stroke_width=1, stroke_opacity=.7)
    return s


def drum():
    s = Simbolo("process", "drum", 50, 70, tipo="tanks", body="body-pump", it="Fusto", en="Drum")
    s.corpo()
    s.forma(*R(6, 6, 38, 60, 4), velo="paint-h")
    s.statico()
    for y in (6, 24, 46, 64):
        s.forma(*R(4, y - 1.5, 42, 4, 2), mat="steel", velo="metal-h")
    s.forma(*C(34, 9, 2.4), mat="steel-dark", stroke="none")
    return s


def ibc_tote():
    s = Simbolo("process", "ibc-tote", 90, 110, tipo="tanks", body="appliance", it="Cisternetta IBC", en="IBC tote")
    s.forma(*R(4, 96, 82, 14, 1), mat="steel-dark", velo="dark-v")
    for x in (10, 40, 70):
        s.forma(*R(x, 98, 10, 10), mat="glass-dark", stroke="none")
    s.forma(*R(40, 86, 10, 10, 1), mat="safety-yellow", velo="paint-v")
    s.corpo()
    s.forma(*R(10, 12, 70, 80, 8), velo="paint-d")
    s.statico()
    s.forma(*R(38, 4, 14, 8, 2), mat="steel", velo="metal-v")
    s.parte("level", "level", x=12, y=14, w=66, h=76)
    s.forma(*R(12, 14, 66, 76, 6), mat="liquid", fill_opacity=.45, stroke="none")
    s.statico()
    s.tratto("M6 10 L84 10 L84 94 L6 94 Z M6 38 L84 38 M6 66 L84 66 M30 10 L30 94 M60 10 L60 94", mat="steel", stroke_width=1.6)
    return s


def gas_cylinder():
    s = Simbolo("process", "gas-cylinder", 40, 110, tipo="tanks", body="gas", it="Bombola", en="Gas cylinder")
    s.forma(*R(16, 4, 8, 10, 1), mat="steel", velo="metal-h")
    s.forma(*R(24, 6, 12, 5, 1), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*P("M8 30 Q8 14 20 14 Q32 14 32 30 L32 104 Q32 108 28 108 L12 108 Q8 108 8 104 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(8, 20, 24, 8), mat="label", fill_opacity=.8, stroke="none")
    return s


# ── Scambio termico ─────────────────────────────────────────────────────────

def plate_exchanger():
    s = Simbolo("process", "plate-exchanger", 100, 120, tipo="heat-exchange", body="stainless", it="Scambiatore a piastre", en="Plate heat exchanger")
    for y in (30, 90):
        tubo_o(s, 4, y - 5, 10); flangia_v(s, 0, y - 8)
    s.forma(*R(4, 112, 92, 8, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(14, 8, 8, 104, 1), mat="body-pump", velo="paint-h")
    s.forma(*R(82, 8, 8, 104, 1), mat="body-pump", velo="paint-h")
    s.corpo()
    s.forma(*R(22, 14, 60, 92, 1), velo="paint-v")
    s.statico()
    nervature(s, 26, 80, 15, 105, 3, opacita=.35)
    for y in (12, 108):
        s.forma(*R(10, y - 2, 84, 4, 2), mat="steel", velo="metal-v")
    return s


def coil_exchanger():
    s = Simbolo("process", "coil-exchanger", 80, 140, tipo="heat-exchange", body="stainless", it="Scambiatore a serpentino", en="Coil heat exchanger")
    tubo_v(s, 35, 4, 12); flangia_o(s, 33, 0, 14)
    tubo_o(s, 66, 35, 10); flangia_v(s, 76, 32)
    tubo_o(s, 66, 105, 10); flangia_v(s, 76, 102)
    for x in (14, 60):
        s.forma(*R(x, 124, 6, 12), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 4, 135, 14, 5, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M10 30 Q10 14 40 12 Q70 14 70 30 L70 114 Q70 130 40 132 Q10 130 10 114 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(18, 30, 44, 86, 4), mat="glass-dark")
    for i in range(7):
        y = 38 + 11 * i
        s.tratto(f"M22 {y} Q40 {y + 8} 58 {y} M22 {y} Q40 {y - 4} 58 {y}", mat="copper", stroke_width=2.4, stroke_linecap="round")
    s.luce(*R(18, 30, 44, 86, 4), opacita=.3)
    return s


def air_cooled_condenser():
    s = Simbolo("process", "air-cooled-condenser", 160, 100, tipo="heat-exchange", body="steel", it="Condensatore ad aria", en="Air-cooled condenser")
    tubo_o(s, 0, 25, 12); flangia_v(s, 0, 22)
    tubo_o(s, 148, 25, 12); flangia_v(s, 156, 22)
    for x in (14, 142):
        s.forma(*R(x, 40, 4, 56), mat="steel-dark", velo="dark-h")
    s.forma(*R(8, 92, 144, 6, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(10, 14, 140, 24, 2), velo="metal-v")
    s.statico()
    nervature(s, 14, 148, 15, 37, 3, opacita=.4)
    for i, cx in enumerate((50, 110)):
        s.forma(*C(cx, 64, 20), mat="steel-dark", velo="dark-v")
        s.parte(f"rotor-{i + 1}", "rotor", cx=cx, cy=64, symmetry=90)
        petali(s, cx, 64, 17, 4, 4)
        s.statico()
    return s


# ── Filtri e separatori ─────────────────────────────────────────────────────

def bag_filter():
    s = Simbolo("process", "bag-filter", 70, 130, tipo="filters", body="stainless", it="Filtro a sacco", en="Bag filter")
    tubo_o(s, 4, 35, 12); flangia_v(s, 0, 32)
    tubo_o(s, 54, 95, 12); flangia_v(s, 66, 92)
    for x in (14, 50):
        s.forma(*R(x, 110, 6, 16), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 3, 125, 12, 5, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M14 22 Q14 8 35 8 Q56 8 56 22 Z"), velo="paint-h")
    s.forma(*P("M12 26 L58 26 L58 104 Q58 114 35 114 Q12 114 12 104 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(10, 21, 50, 6, 1.5), mat="steel", velo="metal-v")
    for x in (10, 60):
        s.forma(*R(x - 3, 18, 6, 12, 1), mat="steel-dark")
    s.tratto("M22 32 L22 98 Q35 106 48 98 L48 32", stroke_opacity=.35, stroke_dasharray="3 2")
    return s


def centrifuge():
    s = Simbolo("process", "centrifuge", 140, 90, tipo="filters", body="stainless", it="Centrifuga", en="Centrifuge")
    tubo_o(s, 128, 35, 12); flangia_v(s, 136, 32)
    for x in (45, 95):
        tubo_v(s, x, 64, 16); flangia_o(s, x - 3, 80)
    s.forma(*R(4, 70, 30, 20, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(4, 30, 26, 32, 4), mat="body-motor", velo="paint-v")
    nervature(s, 8, 27, 34, 58, 4)
    s.forma(*R(30, 40, 8, 12), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(38, 20, 90, 48, 10), velo="paint-v")
    s.statico()
    s.tratto("M46 30 L110 30 L122 44 L110 58 L46 58 Z", stroke_opacity=.4)
    s.tratto("M54 36 L104 52 M54 52 L104 36", stroke_opacity=.2)
    return s


# ── Strumenti ───────────────────────────────────────────────────────────────

def turbine_flowmeter():
    s = Simbolo("process", "turbine-flowmeter", 80, 60, tipo="instruments", body="steel", it="Misuratore a turbina", en="Turbine flowmeter")
    tubo_o(s, 4, 45, 12); flangia_v(s, 0, 42)
    tubo_o(s, 64, 45, 12); flangia_v(s, 76, 42)
    s.forma(*R(35, 18, 10, 18), mat="steel", velo="metal-h")
    s.forma(*R(28, 4, 24, 16, 4), mat="instrument", velo="paint-d")
    s.corpo()
    s.forma(*R(16, 36, 48, 20, 4), velo="metal-v")
    s.statico()
    for x in range(26, 56, 6):
        s.tratto(f"M{x} 38 L{x + 4} 54", stroke_opacity=.35)
    return s


def coriolis_flowmeter():
    s = Simbolo("process", "coriolis-flowmeter", 100, 90, tipo="instruments", body="steel", it="Misuratore Coriolis", en="Coriolis flowmeter")
    tubo_o(s, 4, 25, 16); flangia_v(s, 0, 22)
    tubo_o(s, 80, 25, 16); flangia_v(s, 96, 22)
    s.forma(*R(38, 2, 24, 14, 3), mat="instrument", velo="paint-d")
    s.corpo()
    s.forma(*R(18, 18, 64, 18, 4), velo="metal-v")
    s.forma(*P("M24 36 L76 36 L70 82 Q50 90 30 82 Z"), velo="metal-h")
    s.statico()
    s.tratto("M34 40 L36 74 Q50 80 64 74 L66 40", stroke_opacity=.35)
    return s


def rotameter():
    s = Simbolo("process", "rotameter", 40, 130, tipo="instruments", body="steel", it="Flussimetro a galleggiante", en="Rotameter")
    tubo_v(s, 15, 0, 12); tubo_v(s, 15, 118, 12)
    s.corpo()
    s.forma(*R(6, 10, 28, 10, 2), velo="metal-v")
    s.forma(*R(6, 110, 28, 10, 2), velo="metal-v")
    s.statico()
    s.forma(*P("M12 20 L28 20 L24 110 L16 110 Z"), mat="glass", velo="paint-h", fill_opacity=.6)
    for y in range(30, 106, 10):
        s.tratto(f"M27 {y} L31 {y}", stroke_width=.8)
    s.forma(*P("M14 60 L26 60 L20 70 Z"), mat="signal-red", velo="paint-r")
    s.tratto("M8 20 L8 110 M32 20 L32 110", mat="steel-dark", stroke_width=1.6)
    return s


def pressure_transmitter():
    s = Simbolo("process", "pressure-transmitter", 60, 100, tipo="instruments", body="instrument", it="Trasmettitore di pressione", en="Pressure transmitter")
    s.forma(*R(25, 82, 10, 18), mat="steel", velo="metal-h")
    s.forma(*R(14, 64, 32, 18, 2), mat="steel", velo="metal-v")
    s.forma(*R(26, 52, 8, 12), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*C(30, 30, 24), velo="paint-r")
    s.statico()
    s.forma(*C(30, 30, 15), mat="glass-dark")
    s.tratto("M22 30 L38 30", mat="lamp-green", stroke_width=2, stroke_linecap="round")
    s.luce(*C(30, 30, 15), opacita=.5)
    return s


def float_switch():
    s = Simbolo("process", "float-switch", 60, 110, tipo="instruments", body="steel", it="Interruttore a galleggiante", en="Float switch")
    s.forma(*R(10, 0, 40, 8, 1), mat="steel", velo="metal-v")
    s.forma(*R(22, 8, 16, 14, 3), mat="steel-dark", velo="dark-v")
    s.tratto("M38 14 Q54 14 54 30", mat="rubber", stroke_width=2.2)
    s.forma(*R(28, 22, 4, 64), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*C(30, 92, 14), velo="paint-r")
    s.parte("led", "lamp")
    s.forma(*C(30, 15, 2.2), mat="lamp-green")
    s.luce(*C(30, 15, 2.2))
    return s


def ph_analyzer():
    s = Simbolo("process", "ph-analyzer", 80, 110, tipo="instruments", body="appliance", it="Analizzatore pH", en="pH analyzer")
    s.tratto("M40 50 L40 66", mat="rubber", stroke_width=2.4)
    s.forma(*R(34, 66, 12, 8, 1.5), mat="steel-dark", velo="dark-v")
    s.forma(*R(36, 74, 8, 26, 3), mat="glass", velo="paint-h", fill_opacity=.8)
    s.forma(*C(40, 102, 5), mat="glass", velo="glass-r")
    s.corpo()
    s.forma(*R(10, 4, 60, 46, 4), velo="paint-d")
    s.statico()
    s.forma(*R(18, 12, 44, 22, 2), mat="glass-dark")
    s.tratto("M24 23 L36 23 M42 23 L56 23", mat="lamp-green", stroke_width=2, stroke_linecap="round")
    for x in (22, 34, 46, 58):
        s.forma(*R(x - 3, 39, 6, 5, 1), mat="steel-dark", stroke="none")
    return s


# ── Tubi e raccordi ─────────────────────────────────────────────────────────

def pipe_straight():
    s = Simbolo("process", "pipe-straight", 60, 20, tipo="piping", body="steel", it="Tratto di tubo", en="Straight pipe")
    s.corpo()
    s.forma(*R(4, 5, 52, 10), velo="metal-v")
    s.statico()
    flangia_v(s, 0, 2); flangia_v(s, 56, 2)
    return s


def elbow_45():
    s = Simbolo("process", "elbow-45", 60, 60, tipo="piping", body="steel", it="Curva 45°", en="45° elbow")
    s.corpo()
    s.forma(*R(4, 35, 16, 10), velo="metal-v")
    s.forma(*P("M20 35 L20 45 L46 19 L39 12 Z"), velo="metal-h")
    s.statico()
    flangia_v(s, 0, 32)
    s.forma(*P("M36 9 L39 6 L50 17 L47 20 Z"), mat="steel", velo="metal-h")
    return s


def tee():
    s = Simbolo("process", "tee", 60, 60, tipo="piping", body="steel", it="Raccordo a T", en="Tee")
    s.corpo()
    s.forma(*R(25, 30, 10, 26), velo="metal-h")
    s.forma(*R(4, 25, 52, 10), velo="metal-v")
    s.statico()
    flangia_v(s, 0, 22); flangia_v(s, 56, 22); flangia_o(s, 22, 56)
    return s


def cross():
    s = Simbolo("process", "cross", 60, 60, tipo="piping", body="steel", it="Raccordo a croce", en="Cross")
    s.corpo()
    s.forma(*R(25, 4, 10, 52), velo="metal-h")
    s.forma(*R(4, 25, 52, 10), velo="metal-v")
    s.statico()
    flangia_v(s, 0, 22); flangia_v(s, 56, 22); flangia_o(s, 22, 0); flangia_o(s, 22, 56)
    return s


def reducer():
    s = Simbolo("process", "reducer", 60, 40, tipo="piping", body="steel", it="Riduzione", en="Reducer")
    s.corpo()
    s.forma(*P("M4 12 L22 12 L38 15 L56 15 L56 25 L38 25 L22 28 L4 28 Z"), velo="metal-v")
    s.statico()
    flangia_v(s, 0, 8, h=24); flangia_v(s, 56, 12)
    return s


def blind_flange():
    s = Simbolo("process", "blind-flange", 40, 40, tipo="piping", body="steel", it="Flangia cieca", en="Blind flange")
    tubo_o(s, 0, 15, 26)
    s.corpo()
    s.forma(*R(26, 4, 10, 32, 1.5), velo="metal-h")
    s.statico()
    for y in (9, 31):
        s.forma(*C(31, y, 1.8), mat="steel-dark", stroke="none")
    return s


def coupling():
    s = Simbolo("process", "coupling", 60, 30, tipo="piping", body="steel", it="Giunto", en="Coupling")
    tubo_o(s, 0, 10, 60)
    s.corpo()
    s.forma(*R(18, 4, 24, 22, 3), velo="metal-v")
    s.statico()
    s.tratto("M24 4 L24 26 M36 4 L36 26", stroke_opacity=.45)
    return s


def flexible_hose():
    s = Simbolo("process", "flexible-hose", 100, 30, tipo="piping", body="rubber", it="Tubo flessibile", en="Flexible hose")
    s.corpo()
    s.forma(*R(14, 8, 72, 14, 7), velo="rubber-r")
    s.statico()
    nervature(s, 20, 82, 9, 21, 5, opacita=.5)
    for x in (0, 86):
        s.forma(*R(x, 9, 14, 12, 1), mat="steel", velo="metal-v")
        s.forma(*R(x + (10 if x == 0 else 0), 6, 4, 18, 1), mat="steel", velo="metal-h")
    return s


def tutti():
    return [f() for f in (
        inline_pump, submersible_pump, gear_pump, screw_pump, diaphragm_pump, peristaltic_pump, dosing_pump, piston_pump,
        butterfly_valve, gate_valve, globe_valve, pressure_reducing_valve, needle_valve, solenoid_valve, handwheel_valve,
        horizontal_tank, tank_on_legs, conical_tank, hopper, open_basin, drum, ibc_tote, gas_cylinder,
        plate_exchanger, coil_exchanger, air_cooled_condenser,
        bag_filter, centrifuge,
        turbine_flowmeter, coriolis_flowmeter, rotameter, pressure_transmitter, float_switch, ph_analyzer,
        pipe_straight, elbow_45, tee, cross, reducer, blind_flange, coupling, flexible_hose,
    )]
