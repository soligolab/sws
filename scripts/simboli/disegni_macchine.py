"""Fase 7, lotti 3 e 4: il resto di «Macchine e movimentazione» e di «Edificio e
HVAC». Stesse regole di `disegni.py`."""
import math

from genera import Simbolo
from disegni import C, E, P, R, f2, flangia_o, flangia_v, polare, tubo_o, tubo_v
from disegni_elettrico import display, piedini, spia
from disegni_processo import nervature
from disegni_sostitutivi import petali


def ruota(s, cx, cy, r):
    s.forma(*C(cx, cy, r), mat="rubber", velo="rubber-r")
    s.forma(*C(cx, cy, f2(r * .45)), mat="steel", velo="metal-r")


def gambe(s, xs, y0, y1):
    for x in xs:
        s.forma(*R(x, y0, 6, y1 - y0), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 4, y1 - 1, 14, 5, 1), mat="steel-dark", velo="dark-v")


# ── Nastri ──────────────────────────────────────────────────────────────────

def roller_conveyor():
    s = Simbolo("machines", "roller-conveyor", 160, 60, tipo="conveyors", body="body-motor", it="Rulliera", en="Roller conveyor")
    gambe(s, (24, 130), 26, 56)
    s.tratto("M30 34 L130 48 M30 48 L130 34", mat="steel-dark", stroke_width=2)
    for x in range(14, 150, 12):
        s.forma(*C(x, 14, 5.5), mat="steel", velo="metal-r")
    s.corpo()
    s.forma(*R(6, 16, 148, 10, 1.5), velo="paint-v")
    return s


def screw_conveyor():
    s = Simbolo("machines", "screw-conveyor", 170, 70, tipo="conveyors", body="body-motor", it="Coclea", en="Screw conveyor")
    tubo_v(s, 25, 4, 14); flangia_o(s, 22, 0)
    tubo_v(s, 135, 52, 14); flangia_o(s, 132, 66)
    s.forma(*R(150, 24, 18, 26, 4), mat="body-motor", velo="paint-v")
    s.corpo()
    s.forma(*R(10, 18, 140, 34, 8), velo="paint-v")
    s.statico()
    s.forma(*R(20, 24, 120, 22, 4), mat="glass-dark")
    s.tratto("M22 35 " + " ".join(f"Q{26 + i * 12} {24 if i % 2 == 0 else 46} {28 + i * 12} 35" for i in range(10)), mat="steel", stroke_width=2.4)
    s.tratto("M20 35 L140 35", mat="steel", stroke_width=1.6)
    s.luce(*R(20, 24, 120, 22, 4), opacita=.3)
    return s


def bucket_elevator():
    s = Simbolo("machines", "bucket-elevator", 90, 170, tipo="conveyors", body="body-motor", it="Elevatore a tazze", en="Bucket elevator")
    s.forma(*P("M60 20 L86 34 L86 44 L60 34 Z"), mat="steel", velo="metal-h")
    tubo_o(s, 0, 145, 14); flangia_v(s, 0, 142)
    s.forma(*R(4, 2, 14, 18, 3), mat="body-motor", velo="paint-v")
    s.corpo()
    s.forma(*R(18, 8, 44, 30, 8), velo="paint-v")
    s.forma(*R(24, 38, 32, 100), velo="paint-h")
    s.forma(*R(14, 136, 52, 30, 6), velo="paint-v")
    s.statico()
    s.forma(*R(30, 44, 20, 88, 2), mat="glass-dark")
    for y in range(48, 130, 12):
        s.forma(*P(f"M34 {y} L46 {y} L44 {y + 6} L36 {y + 6} Z"), mat="safety-yellow", stroke_width=.6)
    s.luce(*R(30, 44, 20, 88, 2), opacita=.3)
    return s


def chain_conveyor():
    s = Simbolo("machines", "chain-conveyor", 160, 60, tipo="conveyors", body="body-motor", it="Trasportatore a catena", en="Chain conveyor")
    gambe(s, (24, 130), 30, 56)
    s.forma(*R(4, 8, 152, 24, 12), mat="steel-dark", velo="dark-v")
    for x in range(14, 148, 7):
        s.forma(*R(x, 9, 5, 3, 1), mat="steel", stroke_width=.5)
        s.forma(*R(x, 28, 5, 3, 1), mat="steel", stroke_width=.5)
    for i, cx in enumerate((16, 144)):
        s.parte(f"rotor-{i + 1}", "rotor", cx=cx, cy=20, symmetry=45)
        s.forma(*C(cx, 20, 9.5), mat="steel", velo="metal-r")
        for a in range(0, 360, 45):
            x0, y0 = polare(cx, 20, 9.5, a)
            s.forma(*C(f2(x0), f2(y0), 1.6), mat="steel-dark", stroke="none")
        s.forma(*C(cx, 20, 2.5), mat="steel-dark")
    s.corpo()
    s.forma(*R(26, 13, 108, 14, 1.5), velo="paint-v")
    return s


def curved_conveyor():
    s = Simbolo("machines", "curved-conveyor", 120, 120, tipo="conveyors", body="body-motor", it="Curva del nastro", en="Curved conveyor")
    s.forma(*P("M10 110 L10 100 A90 90 0 0 1 100 10 L110 10 L110 46 L100 46 A54 54 0 0 0 46 100 L46 110 Z"), mat="rubber", velo="rubber-r")
    s.corpo()
    s.forma(*P("M6 110 L6 100 A94 94 0 0 1 100 6 L110 6 L110 12 L100 12 A88 88 0 0 0 12 100 L12 110 Z"), velo="paint-v")
    s.forma(*P("M40 110 L40 100 A60 60 0 0 1 100 40 L110 40 L110 50 L100 50 A50 50 0 0 0 50 100 L50 110 Z"), velo="paint-v")
    s.statico()
    for a in range(8, 90, 12):
        c = math.radians(180 + a)
        x0, y0 = 110 + 92 * math.cos(c), 110 + 92 * math.sin(c)
        x1, y1 = 110 + 62 * math.cos(c), 110 + 62 * math.sin(c)
        s.tratto(f"M{f2(x0)} {f2(y0)} L{f2(x1)} {f2(y1)}", stroke_opacity=.3)
    return s


# ── Movimentazione ──────────────────────────────────────────────────────────

def pallet_jack():
    s = Simbolo("machines", "pallet-jack", 120, 90, tipo="handling", body="signal-red", it="Transpallet", en="Pallet jack")
    s.forma(*P("M30 76 L116 76 L116 82 L30 82 Z"), mat="steel", velo="metal-v")
    s.tratto("M24 60 L8 6", mat="steel-dark", stroke_width=3.5, stroke_linecap="round")
    s.forma(*R(2, 2, 16, 6, 3), mat="rubber")
    s.corpo()
    s.forma(*P("M16 52 L40 52 L40 82 L22 82 Q14 82 14 74 Z"), velo="paint-v")
    s.statico()
    ruota(s, 26, 82, 7)
    ruota(s, 108, 85, 4)
    return s


def agv():
    s = Simbolo("machines", "agv", 120, 70, tipo="handling", body="safety-yellow", it="Navetta AGV", en="AGV")
    for cx in (24, 96):
        ruota(s, cx, 60, 7)
    s.forma(*R(52, 8, 16, 10, 3), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(6, 18, 108, 40, 6), velo="paint-v")
    s.statico()
    s.forma(*R(14, 26, 92, 6, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M14 44 L106 44", stroke_opacity=.35)
    spia(s, "lamp", 60, 12, 3, "lamp-green")
    return s


def overhead_crane():
    s = Simbolo("machines", "overhead-crane", 160, 120, tipo="handling", body="safety-yellow", it="Carroponte", en="Overhead crane")
    for x in (6, 146):
        s.forma(*R(x, 20, 8, 100), mat="steel-dark", velo="dark-h")
    s.tratto("M80 34 L80 86", mat="steel-dark", stroke_width=1.6)
    s.tratto("M80 86 L80 94 Q80 102 74 102 Q70 102 70 98", mat="steel", stroke_width=3, stroke_linecap="round")
    s.corpo()
    s.forma(*R(2, 10, 156, 14, 2), velo="paint-v")
    s.statico()
    s.forma(*R(66, 22, 28, 14, 2), mat="steel-dark", velo="dark-v")
    for x in range(10, 152, 12):
        s.tratto(f"M{x} 11 L{x + 6} 23", stroke_opacity=.35)
    return s


def hoist():
    s = Simbolo("machines", "hoist", 60, 130, tipo="handling", body="safety-yellow", it="Paranco", en="Hoist")
    s.forma(*R(24, 0, 12, 10, 2), mat="steel", velo="metal-v")
    s.tratto("M30 50 L30 104", mat="steel-dark", stroke_width=2.2, stroke_dasharray="3 1.5")
    s.forma(*R(22, 102, 16, 8, 2), mat="steel-dark", velo="dark-v")
    s.tratto("M30 110 L30 116 Q30 126 22 126 Q16 126 16 120", mat="steel", stroke_width=3.2, stroke_linecap="round")
    s.corpo()
    s.forma(*R(8, 8, 44, 42, 8), velo="paint-v")
    s.statico()
    s.forma(*C(30, 29, 10), fill="none", stroke_opacity=.4)
    return s


def industrial_robot():
    s = Simbolo("machines", "industrial-robot", 110, 130, tipo="handling", body="safety-yellow", it="Robot industriale", en="Industrial robot")
    s.forma(*R(14, 118, 52, 12, 2), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M24 118 L56 118 L52 96 L28 96 Z"), velo="paint-h")
    s.forma(*P("M34 98 L46 98 L74 40 L64 34 Z"), velo="paint-h")
    s.forma(*P("M64 34 L72 44 L100 30 L94 22 Z"), velo="paint-v")
    s.statico()
    for cx, cy, r in ((40, 96, 8), (69, 38, 7)):
        s.forma(*C(cx, cy, r), mat="steel-dark", velo="dark-v")
        s.forma(*C(cx, cy, f2(r * .4)), mat="steel", velo="metal-r")
    s.forma(*R(96, 18, 8, 18, 2), mat="steel", velo="metal-h")
    s.tratto("M104 20 L110 16 M104 34 L110 38", mat="steel-dark", stroke_width=2.4, stroke_linecap="round")
    return s


def pallet():
    s = Simbolo("machines", "pallet", 100, 30, tipo="handling", body="wood", it="Pallet", en="Pallet")
    s.corpo()
    s.forma(*R(2, 4, 96, 6, 1), velo="paint-v")
    s.forma(*R(2, 20, 96, 6, 1), velo="paint-v")
    for x in (4, 44, 84):
        s.forma(*R(x, 10, 12, 10, 1), velo="paint-d")
    return s


def parcel():
    s = Simbolo("machines", "parcel", 60, 50, tipo="handling", body="cardboard", it="Collo", en="Parcel")
    s.corpo()
    s.forma(*R(4, 6, 52, 40, 2), velo="paint-d")
    s.statico()
    s.forma(*R(24, 6, 12, 40), mat="label", fill_opacity=.5, stroke="none")
    s.forma(*R(8, 30, 14, 10, 1), mat="appliance", stroke_width=.6)
    return s


# ── Macchine e aria ─────────────────────────────────────────────────────────

def piston_compressor():
    s = Simbolo("machines", "piston-compressor", 130, 100, tipo="machines", body="signal-red", it="Compressore a pistoni", en="Piston compressor")
    piedini(s, (20, 96), 86, 12, 10)
    s.forma(*R(70, 18, 34, 30, 3), mat="body-motor", velo="paint-v")
    nervature(s, 74, 101, 22, 45, 4)
    s.forma(*R(22, 10, 24, 38, 3), mat="steel-dark", velo="dark-v")
    nervature(s, 22, 46, 14, 34, 4, verticali=False)
    s.forma(*P("M46 26 L70 22 L70 44 L46 40 Z"), mat="safety-yellow", velo="paint-h")
    s.corpo()
    s.forma(*P("M24 48 L106 48 Q122 48 122 67 Q122 86 106 86 L24 86 Q8 86 8 67 Q8 48 24 48 Z"), velo="paint-v")
    s.statico()
    s.forma(*C(112, 56, 5), mat="dial", velo="dial-r")
    return s


def air_receiver():
    s = Simbolo("machines", "air-receiver", 60, 150, tipo="machines", body="signal-red", it="Serbatoio dell'aria", en="Air receiver")
    tubo_o(s, 44, 35, 16); flangia_v(s, 56, 32)
    s.forma(*R(26, 2, 8, 10, 1), mat="steel", velo="metal-h")
    s.forma(*C(14, 46, 6), mat="dial", velo="dial-r")
    s.tratto("M14 52 L14 58", mat="steel", stroke_width=2)
    for x in (12, 42):
        s.forma(*R(x, 128, 6, 18), mat="steel-dark", velo="dark-h")
        s.forma(*R(x - 3, 145, 12, 5, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M8 28 Q8 10 30 10 Q52 10 52 28 L52 118 Q52 136 30 136 Q8 136 8 118 Z"), velo="paint-h")
    s.statico()
    s.forma(*R(16, 70, 28, 18, 1), mat="label", stroke_width=.6)
    return s


def press():
    s = Simbolo("machines", "press", 110, 150, tipo="machines", body="body-pump", it="Pressa", en="Press")
    s.forma(*R(50, 0, 10, 16), mat="steel", velo="metal-h")
    for x in (18, 84):
        s.forma(*R(x, 36, 8, 88), mat="steel", velo="metal-h")
    s.forma(*R(30, 78, 50, 10, 1), mat="steel", velo="metal-v")
    s.forma(*R(42, 46, 26, 32), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(8, 14, 94, 24, 3), velo="paint-v")
    s.forma(*R(8, 122, 94, 24, 3), velo="paint-v")
    s.statico()
    s.forma(*R(28, 116, 54, 6, 1), mat="steel-dark", velo="dark-v")
    s.forma(*P("M48 100 L62 100 L64 108 L46 108 Z"), mat="steel-dark", velo="dark-v")
    return s


def cnc_machine():
    s = Simbolo("machines", "cnc-machine", 150, 110, tipo="machines", body="appliance", it="Centro di lavoro CNC", en="CNC machine")
    s.forma(*R(4, 100, 142, 10, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(6, 8, 112, 92, 4), velo="paint-d")
    s.forma(*R(118, 20, 26, 60, 3), velo="paint-d")
    s.statico()
    s.forma(*R(16, 18, 72, 50, 3), mat="glass-dark")
    s.forma(*R(46, 22, 12, 20, 1), mat="steel", velo="metal-h")
    s.forma(*R(30, 54, 44, 8, 1), mat="steel", velo="metal-v")
    s.luce(*R(16, 18, 72, 50, 3), opacita=.35)
    s.forma(*R(92, 30, 4, 30, 2), mat="steel-dark")
    s.forma(*R(6, 74, 112, 4), mat="safety-yellow", fill_opacity=.9, stroke_width=.6)
    display(s, 122, 26, 18, 14)
    for y in (46, 56, 66):
        s.forma(*R(122, y, 18, 6, 1), mat="steel-dark", stroke_width=.5)
    return s


def extruder():
    s = Simbolo("machines", "extruder", 170, 80, tipo="machines", body="body-motor", it="Estrusore", en="Extruder")
    s.forma(*R(4, 68, 162, 12, 1), mat="steel-dark", velo="dark-v")
    s.forma(*P("M66 4 L94 4 L86 26 L74 26 Z"), mat="steel", velo="metal-h")
    s.forma(*R(4, 24, 28, 40, 4), mat="body-motor", velo="paint-v")
    nervature(s, 8, 29, 29, 60, 4)
    s.corpo()
    s.forma(*R(32, 20, 34, 48, 4), velo="paint-v")
    s.statico()
    s.forma(*R(66, 30, 90, 24, 3), mat="steel", velo="metal-v")
    for x in range(74, 150, 16):
        s.forma(*R(x, 27, 8, 30, 1.5), mat="copper", velo="metal-h")
    s.forma(*R(156, 34, 10, 16, 2), mat="steel-dark", velo="dark-h")
    return s


def mill():
    s = Simbolo("machines", "mill", 110, 120, tipo="machines", body="body-pump", it="Mulino", en="Mill")
    s.forma(*P("M30 4 L80 4 L70 30 L40 30 Z"), mat="steel", velo="metal-h")
    tubo_v(s, 45, 96, 24, w=20)
    s.forma(*R(76, 54, 30, 30, 4), mat="body-motor", velo="paint-v")
    nervature(s, 80, 103, 58, 81, 4)
    s.corpo()
    s.forma(*C(52, 62, 34), velo="paint-r")
    s.statico()
    s.forma(*C(52, 62, 18), fill="none", stroke_opacity=.45)
    s.forma(*C(52, 62, 5), mat="steel", velo="metal-r")
    return s


# ── Sensori ─────────────────────────────────────────────────────────────────

def inductive_sensor():
    s = Simbolo("machines", "inductive-sensor", 80, 30, tipo="sensors", body="steel", it="Sensore induttivo", en="Inductive sensor")
    s.tratto("M0 15 L8 15", mat="rubber", stroke_width=4)
    s.forma(*R(6, 9, 10, 12, 2), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(16, 7, 52, 16, 2), velo="metal-v")
    s.statico()
    for x in range(20, 64, 3):
        s.tratto(f"M{x} 7 L{x + 2} 23", stroke_opacity=.25)
    s.forma(*R(40, 4, 8, 22, 1), mat="steel", velo="metal-h")
    s.forma(*R(68, 8, 10, 14, 2), mat="safety-yellow", velo="paint-h")
    spia(s, "led", 22, 15, 2, "lamp-amber")
    return s


def limit_switch():
    s = Simbolo("machines", "limit-switch", 60, 100, tipo="sensors", body="safety-yellow", it="Finecorsa", en="Limit switch")
    s.tratto("M30 96 L30 100", mat="rubber", stroke_width=4)
    s.forma(*R(24, 88, 12, 8, 2), mat="steel-dark", velo="dark-v")
    s.forma(*R(26, 30, 8, 12), mat="steel", velo="metal-h")
    s.parte("lever", "lever", cx=30, cy=32, open=0, closed=30)
    s.forma(*R(28, 6, 4, 28, 1.5), mat="steel", velo="metal-h")
    s.forma(*C(30, 8, 6), mat="rubber", velo="rubber-r")
    s.forma(*C(30, 32, 3), mat="steel-dark")
    s.corpo()
    s.forma(*R(10, 40, 40, 50, 4), velo="paint-d")
    return s


def light_curtain():
    s = Simbolo("machines", "light-curtain", 60, 150, tipo="sensors", body="safety-yellow", it="Barriera fotoelettrica", en="Light curtain")
    s.tratto("M30 144 L30 150", mat="rubber", stroke_width=4)
    s.corpo()
    s.forma(*R(18, 4, 24, 140, 4), velo="paint-h")
    s.statico()
    s.forma(*R(24, 12, 12, 116, 2), mat="glass-dark")
    for y in range(18, 126, 10):
        s.forma(*C(30, y, 2), mat="lamp-red-off", stroke="none")
    s.parte("lamp", "lamp")
    for y in range(18, 126, 10):
        s.forma(*C(30, y, 2), mat="lamp-red", stroke="none")
    s.statico()
    spia(s, "led", 30, 136, 2.4, "lamp-green")
    return s


def encoder():
    s = Simbolo("machines", "encoder", 70, 70, tipo="sensors", body="steel", it="Encoder", en="Encoder")
    s.tratto("M56 52 Q68 58 70 70", mat="rubber", stroke_width=3)
    s.corpo()
    s.forma(*C(32, 32, 26), velo="paint-r")
    s.statico()
    s.forma(*C(32, 32, 18), mat="steel-dark", velo="dark-v")
    s.parte("rotor", "rotor", cx=32, cy=32, symmetry=90)
    s.forma(*C(32, 32, 7), mat="steel", velo="metal-r")
    s.forma(*R(29, 25, 6, 3), mat="steel-dark", stroke="none")
    s.statico()
    for a in (45, 135, 225, 315):
        x, y = polare(32, 32, 22, a)
        s.forma(*C(f2(x), f2(y), 1.8), mat="steel-dark", stroke="none")
    return s


def load_cell():
    s = Simbolo("machines", "load-cell", 100, 40, tipo="sensors", body="steel", it="Cella di carico", en="Load cell")
    s.tratto("M90 26 Q98 28 100 36", mat="rubber", stroke_width=3)
    s.corpo()
    s.forma(*R(4, 8, 86, 24, 2), velo="metal-v")
    s.statico()
    s.forma(*C(24, 20, 6), mat="steel-dark", velo="dark-v")
    s.forma(*C(70, 20, 6), mat="steel-dark", velo="dark-v")
    s.forma(*R(40, 14, 16, 12, 6), mat="glass-dark")
    return s


# ── Segnalazione ────────────────────────────────────────────────────────────

def siren():
    s = Simbolo("machines", "siren", 70, 70, tipo="signalling", body="signal-red", it="Sirena", en="Siren")
    s.forma(*R(4, 24, 12, 22, 2), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*P("M16 22 L40 22 L62 8 L62 62 L40 48 L16 48 Z"), velo="paint-h")
    s.statico()
    for x in (46, 52, 58):
        s.tratto(f"M{x} {18 + (x - 46) * .6} L{x} {52 - (x - 46) * .6}", stroke_opacity=.45)
    return s


def beacon():
    s = Simbolo("machines", "beacon", 50, 70, tipo="signalling", body="steel-dark", it="Lampeggiante", en="Beacon")
    s.corpo()
    s.forma(*R(8, 52, 34, 14, 3), velo="paint-v")
    s.statico()
    s.forma(*P("M12 52 L12 26 Q12 6 25 6 Q38 6 38 26 L38 52 Z"), mat="lamp-amber-off", velo="paint-h")
    s.parte("lamp", "lamp")
    s.forma(*P("M12 52 L12 26 Q12 6 25 6 Q38 6 38 26 L38 52 Z"), mat="lamp-amber", velo="paint-h")
    s.riflesso(*R(16, 14, 4, 34, 2), opacita=.4)
    return s


def emergency_stop():
    s = Simbolo("machines", "emergency-stop", 60, 60, tipo="signalling", body="safety-yellow", it="Pulsante di emergenza", en="Emergency stop")
    s.corpo()
    s.forma(*R(4, 4, 52, 52, 6), velo="paint-d")
    s.statico()
    s.forma(*C(30, 30, 20), mat="steel-dark", velo="dark-v")
    s.forma(*C(30, 30, 16), mat="signal-red", velo="paint-r")
    s.forma(*C(30, 30, 9), fill="none", stroke_opacity=.45)
    return s


# ── Edificio e HVAC ─────────────────────────────────────────────────────────

def air_handling_unit():
    s = Simbolo("building", "air-handling-unit", 170, 90, tipo="hvac", body="appliance", it="Unità di trattamento aria", en="Air handling unit")
    s.forma(*R(0, 20, 8, 40, 1), mat="steel", velo="metal-h")
    s.forma(*R(162, 20, 8, 40, 1), mat="steel", velo="metal-h")
    piedini(s, (24, 132), 80, 14, 10)
    s.corpo()
    s.forma(*R(8, 10, 154, 70, 3), velo="paint-d")
    s.statico()
    for x in (48, 88, 128):
        s.tratto(f"M{x} 12 L{x} 78", stroke_opacity=.4)
    s.forma(*R(14, 18, 28, 54, 1), mat="glass-dark")
    for y in range(20, 72, 4):
        s.tratto(f"M16 {y} L40 {y + 2}", mat="steel", stroke_width=.8)
    s.forma(*R(54, 18, 28, 54, 1), mat="copper", velo="metal-h")
    nervature(s, 56, 81, 19, 71, 3, opacita=.5)
    s.forma(*C(108, 45, 18), mat="steel-dark", velo="dark-v")
    s.parte("rotor", "rotor", cx=108, cy=45, symmetry=90)
    petali(s, 108, 45, 15, 4, 4)
    s.statico()
    s.forma(*R(134, 18, 22, 54, 1), mat="glass", velo="paint-d")
    return s


def fan_coil():
    s = Simbolo("building", "fan-coil", 120, 60, tipo="hvac", body="appliance", it="Ventilconvettore", en="Fan coil")
    s.corpo()
    s.forma(*R(4, 6, 112, 48, 6), velo="paint-d")
    s.statico()
    nervature(s, 14, 106, 12, 30, 4, opacita=.5)
    s.forma(*R(12, 36, 96, 10, 2), mat="steel-dark", velo="dark-v")
    spia(s, "led", 104, 16, 2.2, "lamp-green")
    return s


def radiator():
    s = Simbolo("building", "radiator", 120, 70, tipo="hvac", body="appliance", it="Radiatore", en="Radiator")
    tubo_o(s, 0, 55, 8, h=6)
    tubo_o(s, 112, 55, 8, h=6)
    s.corpo()
    for x in range(8, 112, 10):
        s.forma(*R(x, 6, 8, 58, 3), velo="paint-h")
    s.statico()
    s.forma(*R(4, 6, 6, 8, 1), mat="steel", velo="metal-h")
    return s


def thermostat():
    s = Simbolo("building", "thermostat", 60, 60, tipo="hvac", body="appliance", it="Termostato", en="Thermostat")
    s.corpo()
    s.forma(*R(4, 4, 52, 52, 10), velo="paint-d")
    s.statico()
    s.forma(*C(30, 30, 18), mat="steel", velo="metal-r")
    s.forma(*C(30, 30, 13), mat="glass-dark")
    s.parte("needle", "needle", cx=30, cy=30, a0=-135, a1=135)
    s.tratto("M30 30 L30 19", mat="flame", stroke_width=2, stroke_linecap="round")
    s.forma(*C(30, 30, 2.4), mat="steel", velo="metal-r")
    return s


def tutti():
    return [f() for f in (
        roller_conveyor, screw_conveyor, bucket_elevator, chain_conveyor, curved_conveyor,
        pallet_jack, agv, overhead_crane, hoist, industrial_robot, pallet, parcel,
        piston_compressor, air_receiver, press, cnc_machine, extruder, mill,
        inductive_sensor, limit_switch, light_curtain, encoder, load_cell,
        siren, beacon, emergency_stop,
        air_handling_unit, fan_coil, radiator, thermostat,
    )]
