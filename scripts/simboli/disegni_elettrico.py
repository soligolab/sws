"""Fase 7, lotto 2: il resto di «Elettrico ed energia». Stesse regole di `disegni.py`."""
import math

from genera import Simbolo
from disegni import C, E, P, R, f2, polare
from disegni_processo import nervature
from disegni_sostitutivi import petali


def piedini(s, xs, y, larghezza=12, altezza=8):
    for x in xs:
        s.forma(*P(f"M{x} {y} L{x + larghezza} {y} L{x + larghezza + 2} {y + altezza} L{x - 2} {y + altezza} Z"),
                mat="steel-dark", velo="dark-v")


def display(s, x, y, w, h, mat_riga="lamp-green"):
    s.forma(*R(x, y, w, h, 2), mat="glass-dark")
    s.tratto(f"M{x + 4} {y + h / 2} L{x + w * .45} {y + h / 2} M{x + w * .55} {y + h / 2} L{x + w - 4} {y + h / 2}",
             mat=mat_riga, stroke_width=1.8, stroke_linecap="round")
    s.luce(*R(x, y, w, h, 2), opacita=.4)


def spia(s, pid, cx, cy, r, mat):
    s.forma(*C(cx, cy, r), mat=f"{mat}-off")
    s.parte(pid, "lamp")
    s.forma(*C(cx, cy, r), mat=mat)
    s.luce(*C(cx, cy, r))
    s.statico()


# ── Motori ──────────────────────────────────────────────────────────────────

def electric_motor_front():
    s = Simbolo("electrical", "electric-motor-front", 80, 90, tipo="motors", body="body-motor",
                it="Motore elettrico (frontale)", en="Electric motor (front)")
    piedini(s, (10, 56), 76, 14, 10)
    s.forma(*R(28, 0, 24, 12, 1.5), mat="body-motor", velo="paint-d")
    s.corpo()
    s.forma(*C(40, 46, 34), velo="paint-r")
    s.statico()
    for a in range(0, 360, 20):
        x0, y0 = polare(40, 46, 26, a)
        x1, y1 = polare(40, 46, 33, a)
        s.tratto(f"M{f2(x0)} {f2(y0)} L{f2(x1)} {f2(y1)}", stroke_opacity=.35)
    s.forma(*C(40, 46, 16), mat="steel", velo="metal-r")
    s.forma(*C(40, 46, 5), mat="steel-dark", velo="dark-v")
    return s


def gear_motor():
    s = Simbolo("electrical", "gear-motor", 130, 70, tipo="motors", body="body-motor", it="Motoriduttore", en="Gear motor")
    piedini(s, (78, 108), 58, 10, 10)
    s.forma(*R(4, 14, 16, 38, 4), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(20, 10, 52, 46, 4), velo="paint-v")
    s.forma(*R(72, 4, 50, 56, 6), velo="paint-v")
    s.statico()
    nervature(s, 23, 70, 15, 52, 5, verticali=False)
    s.forma(*R(84, 22, 26, 20, 2), mat="label", stroke_width=.8)
    s.forma(*R(122, 26, 8, 12), mat="steel", velo="metal-v")
    return s


def servo_motor():
    s = Simbolo("electrical", "servo-motor", 110, 60, tipo="motors", body="steel-dark", it="Servomotore", en="Servo motor")
    s.forma(*R(94, 24, 16, 12), mat="steel", velo="metal-v")
    s.forma(*R(84, 6, 10, 48, 1.5), mat="steel", velo="metal-h")
    s.forma(*R(30, 0, 14, 10, 2), mat="safety-yellow", velo="paint-d")
    s.forma(*R(48, 0, 12, 10, 2), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(20, 8, 64, 44, 3), velo="paint-v")
    s.statico()
    s.forma(*R(6, 12, 14, 36, 4), mat="steel-dark", velo="dark-v")
    s.tratto("M24 30 L80 30", stroke_opacity=.3)
    return s


def dc_motor():
    s = Simbolo("electrical", "dc-motor", 110, 70, tipo="motors", body="signal-red", it="Motore in corrente continua", en="DC motor")
    piedini(s, (28, 70), 58, 12, 10)
    s.forma(*R(94, 30, 16, 10), mat="steel", velo="metal-v")
    s.forma(*R(84, 16, 10, 38, 2), mat="steel", velo="metal-v")
    s.forma(*R(8, 16, 16, 38, 4), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(24, 10, 60, 50, 6), velo="paint-v")
    s.statico()
    for x in (34, 62):
        s.forma(*R(x, 4, 14, 10, 2), mat="steel-dark", velo="dark-v")
    s.forma(*R(44, 28, 20, 12, 1), mat="label", stroke_width=.8)
    return s


# ── Quadri e automazione ────────────────────────────────────────────────────

def electrical_cabinet_open():
    s = Simbolo("electrical", "electrical-cabinet-open", 120, 120, tipo="cabinets", body="cabinet",
                it="Armadio elettrico aperto", en="Open electrical cabinet")
    s.forma(*R(6, 110, 78, 10, 1), mat="steel-dark", velo="dark-v")
    s.forma(*P("M84 6 L112 14 L112 104 L84 111 Z"), mat="cabinet", velo="paint-h")
    s.corpo()
    s.forma(*R(4, 6, 80, 105, 2), velo="paint-d")
    s.statico()
    s.forma(*R(10, 12, 68, 93, 1), mat="steel-dark", velo="dark-v")
    for i, y in enumerate((20, 46, 72)):
        s.forma(*R(12, y + 8, 64, 3), mat="steel", stroke_width=.6)
        for j in range(6 if i < 2 else 4):
            x = 14 + j * 10
            s.forma(*R(x, y, 8, 18, 1), mat="appliance", velo="paint-v", stroke_width=.6)
            s.forma(*R(x + 2.5, y + 4, 3, 5, .8), mat="rubber" if (i + j) % 3 else "signal-red", stroke="none")
    s.forma(*R(14, 92, 60, 8, 1), mat="steel", velo="metal-v")
    return s


def push_button_station():
    s = Simbolo("electrical", "push-button-station", 50, 100, tipo="cabinets", body="appliance",
                it="Pulsantiera", en="Push-button station")
    s.forma(*R(19, 92, 12, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(6, 4, 38, 88, 4), velo="paint-d")
    s.statico()
    s.forma(*C(25, 22, 9), mat="steel-dark")
    s.forma(*C(25, 22, 7), mat="lamp-green", velo="paint-r")
    s.forma(*C(25, 48, 9), mat="steel-dark")
    s.forma(*C(25, 48, 7), mat="signal-red", velo="paint-r")
    s.forma(*C(25, 74, 8), mat="steel-dark", velo="dark-v")
    s.forma(*R(23.5, 66, 3, 16, 1.5), mat="label", stroke_width=.6)
    return s


def plc():
    s = Simbolo("electrical", "plc", 110, 80, tipo="cabinets", body="steel-dark", it="PLC", en="PLC")
    s.forma(*R(0, 34, 110, 12, 1), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(6, 8, 34, 64, 3), velo="paint-v")
    s.statico()
    for x in (42, 60, 78):
        s.forma(*R(x, 8, 16, 64, 2), mat="appliance", velo="paint-v")
        for y in range(14, 66, 6):
            s.forma(*C(x + 4, y, 1.4), mat="steel-dark", stroke="none")
            s.forma(*R(x + 8, y - 1.5, 5, 3, .6), mat="lamp-green-off", stroke="none")
    s.forma(*R(10, 46, 26, 20, 2), mat="glass-dark")
    spia(s, "led-run", 14, 16, 2.4, "lamp-green")
    spia(s, "led-err", 22, 16, 2.4, "lamp-red")
    return s


def vfd():
    s = Simbolo("electrical", "vfd", 70, 110, tipo="cabinets", body="appliance", it="Inverter", en="Variable frequency drive")
    s.corpo()
    s.forma(*R(6, 4, 58, 102, 4), velo="paint-d")
    s.statico()
    display(s, 14, 12, 42, 18)
    for i, x in enumerate((16, 30, 44)):
        s.forma(*R(x, 36, 10, 8, 2), mat="steel-dark", velo="dark-v")
    s.forma(*C(35, 56, 7), mat="steel-dark", velo="dark-v")
    nervature(s, 14, 57, 74, 100, 4, verticali=False, opacita=.5)
    spia(s, "led", 56, 40, 2.2, "lamp-green")
    return s


def hmi_panel():
    s = Simbolo("electrical", "hmi-panel", 110, 80, tipo="cabinets", body="steel-dark", it="Pannello operatore", en="HMI panel")
    s.corpo()
    s.forma(*R(4, 4, 102, 72, 5), velo="paint-v")
    s.statico()
    s.forma(*R(12, 10, 86, 56, 2), mat="glass-dark")
    for i, h in enumerate((18, 30, 24, 38, 28)):
        s.forma(*R(20 + i * 14, 58 - h, 9, h), mat="glass", velo="paint-v", stroke="none")
    s.tratto("M18 26 Q34 16 50 24 Q66 32 92 18", mat="lamp-green", stroke_width=1.6)
    s.luce(*R(12, 10, 86, 56, 2), opacita=.35)
    s.forma(*C(55, 71, 1.8), mat="lamp-green", stroke="none")
    return s


# ── Distribuzione ───────────────────────────────────────────────────────────

def substation():
    s = Simbolo("electrical", "substation", 150, 110, tipo="distribution", body="transformer", it="Cabina", en="Substation")
    s.tratto("M10 30 L10 104 M140 30 L140 104 M10 30 L140 30", mat="steel", stroke_width=3)
    for x in (30, 75, 120):
        s.forma(*R(x - 3, 30, 6, 12), mat="porcelain")
    # La recinzione sta dietro al trasformatore.
    for x in range(8, 146, 10):
        s.tratto(f"M{x} 70 L{x} 96", mat="steel-dark", stroke_width=1)
    s.tratto("M4 72 L146 72", mat="steel-dark", stroke_width=1)
    s.corpo()
    s.forma(*R(44, 50, 62, 46, 2), velo="paint-d")
    s.statico()
    for x in range(46, 104, 6):
        s.forma(*R(x, 54, 3, 38), mat="steel", velo="metal-h", stroke_width=.5)
    s.forma(*P("M75 62 L83 75 L67 75 Z"), mat="warning-yellow")
    s.forma(*R(4, 96, 142, 10, 1), mat="wall", velo="paint-d")
    return s


def utility_pole():
    s = Simbolo("electrical", "utility-pole", 70, 150, tipo="distribution", body="porcelain-shed", it="Palo", en="Utility pole")
    s.corpo()
    s.forma(*R(31, 8, 8, 142), velo="paint-h")
    s.statico()
    s.forma(*R(4, 16, 62, 6, 1), mat="porcelain-shed", velo="paint-v")
    for x in (8, 35, 62):
        s.forma(*R(x - 3, 8, 6, 9), mat="porcelain")
        s.forma(*C(x, 7, 2.2), mat="steel-dark")
    s.forma(*R(40, 52, 22, 32, 4), mat="transformer", velo="paint-h")
    s.forma(*R(40, 50, 22, 4, 1), mat="steel", velo="metal-v")
    s.tratto("M51 50 L51 22", mat="steel-dark", stroke_width=1.4)
    return s


def mv_switchgear():
    s = Simbolo("electrical", "mv-switchgear", 110, 130, tipo="distribution", body="cabinet", it="Quadro di media tensione", en="MV switchgear")
    s.forma(*R(4, 122, 102, 8, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    for x in (4, 40, 76):
        s.forma(*R(x, 4, 32, 118, 2), velo="paint-d")
    s.statico()
    for x in (4, 40, 76):
        s.forma(*R(x + 6, 10, 20, 12, 1), mat="glass-dark")
        s.tratto(f"M{x + 16} 30 L{x + 16} 60 M{x + 10} 46 L{x + 22} 40", mat="steel-dark", stroke_width=1.6, stroke_linecap="round")
        s.forma(*C(x + 16, 68, 3), mat="steel-dark")
        s.forma(*R(x + 24, 80, 4, 16, 2), mat="steel-dark", velo="dark-h")
    spia(s, "lamp-1", 16, 16, 3, "lamp-red")
    spia(s, "lamp-2", 52, 16, 3, "lamp-green")
    spia(s, "lamp-3", 88, 16, 3, "lamp-green")
    s.forma(*P("M56 100 L64 113 L48 113 Z"), mat="warning-yellow")
    return s


def distribution_board():
    s = Simbolo("electrical", "distribution-board", 90, 120, tipo="distribution", body="appliance", it="Quadro di distribuzione", en="Distribution board")
    s.corpo()
    s.forma(*R(4, 4, 82, 112, 4), velo="paint-d")
    s.statico()
    for i, y in enumerate((14, 44, 74)):
        s.forma(*R(10, y, 70, 24, 1), mat="steel-dark", velo="dark-v")
        for j in range(7):
            x = 12 + j * 9.5
            s.forma(*R(f2(x), y + 2, 8, 20, 1), mat="appliance", velo="paint-v", stroke_width=.5)
            s.forma(*R(f2(x + 2.5), y + 8, 3, 6, .6), mat="rubber" if j % 4 else "signal-red", stroke="none")
    s.forma(*R(36, 104, 18, 6, 2), mat="steel-dark")
    return s


def energy_meter():
    s = Simbolo("electrical", "energy-meter", 60, 90, tipo="distribution", body="appliance", it="Contatore", en="Energy meter")
    s.forma(*R(10, 78, 40, 12, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(6, 4, 48, 76, 4), velo="paint-d")
    s.statico()
    display(s, 12, 14, 36, 16)
    s.forma(*R(12, 38, 36, 14, 2), mat="label", stroke_width=.6)
    spia(s, "led", 30, 62, 3, "lamp-red")
    return s


# ── Generazione e accumulo ──────────────────────────────────────────────────

def pv_inverter():
    s = Simbolo("electrical", "pv-inverter", 70, 110, tipo="generation", body="appliance", it="Inverter fotovoltaico", en="PV inverter")
    for x in (16, 30, 44):
        s.forma(*R(x, 100, 8, 10, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(6, 4, 58, 98, 6), velo="paint-d")
    s.statico()
    display(s, 14, 14, 42, 16)
    nervature(s, 12, 59, 42, 92, 5, opacita=.45)
    spia(s, "led", 56, 36, 2.2, "lamp-green")
    return s


def wind_turbine():
    s = Simbolo("electrical", "wind-turbine", 100, 170, tipo="generation", body="appliance", it="Turbina eolica", en="Wind turbine")
    s.corpo()
    s.forma(*P("M46 50 L54 50 L58 166 L42 166 Z"), velo="paint-h")
    s.forma(*R(38, 32, 30, 14, 6), velo="paint-v")
    s.statico()
    s.forma(*R(30, 164, 40, 6, 1), mat="wall", velo="paint-d")
    s.parte("rotor", "rotor", cx=40, cy=39, symmetry=120)
    for a in (90, 210, 330):
        r = math.radians(a)
        tip = (40 + 36 * math.cos(r), 39 - 36 * math.sin(r))
        l = (40 + 7 * math.cos(r + 1.2), 39 - 7 * math.sin(r + 1.2))
        q = (40 + 16 * math.cos(r + .42), 39 - 16 * math.sin(r + .42))
        b = (40 + 14 * math.cos(r - .12), 39 - 14 * math.sin(r - .12))
        d = (f"M{f2(l[0])} {f2(l[1])} Q{f2(q[0])} {f2(q[1])} {f2(tip[0])} {f2(tip[1])} "
             f"Q{f2(b[0])} {f2(b[1])} 40 39 Z")
        s.forma(*P(d), mat="appliance", velo="paint-d", stroke_width=.8)
    s.forma(*C(40, 39, 5), mat="steel", velo="metal-r")
    return s


def generator_set():
    s = Simbolo("electrical", "generator-set", 170, 100, tipo="generation", body="safety-yellow", it="Gruppo elettrogeno", en="Generator set")
    s.forma(*R(4, 86, 162, 14, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(30, 0, 10, 26), mat="steel-dark", velo="dark-h")
    s.forma(*R(28, 0, 14, 4, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(8, 24, 98, 62, 4), velo="paint-v")
    s.forma(*R(106, 30, 54, 56, 8), velo="paint-v")
    s.statico()
    nervature(s, 14, 60, 32, 80, 4, opacita=.45)
    s.forma(*R(64, 34, 34, 22, 2), mat="appliance", velo="paint-d")
    display(s, 68, 38, 26, 10)
    s.forma(*C(133, 58, 12), fill="none", stroke_opacity=.45)
    return s


def ups():
    s = Simbolo("electrical", "ups", 60, 110, tipo="generation", body="steel-dark", it="Gruppo di continuità", en="UPS")
    s.corpo()
    s.forma(*R(6, 4, 48, 102, 4), velo="paint-v")
    s.statico()
    display(s, 12, 12, 36, 14)
    for y in range(36, 96, 8):
        s.tratto(f"M12 {y} L48 {y}", stroke_opacity=.45)
    spia(s, "led", 30, 98, 2.4, "lamp-green")
    return s


def ev_charger():
    s = Simbolo("electrical", "ev-charger", 70, 120, tipo="generation", body="appliance", it="Colonnina di ricarica", en="EV charger")
    s.forma(*R(10, 110, 40, 10, 1), mat="steel-dark", velo="dark-v")
    s.tratto("M46 60 Q64 64 62 86 Q60 104 54 106", mat="rubber", stroke_width=3)
    s.forma(*R(48, 100, 10, 14, 3), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(10, 6, 40, 104, 8), velo="paint-d")
    s.statico()
    display(s, 16, 16, 28, 16)
    s.forma(*R(24, 44, 12, 34, 3), mat="steel-dark", velo="dark-v")
    s.parte("led", "lamp")
    s.forma(*R(14, 86, 32, 4, 2), mat="lamp-green")
    s.luce(*R(14, 86, 32, 4, 2))
    return s


def tutti():
    return [f() for f in (
        electric_motor_front, gear_motor, servo_motor, dc_motor,
        electrical_cabinet_open, push_button_station, plc, vfd, hmi_panel,
        substation, utility_pole, mv_switchgear, distribution_board, energy_meter,
        pv_inverter, wind_turbine, generator_set, ups, ev_charger,
    )]
