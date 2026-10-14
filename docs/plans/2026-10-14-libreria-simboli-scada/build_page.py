#!/usr/bin/env python3
"""Costruisce la tavola campioni (pagina HTML) dagli SVG e dai PNG resvg."""
import base64, os, re, sys, html

D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]

FAMIGLIE = [
 ("Processo e fluidi", [
  ("Pompe", "pompa-centrifuga", "Centrifuga orizzontale", ["centrifuga in linea", "sommersa", "a ingranaggi", "a vite", "a membrana", "peristaltica", "dosatrice", "a pistoni"]),
  ("Valvole", "valvola-sfera", "A sfera, leva aperta", ["farfalla", "saracinesca", "globo", "ritegno", "a 3 vie", "sicurezza", "riduttrice", "a spillo", "motorizzata", "pneumatica", "elettrovalvola", "a volantino"]),
  ("Serbatoi e reattori", "serbatoio-verticale", "Verticale con spia di livello", ["orizzontale", "su gambe", "fondo conico", "silo", "tramoggia", "vasca aperta", "fusto", "cisternetta IBC", "bombola", "con agitatore", "reattore incamiciato"]),
  ("Scambio termico", "scambiatore-fascio-tubiero", "A fascio tubiero", ["a piastre", "a serpentino", "caldaia", "forno", "torre evaporativa", "condensatore ad aria"]),
  ("Filtri e separatori", "filtro-cartuccia", "Filtro a cartuccia", ["filtro a Y", "a sacco", "ciclone", "separatore", "centrifuga", "colonna"]),
  ("Strumenti", "manometro", "Manometro", ["termometro", "portata elettromagnetico", "a turbina", "Coriolis", "rotametro", "trasmettitore di pressione", "livello radar", "galleggiante", "analizzatore pH"]),
  ("Tubi e raccordi", "curva-90", "Curva 90° flangiata", ["tratto dritto", "curva 45°", "T", "croce", "riduzione", "flangia cieca", "giunto", "tubo flessibile"]),
 ]),
 ("Elettrico ed energia", [
  ("Motori", "motore-elettrico", "Motore asincrono, vista laterale", ["vista frontale", "motoriduttore", "servomotore", "motore DC"]),
  ("Quadri e automazione", "quadro-elettrico", "Armadio RAL 7035 con spie", ["armadio aperto", "pulsantiera", "PLC", "inverter", "pannello HMI"]),
  ("Distribuzione", "trasformatore", "Trasformatore in olio", ["cabina", "traliccio", "palo", "interruttore MT", "quadro di distribuzione", "contatore"]),
  ("Generazione e accumulo", "pannello-fotovoltaico", "Pannello fotovoltaico", ["inverter FV", "turbina eolica", "gruppo elettrogeno", "rack batterie", "UPS", "colonnina di ricarica"]),
 ]),
 ("Macchine e movimentazione", [
  ("Nastri", "nastro-trasportatore", "Nastro a tappeto", ["a rulli", "coclea", "elevatore a tazze", "a catena", "curva"]),
  ("Movimentazione", "carrello-elevatore", "Carrello elevatore", ["transpallet", "AGV", "carroponte", "paranco", "robot articolato", "pallet", "collo"]),
  ("Macchine e aria", "ventilatore-centrifugo", "Ventilatore centrifugo", ["assiale", "soffiante", "compressore a vite", "a pistoni", "serbatoio aria", "pressa", "CNC", "estrusore", "mulino"]),
  ("Sensori", "fotocellula", "Fotocellula", ["induttivo", "finecorsa", "barriera", "encoder", "cella di carico"]),
  ("Segnalazione", "colonna-luminosa", "Colonna luminosa", ["sirena", "lampeggiante", "pulsante di emergenza"]),
 ]),
]

PARTI = {"rotor": "gira", "rotor-1": "gira", "rotor-2": "gira", "lever": "leva", "level": "livello",
         "needle": "lancetta", "led": "spia", "lamp-1": "spia", "lamp-2": "spia", "lamp-3": "spia",
         "lamp-red": "spia", "lamp-amber": "spia", "lamp-green": "spia"}

def carta(cat, slug, nome, altri):
    svg = open(f"{D}/svg/{slug}.svg").read()
    w, h = map(int, re.search(r'width="(\d+)" height="(\d+)"', svg).groups())
    k = 1.5
    svg_inline = svg.replace(f'width="{w}" height="{h}"', f'width="{w*k:g}" height="{h*k:g}"', 1)
    png = base64.b64encode(open(f"{D}/png/{slug}.png", "rb").read()).decode()
    ids = re.findall(r'id="([a-z0-9-]+)"', svg)
    parti = ["body"] + [i for i in ids if i in PARTI]
    chips = "".join(f'<span class="chip{" chip-body" if p == "body" else ""}">{p}</span>' for p in dict.fromkeys(parti))
    piano = ", ".join(altri)
    return f'''<article class="card">
  <div class="tile"><div class="art vista-web">{svg_inline}</div>
    <div class="art vista-pannello"><img alt="{html.escape(nome)} rasterizzato da resvg" src="data:image/png;base64,{png}" width="{w*k:g}" height="{h*k:g}"></div></div>
  <div class="meta">
    <p class="cat">{cat}</p>
    <h3>{nome}</h3>
    <p class="file"><code>{slug}.svg</code> <span class="dim">{w}×{h}</span></p>
    <p class="parti">{chips}</p>
    <p class="piano"><span class="dim">Poi, {len(altri)}:</span> {piano}</p>
  </div>
</article>'''

sezioni = []
totale = 0
for fam, cats in FAMIGLIE:
    n = sum(1 + len(c[3]) for c in cats); totale += n
    sezioni.append(f'<section class="famiglia"><header class="fam-h"><h2>{fam}</h2><p class="dim">{len(cats)} tipologie · circa {n} simboli</p></header>'
                   f'<div class="griglia">' + "".join(carta(*c) for c in cats) + "</div></section>")

PAGE = open(f"{D}/page_template.html").read()
PAGE = PAGE.replace("{{SEZIONI}}", "\n".join(sezioni)).replace("{{TOTALE}}", str(totale))
open(OUT, "w").write(PAGE)
print(OUT, len(PAGE) // 1024, "KiB, totale piano", totale)
