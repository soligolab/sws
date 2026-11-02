#!/usr/bin/env python3
"""Genera il template «Slider — stili e modi» (examples/templates/demo-slider).

Nato il 02-11-2026 dal progetto di collaudo della revisione dello slider
(docs/plans/allegati/2026-10-30-revisione-slider/genera_collaudo_slider.py), che il
maintainer ha chiesto di rendere un template per tutti: stesse quattro pagine, una
quinta con le opzioni che il collaudo non mostrava (le otto icone, l'immagine dietro,
i limiti dal tag, le tacche senza numeri, il comando critico).

Le regole dei template (examples/templates/README.md) chiedono che ogni testo passi
dalla tabella lingue in it/en/es: qui ogni testo nasce con le sue tre lingue, nella
chiamata `T(...)`, e il generatore numera le chiavi. Si rigenera invece di ritoccare:

    python3 scripts/genera_template_demo_slider.py
"""
import os
import shutil
import yaml

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(RADICE, "examples", "templates", "demo-slider")

voci = []


def T(it, en, es):
    """Un testo per l'operatore: entra nella tabella e torna la sua chiave."""
    for v in voci:
        if v["values"]["it"] == it:
            return "{{%s}}" % v["key"]
    chiave = "t%04d" % (len(voci) + 1)
    voci.append({"key": chiave, "values": {"it": it, "en": en, "es": es}})
    return "{{%s}}" % chiave


def tag(id, desc, unit=None, gen=None, **altro):
    t = {"id": id, "description": desc, "data_type": "float"}
    if unit:
        t["unit"] = unit
    if gen:
        t["generator"] = gen
    t.update(altro)
    return t


tags = [
    tag("c.luce", "Luce del soggiorno (piastra)", "%"),
    tag("c.luce_terrazzo", "Luce del terrazzo (piastra)", "%"),
    tag("c.ventola", "Ventola (piastra)", "%"),
    tag("c.tapparella", "Tapparella (piastra verticale)", "%"),
    tag("c.presa", "Presa smart, limite di potenza (piastra)", "%"),
    tag("c.volume", "Volume della musica (piastra)", "%"),
    tag("c.irrigazione", "Irrigazione (piastra)", "%"),
    tag("c.valore", "Il valore comune agli slider generici", "%"),
    tag("c.frazione", "Frazione 0..1 col passo 0,05"),
    tag("c.offset", "Offset bipolare −50..50"),
    tag("c.setpoint", "Setpoint del termostato", "°C"),
    tag("c.jog", "Leva a molla −100..100"),
    tag("c.continuo", "Scrittura continua con deadband 5", "%"),
    tag("c.conferma", "Scrittura con conferma", "%"),
    tag("c.verticale", "Slider verticali", "%"),
    tag("c.pressione", "Pressione: limiti, unità e decimali presi dal tag", "bar",
        range_lo=0.0, range_hi=6.0, decimals=1),
    tag("c.critico", "Comando critico", "%"),
    tag("s.rampa", "Si muove da solo: rampa 0..100 in 40 s", "%",
        {"shape": "ramp", "period_ms": 40000, "min": 0.0, "max": 100.0, "enabled": True}),
    tag("s.temperatura", "Si muove da solo: 18..26 °C in 60 s", "°C",
        {"shape": "triangle", "period_ms": 60000, "min": 18.0, "max": 26.0, "enabled": True}),
]


def testo(id, x, y, t, w=360, size=13.0, color=None):
    o = {"id": id, "type": "text", "x": float(x), "y": float(y), "width": float(w), "height": 20.0,
         "text": t, "font_size": size}
    if color:
        o["color"] = color
    return o


SCRITTO = T("scritto:", "written:", "escrito:")


def lettura(id, x, y, tag, decimali=2, coda=None, w=200):
    fmt = "%s {value:.%df}" % (SCRITTO, decimali)
    if coda:
        fmt += " " + coda
    return {"id": id, "type": "text", "x": float(x), "y": float(y), "width": float(w), "height": 18.0,
            "tag": tag, "format": fmt, "font_size": 11.0, "color": "#94a3b8"}


def slider(id, x, y, w, h, tag, limiti=True, **kw):
    o = {"id": id, "type": "slider", "x": float(x), "y": float(y), "width": float(w), "height": float(h)}
    if tag:
        o["tag"] = tag
    if limiti:
        o.update({"min": 0.0, "max": 100.0, "step": 1.0})
    o.update(kw)
    return o


nav = {"id": "nav", "type": "page_navigator", "x": 24.0, "y": 752.0, "width": 1232.0, "height": 40.0,
       "nav_orientation": "horizontal", "nav_fill": True, "nav_gap": 6, "locked": True}


def pagina(id, file, nome, sfondo, oggetti):
    return file, {"id": id, "name": nome, "width": 1280.0, "height": 800.0, "background": sfondo,
                  "objects": oggetti + [dict(nav)]}


# ── 1. Stili ─────────────────────────────────────────────────────────────────
p1 = [
    testo("tit", 40, 20, T("Gli stili — trascina col dito, col mouse, o con Tab e le frecce",
                           "The styles — drag with a finger, with the mouse, or with Tab and the arrows",
                           "Los estilos — arrastra con el dedo, con el ratón o con Tab y las flechas"), 700, 16.0),
    testo("t_cl", 40, 60, T("Classico", "Classic", "Clásico")),
    slider("s_cl", 40, 85, 340, 50, "c.valore", unit="%", label=T("Classico", "Classic", "Clásico")),
    lettura("l_cl", 40, 140, "c.valore"),
    testo("t_pi", 40, 175, T("Pillola: il cursore bianco sta dentro la traccia",
                             "Pill: the white knob sits inside the track",
                             "Píldora: el cursor blanco va dentro de la pista")),
    slider("s_pi", 40, 200, 340, 60, "c.valore", unit="%", label=T("Pillola", "Pill", "Píldora"),
           slider_style="pillola"),
    testo("t_isa", 40, 285, T("ISA-101: grigi e cursore rettangolare, ignora il colore",
                              "ISA-101: greys and a square knob, it ignores the colour",
                              "ISA-101: grises y cursor rectangular, ignora el color")),
    slider("s_isa", 40, 310, 340, 56, "c.valore", unit="%", label=T("ISA-101", "ISA-101", "ISA-101"), slider_style="isa", fill="#ef4444"),
    testo("t_col", 40, 390, T("Classico: colore, traccia scura, spessore 24",
                              "Classic: colour, dark track, thickness 24",
                              "Clásico: color, pista oscura, grosor 24")),
    slider("s_col", 40, 415, 340, 56, "c.valore", unit="%", label=T("Colori", "Colours", "Colores"),
           fill="#22c55e", slider_track_color="#334155", slider_track_thickness=24.0),
    testo("t_op", 40, 495, T("Traccia al 30 % su uno sfondo colorato", "Track at 30 % on a coloured background",
                             "Pista al 30 % sobre un fondo de color")),
    slider("s_op", 40, 520, 340, 56, "c.valore", unit="%", label=T("Trasparenza", "Transparency", "Transparencia"),
           bg_color="#7c2d12", slider_track_opacity=30.0),
    testo("t_pz", 440, 60, T("Piastra (domotica): si trascina ovunque", "Tile (home automation): drag anywhere",
                             "Placa (domótica): se arrastra desde cualquier punto"), 400),
    slider("s_luce", 440, 85, 340, 72, "c.luce", unit="%", label=T("Luce soggiorno", "Living room light",
                                                                    "Luz del salón"),
           slider_style="piastra", slider_icon="lampadina", fill="#f59e0b"),
    lettura("l_luce", 440, 162, "c.luce"),
    slider("s_vent", 440, 190, 340, 72, "c.ventola", unit="%", label=T("Ventola", "Fan", "Ventilador"),
           slider_style="piastra", slider_icon="ventola", fill="#06b6d4"),
    slider("s_vol", 440, 280, 340, 56, "c.volume", unit="%", label=T("Volume", "Volume", "Volumen"),
           slider_style="piastra", slider_icon="volume", fill="#a855f7"),
    slider("s_senza", 440, 350, 340, 56, "c.valore", unit="%", label=T("Senza icona", "No icon", "Sin icono"),
           slider_style="piastra"),
    testo("t_v", 840, 60, T("Verticali", "Vertical", "Verticales"), 300),
    slider("s_tap", 840, 90, 100, 300, "c.tapparella", unit="%", label=T("Tapparella", "Shutter", "Persiana"),
           slider_style="piastra", slider_icon="tapparella", fill="#22c55e", orientation="vertical"),
    slider("s_vcl", 970, 90, 70, 300, "c.verticale", unit="%", label=T("Classico", "Classic", "Clásico"),
           orientation="vertical"),
    slider("s_vpi", 1060, 90, 70, 300, "c.verticale", unit="%", label=T("Pillola", "Pill", "Píldora"),
           orientation="vertical", slider_style="pillola"),
    slider("s_visa", 1150, 90, 90, 300, "c.verticale", unit="%", label=T("ISA", "ISA", "ISA"), orientation="vertical",
           slider_style="isa", slider_tick_major=20.0, slider_tick_minor=5.0),
    lettura("l_tap", 840, 400, "c.tapparella"),
    lettura("l_ver", 970, 400, "c.verticale"),
]

# ── 2. Valore e tacche ───────────────────────────────────────────────────────
p2 = [
    testo("tit", 40, 20, T("Dove sta il valore, tacche, bande, passi", "Where the value goes, ticks, bands, steps",
                           "Dónde va el valor, marcas, bandas, pasos"), 700, 16.0),
    slider("s_sotto", 40, 60, 340, 56, "c.valore", unit="%",
           label=T("Valore sotto (predefinito)", "Value below (default)", "Valor debajo (predeterminado)")),
    slider("s_sopra", 40, 130, 340, 56, "c.valore", unit="%", label=T("Valore sopra", "Value above", "Valor encima"),
           slider_value_position="sopra"),
    slider("s_dentro", 40, 200, 340, 50, "c.valore", unit="%", slider_value_position="dentro",
           slider_track_thickness=28.0, fill="#f59e0b"),
    slider("s_curs", 40, 270, 340, 56, "c.valore", unit="%",
           label=T("Sul cursore, mentre trascini", "On the knob, while you drag", "Sobre el cursor, mientras arrastras"),
           slider_value_position="cursore"),
    slider("s_nv", 40, 340, 340, 40, "c.valore", show_value=False),
    testo("t_nv", 40, 385, T("Senza valore", "No value", "Sin valor")),
    testo("t_tc", 440, 60, T("Tacche: marcata ogni 10, divisione ogni 2", "Ticks: major every 10, minor every 2",
                             "Marcas: principal cada 10, división cada 2"), 420),
    slider("s_tc", 440, 85, 400, 90, "c.valore", unit="%", label=T("Tacche", "Ticks", "Marcas"),
           slider_tick_major=10.0, slider_tick_minor=2.0),
    testo("t_ag", 440, 190, T("Aggancio alle tacche da 5 (prova con le frecce)", "Snap to the ticks of 5 (try the arrows)",
                              "Ajuste a las marcas de 5 (prueba con las flechas)"), 420),
    slider("s_ag", 440, 215, 400, 90, "c.valore", unit="%", label=T("Aggancio", "Snap", "Ajuste"),
           slider_tick_major=25.0, slider_tick_minor=5.0, slider_snap_ticks=True),
    testo("t_bs", 440, 320, T("Bande sempre: allarme 10/90, avviso 20/80", "Bands always: alarm 10/90, warning 20/80",
                              "Bandas siempre: alarma 10/90, aviso 20/80"), 420),
    slider("s_bs", 440, 345, 400, 80, "c.valore", unit="%", label=T("Bande", "Bands", "Bandas"), slider_bands="sempre",
           alarm_low=10.0, warn_low=20.0, warn_high=80.0, alarm_high=90.0, slider_tick_major=50.0),
    testo("t_ba", 440, 440, T("Bande solo fuori dai limiti, su una rampa (sola lettura)",
                              "Bands only outside the limits, on a ramp (read only)",
                              "Bandas solo fuera de los límites, sobre una rampa (solo lectura)"), 420),
    slider("s_ba", 440, 465, 400, 70, "s.rampa", unit="%", label=T("Rampa", "Ramp", "Rampa"), read_only=True,
           slider_bands="in_allarme", warn_high=70.0, alarm_high=90.0, slider_tick_major=10.0),
    testo("t_fr", 900, 60, T("Frazione 0..1, passo 0,05", "Fraction 0..1, step 0.05", "Fracción 0..1, paso 0,05"), 340),
    slider("s_fr", 900, 85, 340, 56, "c.frazione", min=0.0, max=1.0, step=0.05,
           label=T("Frazione", "Fraction", "Fracción")),
    lettura("l_fr", 900, 146, "c.frazione", 3, w=340),
    testo("t_ro", 900, 190, T("Sola lettura su una rampa", "Read only, on a ramp", "Solo lectura, sobre una rampa"), 340),
    slider("s_ro", 900, 215, 340, 56, "s.rampa", unit="%", label=T("Sola lettura", "Read only", "Solo lectura"),
           read_only=True),
    testo("t_ct", 900, 300, T("Scrittura continua, deadband 5", "Continuous writing, deadband 5",
                              "Escritura continua, banda muerta 5"), 340),
    slider("s_ct", 900, 325, 340, 56, "c.continuo", unit="%", label=T("Continuo", "Continuous", "Continuo"),
           write_on_release=False, write_deadband=5.0),
    lettura("l_ct", 900, 386, "c.continuo"),
    testo("t_cf", 900, 420, T("Con conferma, al rilascio", "With confirmation, on release",
                              "Con confirmación, al soltar"), 340),
    slider("s_cf", 900, 445, 340, 56, "c.conferma", unit="%", label=T("Conferma", "Confirm", "Confirmación"),
           require_confirm=True, confirm_message=T("Cambiare il valore?", "Change the value?", "¿Cambiar el valor?")),
    lettura("l_cf", 900, 506, "c.conferma"),
]

# ── 3. Bipolare, PV, molla ───────────────────────────────────────────────────
p3 = [
    testo("tit", 40, 20, T("Bipolare, valore misurato, molla", "Bipolar, measured value, spring",
                           "Bipolar, valor medido, muelle"), 700, 16.0),
    testo("t_bp", 40, 60, T("Offset −50..50, origine 0", "Offset −50..50, origin 0", "Offset −50..50, origen 0"), 400),
    slider("s_bp", 40, 85, 400, 80, "c.offset", min=-50.0, max=50.0, label=T("Offset", "Offset", "Offset"), slider_origin=0.0,
           slider_tick_major=25.0, slider_tick_minor=5.0),
    lettura("l_bp", 40, 170, "c.offset"),
    testo("t_tm", 40, 210, T("Termostato 15..30, passo 0,5, col valore misurato che si muove",
                             "Thermostat 15..30, step 0.5, with the measured value moving",
                             "Termostato 15..30, paso 0,5, con el valor medido en movimiento"), 400),
    slider("s_tm", 40, 235, 400, 80, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label=T("Termostato", "Thermostat", "Termostato"), slider_pv_tag="s.temperatura",
           slider_pv_color="#f59e0b", slider_tick_major=5.0, slider_tick_minor=1.0),
    testo("t_tp", 40, 340, T("Lo stesso, a piastra", "The same, as a tile", "Lo mismo, como placa"), 400),
    slider("s_tp", 40, 365, 400, 72, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label=T("Soggiorno", "Living room", "Salón"), slider_style="piastra", slider_icon="termometro",
           fill="#ef4444", slider_pv_tag="s.temperatura"),
    testo("t_jog", 520, 60, T("Leva a molla −100..100: tienila, poi lascia", "Spring lever −100..100: hold it, then let go",
                              "Palanca con muelle −100..100: mantenla y suelta"), 420),
    slider("s_jog", 520, 85, 420, 80, "c.jog", min=-100.0, max=100.0, label=T("Jog", "Jog", "Jog"), slider_origin=0.0,
           slider_rest_value=0.0, slider_tick_major=50.0, fill="#a855f7"),
    lettura("l_jog", 520, 170, "c.jog", 0,
            T("(mentre la tieni al massimo 5 volte al secondo, poi 0)", "(at most 5 times a second while held, then 0)",
              "(como mucho 5 veces por segundo mientras la mantienes, luego 0)"), 420),
    testo("t_jv", 520, 210, T("Molla verticale, riposo al minimo", "Vertical spring, rest at the minimum",
                              "Muelle vertical, reposo en el mínimo"), 420),
    slider("s_jv", 520, 235, 80, 260, "c.jog", min=0.0, max=100.0, orientation="vertical", slider_rest_value=0.0,
           slider_style="pillola"),
    testo("t_pv", 640, 240, T("Bipolare verticale col valore misurato", "Vertical bipolar with the measured value",
                              "Bipolar vertical con el valor medido"), 300),
    slider("s_pvv", 660, 265, 90, 260, "c.offset", min=-50.0, max=50.0, orientation="vertical", slider_origin=0.0,
           slider_pv_tag="s.rampa"),
]

# ── 4. Tema chiaro ───────────────────────────────────────────────────────────
p4 = [
    testo("tit", 40, 20, T("Gli stessi stili su sfondo chiaro", "The same styles on a light background",
                           "Los mismos estilos sobre fondo claro"), 700, 16.0),
    slider("c_cl", 40, 70, 340, 56, "c.valore", unit="%", label=T("Classico", "Classic", "Clásico")),
    slider("c_pi", 40, 150, 340, 60, "c.valore", unit="%", label=T("Pillola", "Pill", "Píldora"), slider_style="pillola"),
    slider("c_isa", 40, 235, 340, 56, "c.valore", unit="%", label=T("ISA-101", "ISA-101", "ISA-101"), slider_style="isa", slider_tick_major=25.0),
    slider("c_tc", 40, 320, 340, 90, "c.valore", unit="%", label=T("Tacche e bande", "Ticks and bands", "Marcas y bandas"),
           slider_tick_major=10.0, slider_tick_minor=2.0, slider_bands="sempre", warn_high=80.0, alarm_high=90.0),
    slider("c_luce", 440, 70, 340, 72, "c.luce_terrazzo", unit="%", label=T("Luce terrazzo", "Terrace light",
                                                                             "Luz de la terraza"),
           slider_style="piastra", slider_icon="sole", fill="#f59e0b"),
    slider("c_goc", 440, 160, 340, 72, "c.irrigazione", unit="%", label=T("Irrigazione", "Irrigation", "Riego"),
           slider_style="piastra", slider_icon="goccia", fill="#0ea5e9"),
    slider("c_pre", 440, 250, 340, 72, "c.presa", unit="%", label=T("Presa smart", "Smart plug", "Enchufe inteligente"),
           slider_style="piastra", slider_icon="presa", fill="#22c55e"),
    slider("c_tm", 440, 345, 340, 80, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label=T("Termostato", "Thermostat", "Termostato"), slider_pv_tag="s.temperatura", slider_tick_major=5.0),
    slider("c_tap", 860, 70, 100, 300, "c.tapparella", unit="%", label=T("Tapparella", "Shutter", "Persiana"),
           slider_style="piastra", slider_icon="tapparella", fill="#22c55e", orientation="vertical"),
    slider("c_jog", 990, 70, 80, 300, "c.jog", min=-100.0, max=100.0, orientation="vertical", slider_origin=0.0,
           slider_rest_value=0.0, label=T("Jog", "Jog", "Jog")),
]

# ── 5. In casa, e le altre opzioni ───────────────────────────────────────────
STANZA = "/api/project/images/soggiorno.svg"
icone = [
    ("lampadina", "c.luce", T("Luce soggiorno", "Living room light", "Luz del salón"), "#f59e0b"),
    ("sole", "c.luce_terrazzo", T("Luce terrazzo", "Terrace light", "Luz de la terraza"), "#eab308"),
    ("tapparella", "c.tapparella", T("Tapparella", "Shutter", "Persiana"), "#22c55e"),
    ("termometro", "c.setpoint", T("Riscaldamento", "Heating", "Calefacción"), "#ef4444"),
    ("ventola", "c.ventola", T("Ventilazione", "Ventilation", "Ventilación"), "#06b6d4"),
    ("presa", "c.presa", T("Presa smart", "Smart plug", "Enchufe inteligente"), "#22c55e"),
    ("volume", "c.volume", T("Musica", "Music", "Música"), "#a855f7"),
    ("goccia", "c.irrigazione", T("Irrigazione", "Irrigation", "Riego"), "#0ea5e9"),
]
p5 = [
    testo("tit", 40, 20, T("In casa: le otto icone, un'immagine dietro, i limiti dal tag",
                           "At home: the eight icons, an image behind, the limits from the tag",
                           "En casa: los ocho iconos, una imagen detrás, los límites desde el tag"), 900, 16.0),
    testo("t_ic", 40, 60, T("Le otto icone della piastra", "The eight tile icons", "Los ocho iconos de la placa"), 560),
]
for i, (icona, t, etichetta, colore) in enumerate(icone):
    x = 40 + (i % 2) * 290
    y = 85 + (i // 2) * 84
    extra = {"min": 15.0, "max": 30.0, "step": 0.5, "decimals": 1, "unit": "°C", "slider_pv_tag": "s.temperatura"} \
        if icona == "termometro" else {"unit": "%"}
    limiti = icona != "termometro"
    p5.append(slider(f"s_{icona}", x, y, 270, 70, t, limiti, label=etichetta, slider_style="piastra",
                     slider_icon=icona, fill=colore, **extra))
p5 += [
    testo("t_img", 660, 60, T("Un'immagine dietro tutto il riquadro, in trasparenza",
                              "An image behind the whole box, see-through",
                              "Una imagen detrás de todo el recuadro, en transparencia"), 560),
    slider("s_img", 660, 85, 560, 110, "c.luce", unit="%", label=T("Soggiorno, opacità 45 %", "Living room, opacity 45 %",
                                                                    "Salón, opacidad 45 %"),
           slider_style="piastra", slider_icon="lampadina", fill="#f59e0b", slider_track_opacity=35.0,
           bg_image=STANZA, bg_image_opacity=45.0),
    slider("s_img2", 660, 210, 560, 70, "c.tapparella", unit="%",
           label=T("Classico sopra la stessa immagine, opacità 25 %", "Classic on the same image, opacity 25 %",
                   "Clásico sobre la misma imagen, opacidad 25 %"),
           bg_image=STANZA, bg_image_opacity=25.0, fill="#22c55e"),
    testo("t_tag", 660, 300, T("Minimo, massimo, unità e decimali presi dal tag (0..6 bar)",
                               "Minimum, maximum, unit and decimals taken from the tag (0..6 bar)",
                               "Mínimo, máximo, unidad y decimales tomados del tag (0..6 bar)"), 560),
    slider("s_tag", 660, 325, 560, 80, "c.pressione", limiti=False, step=0.1,
           label=T("Pressione dell'impianto", "System pressure", "Presión de la instalación"),
           slider_tick_major=1.0, slider_tick_minor=0.5),
    testo("t_nn", 660, 425, T("Tacche senza numeri", "Ticks without numbers", "Marcas sin números"), 560),
    slider("s_nn", 660, 450, 560, 60, "c.valore", unit="%", slider_tick_major=10.0, slider_tick_minor=5.0,
           slider_tick_labels=False, fill="#64748b"),
    testo("t_cr", 660, 530, T("Comando critico: chiede conferma prima di scrivere",
                              "Critical command: it asks for confirmation before writing",
                              "Mando crítico: pide confirmación antes de escribir"), 560),
    slider("s_cr", 660, 555, 560, 70, "c.critico", unit="%", label=T("Potenza della pompa", "Pump power",
                                                                      "Potencia de la bomba"),
           critical=True, fill="#ef4444", font_size=18.0, label_font_size=13.0),
    lettura("l_cr", 660, 630, "c.critico", 0),
]

pagine = [
    pagina("p_stili", "1 Stili", T("Stili", "Styles", "Estilos"), "#0f172a", p1),
    pagina("p_valore", "2 Valore e tacche", T("Valore e tacche", "Value and ticks", "Valor y marcas"), "#0f172a", p2),
    pagina("p_molla", "3 Bipolare PV molla", T("Bipolare, PV, molla", "Bipolar, PV, spring", "Bipolar, PV, muelle"),
           "#0f172a", p3),
    pagina("p_chiaro", "4 Chiaro", T("Sfondo chiaro", "Light background", "Fondo claro"), "#f1f5f9", p4),
    pagina("p_casa", "5 In casa", T("In casa e altre opzioni", "At home and more options", "En casa y más opciones"),
           "#0f172a", p5),
]

project = {
    "meta": {"name": "Slider — stili e modi", "version": "0.1.0",
             "description": "Tutti gli slider del prodotto, dalla luce a piastra al termostato col valore misurato, "
                            "su variabili interne che si muovono da sole."},
    "tags": tags, "sources": [], "alarms": [], "functions": [],
    "page_layout": {"size_mode": "fixed", "default_width": 1280.0, "default_height": 800.0, "home_page_id": "p_stili"},
    "languages": {"default": "it", "langs": ["it", "en", "es"], "entries": voci},
}

SOGGIORNO = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 110" preserveAspectRatio="xMidYMid slice">
  <rect width="560" height="110" fill="#78350f"/>
  <rect x="0" y="80" width="560" height="30" fill="#451a03"/>
  <rect x="360" y="10" width="150" height="62" rx="3" fill="#bae6fd"/>
  <path d="M435 10v62M360 41h150" stroke="#78350f" stroke-width="4"/>
  <rect x="60" y="48" width="200" height="38" rx="10" fill="#b45309"/>
  <rect x="48" y="36" width="24" height="50" rx="8" fill="#92400e"/>
  <rect x="248" y="36" width="24" height="50" rx="8" fill="#92400e"/>
  <path d="M310 86V30" stroke="#fcd34d" stroke-width="3"/>
  <path d="M296 30h28l-6-16h-16z" fill="#fde68a"/>
</svg>
"""

if os.path.exists(DEST):
    shutil.rmtree(DEST)
os.makedirs(f"{DEST}/synoptics")
os.makedirs(f"{DEST}/images")
with open(f"{DEST}/images/soggiorno.svg", "w") as f:
    f.write(SOGGIORNO)
with open(f"{DEST}/project.yaml", "w") as f:
    yaml.safe_dump(project, f, allow_unicode=True, sort_keys=False, width=120)
for file, p in pagine:
    with open(f"{DEST}/synoptics/{file}.yaml", "w") as f:
        yaml.safe_dump(p, f, allow_unicode=True, sort_keys=False, width=120)
with open(f"{DEST}/template.yaml", "w") as f:
    yaml.safe_dump({
        "id": "demo-slider",
        "label": "Slider — stili e modi",
        "description": "Tutti gli slider del prodotto su cinque pagine: classico, pillola, piastra con le otto icone e "
                       "ISA-101; valore, tacche, bande e aggancio; bipolare, valore misurato e leva a molla; sfondo "
                       "chiaro; un'immagine dietro, i limiti dal tag e il comando critico. Variabili interne, due che "
                       "si muovono da sole: si prova senza impianto, sul web e sul pannello LVGL.",
    }, f, allow_unicode=True, sort_keys=False, width=120)
print("scritto", DEST, len(pagine), "pagine,", sum(len(p["objects"]) for _, p in pagine), "oggetti,",
      len(voci), "testi in tre lingue")
