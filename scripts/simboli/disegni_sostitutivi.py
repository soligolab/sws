"""I disegni che sostituiscono i builtin (Fase 6 del piano dei simboli di libreria).

Stesse regole di `disegni.py`. Ognuno dichiara `replaces` col builtin che prende
il posto: il runtime nuovo risolve l'id vecchio su questo disegno (alias), e i
progetti esistenti non cambiano.
"""
import math

from genera import Simbolo
from disegni import C, E, P, R, f2, flangia_o, flangia_v, girante, polare, tubo_o, tubo_v


def petali(s, cx, cy, r, n, mozzo, mat="steel", velo="metal-r", inclinazione=0):
    """Pale di un ventilatore assiale viste di fronte: n petali attorno al mozzo."""
    for i in range(n):
        a = math.radians(inclinazione + i * 360 / n)
        b1, b2 = a - 0.42, a + 0.42
        p0 = (cx + mozzo * 0.8 * math.cos(a), cy + mozzo * 0.8 * math.sin(a))
        c1 = (cx + r * 0.85 * math.cos(b1), cy + r * 0.85 * math.sin(b1))
        c2 = (cx + r * 1.05 * math.cos(a + 0.12), cy + r * 1.05 * math.sin(a + 0.12))
        c3 = (cx + r * 0.75 * math.cos(b2), cy + r * 0.75 * math.sin(b2))
        d = (f"M{f2(p0[0])} {f2(p0[1])} Q{f2(c1[0])} {f2(c1[1])} {f2(c2[0])} {f2(c2[1])} "
             f"Q{f2(c3[0])} {f2(c3[1])} {f2(p0[0])} {f2(p0[1])} Z")
        s.forma(*P(d), mat=mat, velo=velo, stroke_width=0.8)
    s.forma(*C(cx, cy, mozzo), mat="steel-dark", velo="dark-v")


def corpo_valvola(s, cy, x0=16, x1=44, h=24, raggio=8):
    """Tubi, flange e corpo di una valvola su un tubo orizzontale con asse a `cy`."""
    tubo_o(s, 4, cy - 5, x0 - 2); flangia_v(s, 0, cy - 8)
    tubo_o(s, x1 - 2, cy - 5, 60 - x1 - 2); flangia_v(s, 56, cy - 8)


# ── Valvole ─────────────────────────────────────────────────────────────────

def check_valve():
    s = Simbolo("process", "check-valve", 60, 50, tipo="valves", body="steel",
                it="Valvola di ritegno", en="Check valve", replaces="check_valve")
    corpo_valvola(s, 30)
    s.corpo()
    s.forma(*R(24, 12, 12, 7, 1.5), velo="paint-h")
    s.forma(*R(14, 17, 32, 26, 10), velo="paint-v")
    s.statico()
    # Freccia del verso del flusso e il clapet incernierato in alto.
    s.tratto("M20 30 L38 30 M33 25 L39 30 L33 35", stroke_width=1.4, stroke_linecap="round", stroke_opacity=.7)
    s.forma(*C(30, 15.5, 1.6), mat="steel-dark", stroke="none")
    return s


def three_way_valve():
    s = Simbolo("process", "three-way-valve", 60, 80, tipo="valves", body="steel",
                it="Valvola a tre vie", en="Three-way valve", replaces="valve_3way")
    corpo_valvola(s, 40)
    tubo_v(s, 25, 60, 16); flangia_o(s, 22, 76)
    s.forma(*R(27, 16, 6, 8), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(25, 22, 10, 8, 1.5), velo="paint-h")
    s.forma(*R(16, 28, 28, 24, 8), velo="paint-v")
    s.forma(*R(24, 50, 12, 12, 2), velo="paint-h")
    s.statico()
    s.tratto("M22 40 L38 40 M30 40 L30 56", stroke_opacity=.35)
    # Leva verso destra = via diritta; ruotata di 180° = via verso il basso.
    s.parte("lever", "lever", cx=30, cy=14, open=0, closed=180)
    s.forma(*R(24, 10.5, 28, 7, 2), mat="signal-red", velo="paint-v")
    s.forma(*C(30, 14, 4), mat="steel", velo="metal-r")
    return s


def relief_valve():
    s = Simbolo("process", "relief-valve", 60, 90, tipo="valves", body="signal-red",
                it="Valvola di sicurezza", en="Relief valve", replaces="relief_valve")
    tubo_v(s, 25, 72, 14); flangia_o(s, 22, 86)
    tubo_o(s, 42, 55, 14); flangia_v(s, 56, 52)
    s.forma(*R(24, 28, 12, 22, 1.5), mat="steel", velo="metal-h")
    s.forma(*R(26, 18, 8, 11, 2), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*C(30, 60, 13), velo="paint-r")
    s.forma(*R(21, 46, 18, 7, 2), velo="paint-v")
    s.statico()
    s.tratto("M26 31 L34 34 L26 37 L34 40 L26 43 L34 46", stroke_width=1, stroke_opacity=.7)
    return s


def motorized_valve():
    s = Simbolo("process", "motorized-valve", 60, 70, tipo="valves", body="steel",
                it="Valvola motorizzata", en="Motorized valve", replaces="valve_motorized")
    corpo_valvola(s, 50)
    s.forma(*R(27, 26, 6, 8), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(25, 32, 10, 9, 1.5), velo="paint-h")
    s.forma(*R(16, 38, 28, 24, 8), velo="paint-v")
    s.statico()
    s.tratto("M22 50 L38 50", stroke_opacity=.35)
    s.forma(*R(12, 4, 36, 22, 3), mat="body-motor", velo="paint-d")
    s.forma(*R(22, 8, 16, 9, 1.5), mat="glass-dark")
    s.luce(*R(22, 8, 16, 9, 1.5), opacita=.5)
    s.forma(*C(30, 21.5, 1.6), mat="lamp-green", stroke="none")
    return s


def pneumatic_valve():
    s = Simbolo("process", "pneumatic-valve", 60, 80, tipo="valves", body="steel",
                it="Valvola pneumatica", en="Pneumatic valve", replaces="valve_pneumatic")
    corpo_valvola(s, 60)
    for x in (21, 36):
        s.forma(*R(x, 22, 3, 22), mat="steel", velo="metal-h")
    s.forma(*R(28, 30, 4, 14), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(25, 42, 10, 9, 1.5), velo="paint-h")
    s.forma(*R(16, 48, 28, 24, 8), velo="paint-v")
    s.statico()
    s.tratto("M22 60 L38 60", stroke_opacity=.35)
    s.forma(*P("M8 22 Q8 4 30 4 Q52 4 52 22 Z"), mat="body-pump", velo="paint-r")
    s.forma(*R(6, 20, 48, 4, 1), mat="steel", velo="metal-v")
    return s


# ── Serbatoi e reattori ─────────────────────────────────────────────────────

def silo():
    s = Simbolo("process", "silo", 80, 160, tipo="tanks", body="stainless",
                it="Silo", en="Silo", replaces="silo")
    tubo_v(s, 35, 132, 14, w=10); flangia_o(s, 33, 146, 14)
    s.bocca(40, 150, "bottom", 10)  # lo scarico sta fra le gambe, non sul bordo
    for x in (10, 64):
        s.forma(*R(x, 96, 6, 60), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 3, 155, 12, 5, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M16 110 L64 140 M16 140 L64 110", mat="steel-dark", stroke_width=2)
    s.corpo()
    s.forma(*P("M10 24 L40 6 L70 24 Z"), velo="paint-h")
    s.forma(*P("M10 24 L70 24 L70 98 L45 132 L35 132 L10 98 Z"), velo="paint-h")
    s.statico()
    for y in (48, 72, 98):
        s.tratto(f"M10 {y} L70 {y}", stroke_opacity=.3)
    s.forma(*R(31, 30, 18, 64, 3), mat="glass-dark")
    s.parte("level", "level", x=32, y=32, w=16, h=60)
    s.forma(*R(32, 32, 16, 60, 2), mat="bulk", velo="paint-h")
    s.statico()
    s.riflesso(*R(34, 32, 3, 60, 1.5))
    return s


def mixing_tank():
    s = Simbolo("process", "mixing-tank", 80, 160, tipo="tanks", body="stainless",
                it="Serbatoio con agitatore", en="Mixing tank", replaces="mixer")
    tubo_o(s, 66, 135, 10); flangia_v(s, 76, 132)
    for x in (14, 60):
        s.forma(*R(x, 144, 6, 12), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 4, 155, 14, 5, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(30, 2, 20, 18, 3), mat="body-motor", velo="paint-v")
    s.forma(*R(26, 20, 28, 6, 1.5), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M10 42 Q10 26 40 24 Q70 26 70 42 L70 138 Q70 154 40 156 Q10 154 10 138 Z"), velo="paint-h")
    s.statico()
    for y in (42, 138):
        s.tratto(f"M10 {y} L70 {y}", stroke_opacity=.3)
    s.forma(*R(22, 48, 36, 86, 4), mat="glass-dark")
    s.parte("level", "level", x=23, y=50, w=34, h=82)
    s.forma(*R(23, 50, 34, 82, 3), mat="liquid", velo="paint-h")
    s.statico()
    s.forma(*R(39, 26, 2, 92), mat="steel", stroke_width=.6)
    s.parte("rotor", "rotor", cx=40, cy=118, symmetry=120)
    petali(s, 40, 118, 13, 3, 3.2)
    s.statico()
    s.riflesso(*R(25, 50, 4, 82, 2))
    return s


def agitator():
    s = Simbolo("process", "agitator", 60, 120, tipo="tanks", body="body-motor",
                it="Agitatore", en="Agitator", replaces="agitator")
    s.forma(*R(10, 30, 40, 8, 1.5), mat="steel", velo="metal-v")
    s.forma(*R(28.5, 38, 3, 60), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(18, 2, 24, 20, 3), velo="paint-v")
    s.forma(*R(20, 22, 20, 8, 1.5), velo="paint-v")
    s.parte("rotor", "rotor", cx=30, cy=102, symmetry=90)
    petali(s, 30, 102, 16, 4, 3.5)
    return s


def jacketed_reactor():
    s = Simbolo("process", "jacketed-reactor", 100, 170, tipo="tanks", body="stainless",
                it="Reattore incamiciato", en="Jacketed reactor", replaces="reactor")
    tubo_o(s, 4, 105, 12); flangia_v(s, 0, 102)
    tubo_o(s, 84, 135, 12); flangia_v(s, 96, 132)
    tubo_v(s, 45, 152, 14); flangia_o(s, 43, 166, 14)
    for x in (8, 86):
        s.forma(*R(x, 80, 6, 10, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(40, 2, 20, 16, 3), mat="body-motor", velo="paint-v")
    s.forma(*R(36, 18, 28, 6, 1.5), mat="steel-dark", velo="dark-v")
    s.forma(*R(64, 18, 14, 8, 1), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*P("M14 44 Q14 26 50 24 Q86 26 86 44 L86 132 Q86 152 50 154 Q14 152 14 132 Z"), velo="paint-h")
    s.statico()
    # La camicia: un guscio esterno sulla parte bassa.
    s.forma(*P("M14 76 L86 76 L86 132 Q86 152 50 154 Q14 152 14 132 Z"), fill="none", stroke_width=2.2, stroke_opacity=.55)
    s.tratto("M14 76 L86 76", stroke_opacity=.4)
    s.forma(*R(34, 50, 32, 80, 4), mat="glass-dark")
    s.parte("level", "level", x=35, y=52, w=30, h=76)
    s.forma(*R(35, 52, 30, 76, 3), mat="liquid", velo="paint-h")
    s.statico()
    s.forma(*R(49, 24, 2, 88), mat="steel", stroke_width=.6)
    s.parte("rotor", "rotor", cx=50, cy=112, symmetry=120)
    petali(s, 50, 112, 13, 3, 3.2)
    s.statico()
    s.riflesso(*R(37, 52, 4, 76, 2))
    return s


# ── Scambio termico ─────────────────────────────────────────────────────────

def boiler():
    s = Simbolo("process", "boiler", 120, 100, tipo="heat-exchange", body="body-boiler",
                it="Caldaia", en="Boiler", replaces="boiler")
    tubo_v(s, 45, 4, 14); flangia_o(s, 42, 0)
    s.forma(*R(86, 0, 12, 22), mat="steel-dark", velo="dark-h")
    s.forma(*R(84, 0, 16, 4, 1), mat="steel-dark", velo="dark-v")
    for x in (28, 78):
        s.forma(*P(f"M{x} 80 L{x + 14} 80 L{x + 18} 94 L{x - 4} 94 Z"), mat="steel-dark", velo="dark-v")
    s.forma(*R(18, 94, 86, 6, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(2, 38, 16, 30, 3), mat="signal-red", velo="paint-d")
    s.forma(*C(10, 53, 4), mat="glass-dark")
    s.corpo()
    s.forma(*R(16, 18, 96, 64, 22), velo="paint-v")
    s.statico()
    for x in (40, 64, 88):
        s.tratto(f"M{x} 19 L{x} 81", stroke_opacity=.3)
    s.forma(*R(48, 40, 26, 16, 2), mat="label", stroke_width=.8)
    return s


def furnace():
    s = Simbolo("process", "furnace", 100, 120, tipo="heat-exchange", body="body-furnace",
                it="Forno", en="Furnace", replaces="furnace")
    s.forma(*R(40, 0, 20, 34), mat="steel-dark", velo="dark-h")
    s.forma(*R(37, 0, 26, 4, 1), mat="steel-dark", velo="dark-v")
    tubo_o(s, 0, 85, 12); flangia_v(s, 0, 82)
    for y in (45, 65):
        tubo_o(s, 88, y, 8); flangia_v(s, 96, y - 3)
    s.forma(*R(8, 112, 84, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M12 44 L30 30 L70 30 L88 44 L88 112 L12 112 Z"), velo="paint-d")
    s.statico()
    for y in (56, 70, 84, 98):
        s.tratto(f"M12 {y} L88 {y}", stroke_opacity=.25)
    s.forma(*R(32, 70, 36, 30, 3), mat="glass-dark")
    s.parte("flame", "lamp")
    s.forma(*P("M50 98 Q36 92 40 82 Q42 88 46 86 Q44 76 50 72 Q52 80 56 82 Q60 76 58 72 Q66 82 62 92 Q60 98 50 98 Z"),
            mat="flame", velo="paint-r", stroke_width=.6)
    s.forma(*P("M50 97 Q44 94 46 88 Q49 92 50 86 Q54 92 54 94 Q53 97 50 97 Z"), mat="flame-core", stroke="none")
    s.statico()
    s.luce(*R(32, 70, 36, 30, 3), opacita=.35)
    return s


def cooling_tower():
    s = Simbolo("process", "cooling-tower", 100, 120, tipo="heat-exchange", body="appliance",
                it="Torre evaporativa", en="Cooling tower", replaces="cooling_tower")
    tubo_o(s, 0, 35, 12); flangia_v(s, 0, 32)
    tubo_o(s, 88, 105, 12); flangia_v(s, 96, 102)
    s.forma(*P("M26 26 L32 6 L68 6 L74 26 Z"), mat="steel", velo="metal-h")
    s.forma(*R(28, 4, 44, 4, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(10, 24, 80, 92, 2), velo="paint-d")
    s.statico()
    for y in range(80, 112, 6):
        s.tratto(f"M14 {y} L86 {y}", mat="steel-dark", stroke_width=2, stroke_opacity=.8)
    s.tratto("M10 72 L90 72", stroke_opacity=.4)
    s.forma(*R(30, 34, 40, 26, 2), mat="glass-dark")
    for x in range(34, 68, 6):
        s.tratto(f"M{x} 36 L{x + 4} 58", mat="glass", stroke_width=1, stroke_opacity=.7)
    return s


# ── Filtri e separatori ─────────────────────────────────────────────────────

def y_strainer():
    s = Simbolo("process", "y-strainer", 80, 60, tipo="filters", body="steel",
                it="Filtro a Y", en="Y-strainer", replaces="strainer")
    tubo_o(s, 4, 15, 12); flangia_v(s, 0, 12)
    tubo_o(s, 64, 15, 12); flangia_v(s, 76, 12)
    s.corpo()
    s.forma(*R(14, 10, 52, 20, 8), velo="paint-v")
    s.forma(*P("M30 24 L42 24 L60 46 L50 54 Z"), velo="paint-d")
    s.statico()
    s.forma(*P("M50 54 L60 46 L64 50 L54 58 Z"), mat="steel-dark", velo="dark-v")
    s.tratto("M34 26 L52 48", stroke_opacity=.4, stroke_dasharray="2 2")
    return s


def cyclone():
    s = Simbolo("process", "cyclone", 70, 140, tipo="filters", body="stainless",
                it="Ciclone", en="Cyclone", replaces="cyclone")
    s.forma(*R(0, 24, 18, 14), mat="stainless", velo="paint-v")
    s.forma(*R(0, 22, 4, 18, .8), mat="steel", velo="metal-h")
    tubo_v(s, 30, 4, 18); flangia_o(s, 27, 0)
    tubo_v(s, 30, 120, 16); flangia_o(s, 27, 136)
    s.corpo()
    s.forma(*P("M14 20 L56 20 L56 60 L40 120 L30 120 L14 60 Z"), velo="paint-h")
    s.statico()
    s.tratto("M14 60 L56 60", stroke_opacity=.35)
    s.tratto("M22 66 Q35 74 48 66 M26 82 Q35 88 44 82 M30 98 Q35 102 40 98", stroke_opacity=.35, stroke_linecap="round")
    return s


def separator():
    s = Simbolo("process", "separator", 160, 80, tipo="filters", body="stainless",
                it="Separatore", en="Separator", replaces="separator")
    tubo_v(s, 35, 4, 14); flangia_o(s, 32, 0)
    tubo_v(s, 115, 4, 14); flangia_o(s, 112, 0)
    tubo_v(s, 95, 60, 16); flangia_o(s, 92, 76)
    for x in (34, 118):
        s.forma(*P(f"M{x - 8} 60 L{x + 8} 60 L{x + 12} 76 L{x - 12} 76 Z"), mat="steel-dark", velo="dark-v")
        s.forma(*R(x - 16, 76, 32, 4, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M30 16 L130 16 Q152 16 152 40 Q152 64 130 64 L30 64 Q8 64 8 40 Q8 16 30 16 Z"), velo="paint-v")
    s.statico()
    s.tratto("M80 18 L80 62", stroke_opacity=.3, stroke_dasharray="3 2")
    s.forma(*R(46, 26, 68, 30, 4), mat="glass-dark")
    s.parte("level", "level", x=47, y=27, w=66, h=28)
    s.forma(*R(47, 27, 66, 28, 3), mat="liquid", velo="paint-v")
    s.statico()
    s.riflesso(*R(47, 28, 66, 3, 1.5))
    return s


def column():
    s = Simbolo("process", "column", 60, 200, tipo="filters", body="stainless",
                it="Colonna", en="Column", replaces="column")
    for y in (40, 100, 160):
        tubo_o(s, 4, y - 5, 12); flangia_v(s, 0, y - 8)
    tubo_v(s, 25, 4, 12); flangia_o(s, 22, 0)
    tubo_o(s, 44, 175, 12); flangia_v(s, 56, 172)
    s.forma(*P("M18 182 L42 182 L46 196 L14 196 Z"), mat="steel-dark", velo="dark-v")
    s.forma(*R(10, 196, 40, 4, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M16 26 Q16 14 30 14 Q44 14 44 26 L44 174 Q44 186 30 186 Q16 186 16 174 Z"), velo="paint-h")
    s.statico()
    for y in range(36, 172, 14):
        s.tratto(f"M18 {y} L42 {y}", stroke_opacity=.25, stroke_dasharray="4 2")
    return s


# ── Strumenti ───────────────────────────────────────────────────────────────

def thermometer():
    s = Simbolo("process", "thermometer", 60, 90, tipo="instruments", body="steel",
                it="Termometro", en="Thermometer", replaces="temperature_sensor")
    s.forma(*R(27, 48, 6, 42), mat="steel", velo="metal-h")
    s.forma(*P("M22 46 L38 46 L39 49 L38 53 L22 53 L21 49 Z"), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*C(30, 24, 21), velo="paint-r")
    s.statico()
    s.forma(*C(30, 24, 17), mat="dial", velo="dial-r")
    for i in range(9):
        a = 225 - 33.75 * i
        (x0, y0), (x1, y1) = polare(30, 24, 15.5, a), polare(30, 24, 12 if i % 4 == 0 else 13.5, a)
        s.tratto(f"M{f2(x0)} {f2(y0)} L{f2(x1)} {f2(y1)}", stroke_width=.9, stroke_linecap="round")
    (x0, y0), (x1, y1) = polare(30, 24, 14, -18), polare(30, 24, 14, -45)
    s.tratto(f"M{f2(x0)} {f2(y0)} A14 14 0 0 1 {f2(x1)} {f2(y1)}", mat="signal-red", stroke_width=2.2, stroke_linecap="butt")
    s.parte("needle", "needle", cx=30, cy=24, a0=-135, a1=135)
    s.tratto("M30 24 L30 11", mat="signal-red", stroke_width=1.6, stroke_linecap="round")
    s.forma(*C(30, 24, 2), mat="steel", velo="metal-r")
    s.statico()
    s.luce(*C(30, 24, 17), opacita=.5)
    return s


def magnetic_flowmeter():
    s = Simbolo("process", "magnetic-flowmeter", 80, 60, tipo="instruments", body="instrument",
                it="Misuratore di portata", en="Magnetic flowmeter", replaces="flow_meter")
    tubo_o(s, 4, 45, 10); flangia_v(s, 0, 42)
    tubo_o(s, 66, 45, 10); flangia_v(s, 76, 42)
    s.forma(*R(12, 38, 4, 24, .8), mat="steel", velo="metal-h")
    s.forma(*R(64, 38, 4, 24, .8), mat="steel", velo="metal-h")
    s.forma(*R(35, 22, 10, 12), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(16, 36, 48, 24, 6), velo="paint-v")
    s.forma(*R(22, 2, 36, 22, 4), velo="paint-d")
    s.statico()
    s.forma(*R(27, 6, 26, 12, 2), mat="glass-dark")
    s.luce(*R(27, 6, 26, 12, 2), opacita=.5)
    s.tratto("M30 12 L38 12 M42 12 L50 12", mat="lamp-green", stroke_width=1.6, stroke_linecap="round")
    return s


def radar_level_sensor():
    s = Simbolo("process", "radar-level-sensor", 60, 90, tipo="instruments", body="instrument",
                it="Sensore di livello radar", en="Radar level sensor", replaces="level_sensor")
    s.forma(*R(26, 34, 8, 12), mat="steel", velo="metal-h")
    s.forma(*R(8, 44, 44, 6, 1), mat="steel", velo="metal-v")
    s.forma(*P("M22 50 L38 50 L46 88 L14 88 Z"), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(12, 4, 36, 32, 8), velo="paint-d")
    s.statico()
    s.forma(*C(30, 20, 7), mat="glass-dark")
    s.luce(*C(30, 20, 7), opacita=.6)
    s.tratto("M22 62 Q30 58 38 62 M20 72 Q30 67 40 72 M18 82 Q30 76 42 82", stroke_opacity=.45, stroke_linecap="round")
    return s


# ── Elettrico ed energia ────────────────────────────────────────────────────

def circuit_breaker():
    s = Simbolo("electrical", "circuit-breaker", 50, 90, tipo="cabinets", body="steel-dark",
                it="Interruttore", en="Circuit breaker", replaces="breaker")
    s.forma(*R(21, 0, 8, 12), mat="copper", velo="metal-h")
    s.forma(*R(21, 78, 8, 12), mat="copper", velo="metal-h")
    s.corpo()
    s.forma(*R(8, 10, 34, 70, 3), velo="paint-d")
    s.statico()
    for y in (14, 72):
        s.forma(*C(25, y + 2, 2.4), mat="steel", velo="metal-r")
    s.forma(*R(16, 34, 18, 24, 2), mat="rubber")
    s.tratto("M14 30 L36 30 M14 62 L36 62", stroke_opacity=.35)
    # Disegnato aperto (leva in basso, OFF); chiuso = 180°, leva in alto (ON).
    s.parte("lever", "lever", cx=25, cy=46, open=0, closed=180)
    s.forma(*R(21, 44, 8, 12, 2), mat="signal-red", velo="paint-h")
    s.forma(*C(25, 46, 3), mat="steel", velo="metal-r")
    return s


def transmission_tower():
    s = Simbolo("electrical", "transmission-tower", 80, 160, tipo="distribution", body="steel",
                it="Traliccio", en="Transmission tower", replaces="transmission_tower")
    s.corpo()
    s.forma(*P("M8 160 L33 20 L37 20 L13 160 Z"), velo="metal-h")
    s.forma(*P("M72 160 L47 20 L43 20 L67 160 Z"), velo="metal-h")
    s.forma(*R(30, 8, 20, 14, 1), velo="metal-v")
    s.forma(*R(4, 28, 72, 5, 1), velo="metal-v")
    s.forma(*R(10, 56, 60, 5, 1), velo="metal-v")
    s.statico()
    s.tratto("M14 150 L62 120 M66 150 L18 120 M19 118 L58 92 M61 118 L22 92 M24 90 L54 66 M56 90 L26 66 M28 64 L50 40 M52 64 L30 40",
             mat="steel", stroke_width=1.4, stroke_linecap="round")
    for x, y in ((8, 33), (40, 33), (72, 33), (14, 61), (66, 61)):
        s.forma(*R(x - 2, y, 4, 9), mat="porcelain")
        s.forma(*C(x, y + 11, 2.2), mat="steel-dark")
    return s


def battery_rack():
    s = Simbolo("electrical", "battery-rack", 80, 120, tipo="generation", body="steel-dark",
                it="Rack batterie", en="Battery rack", replaces="battery")
    s.forma(*R(6, 112, 68, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(4, 4, 72, 108, 3), velo="paint-d")
    s.statico()
    for i in range(4):
        y = 10 + 24 * i
        s.forma(*R(10, y, 44, 20, 2), mat="appliance", velo="paint-v")
        for x in (16, 44):
            s.forma(*R(x, y - 2, 5, 3, .8), mat="copper")
    s.forma(*R(60, 10, 10, 92, 3), mat="glass-dark")
    s.parte("level", "level", x=61, y=12, w=8, h=88)
    s.forma(*R(61, 12, 8, 88, 2), mat="charge", velo="paint-h")
    s.statico()
    s.riflesso(*R(62, 12, 2, 88, 1))
    return s


# ── Macchine e aria ─────────────────────────────────────────────────────────

def axial_fan():
    s = Simbolo("machines", "axial-fan", 100, 100, tipo="machines", body="body-motor",
                it="Ventilatore assiale", en="Axial fan", replaces="fan")
    s.tratto("M30 84 L22 100 M70 84 L78 100", mat="steel-dark", stroke_width=4, stroke_linecap="round")
    s.corpo()
    s.forma(*C(50, 48, 44), velo="paint-r")
    s.statico()
    s.forma(*C(50, 48, 36), mat="glass-dark")
    s.parte("rotor", "rotor", cx=50, cy=48, symmetry=72)
    petali(s, 50, 48, 34, 5, 7)
    s.statico()
    s.tratto("M14 48 L86 48 M50 12 L50 84", stroke_opacity=.35)
    return s


def blower():
    s = Simbolo("machines", "blower", 100, 100, tipo="machines", body="body-pump",
                it="Soffiante", en="Blower", replaces="blower")
    tubo_o(s, 4, 55, 12); flangia_v(s, 0, 52)
    tubo_v(s, 45, 4, 14); flangia_o(s, 42, 0)
    s.forma(*R(14, 88, 72, 12, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(14, 16, 72, 74, 16), velo="paint-v")
    s.statico()
    s.forma(*C(50, 54, 26), mat="steel", velo="metal-r")
    s.forma(*C(50, 54, 23), mat="glass-dark")
    s.parte("rotor", "rotor", cx=50, cy=54, symmetry=180)
    s.forma(*P("M50 54 Q36 30 50 34 Q64 30 50 54 Q64 78 50 74 Q36 78 50 54 Z"), mat="steel", velo="metal-r", stroke_width=.8)
    s.forma(*C(50, 54, 3), mat="steel-dark")
    return s


def screw_compressor():
    s = Simbolo("machines", "screw-compressor", 140, 90, tipo="machines", body="body-pump",
                it="Compressore a vite", en="Screw compressor", replaces="compressor")
    s.forma(*R(4, 78, 132, 12, 1), mat="steel-dark", velo="dark-v")
    tubo_v(s, 105, 4, 16); flangia_o(s, 102, 0)
    s.forma(*R(8, 30, 14, 40, 4), mat="steel-dark", velo="dark-v")
    s.forma(*R(22, 26, 46, 48, 4), mat="body-motor", velo="paint-v")
    for y in range(32, 70, 6):
        s.tratto(f"M25 {y} L65 {y}", stroke_opacity=.35)
    s.forma(*R(68, 40, 10, 20, 2), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(78, 18, 52, 60, 8), velo="paint-v")
    s.statico()
    s.tratto("M86 36 Q96 30 106 36 Q116 42 124 36 M86 48 Q96 42 106 48 Q116 54 124 48 M86 60 Q96 54 106 60 Q116 66 124 60",
             stroke_opacity=.4, stroke_linecap="round")
    return s


# ── Edificio e HVAC ─────────────────────────────────────────────────────────

def heat_pump():
    s = Simbolo("building", "heat-pump", 120, 90, tipo="hvac", body="appliance",
                it="Pompa di calore", en="Heat pump", replaces="heat_pump")
    tubo_o(s, 108, 55, 12); flangia_v(s, 116, 52)
    tubo_o(s, 108, 75, 12); flangia_v(s, 116, 72)
    s.forma(*R(10, 82, 20, 8, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(80, 82, 20, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(4, 4, 106, 80, 4), velo="paint-d")
    s.statico()
    s.forma(*C(42, 44, 32), mat="steel-dark", velo="dark-v")
    s.parte("rotor", "rotor", cx=42, cy=44, symmetry=90)
    petali(s, 42, 44, 28, 4, 6)
    s.statico()
    for r in (14, 22, 30):
        s.forma(*C(42, 44, r), fill="none", stroke_width=.8, stroke_opacity=.5)
    s.tratto("M42 12 L42 76 M10 44 L74 44", stroke_width=.8, stroke_opacity=.5)
    for x in range(82, 104, 4):
        s.tratto(f"M{x} 12 L{x} 76", stroke_opacity=.35)
    return s


def chiller():
    s = Simbolo("building", "chiller", 160, 90, tipo="hvac", body="appliance",
                it="Refrigeratore", en="Chiller", replaces="chiller")
    tubo_o(s, 0, 65, 12); flangia_v(s, 0, 62)
    tubo_o(s, 148, 65, 12); flangia_v(s, 156, 62)
    s.forma(*R(10, 82, 140, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(10, 14, 140, 70, 3), velo="paint-d")
    s.statico()
    for i, cx in enumerate((50, 110)):
        s.forma(*R(cx - 28, 4, 56, 12, 2), mat="steel-dark", velo="dark-v")
    for x in range(14, 146, 4):
        s.tratto(f"M{x} 50 L{x} 80", stroke_opacity=.3)
    for i, cx in enumerate((50, 110)):
        s.forma(*C(cx, 32, 16), mat="steel-dark", velo="dark-v")
        s.parte(f"rotor-{i + 1}", "rotor", cx=cx, cy=32, symmetry=90)
        petali(s, cx, 32, 14, 4, 3.5)
        s.statico()
    return s


def ceiling_light():
    s = Simbolo("building", "ceiling-light", 60, 70, tipo="building", body="steel-dark",
                it="Lampada", en="Ceiling light", replaces="home_lightning")
    s.tratto("M30 0 L30 16", mat="rubber", stroke_width=2)
    s.forma(*R(26, 14, 8, 6, 1.5), mat="steel", velo="metal-v")
    s.forma(*E(30, 46, 9, 8), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*E(30, 58, 22, 10), mat="flame-core", fill_opacity=.35, stroke="none")
    s.forma(*E(30, 46, 9, 8), mat="flame-core", velo="glass-r")
    s.corpo()
    s.forma(*P("M8 44 Q12 22 30 20 Q48 22 52 44 Z"), velo="paint-h")
    return s


def garage_door():
    s = Simbolo("building", "garage-door", 100, 90, tipo="building", body="appliance",
                it="Porta del garage", en="Garage door", replaces="garage")
    s.forma(*R(0, 0, 100, 90), mat="wall", velo="paint-d", stroke="none")
    s.forma(*R(8, 10, 84, 80, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    for i in range(4):
        s.forma(*R(12, 14 + 19 * i, 76, 18, 1), velo="paint-v")
    s.statico()
    s.forma(*R(44, 78, 12, 4, 1.5), mat="steel-dark")
    return s


def window():
    s = Simbolo("building", "window", 80, 100, tipo="building", body="appliance",
                it="Finestra", en="Window", replaces="window_open")
    s.forma(*R(0, 0, 80, 100), mat="wall", velo="paint-d", stroke="none")
    s.corpo()
    s.forma(*R(8, 8, 64, 84, 2), velo="paint-d")
    s.statico()
    s.forma(*R(14, 14, 24, 72, 1), mat="glass", velo="paint-d")
    s.forma(*P("M42 14 L66 20 L66 80 L42 86 Z"), mat="glass", velo="paint-d")
    s.riflesso(*P("M16 16 L28 16 L16 40 Z"), opacita=.35)
    s.tratto("M42 14 L42 86", stroke_width=1.6)
    s.forma(*R(36, 46, 3, 10, 1), mat="steel-dark")
    s.forma(*R(4, 92, 72, 6, 1), mat="steel", velo="metal-v")
    return s


def roller_shutter():
    s = Simbolo("building", "roller-shutter", 80, 100, tipo="building", body="appliance",
                it="Tapparella", en="Roller shutter", replaces="roller_shade")
    s.forma(*R(0, 0, 80, 100), mat="wall", velo="paint-d", stroke="none")
    s.forma(*R(8, 12, 64, 80, 1), mat="glass", velo="paint-d")
    s.riflesso(*P("M10 70 L24 70 L10 88 Z"), opacita=.35)
    s.forma(*R(4, 4, 72, 10, 2), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(8, 14, 64, 52), velo="paint-v")
    s.statico()
    for y in range(20, 66, 6):
        s.tratto(f"M8 {y} L72 {y}", stroke_opacity=.35)
    s.forma(*R(4, 92, 72, 6, 1), mat="steel", velo="metal-v")
    return s


def tutti():
    return [f() for f in (
        check_valve, three_way_valve, relief_valve, motorized_valve, pneumatic_valve,
        silo, mixing_tank, agitator, jacketed_reactor,
        boiler, furnace, cooling_tower,
        y_strainer, cyclone, separator, column,
        thermometer, magnetic_flowmeter, radar_level_sensor,
        circuit_breaker, transmission_tower, battery_rack,
        axial_fan, blower, screw_compressor,
        heat_pump, chiller, ceiling_light, garage_door, window, roller_shutter,
    )]
