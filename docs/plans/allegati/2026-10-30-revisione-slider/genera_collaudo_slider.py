"""Genera il progetto di collaudo dello slider (fasi 1-6), per web e LVGL."""
import os, sys, yaml

dest = sys.argv[1]
os.makedirs(f"{dest}/synoptics", exist_ok=True)

def tag(id, desc, unit=None, gen=None):
    t = {"id": id, "description": desc, "data_type": "float"}
    if unit: t["unit"] = unit
    if gen: t["generator"] = gen
    return t

tags = [
    tag("c.luce", "scrivibile: luce, piastra", "%"),
    tag("c.ventola", "scrivibile: ventola, piastra", "%"),
    tag("c.tapparella", "scrivibile: tapparella, piastra verticale", "%"),
    tag("c.valore", "scrivibile: gli slider generici", "%"),
    tag("c.frazione", "scrivibile: 0..1 col passo 0,05 (deve arrivare un decimale)"),
    tag("c.offset", "scrivibile: bipolare −50..50"),
    tag("c.setpoint", "scrivibile: il setpoint del termostato", "°C"),
    tag("c.jog", "scrivibile: la leva a molla −100..100"),
    tag("c.continuo", "scrivibile: scrittura continua con deadband 5", "%"),
    tag("c.conferma", "scrivibile: con conferma", "%"),
    tag("c.verticale", "scrivibile: verticale", "%"),
    tag("s.rampa", "si muove da solo: rampa 0..100 in 40 s (PV, bande, sola lettura)", "%",
        {"shape": "ramp", "period_ms": 40000, "min": 0.0, "max": 100.0, "enabled": True}),
    tag("s.temperatura", "si muove da solo: 18..26 °C in 60 s (il PV del termostato)", "°C",
        {"shape": "triangle", "period_ms": 60000, "min": 18.0, "max": 26.0, "enabled": True}),
]
project = {
    "meta": {"name": "collaudo-slider", "version": "0.1.0"},
    "tags": tags, "sources": [], "alarms": [], "functions": [],
    "page_layout": {"size_mode": "fixed", "default_width": 1280.0, "default_height": 800.0, "home_page_id": "p_stili"},
    "target": {"kind": "lvgl_framebuffer"},
}

def testo(id, x, y, t, w=360, size=13.0, color=None):
    o = {"id": id, "type": "text", "x": float(x), "y": float(y), "width": float(w), "height": 20.0, "text": t, "font_size": size}
    if color: o["color"] = color
    return o

def lettura(id, x, y, tag, fmt="scritto: {value:.2f}", w=200):
    return {"id": id, "type": "text", "x": float(x), "y": float(y), "width": float(w), "height": 18.0,
            "tag": tag, "format": fmt, "font_size": 11.0, "color": "#94a3b8"}

def slider(id, x, y, w, h, tag, **kw):
    o = {"id": id, "type": "slider", "x": float(x), "y": float(y), "width": float(w), "height": float(h), "tag": tag,
         "min": 0.0, "max": 100.0, "step": 1.0}
    o.update(kw)
    return o

nav = {"id": "nav", "type": "page_navigator", "x": 24.0, "y": 752.0, "width": 1232.0, "height": 40.0,
       "nav_orientation": "horizontal", "nav_fill": True, "nav_gap": 6, "locked": True}

def pagina(id, nome, sfondo, oggetti):
    return {"id": id, "name": nome, "width": 1280.0, "height": 800.0, "background": sfondo, "objects": oggetti + [dict(nav)]}

# ── 1. Stili ─────────────────────────────────────────────────────────────────
p1 = [
    testo("tit", 40, 20, "Gli stili — trascina col dito, col mouse, o Tab e frecce", 700, 16.0),
    testo("t_cl", 40, 60, "Classico (come LVGL di sempre)"),
    slider("s_cl", 40, 85, 340, 50, "c.valore", unit="%", label="Classico"),
    lettura("l_cl", 40, 140, "c.valore"),
    testo("t_pi", 40, 175, "Pillola (cursore bianco dentro la traccia)"),
    slider("s_pi", 40, 200, 340, 60, "c.valore", unit="%", label="Pillola", slider_style="pillola"),
    testo("t_isa", 40, 285, "ISA-101 (grigi, cursore rettangolare; ignora il colore)"),
    slider("s_isa", 40, 310, 340, 56, "c.valore", unit="%", label="ISA-101", slider_style="isa", fill="#ef4444"),
    testo("t_col", 40, 390, "Classico: colore, traccia scura, spessore 24"),
    slider("s_col", 40, 415, 340, 56, "c.valore", unit="%", label="Colori", fill="#22c55e",
           slider_track_color="#334155", slider_track_thickness=24.0),
    testo("t_op", 40, 495, "Traccia al 30 % su uno sfondo colorato"),
    slider("s_op", 40, 520, 340, 56, "c.valore", unit="%", label="Trasparenza", bg_color="#7c2d12",
           slider_track_opacity=30.0),
    testo("t_pz", 440, 60, "Piastra (domotica): trascina ovunque", 400),
    slider("s_luce", 440, 85, 340, 72, "c.luce", unit="%", label="Luce soggiorno", slider_style="piastra",
           slider_icon="lampadina", fill="#f59e0b"),
    lettura("l_luce", 440, 162, "c.luce"),
    slider("s_vent", 440, 190, 340, 72, "c.ventola", unit="%", label="Ventola", slider_style="piastra",
           slider_icon="ventola", fill="#06b6d4"),
    slider("s_vol", 440, 280, 340, 56, "c.valore", unit="%", label="Volume", slider_style="piastra",
           slider_icon="volume", fill="#a855f7"),
    slider("s_senza", 440, 350, 340, 56, "c.valore", unit="%", label="Senza icona", slider_style="piastra"),
    testo("t_v", 840, 60, "Verticali", 300),
    slider("s_tap", 840, 90, 100, 300, "c.tapparella", unit="%", label="Tapparella", slider_style="piastra",
           slider_icon="tapparella", fill="#22c55e", orientation="vertical"),
    slider("s_vcl", 970, 90, 70, 300, "c.verticale", unit="%", label="Classico", orientation="vertical"),
    slider("s_vpi", 1060, 90, 70, 300, "c.verticale", unit="%", label="Pillola", orientation="vertical",
           slider_style="pillola"),
    slider("s_visa", 1150, 90, 90, 300, "c.verticale", unit="%", label="ISA", orientation="vertical",
           slider_style="isa", slider_tick_major=20.0, slider_tick_minor=5.0),
    lettura("l_tap", 840, 400, "c.tapparella"),
    lettura("l_ver", 970, 400, "c.verticale"),
]
# ── 2. Valore e tacche ───────────────────────────────────────────────────────
p2 = [
    testo("tit", 40, 20, "Dove sta il valore, tacche, bande, passi", 700, 16.0),
    slider("s_sotto", 40, 60, 340, 56, "c.valore", unit="%", label="Valore sotto (predefinito)"),
    slider("s_sopra", 40, 130, 340, 56, "c.valore", unit="%", label="Valore sopra", slider_value_position="sopra"),
    slider("s_dentro", 40, 200, 340, 50, "c.valore", unit="%", slider_value_position="dentro",
           slider_track_thickness=28.0, fill="#f59e0b"),
    slider("s_curs", 40, 270, 340, 56, "c.valore", unit="%", label="Sul cursore, mentre trascini",
           slider_value_position="cursore"),
    slider("s_nv", 40, 340, 340, 40, "c.valore", show_value=False),
    testo("t_nv", 40, 385, "Senza valore (show_value: false)"),
    testo("t_tc", 440, 60, "Tacche: marcata ogni 10, divisione ogni 2", 420),
    slider("s_tc", 440, 85, 400, 90, "c.valore", unit="%", label="Tacche", slider_tick_major=10.0, slider_tick_minor=2.0),
    testo("t_ag", 440, 190, "Aggancio alle tacche da 5 (prova con le frecce)", 420),
    slider("s_ag", 440, 215, 400, 90, "c.valore", unit="%", label="Aggancio", slider_tick_major=25.0,
           slider_tick_minor=5.0, slider_snap_ticks=True),
    testo("t_bs", 440, 320, "Bande sempre (allarme 10/90, avviso 20/80)", 420),
    slider("s_bs", 440, 345, 400, 80, "c.valore", unit="%", label="Bande", slider_bands="sempre",
           alarm_low=10.0, warn_low=20.0, warn_high=80.0, alarm_high=90.0, slider_tick_major=50.0),
    testo("t_ba", 440, 440, "Bande solo fuori dai limiti, su una rampa (sola lettura)", 420),
    slider("s_ba", 440, 465, 400, 70, "s.rampa", unit="%", label="Rampa", read_only=True, slider_bands="in_allarme",
           warn_high=70.0, alarm_high=90.0, slider_tick_major=10.0),
    testo("t_fr", 900, 60, "Frazione 0..1, passo 0,05", 340),
    slider("s_fr", 900, 85, 340, 56, "c.frazione", min=0.0, max=1.0, step=0.05, label="Frazione"),
    lettura("l_fr", 900, 146, "c.frazione", "scritto: {value:.3f} (deve avere i decimali)", 340),
    testo("t_ro", 900, 190, "Sola lettura su una rampa", 340),
    slider("s_ro", 900, 215, 340, 56, "s.rampa", unit="%", label="Sola lettura", read_only=True),
    testo("t_ct", 900, 300, "Scrittura continua, deadband 5", 340),
    slider("s_ct", 900, 325, 340, 56, "c.continuo", unit="%", label="Continuo", write_on_release=False,
           write_deadband=5.0),
    lettura("l_ct", 900, 386, "c.continuo"),
    testo("t_cf", 900, 420, "Con conferma (al rilascio)", 340),
    slider("s_cf", 900, 445, 340, 56, "c.conferma", unit="%", label="Conferma", require_confirm=True,
           confirm_message="Cambiare il valore?"),
    lettura("l_cf", 900, 506, "c.conferma"),
]
# ── 3. Bipolare, PV, molla ───────────────────────────────────────────────────
p3 = [
    testo("tit", 40, 20, "Bipolare, valore misurato, molla", 700, 16.0),
    testo("t_bp", 40, 60, "Offset −50..50, origine 0", 400),
    slider("s_bp", 40, 85, 400, 80, "c.offset", min=-50.0, max=50.0, label="Offset", slider_origin=0.0,
           slider_tick_major=25.0, slider_tick_minor=5.0),
    lettura("l_bp", 40, 170, "c.offset"),
    testo("t_tm", 40, 210, "Termostato 15..30, passo 0,5, PV che si muove", 400),
    slider("s_tm", 40, 235, 400, 80, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label="Termostato", slider_pv_tag="s.temperatura", slider_pv_color="#f59e0b", slider_tick_major=5.0,
           slider_tick_minor=1.0),
    testo("t_tp", 40, 340, "Lo stesso, a piastra", 400),
    slider("s_tp", 40, 365, 400, 72, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label="Soggiorno", slider_style="piastra", slider_icon="termometro", fill="#ef4444",
           slider_pv_tag="s.temperatura"),
    testo("t_jog", 520, 60, "Leva a molla −100..100: tienila, poi lascia", 420),
    slider("s_jog", 520, 85, 420, 80, "c.jog", min=-100.0, max=100.0, label="Jog", slider_origin=0.0,
           slider_rest_value=0.0, slider_tick_major=50.0, fill="#a855f7"),
    lettura("l_jog", 520, 170, "c.jog", "scritto: {value:.0f} (mentre tieni ≤ 5 al secondo, poi 0)", 420),
    testo("t_jv", 520, 210, "Molla verticale, riposo al minimo", 420),
    slider("s_jv", 520, 235, 80, 260, "c.jog", min=0.0, max=100.0, orientation="vertical", slider_rest_value=0.0,
           slider_style="pillola"),
    testo("t_pv", 640, 240, "Bipolare verticale con PV", 300),
    slider("s_pvv", 660, 265, 90, 260, "c.offset", min=-50.0, max=50.0, orientation="vertical", slider_origin=0.0,
           slider_pv_tag="s.rampa"),
]
# ── 4. Tema chiaro ───────────────────────────────────────────────────────────
p4 = [
    testo("tit", 40, 20, "Gli stessi stili su sfondo chiaro", 700, 16.0),
    slider("c_cl", 40, 70, 340, 56, "c.valore", unit="%", label="Classico"),
    slider("c_pi", 40, 150, 340, 60, "c.valore", unit="%", label="Pillola", slider_style="pillola"),
    slider("c_isa", 40, 235, 340, 56, "c.valore", unit="%", label="ISA-101", slider_style="isa",
           slider_tick_major=25.0),
    slider("c_tc", 40, 320, 340, 90, "c.valore", unit="%", label="Tacche e bande", slider_tick_major=10.0,
           slider_tick_minor=2.0, slider_bands="sempre", warn_high=80.0, alarm_high=90.0),
    slider("c_luce", 440, 70, 340, 72, "c.luce", unit="%", label="Luce cucina", slider_style="piastra",
           slider_icon="sole", fill="#f59e0b"),
    slider("c_goc", 440, 160, 340, 72, "c.ventola", unit="%", label="Irrigazione", slider_style="piastra",
           slider_icon="goccia", fill="#0ea5e9"),
    slider("c_pre", 440, 250, 340, 72, "c.valore", unit="%", label="Presa smart", slider_style="piastra",
           slider_icon="presa", fill="#22c55e"),
    slider("c_tm", 440, 345, 340, 80, "c.setpoint", min=15.0, max=30.0, step=0.5, decimals=1, unit="°C",
           label="Termostato", slider_pv_tag="s.temperatura", slider_tick_major=5.0),
    slider("c_tap", 860, 70, 100, 300, "c.tapparella", unit="%", label="Tapparella", slider_style="piastra",
           slider_icon="tapparella", fill="#22c55e", orientation="vertical"),
    slider("c_jog", 990, 70, 80, 300, "c.jog", min=-100.0, max=100.0, orientation="vertical", slider_origin=0.0,
           slider_rest_value=0.0, label="Jog"),
]
pagine = [pagina("p_stili", "1 Stili", "#0f172a", p1), pagina("p_valore", "2 Valore e tacche", "#0f172a", p2),
          pagina("p_molla", "3 Bipolare PV molla", "#0f172a", p3), pagina("p_chiaro", "4 Chiaro", "#f1f5f9", p4)]
with open(f"{dest}/project.yaml", "w") as f:
    yaml.safe_dump(project, f, allow_unicode=True, sort_keys=False)
for p in pagine:
    with open(f"{dest}/synoptics/{p['name']}.yaml", "w") as f:
        yaml.safe_dump(p, f, allow_unicode=True, sort_keys=False)
print("scritto", dest, len(pagine), "pagine", sum(len(p["objects"]) for p in pagine), "oggetti")
