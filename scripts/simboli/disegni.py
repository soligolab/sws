"""I disegni della libreria SCADA. Uno per funzione, raggruppati per famiglia.

Regole (vedi genera.py e docs/plans/2026-10-14-libreria-simboli-scada.md):
vista ortogonale, luce dall'alto a sinistra, viewBox multiplo di 10, attacchi con
l'asse su multipli di 10 a filo del bordo (tubo 8: bocchello 10, flangia 14–16×4),
ingresso a sinistra. Le parti vive sono strati propri, con la geometria che il
motore usa: finestra del livello, centro e simmetria del rotore, perno e arco della
lancetta, perno e angoli della leva.
"""
import math

from genera import Simbolo


def R(x, y, w, h, rx=None):
    return "rect", {"x": x, "y": y, "width": w, "height": h, "rx": rx}


def C(cx, cy, r):
    return "circle", {"cx": cx, "cy": cy, "r": r}


def E(cx, cy, rx, ry):
    return "ellipse", {"cx": cx, "cy": cy, "rx": rx, "ry": ry}


def P(d):
    return "path", {"d": d}


def polare(cx, cy, r, gradi):
    a = math.radians(gradi)
    return cx + r * math.cos(a), cy - r * math.sin(a)


def f2(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


# ── attacchi ────────────────────────────────────────────────────────────────

def flangia_v(s, x, y, w=4, h=16):
    """Piastra verticale (flangia di un tubo orizzontale)."""
    s.forma(*R(x, y, w, h, .8), mat="steel", velo="metal-h")


def flangia_o(s, x, y, w=16, h=4):
    s.forma(*R(x, y, w, h, .8), mat="steel", velo="metal-v")


def tubo_o(s, x, y, w, h=10):
    s.forma(*R(x, y, w, h), mat="steel", velo="metal-v")


def tubo_v(s, x, y, h, w=10):
    s.forma(*R(x, y, w, h), mat="steel", velo="metal-h")


def girante(s, cx, cy, r, pale, mozzo):
    """Disco scuro con pale curve: la parte che gira di pompe e ventilatori."""
    s.forma(*C(cx, cy, r), mat="impeller")
    passo = 360 / pale
    for i in range(pale):
        a = i * passo
        p0 = (cx + r * .29 * math.cos(math.radians(a)), cy + r * .29 * math.sin(math.radians(a)))
        p1 = (cx + r * .67 * math.cos(math.radians(a + 40)), cy + r * .67 * math.sin(math.radians(a + 40)))
        p2 = (cx + r * .86 * math.cos(math.radians(a + 70)), cy + r * .86 * math.sin(math.radians(a + 70)))
        s.tratto(f"M{f2(p0[0])} {f2(p0[1])} Q{f2(p1[0])} {f2(p1[1])} {f2(p2[0])} {f2(p2[1])}",
                 mat="impeller-vane", stroke_width=1.4, stroke_linecap="round")
    s.forma(*C(cx, cy, mozzo), mat="steel", velo="metal-r")


# ── Processo e fluidi ───────────────────────────────────────────────────────

def centrifugal_pump():
    s = Simbolo("process", "centrifugal-pump", 80, 80, tipo="pumps", body="body-pump",
                it="Pompa centrifuga", en="Centrifugal pump", replaces="pump")
    tubo_o(s, 4, 45, 20); flangia_v(s, 0, 42)
    tubo_v(s, 45, 4, 32); flangia_o(s, 42, 0)
    s.forma(*P("M30 66 L50 66 L55 74 L25 74 Z"), mat="steel-dark", velo="dark-v")
    s.forma(*R(12, 74, 56, 6, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*C(40, 50, 20), velo="paint-r")
    s.statico()
    for a in range(0, 360, 45):
        s.forma(*C(f2(40 + 16.5 * math.cos(math.radians(a))), f2(50 + 16.5 * math.sin(math.radians(a))), 1.1),
                mat="steel-dark", stroke="none")
    s.parte("rotor", "rotor", cx=40, cy=50, symmetry=60)
    girante(s, 40, 50, 10.5, 6, 3.2)
    return s


def ball_valve():
    s = Simbolo("process", "ball-valve", 60, 70, tipo="valves", body="steel",
                it="Valvola a sfera", en="Ball valve", replaces="valve")
    tubo_o(s, 4, 45, 14); flangia_v(s, 0, 42)
    tubo_o(s, 42, 45, 14); flangia_v(s, 56, 42)
    s.forma(*R(27, 26, 6, 8), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(25, 32, 10, 9, 1.5), velo="paint-h")
    s.forma(*R(16, 38, 28, 24, 8), velo="paint-v")
    s.statico()
    s.tratto("M22 50 L38 50", stroke_opacity=.35)
    # Disegnata aperta (leva lungo il tubo); chiusa = -90°, leva in verticale.
    s.parte("lever", "lever", cx=30, cy=24, open=0, closed=-90)
    s.forma(*R(24, 20.5, 28, 7, 2), mat="signal-red", velo="paint-v")
    s.forma(*C(30, 24, 4), mat="steel", velo="metal-r")
    return s


def vertical_tank():
    s = Simbolo("process", "vertical-tank", 80, 160, tipo="tanks", body="stainless",
                it="Serbatoio verticale", en="Vertical tank", replaces="tank")
    tubo_v(s, 35, 4, 12); flangia_o(s, 33, 0, 14)
    tubo_o(s, 66, 125, 10); flangia_v(s, 76, 122)
    for x in (14, 60):
        s.forma(*R(x, 134, 6, 22), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 4, 155, 14, 5, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M10 32 Q10 14 40 12 Q70 14 70 32 L70 128 Q70 146 40 148 Q10 146 10 128 Z"), velo="paint-h")
    s.statico()
    for y in (32, 80, 128):
        s.tratto(f"M10 {y} L70 {y}", stroke_opacity=.3)
    s.forma(*R(30, 38, 20, 84, 3), mat="glass-dark")
    # Il liquido è disegnato pieno: il motore ne mostra la parte bassa.
    s.parte("level", "level", x=31, y=40, w=18, h=80)
    s.forma(*R(31, 40, 18, 80, 2), mat="liquid", velo="paint-h")
    s.statico()
    s.riflesso(*R(33, 40, 4, 80, 2))
    return s


def shell_tube_exchanger():
    s = Simbolo("process", "shell-tube-exchanger", 160, 80, tipo="heat-exchange", body="stainless",
                it="Scambiatore a fascio tubiero", en="Shell and tube heat exchanger", replaces="heat_exchanger")
    tubo_v(s, 15, 4, 12); flangia_o(s, 12, 0)
    tubo_v(s, 15, 60, 16); flangia_o(s, 12, 76)
    tubo_v(s, 55, 4, 14); flangia_o(s, 52, 0)
    tubo_v(s, 115, 58, 18); flangia_o(s, 112, 76)
    for x in (44, 84):
        s.forma(*P(f"M{x} 58 L{x + 16} 58 L{x + 20} 76 L{x - 4} 76 Z"), mat="steel-dark", velo="dark-v")
        s.forma(*R(x - 8, 76, 32, 4, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(4, 10, 6, 56, 1), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(10, 14, 18, 48), velo="paint-v")
    s.forma(*R(32, 16, 104, 44), velo="paint-v")
    s.forma(*P("M136 16 Q156 16 156 38 Q156 60 136 60 Z"), velo="paint-v")
    s.statico()
    s.forma(*R(28, 10, 4, 56, .8), mat="steel", velo="metal-h")
    s.forma(*R(134, 12, 4, 52, .8), mat="steel", velo="metal-h")
    for y in (24, 31, 38, 45, 52):
        s.tratto(f"M36 {y} L130 {y}", stroke_opacity=.22, stroke_dasharray="6 3")
    return s


def cartridge_filter():
    s = Simbolo("process", "cartridge-filter", 60, 120, tipo="filters", body="stainless",
                it="Filtro a cartuccia", en="Cartridge filter", replaces="filter")
    tubo_o(s, 4, 35, 8); flangia_v(s, 0, 32)
    tubo_o(s, 48, 35, 8); flangia_v(s, 56, 32)
    for x in (12, 44):
        s.forma(*R(x, 98, 4, 22), mat="steel-dark", velo="dark-h")
    tubo_v(s, 27, 100, 10, w=6)
    s.forma(*R(24, 108, 12, 5, 1), mat="signal-red")
    s.forma(*R(28.5, 2, 3, 10), mat="steel", velo="metal-h")
    s.forma(*C(30, 6, 5), mat="dial", velo="dial-r")
    s.corpo()
    s.forma(*P("M12 22 Q12 10 30 10 Q48 10 48 22 Z"), velo="paint-h")
    s.forma(*P("M10 26 L50 26 L50 92 Q50 102 30 102 Q10 102 10 92 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(8, 21, 44, 6, 1.5), mat="steel", velo="metal-v")
    for x in range(18, 44, 4):
        s.tratto(f"M{x} 50 L{x} 88", stroke_opacity=.25)
    return s


def pressure_gauge():
    s = Simbolo("process", "pressure-gauge", 60, 60, tipo="instruments", body="steel",
                it="Manometro", en="Pressure gauge", replaces="pressure_indicator")
    s.forma(*R(27, 52, 6, 8), mat="steel", velo="metal-h")
    s.forma(*P("M23 46 L37 46 L38 49 L37 53 L23 53 L22 49 Z"), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*C(30, 26, 23), velo="paint-r")
    s.statico()
    s.forma(*C(30, 26, 19), mat="dial", velo="dial-r")

    def arco(r, a0, a1):
        (x0, y0), (x1, y1) = polare(30, 26, r, a0), polare(30, 26, r, a1)
        return f"M{f2(x0)} {f2(y0)} A{r} {r} 0 {1 if abs(a1 - a0) > 180 else 0} 1 {f2(x1)} {f2(y1)}"
    for mat, a0, a1 in (("gauge-green", 225, 9), ("warning-yellow", 9, -18), ("signal-red", -18, -45)):
        s.tratto(arco(15.5, a0, a1), mat=mat, stroke_width=2.4, stroke_linecap="butt")
    for i in range(11):
        a = 225 - 27 * i
        (x0, y0), (x1, y1) = polare(30, 26, 17.5, a), polare(30, 26, 13 if i % 5 == 0 else 14.5, a)
        s.tratto(f"M{f2(x0)} {f2(y0)} L{f2(x1)} {f2(y1)}", stroke_width=.9, stroke_linecap="round")
    # Disegnata verso l'alto (metà scala); il motore la ruota fra a0 e a1.
    s.parte("needle", "needle", cx=30, cy=26, a0=-135, a1=135)
    s.tratto("M30 26 L30 12", mat="signal-red", stroke_width=1.6, stroke_linecap="round")
    s.forma(*C(30, 26, 2.2), mat="steel", velo="metal-r")
    s.statico()
    s.luce(*C(30, 26, 19), opacita=.5)
    return s


def elbow_90():
    s = Simbolo("process", "elbow-90", 60, 60, tipo="piping", body="steel",
                it="Curva 90°", en="90° elbow")
    s.corpo()
    s.forma(*R(4, 25, 6, 10), velo="metal-v")
    s.forma(*P("M10 25 A25 25 0 0 1 35 50 L25 50 A15 15 0 0 0 10 35 Z"), velo="paint-r")
    s.forma(*R(25, 50, 10, 6), velo="metal-h")
    s.statico()
    flangia_v(s, 0, 22); flangia_o(s, 22, 56)
    return s


# ── Elettrico ed energia ────────────────────────────────────────────────────

def electric_motor():
    s = Simbolo("electrical", "electric-motor", 120, 60, tipo="motors", body="body-motor",
                it="Motore elettrico", en="Electric motor", replaces="motor")
    for x in (30, 76):
        s.forma(*P(f"M{x} 50 L{x + 10} 50 L{x + 12} 58 L{x - 2} 58 Z"), mat="steel-dark", velo="dark-v")
    s.forma(*R(100, 25, 20, 10), mat="steel", velo="metal-v")
    s.tratto("M104 28 L116 28", stroke_opacity=.5)
    s.forma(*R(90, 14, 10, 32, 2), mat="steel", velo="metal-v")
    s.forma(*R(4, 12, 20, 36, 5), mat="steel-dark", velo="dark-v")
    for x in (9, 13, 17, 21):
        s.tratto(f"M{x} 17 L{x} 43", stroke_opacity=.6)
    s.corpo()
    s.forma(*R(46, 1, 26, 9, 1.5), velo="paint-d")
    s.forma(*R(24, 8, 66, 44, 4), velo="paint-v")
    s.statico()
    for y in range(14, 48, 5):
        s.tratto(f"M27 {y} L87 {y}", stroke_opacity=.35)
    s.forma(*R(52, 30, 16, 9, 1), mat="label", stroke_width=.8)
    return s


def electrical_cabinet():
    s = Simbolo("electrical", "electrical-cabinet", 80, 120, tipo="cabinets", body="cabinet",
                it="Armadio elettrico", en="Electrical cabinet")
    s.forma(*R(6, 110, 68, 10, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(4, 6, 72, 105, 2), velo="paint-d")
    s.statico()
    s.forma(*R(2, 2, 76, 6, 1.5), mat="steel", velo="metal-v")
    s.forma(*R(8.5, 11.5, 63, 95, 1.5), fill="none", stroke_opacity=.45)
    s.forma(*R(63, 52, 4.5, 18, 2), mat="steel-dark", velo="dark-h")
    s.forma(*R(16, 20, 40, 22, 2), mat="glass-dark")
    spie = (("lamp-1", "lamp-green"), ("lamp-2", "lamp-amber"), ("lamp-3", "lamp-red"))
    for i, (_, mat) in enumerate(spie):
        s.forma(*C(25 + 11 * i, 31, 4.5), mat=f"{mat}-off")
    for i, (lid, mat) in enumerate(spie):
        s.parte(lid, "lamp")
        s.forma(*C(25 + 11 * i, 31, 4.5), mat=mat)
        s.luce(*C(25 + 11 * i, 31, 4.5))
    s.statico()
    s.forma(*C(36, 58, 7), mat="warning-yellow")
    s.forma(*C(36, 58, 4.8), mat="signal-red", velo="paint-r")
    s.forma(*P("M36 72 L44 85 L28 85 Z"), mat="warning-yellow")
    s.tratto("M37 75 L33.5 80.5 L36.5 80.5 L35 84", stroke_width=.9)
    for y in range(91, 103, 3):
        s.tratto(f"M20 {y} L52 {y}", stroke_opacity=.5)
    return s


def transformer():
    s = Simbolo("electrical", "transformer", 100, 100, tipo="distribution", body="transformer",
                it="Trasformatore", en="Transformer")
    s.forma(*R(12, 86, 76, 6, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(3, 44, 94, 3), mat="steel", velo="metal-v")
    s.forma(*R(3, 74, 94, 3), mat="steel", velo="metal-v")
    for x in (4, 7.5, 11, 82.8, 86.3, 89.8, 93.3):
        s.forma(*R(x, 40, 2.2, 42), mat="steel", velo="metal-h", stroke_width=.6)
    s.corpo()
    s.forma(*R(15, 34, 70, 52, 2), velo="paint-d")
    s.statico()
    s.forma(*R(13, 31, 74, 5, 1), mat="steel", velo="metal-v")
    for x in (30, 50, 70):
        s.forma(*R(x - 3, 8, 6, 24), mat="porcelain")
        for y in (26, 20, 14):
            s.forma(*E(x, y, 6, 2), mat="porcelain-shed")
        s.forma(*R(x - 2, 2, 4, 7), mat="steel", velo="metal-h")
    s.forma(*P("M50 50 L58 63 L42 63 Z"), mat="warning-yellow")
    s.tratto("M51 53 L47.5 58.5 L50.5 58.5 L49 62", stroke_width=.9)
    return s


def solar_panel():
    s = Simbolo("electrical", "solar-panel", 100, 80, tipo="generation", body="pv-cell",
                it="Pannello fotovoltaico", en="Solar panel", replaces="solar_panel")
    s.tratto("M30 60 L24 78 M70 60 L76 78", mat="steel-dark", stroke_width=4, stroke_linecap="round")
    s.tratto("M26 74 L74 74", mat="steel-dark", stroke_width=2.5)
    s.forma(*R(3, 3, 94, 58, 1.5), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(6, 6, 88, 52), velo="paint-d")
    s.statico()
    for i in range(1, 8):
        x = 6 + 88 * i / 8
        s.tratto(f"M{f2(x)} 6 L{f2(x)} 58", mat="pv-grid", stroke_opacity=.55, stroke_width=.7)
    for j in range(1, 5):
        y = 6 + 52 * j / 5
        s.tratto(f"M6 {f2(y)} L94 {f2(y)}", mat="pv-grid", stroke_opacity=.55, stroke_width=.7)
    s.riflesso(*P("M6 6 L40 6 L14 58 L6 58 Z"), opacita=.08)
    return s


# ── Macchine e movimentazione ───────────────────────────────────────────────

def belt_conveyor():
    s = Simbolo("machines", "belt-conveyor", 160, 60, tipo="conveyors", body="body-motor",
                it="Nastro trasportatore", en="Belt conveyor", replaces="conveyor")
    for x in (24, 130):
        s.forma(*R(x, 30, 6, 26), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 4, 55, 14, 5, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M30 36 L130 50 M30 50 L130 36", mat="steel-dark", stroke_width=2)
    s.forma(*R(4, 8, 152, 24, 12), mat="rubber", velo="rubber-r")
    for i, cx in enumerate((16, 144)):
        s.parte(f"rotor-{i + 1}", "rotor", cx=cx, cy=20, symmetry=90)
        s.forma(*C(cx, 20, 9.5), mat="steel", velo="metal-r")
        s.tratto(f"M{cx - 7} 20 L{cx + 7} 20 M{cx} 13 L{cx} 27", stroke_opacity=.5)
        s.forma(*C(cx, 20, 2.5), mat="steel-dark")
    s.corpo()
    s.forma(*R(26, 13, 108, 14, 1.5), velo="paint-v")
    s.statico()
    for x in range(36, 130, 16):
        s.forma(*C(x, 20, 1.2), mat="steel-dark", stroke="none")
    return s


def forklift():
    s = Simbolo("machines", "forklift", 120, 100, tipo="handling", body="safety-yellow",
                it="Carrello elevatore", en="Forklift")
    s.forma(*R(86, 6, 6, 78), mat="steel-dark", velo="dark-h")
    s.forma(*R(92, 54, 5, 28), mat="steel-dark", velo="dark-h")
    s.forma(*P("M95 78 L118 78 L118 82 L93 82 Z"), mat="steel", velo="metal-v")
    s.tratto("M32 52 L35 16 M75 52 L72 16", mat="steel-dark", stroke_width=3.5, stroke_linecap="round")
    s.forma(*R(29, 12, 48, 5, 1.5), mat="steel-dark", velo="dark-v")
    s.forma(*P("M40 52 L42 38 L52 38 L50 46 L56 52 Z"), mat="rubber")
    s.tratto("M60 40 L66 52", mat="rubber", stroke_width=2.5, stroke_linecap="round")
    s.corpo()
    s.forma(*P("M18 52 L84 52 L84 80 L14 80 Q8 80 8 72 L8 62 Q8 52 18 52 Z"), velo="paint-v")
    s.statico()
    s.tratto("M10 70 L84 70", stroke_opacity=.35)
    for cx, cy, r in ((68, 86, 12), (26, 88, 10)):
        s.forma(*C(cx, cy, r), mat="rubber", velo="rubber-r")
        s.forma(*C(cx, cy, f2(r * .45)), mat="steel", velo="metal-r")
    return s


def centrifugal_fan():
    s = Simbolo("machines", "centrifugal-fan", 100, 100, tipo="machines", body="body-pump",
                it="Ventilatore centrifugo", en="Centrifugal fan")
    s.forma(*R(22, 94, 56, 6, 1), mat="steel-dark", velo="dark-v")
    flangia_o(s, 48, 4, 44)
    s.corpo()
    s.forma(*P("M90 56 A40 40 0 1 1 50 16 L50 8 L90 8 Z"), velo="paint-r")
    s.statico()
    s.forma(*C(50, 56, 16), mat="steel", velo="metal-r")
    s.parte("rotor", "rotor", cx=50, cy=56, symmetry=45)
    girante(s, 50, 56, 13.5, 8, 3.5)
    return s


def photoelectric_sensor():
    s = Simbolo("machines", "photoelectric-sensor", 60, 40, tipo="sensors", body="safety-yellow",
                it="Fotocellula", en="Photoelectric sensor")
    s.tratto("M0 20 L4 20", mat="rubber", stroke_width=4)
    s.forma(*R(3, 14, 7, 12, 1.5), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(10, 6, 34, 28, 3), velo="paint-d")
    s.statico()
    s.forma(*R(44, 10, 7, 20, 1.5), mat="glass-dark")
    s.luce(*R(44, 10, 7, 20, 1.5), opacita=.6)
    s.forma(*C(17, 12, 2.3), mat="lamp-green-off")
    s.parte("led", "lamp")
    s.forma(*C(17, 12, 2.3), mat="lamp-green")
    s.luce(*C(17, 12, 2.3))
    s.statico()
    for d in ("M54 15 L59 13", "M54 20 L59.5 20", "M54 25 L59 27"):
        s.tratto(d, mat="lamp-red", stroke_width=1.2, stroke_linecap="round", stroke_opacity=.8)
    return s


def stack_light():
    s = Simbolo("machines", "stack-light", 30, 100, tipo="signalling", body="steel-dark",
                it="Colonna luminosa", en="Stack light")
    s.forma(*R(4, 92, 22, 8, 1.5), mat="steel-dark", velo="dark-v")
    s.forma(*R(12, 68, 6, 25), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*P("M6 14 Q6 6 15 6 Q24 6 24 14 Z"), velo="paint-h")
    s.forma(*R(5, 66, 20, 5, 1), velo="paint-h")
    s.statico()
    segmenti = (("lamp-red", "lamp-red"), ("lamp-amber", "lamp-amber"), ("lamp-green", "lamp-green"))
    for i, (_, mat) in enumerate(segmenti):
        s.forma(*R(6, 15 + 17 * i, 18, 15, 1), mat=f"{mat}-off", velo="paint-h")
    for i, (lid, mat) in enumerate(segmenti):
        y = 15 + 17 * i
        s.parte(lid, "lamp")
        s.forma(*R(6, y, 18, 15, 1), mat=mat, velo="paint-h")
        s.riflesso(*R(9, y + 2, 3, 11, 1.5), opacita=.35)
    s.statico()
    for i in (1, 2):
        s.forma(*R(5, 15 + 17 * i - 1.5, 20, 2, .8), mat="steel-dark")
    return s


def tutti():
    return [f() for f in (
        centrifugal_pump, ball_valve, vertical_tank, shell_tube_exchanger, cartridge_filter,
        pressure_gauge, elbow_90,
        electric_motor, electrical_cabinet, transformer, solar_panel,
        belt_conveyor, forklift, centrifugal_fan, photoelectric_sensor, stack_light,
    )]
