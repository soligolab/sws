"""La casa: elettrodomestici, casa connessa, sicurezza ed esterno (02-11-2026).

Chiesti dal maintainer per CasaDomotica, «sono praticamente tutti anche presenti
nella mia abitazione». Stesse regole di `disegni.py`. Ogni utenza elettrica ha
una bocca in alto (`alimentazione`): da lì parte il tubo che la pagina Energy
tira dalla casa, come per `lib:building/house`. Dove c'è una spia, uno schermo o
una luce, è una parte `lamp`: accesa quando l'apparecchio lavora.
"""
import math

from genera import Simbolo
from disegni import C, E, P, R, f2, flangia_o, flangia_v, tubo_o, tubo_v


def pala(cx, cy, r, gradi, larga=.5):
    """Una pala vista di fronte, ruotata di `gradi` attorno al mozzo: i punti si
    calcolano, perché un `transform` sposterebbe la forma ma non il suo velo."""
    a = math.radians(gradi)
    def pt(rr, da):
        return f2(cx + rr * math.sin(a + da)), f2(cy - rr * math.cos(a + da))
    (x1, y1), (x2, y2), (x3, y3) = pt(r * .55, -larga), pt(r, 0), pt(r * .7, larga * .8)
    return P(f"M{f2(cx)} {f2(cy)} Q{x1} {y1} {x2} {y2} Q{x3} {y3} {f2(cx)} {f2(cy)} Z")


def nuovo(slug, w, h, tipo, it, en, body="appliance"):
    return Simbolo("building", slug, w, h, tipo=tipo, body=body, it=it, en=en)


def alimentazione(s, x=None):
    """La bocca dell'alimentazione, in alto: ci si aggancia il tubo dell'energia."""
    s.bocca(s.w / 2 if x is None else x, 0, "top", 6)


def piedini(s, xs, y, w=8, h=4):
    for x in xs:
        s.forma(*R(x, y, w, h, 1), mat="rubber", velo="dark-v")


def schermo(s, x, y, w, h, r=1.5, luce="flame-core"):
    """Un vetro scuro con, sopra, la parte `lamp` che lo accende."""
    s.forma(*R(x, y, w, h, r), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(x, y, w, h, r), mat=luce, velo="glass-r")
    s.statico()


def spia(s, cx, cy, r=2.2, pid="lamp"):
    s.forma(*C(cx, cy, r), mat="lamp-green-off")
    s.parte(pid, "lamp")
    s.forma(*C(cx, cy, r), mat="lamp-green", velo="glass-r")
    s.statico()


def oblo(s, cx, cy, r):
    """L'oblò di lavatrice e asciugatrice: anello d'acciaio, vetro, riflesso."""
    s.forma(*C(cx, cy, r), mat="steel", velo="metal-r")
    s.forma(*C(cx, cy, r - 5), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*C(cx, cy, r - 5), mat="liquid", velo="glass-r", fill_opacity=.85)
    s.statico()
    s.riflesso(*P(f"M{cx - r + 8} {cy - 4} Q{cx - r + 9} {cy - r + 9} {cx - 4} {cy - r + 8}"), opacita=.5)


# ── Soggiorno ───────────────────────────────────────────────────────────────

def television():
    s = nuovo("television", 120, 90, "living", "Televisione", "Television", body="steel-dark")
    alimentazione(s)
    s.forma(*R(52, 72, 16, 10, 1), mat="steel", velo="metal-h")
    s.forma(*R(32, 82, 56, 6, 2), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(4, 6, 112, 68, 3), velo="dark-v")
    s.statico()
    schermo(s, 9, 11, 102, 56, 1.5, luce="pv-grid")
    s.riflesso(*P("M12 14 L40 14 L12 40 Z"), opacita=.12)
    s.forma(*C(108, 70, 1.3), mat="lamp-red")
    return s


def speaker():
    s = nuovo("speaker", 60, 90, "living", "Cassa audio", "Speaker", body="steel-dark")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 4, 48, 82, 4), velo="dark-v")
    s.statico()
    s.forma(*C(30, 24, 9), mat="rubber", velo="rubber-r")
    s.forma(*C(30, 24, 3), mat="steel", velo="metal-r")
    s.forma(*C(30, 58, 17), mat="rubber", velo="rubber-r")
    s.forma(*C(30, 58, 6), mat="steel", velo="metal-r")
    spia(s, 30, 80, 1.6)
    return s


def split_ac():
    s = nuovo("split-ac", 140, 60, "living", "Climatizzatore", "Split air conditioner")
    alimentazione(s, 130)
    s.corpo()
    s.forma(*P("M6 8 Q6 4 12 4 L128 4 Q134 4 134 10 L134 40 Q134 52 120 52 L20 52 Q6 52 6 40 Z"), velo="paint-v")
    s.statico()
    s.forma(*R(14, 40, 112, 8, 2), mat="steel-dark", velo="dark-v")
    for x in range(20, 124, 8):
        s.tratto(f"M{x} 41 L{x - 3} 47", stroke_opacity=.5)
    s.tratto("M12 30 L128 30", stroke_opacity=.25)
    s.forma(*R(104, 12, 22, 7, 2), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(104, 12, 22, 7, 2), mat="liquid", velo="glass-r")
    s.statico()
    return s


def dehumidifier():
    s = nuovo("dehumidifier", 70, 100, "living", "Deumidificatore", "Dehumidifier")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 6, 58, 86, 6), velo="paint-h")
    s.statico()
    for y in range(14, 34, 4):
        s.tratto(f"M14 {y} L56 {y}", stroke_opacity=.45)
    schermo(s, 22, 40, 26, 10, 2, luce="liquid")
    s.forma(*R(12, 58, 46, 28, 3), mat="glass", velo="paint-d")
    s.forma(*R(14, 72, 42, 12, 2), mat="liquid", fill_opacity=.7)
    piedini(s, (12, 50), 92)
    return s


def air_purifier():
    s = nuovo("air-purifier", 60, 100, "living", "Purificatore d'aria", "Air purifier")
    alimentazione(s)
    s.corpo()
    s.forma(*R(8, 10, 44, 84, 10), velo="paint-h")
    s.statico()
    s.forma(*E(30, 12, 20, 5), mat="steel-dark", velo="dark-v")
    for y in range(36, 88, 5):
        s.tratto(f"M14 {y} L46 {y}", stroke_opacity=.35)
    spia(s, 30, 26, 2.4)
    return s


def pellet_stove():
    s = nuovo("pellet-stove", 80, 110, "living", "Stufa a pellet", "Pellet stove", body="steel-dark")
    alimentazione(s, 64)
    s.forma(*R(14, 0, 12, 12, 1), mat="steel", velo="metal-h")
    s.corpo()
    s.forma(*R(6, 10, 68, 92, 4), velo="dark-h")
    s.statico()
    s.forma(*R(14, 34, 52, 44, 4), mat="steel", velo="metal-v")
    s.forma(*R(19, 39, 42, 34, 3), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*P("M26 72 Q24 56 34 48 Q32 58 40 62 Q42 50 50 44 Q56 58 54 72 Z"), mat="flame", velo="glass-r")
    s.forma(*P("M33 72 Q34 62 40 58 Q46 64 46 72 Z"), mat="flame-core")
    s.statico()
    s.forma(*R(52, 16, 16, 8, 1.5), mat="glass-dark")
    s.forma(*R(10, 102, 60, 6, 1), mat="steel", velo="metal-v")
    return s


def fireplace():
    s = nuovo("fireplace", 110, 100, "living", "Camino", "Fireplace", body="wall")
    s.corpo()
    s.forma(*R(4, 4, 102, 92, 2), velo="paint-d")
    s.statico()
    s.forma(*R(0, 30, 110, 10, 1), mat="wood", velo="paint-v")
    s.forma(*P("M22 96 L22 62 Q22 48 36 48 L74 48 Q88 48 88 62 L88 96 Z"), mat="steel-dark", velo="dark-v")
    s.forma(*R(32, 84, 46, 6, 2), mat="wood", velo="paint-v")
    s.parte("lamp", "lamp")
    s.forma(*P("M36 86 Q34 70 46 60 Q44 72 52 76 Q54 62 64 56 Q72 72 70 86 Z"), mat="flame", velo="glass-r")
    s.forma(*P("M46 86 Q48 76 54 72 Q60 78 60 86 Z"), mat="flame-core")
    s.statico()
    return s


# ── Cucina ──────────────────────────────────────────────────────────────────

def fridge():
    s = nuovo("fridge", 70, 130, "kitchen", "Frigorifero", "Fridge")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 4, 58, 120, 4), velo="paint-h")
    s.statico()
    s.tratto("M6 46 L64 46", stroke_width=1.4)
    s.forma(*R(54, 14, 4, 22, 2), mat="steel", velo="metal-h")
    s.forma(*R(54, 56, 4, 30, 2), mat="steel", velo="metal-h")
    schermo(s, 14, 52, 20, 8, 1.5, luce="liquid")
    piedini(s, (10, 52), 124)
    return s


def freezer():
    s = nuovo("freezer", 100, 80, "kitchen", "Congelatore", "Freezer")
    alimentazione(s)
    s.forma(*R(6, 8, 88, 12, 3), mat="appliance", velo="paint-v")
    s.corpo()
    s.forma(*R(6, 18, 88, 54, 3), velo="paint-h")
    s.statico()
    s.forma(*R(40, 22, 20, 4, 2), mat="steel", velo="metal-v")
    s.tratto("M14 40 L22 44 L14 48 M22 44 L34 44", stroke_opacity=.25)
    spia(s, 84, 30, 2)
    piedini(s, (10, 82), 72)
    return s


def oven():
    s = nuovo("oven", 90, 80, "kitchen", "Forno", "Oven", body="stainless")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 4, 82, 72, 3), velo="metal-h")
    s.statico()
    s.forma(*R(8, 8, 74, 12, 2), mat="steel-dark", velo="dark-v")
    for x in (18, 30):
        s.forma(*C(x, 14, 3.5), mat="steel", velo="metal-r")
    s.forma(*R(52, 10, 24, 8, 1), mat="glass-dark")
    s.forma(*R(14, 24, 62, 4, 2), mat="steel", velo="metal-v")
    s.forma(*R(12, 32, 66, 38, 3), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(12, 32, 66, 38, 3), mat="flame", velo="glass-r", fill_opacity=.6)
    s.statico()
    return s


def induction_hob():
    s = nuovo("induction-hob", 120, 70, "kitchen", "Piano cottura a induzione", "Induction hob", body="glass-dark")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 6, 112, 58, 4), velo="dark-v")
    s.statico()
    s.parte("lamp", "lamp")
    for cx, cy, r in ((32, 30, 16), (82, 26, 12), (84, 50, 9)):
        s.tratto(f"M{cx - r} {cy} A{r} {r} 0 1 0 {cx + r} {cy} A{r} {r} 0 1 0 {cx - r} {cy}", mat="lamp-red", stroke_width=2.4)
    s.statico()
    for cx, cy, r in ((32, 30, 16), (82, 26, 12), (84, 50, 9)):
        s.tratto(f"M{cx - r + 3} {cy} A{r - 3} {r - 3} 0 1 0 {cx + r - 3} {cy} A{r - 3} {r - 3} 0 1 0 {cx - r + 3} {cy}",
                 stroke_opacity=.4)
    s.forma(*R(20, 54, 30, 6, 2), mat="steel-dark")
    s.riflesso(*P("M8 10 L40 10 L8 36 Z"), opacita=.1)
    return s


def cooker_hood():
    s = nuovo("cooker-hood", 100, 90, "kitchen", "Cappa", "Cooker hood", body="stainless")
    alimentazione(s, 50)
    s.corpo()
    s.forma(*R(38, 4, 24, 46), velo="metal-h")
    s.forma(*P("M8 74 L36 48 L64 48 L92 74 Z"), velo="metal-v")
    s.statico()
    s.forma(*R(6, 74, 88, 8, 1.5), mat="steel", velo="metal-v")
    s.parte("lamp", "lamp")
    for x in (24, 76):
        s.forma(*E(x, 84, 6, 2), mat="flame-core", velo="glass-r")
    s.statico()
    return s


def microwave():
    s = nuovo("microwave", 100, 70, "kitchen", "Microonde", "Microwave")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 6, 92, 58, 4), velo="paint-h")
    s.statico()
    s.forma(*R(10, 12, 60, 46, 3), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(10, 12, 60, 46, 3), mat="flame-core", velo="glass-r", fill_opacity=.55)
    s.statico()
    s.forma(*R(76, 14, 14, 7, 1), mat="glass-dark")
    for y in (28, 38):
        s.forma(*C(83, y, 3.5), mat="steel", velo="metal-r")
    s.forma(*R(78, 48, 10, 6, 1.5), mat="steel-dark")
    piedini(s, (10, 82), 64)
    return s


def dishwasher():
    s = nuovo("dishwasher", 80, 100, "kitchen", "Lavastoviglie", "Dishwasher", body="stainless")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 4, 72, 88, 3), velo="metal-h")
    s.statico()
    s.forma(*R(8, 8, 64, 14, 2), mat="steel-dark", velo="dark-v")
    schermo(s, 14, 11, 22, 8, 1.2, luce="liquid")
    for x in (48, 58):
        s.forma(*C(x, 15, 3), mat="steel", velo="metal-r")
    s.forma(*R(20, 28, 40, 4, 2), mat="steel", velo="metal-v")
    s.forma(*R(8, 92, 64, 6, 1), mat="rubber", velo="dark-v")
    return s


def coffee_machine():
    s = nuovo("coffee-machine", 70, 90, "kitchen", "Macchina del caffè", "Coffee machine", body="steel-dark")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 4, 58, 26, 4), velo="dark-v")
    s.forma(*R(48, 30, 16, 52, 2), velo="dark-h")
    s.statico()
    s.forma(*R(6, 80, 58, 6, 2), mat="steel", velo="metal-v")
    s.forma(*R(22, 30, 14, 8, 1), mat="steel", velo="metal-h")
    s.forma(*P("M18 58 L40 58 L38 78 L20 78 Z"), mat="appliance", velo="paint-h")
    s.tratto("M40 62 Q47 62 47 68 Q47 74 39 74", stroke_width=1.6)
    s.parte("lamp", "lamp")
    s.forma(*R(28, 38, 2, 16, 1), mat="body-furnace")
    s.statico()
    schermo(s, 12, 10, 26, 10, 1.5, luce="liquid")
    return s


# ── Lavanderia e bagno ──────────────────────────────────────────────────────

def washing_machine():
    s = nuovo("washing-machine", 80, 100, "laundry", "Lavatrice", "Washing machine")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 4, 72, 90, 3), velo="paint-h")
    s.statico()
    s.tratto("M4 22 L76 22", stroke_opacity=.5)
    s.forma(*R(10, 9, 18, 9, 1), mat="steel-dark")
    s.forma(*C(62, 13, 4.5), mat="steel", velo="metal-r")
    spia(s, 50, 13, 1.8, pid="lamp-1")
    s.forma(*C(40, 58, 26), mat="steel", velo="metal-r")
    s.forma(*C(40, 58, 21), mat="glass-dark")
    s.parte("rotor", "rotor", cx=40, cy=58, symmetry=120)
    for a in (0, 120, 240):
        s.forma(*pala(40, 58, 18, a, .35), mat="liquid", velo="glass-r")
    s.statico()
    s.riflesso(*P("M24 52 Q24 40 34 38"), opacita=.5)
    piedini(s, (8, 64), 94)
    return s


def tumble_dryer():
    s = nuovo("tumble-dryer", 80, 100, "laundry", "Asciugatrice", "Tumble dryer")
    alimentazione(s)
    s.corpo()
    s.forma(*R(4, 4, 72, 90, 3), velo="paint-h")
    s.statico()
    s.tratto("M4 22 L76 22", stroke_opacity=.5)
    s.forma(*C(16, 13, 4.5), mat="steel", velo="metal-r")
    s.forma(*R(28, 9, 26, 9, 1), mat="glass-dark")
    oblo(s, 40, 58, 26)
    s.forma(*R(28, 86, 24, 4, 1.5), mat="steel-dark")
    piedini(s, (8, 64), 94)
    return s


def water_heater():
    s = nuovo("water-heater", 70, 130, "laundry", "Scaldabagno", "Water heater")
    alimentazione(s, 35)
    tubo_v(s, 16, 112, 14, 8); flangia_o(s, 12, 126, 16, 4)
    tubo_v(s, 46, 112, 14, 8); flangia_o(s, 42, 126, 16, 4)
    s.corpo()
    s.forma(*R(6, 6, 58, 108, 20), velo="paint-h")
    s.statico()
    s.forma(*C(35, 40, 11), mat="dial", velo="dial-r")
    s.tratto("M35 40 L42 34", stroke_width=1.6, stroke_linecap="round")
    spia(s, 35, 64, 2.4)
    return s


def towel_radiator():
    s = nuovo("towel-radiator", 70, 110, "laundry", "Scaldasalviette", "Towel radiator", body="stainless")
    alimentazione(s, 60)
    s.corpo()
    s.forma(*R(6, 4, 8, 100, 3), velo="metal-h")
    s.forma(*R(56, 4, 8, 100, 3), velo="metal-h")
    s.statico()
    for y in range(12, 100, 9):
        s.forma(*R(12, y, 46, 4, 2), mat="stainless", velo="metal-v")
    spia(s, 60, 106, 1.6)
    return s


def water_softener():
    s = nuovo("water-softener", 70, 110, "laundry", "Addolcitore", "Water softener")
    alimentazione(s, 50)
    tubo_o(s, 0, 20, 10, 8); flangia_v(s, 0, 16, 4, 16)
    tubo_o(s, 60, 20, 10, 8); flangia_v(s, 66, 16, 4, 16)
    s.forma(*R(10, 12, 50, 18, 3), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(14, 30, 42, 76, 14), velo="paint-h")
    s.statico()
    schermo(s, 22, 16, 18, 8, 1.2, luce="liquid")
    s.forma(*R(20, 60, 30, 40, 8), mat="liquid", fill_opacity=.35)
    return s


# ── Casa connessa ───────────────────────────────────────────────────────────

def smart_plug():
    s = nuovo("smart-plug", 60, 60, "smart-home", "Presa smart", "Smart plug")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 6, 48, 48, 10), velo="paint-d")
    s.statico()
    s.forma(*C(30, 32, 14), mat="appliance", velo="paint-r")
    s.forma(*C(24, 32, 2.6), mat="steel-dark")
    s.forma(*C(36, 32, 2.6), mat="steel-dark")
    spia(s, 30, 12, 2)
    return s


def wall_switch():
    s = nuovo("wall-switch", 50, 60, "smart-home", "Interruttore", "Wall switch")
    s.corpo()
    s.forma(*R(4, 4, 42, 52, 4), velo="paint-d")
    s.statico()
    s.forma(*R(12, 10, 26, 40, 3), mat="steel-dark", velo="dark-v")
    # Il bilanciere: una leva, come `lib:controls/rocker-switch`. Legata a un
    # tag passa fra le due posizioni (02-11-2026: «gli interruttori mi
    # aspetterei avessero due disegni diversi tra on e off»).
    s.parte("bilanciere", "lever", cx=25, cy=30, open=-7, closed=7)
    s.forma(*R(14, 12, 22, 36, 3), mat="appliance", velo="paint-v")
    s.tratto("M14 30 L36 30", stroke_opacity=.35)
    s.statico()
    spia(s, 25, 42, 1.8)
    return s


def floor_lamp():
    s = nuovo("floor-lamp", 60, 130, "smart-home", "Lampada", "Floor lamp", body="steel-dark")
    alimentazione(s, 50)
    s.forma(*R(28, 34, 4, 86, 1.5), mat="steel", velo="metal-h")
    s.forma(*E(30, 122, 18, 5), mat="steel-dark", velo="dark-v")
    s.parte("lamp", "lamp")
    s.forma(*E(30, 52, 22, 10), mat="flame-core", fill_opacity=.35, stroke="none")
    s.statico()
    s.corpo()
    s.forma(*P("M14 38 L20 8 L40 8 L46 38 Z"), velo="paint-h")
    return s


def robot_vacuum():
    s = nuovo("robot-vacuum", 80, 60, "smart-home", "Robot aspirapolvere", "Robot vacuum", body="steel-dark")
    alimentazione(s)
    s.forma(*E(40, 46, 34, 10), mat="rubber", velo="dark-v")
    s.corpo()
    s.forma(*E(40, 34, 34, 18), velo="dark-v")
    s.statico()
    s.forma(*E(40, 30, 10, 6), mat="steel", velo="metal-r")
    spia(s, 56, 28, 1.8)
    s.tratto("M10 36 Q40 50 70 36", stroke_opacity=.35)
    return s


def wifi_router():
    s = nuovo("wifi-router", 90, 60, "smart-home", "Router Wi-Fi", "Wi-Fi router")
    alimentazione(s, 80)
    for x in (16, 74):
        s.forma(*R(x - 2, 4, 4, 30, 2), mat="steel-dark", velo="dark-h")
    s.corpo()
    s.forma(*R(6, 30, 78, 22, 4), velo="paint-v")
    s.statico()
    for i, x in enumerate((26, 36, 46, 56)):
        spia(s, x, 44, 1.6, pid=f"lamp-{i + 1}")
    piedini(s, (12, 70), 52)
    return s


# ── Sicurezza e accessi ─────────────────────────────────────────────────────

def front_door():
    s = nuovo("front-door", 80, 120, "security", "Porta d'ingresso", "Front door", body="wood")
    s.forma(*R(0, 0, 80, 120), mat="wall", velo="paint-d", stroke="none")
    s.forma(*R(10, 10, 60, 110, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(14, 14, 52, 106, 1), velo="paint-v")
    s.statico()
    for y in (22, 66):
        s.forma(*R(22, y, 36, 36, 2), mat="wood", velo="paint-d")
    s.forma(*R(56, 62, 4, 14, 2), mat="steel", velo="metal-h")
    return s


def smart_lock():
    s = nuovo("smart-lock", 50, 80, "security", "Serratura smart", "Smart lock", body="steel-dark")
    s.corpo()
    s.forma(*R(8, 4, 34, 72, 8), velo="dark-h")
    s.statico()
    s.forma(*C(25, 26, 11), mat="steel", velo="metal-r")
    s.forma(*R(23, 18, 4, 16, 2), mat="steel-dark")
    s.forma(*R(17, 48, 16, 18, 3), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(17, 48, 16, 18, 3), mat="lamp-green", velo="glass-r", fill_opacity=.8)
    s.statico()
    return s


def video_intercom():
    s = nuovo("video-intercom", 60, 100, "security", "Videocitofono", "Video intercom", body="steel-dark")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 4, 48, 92, 4), velo="dark-h")
    s.statico()
    s.forma(*C(30, 16, 5), mat="glass-dark")
    s.forma(*C(30, 16, 2), mat="pv-cell", velo="glass-r")
    schermo(s, 12, 28, 36, 28, 2, luce="pv-grid")
    for y in (64, 74, 84):
        s.forma(*R(14, y, 32, 7, 2), mat="steel", velo="metal-v")
    return s


def security_camera():
    s = nuovo("security-camera", 100, 70, "security", "Telecamera", "Security camera")
    alimentazione(s, 86)
    s.forma(*R(74, 4, 20, 14, 2), mat="steel-dark", velo="dark-v")
    s.forma(*R(80, 16, 6, 20, 2), mat="steel-dark", velo="dark-h")
    s.corpo()
    s.forma(*P("M8 30 L72 22 Q80 22 80 30 L80 50 Q80 58 72 58 L8 52 Q4 52 4 46 L4 36 Q4 30 8 30 Z"), velo="paint-v")
    s.statico()
    s.forma(*E(8, 41, 5, 10), mat="glass-dark")
    s.forma(*E(8, 41, 2.5, 5), mat="pv-cell", velo="glass-r")
    spia(s, 66, 32, 1.8)
    return s


def motion_sensor():
    s = nuovo("motion-sensor", 60, 60, "security", "Sensore di movimento", "Motion sensor")
    s.corpo()
    s.forma(*R(10, 6, 40, 48, 8), velo="paint-h")
    s.statico()
    s.forma(*P("M16 30 Q16 16 30 16 Q44 16 44 30 Z"), mat="dial", velo="dial-r")
    for x in (22, 30, 38):
        s.tratto(f"M{x} 18 L{x} 30", stroke_opacity=.25)
    spia(s, 30, 44, 2)
    return s


def door_sensor():
    s = nuovo("door-sensor", 70, 60, "security", "Sensore porta/finestra", "Door/window sensor")
    s.corpo()
    s.forma(*R(6, 14, 36, 32, 4), velo="paint-h")
    s.statico()
    s.forma(*R(46, 18, 18, 24, 3), mat="appliance", velo="paint-h")
    spia(s, 16, 24, 1.8)
    s.tratto("M44 22 L44 38", stroke_opacity=.4, stroke_dasharray="2 2")
    return s


def smoke_detector():
    s = nuovo("smoke-detector", 80, 50, "security", "Rilevatore di fumo", "Smoke detector")
    s.forma(*R(28, 4, 24, 8, 2), mat="appliance", velo="paint-v")
    s.corpo()
    s.forma(*P("M6 22 Q6 12 16 12 L64 12 Q74 12 74 22 L74 30 Q74 42 60 42 L20 42 Q6 42 6 30 Z"), velo="paint-v")
    s.statico()
    for x in range(16, 66, 6):
        s.tratto(f"M{x} 24 L{x} 34", stroke_opacity=.35)
    s.forma(*C(40, 29, 6), mat="appliance", velo="paint-r")
    s.forma(*C(66, 18, 2.2), mat="lamp-red-off")
    s.parte("lamp", "lamp")
    s.forma(*C(66, 18, 2.2), mat="lamp-red", velo="glass-r")
    s.statico()
    return s


def flood_sensor():
    s = nuovo("flood-sensor", 60, 50, "security", "Rilevatore di allagamento", "Flood sensor")
    s.forma(*R(0, 38, 60, 12), mat="liquid", velo="glass-r", fill_opacity=.6, stroke="none")
    s.corpo()
    s.forma(*E(30, 30, 22, 12), velo="paint-v")
    s.statico()
    for x in (20, 30, 40):
        s.forma(*R(x - 1.5, 38, 3, 6, 1), mat="copper", velo="metal-h")
    spia(s, 30, 26, 2)
    return s


def alarm_panel():
    s = nuovo("alarm-panel", 70, 90, "security", "Centralina d'allarme", "Alarm panel")
    alimentazione(s)
    s.corpo()
    s.forma(*R(6, 4, 58, 82, 5), velo="paint-h")
    s.statico()
    s.forma(*R(12, 10, 46, 18, 2), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(12, 10, 46, 18, 2), mat="lamp-red", velo="glass-r", fill_opacity=.85)
    s.statico()
    for r in range(4):
        for c in range(3):
            s.forma(*R(16 + c * 14, 34 + r * 12, 10, 8, 2), mat="steel", velo="metal-v")
    return s


def sliding_gate():
    s = nuovo("sliding-gate", 160, 90, "security", "Cancello automatico", "Sliding gate", body="steel-dark")
    alimentazione(s, 150)
    s.forma(*R(140, 10, 16, 76, 2), mat="wall", velo="paint-h")
    s.forma(*R(4, 84, 136, 4, 1), mat="steel", velo="metal-v")
    s.corpo()
    s.forma(*R(8, 16, 128, 6, 1), velo="dark-v")
    s.forma(*R(8, 74, 128, 6, 1), velo="dark-v")
    for x in range(10, 136, 12):
        s.forma(*R(x, 10, 4, 70, 1), velo="dark-h")
    s.statico()
    s.forma(*R(142, 14, 12, 10, 2), mat="safety-yellow", velo="paint-v")
    s.parte("lamp", "lamp")
    s.forma(*R(142, 14, 12, 10, 2), mat="lamp-amber", velo="glass-r")
    s.statico()
    return s


# ── Esterno ─────────────────────────────────────────────────────────────────

def pool_pump():
    s = nuovo("pool-pump", 110, 70, "outdoor", "Pompa della piscina", "Pool pump", body="body-pump")
    alimentazione(s, 90)
    tubo_o(s, 0, 40, 14, 10); flangia_v(s, 0, 37, 4, 16)
    tubo_v(s, 40, 0, 14, 10); flangia_o(s, 37, 0, 16, 4)
    s.forma(*R(10, 60, 90, 6, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(10, 26, 34, 34, 6), mat="glass", velo="paint-d")
    s.forma(*R(16, 34, 22, 20, 3), mat="liquid", fill_opacity=.6)
    s.corpo()
    s.forma(*R(44, 14, 26, 46, 6), velo="paint-v")
    s.forma(*R(68, 22, 36, 38, 5), velo="paint-v")
    s.statico()
    for x in range(74, 102, 5):
        s.tratto(f"M{x} 26 L{x} 56", stroke_opacity=.35)
    return s


def sprinkler():
    s = nuovo("sprinkler", 80, 80, "outdoor", "Irrigatore", "Sprinkler", body="gas")
    tubo_v(s, 35, 66, 14, 10); flangia_o(s, 32, 76, 16, 4)
    s.forma(*E(40, 64, 34, 5), mat="gas", velo="paint-v")
    s.corpo()
    s.forma(*R(32, 40, 16, 24, 3), velo="paint-h")
    s.statico()
    s.forma(*R(36, 34, 8, 8, 2), mat="steel-dark", velo="dark-v")
    s.parte("lamp", "lamp")
    for d in ("M40 34 Q20 10 6 22", "M40 34 Q40 6 40 4", "M40 34 Q60 10 74 22", "M40 34 Q28 14 18 10", "M40 34 Q52 14 62 10"):
        s.tratto(d, mat="liquid", stroke_width=1.6, stroke_dasharray="3 3", stroke_linecap="round")
    s.statico()
    return s


def garden_light():
    s = nuovo("garden-light", 50, 120, "outdoor", "Lampione da giardino", "Garden light", body="steel-dark")
    alimentazione(s, 25)
    s.forma(*R(23, 38, 4, 72, 1.5), mat="steel-dark", velo="dark-h")
    s.forma(*R(12, 108, 26, 8, 2), mat="steel-dark", velo="dark-v")
    s.forma(*R(14, 18, 22, 22, 2), mat="glass-dark")
    s.parte("lamp", "lamp")
    s.forma(*R(14, 18, 22, 22, 2), mat="flame-core", velo="glass-r")
    s.statico()
    s.corpo()
    s.forma(*P("M8 18 L25 6 L42 18 Z"), velo="dark-v")
    s.forma(*R(12, 40, 26, 4, 1), velo="dark-v")
    return s


def ac_outdoor_unit():
    s = nuovo("ac-outdoor-unit", 120, 90, "outdoor", "Unità esterna del clima", "AC outdoor unit")
    alimentazione(s, 104)
    tubo_o(s, 108, 56, 12, 6); flangia_v(s, 116, 53, 4, 12)
    tubo_o(s, 108, 70, 12, 6); flangia_v(s, 116, 67, 4, 12)
    s.forma(*R(10, 82, 20, 6, 1), mat="steel-dark", velo="dark-v")
    s.forma(*R(80, 82, 20, 6, 1), mat="steel-dark", velo="dark-v")
    s.corpo()
    s.forma(*R(4, 8, 106, 76, 4), velo="paint-d")
    s.statico()
    s.forma(*C(44, 46, 30), mat="steel-dark", velo="dark-v")
    s.parte("rotor", "rotor", cx=44, cy=46, symmetry=120)
    for a in (0, 120, 240):
        s.forma(*pala(44, 46, 26, a), mat="steel", velo="metal-r")
    s.statico()
    for r in (12, 20, 28):
        s.forma(*C(44, 46, r), fill="none", stroke_width=.8, stroke_opacity=.5)
    for x in range(84, 106, 4):
        s.tratto(f"M{x} 16 L{x} 76", stroke_opacity=.35)
    return s


def solar_thermal():
    s = nuovo("solar-thermal", 140, 90, "outdoor", "Solare termico", "Solar thermal collector", body="steel")
    tubo_o(s, 0, 18, 12, 8); flangia_v(s, 0, 14, 4, 16)
    tubo_o(s, 128, 66, 12, 8); flangia_v(s, 136, 62, 4, 16)
    s.corpo()
    s.forma(*R(10, 8, 120, 74, 3), velo="metal-v")
    s.statico()
    s.forma(*R(16, 14, 108, 62, 2), mat="pv-cell")
    for x in range(22, 122, 8):
        s.forma(*R(x, 18, 4, 54, 2), mat="copper", velo="metal-h")
    s.luce(*R(16, 14, 108, 62, 2), opacita=.35)
    return s


def tutti():
    return [f() for f in (
        television, speaker, split_ac, dehumidifier, air_purifier, pellet_stove, fireplace,
        fridge, freezer, oven, induction_hob, cooker_hood, microwave, dishwasher, coffee_machine,
        washing_machine, tumble_dryer, water_heater, towel_radiator, water_softener,
        smart_plug, wall_switch, floor_lamp, robot_vacuum, wifi_router,
        front_door, smart_lock, video_intercom, security_camera, motion_sensor, door_sensor,
        smoke_detector, flood_sensor, alarm_panel, sliding_gate,
        pool_pump, sprinkler, garden_light, ac_outdoor_unit, solar_thermal,
    )]
