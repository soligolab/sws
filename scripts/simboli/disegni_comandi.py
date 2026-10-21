"""La famiglia «Comandi»: pulsanti e interruttori (21-10-2026).

Primo lotto di sei, confermato dal maintainer il 19-10-2026 nel ramo 4 della
chiusura dei residui. Sono gli unici simboli della libreria che nascono per
**scrivere**: `oggettoSimbolo` dà a ciascuno il suo comando di partenza, perché
un pulsante che al clic non fa niente è la cosa che questo lotto esiste per
togliere di mezzo.

Due tipologie: `pulsanti` (si premono) e `interruttori` (restano dove li metti).
Il selettore a tre posizioni usa la leva a N posizioni, estesa lo stesso giorno:
`angoli` elenca le tre rotazioni, e `open`/`closed` restano per i binari più
vecchi, che degradano a due posizioni invece di non leggere il manifesto.

Vista dall'alto per i comandi tondi (è come li si vede su un quadro), di tre
quarti per la levetta: luce dall'alto a sinistra come tutto il resto.
"""

from genera import Simbolo

from disegni import C, E, P, R


# ── Pulsanti ────────────────────────────────────────────────────────────────

def push_button():
    """Pulsante tondo da quadro, Ø22. Visto dall'alto: ghiera e cappuccio."""
    s = Simbolo("controls", "push-button", 60, 60, tipo="pulsanti", body="signal-red",
                it="Pulsante", en="Pushbutton")
    # La ghiera metallica avvitata sul quadro, e l'ombra che la stacca.
    s.forma(*C(30, 30, 26), mat="steel-dark")
    s.forma(*C(30, 30, 24), mat="steel", velo="metal-r")
    s.corpo()
    # Il cappuccio: il colore lo dà il corpo, così lo stile di progetto lo
    # ricolora come ogni altro simbolo.
    s.forma(*C(30, 30, 17), velo="paint-r")
    s.statico()
    # Il filo di luce in alto a sinistra, che dice «sporge».
    s.luce(*E(25, 24, 9, 6))
    return s


def lit_push_button():
    """Pulsante luminoso: stessa ghiera, lente che si accende."""
    s = Simbolo("controls", "lit-push-button", 60, 60, tipo="pulsanti", body="steel",
                it="Pulsante luminoso", en="Lit pushbutton")
    s.forma(*C(30, 30, 26), mat="steel-dark")
    s.corpo()
    s.forma(*C(30, 30, 24), velo="metal-r")
    s.statico()
    # La lente spenta sta sotto; quella accesa è la parte viva che le va sopra.
    s.forma(*C(30, 30, 16), mat="lamp-amber-off")
    s.parte("lamp", "lamp")
    s.forma(*C(30, 30, 16), mat="lamp-amber")
    s.statico()
    s.luce(*E(25, 25, 8, 5))
    return s


def emergency_stop_twist():
    """Fungo di emergenza, su piastra gialla. Si sblocca ruotando.

    Lo slug non è `emergency-stop` perché quello esiste già in `machines`: è il
    pittogramma quadrato della segnaletica, senza parti vive e senza comando.
    Questo è l'oggetto che si preme, e ha un comando di partenza `set`.
    """
    s = Simbolo("controls", "emergency-stop-twist", 70, 70, tipo="pulsanti", body="signal-red",
                it="Fungo di emergenza", en="Emergency stop (twist release)")
    # La piastra gialla: è quella che lo rende riconoscibile da lontano.
    s.forma(*C(35, 35, 32), mat="safety-yellow", velo="paint-r")
    s.forma(*C(35, 35, 23), mat="steel-dark")
    s.corpo()
    # La testa a fungo, più larga della ghiera: si colpisce col palmo.
    s.forma(*C(35, 35, 21), velo="paint-r")
    s.statico()
    # La freccia di strappo incisa sulla testa: si sblocca ruotando.
    s.tratto("M35 24 A11 11 0 1 1 24 35", stroke_width=2, stroke_opacity=.45, stroke_linecap="round")
    s.tratto("M24 35 L21 30 M24 35 L29 32", stroke_width=2, stroke_opacity=.45, stroke_linecap="round")
    s.luce(*E(29, 28, 10, 7))
    return s


# ── Interruttori ────────────────────────────────────────────────────────────

def toggle_switch():
    """Interruttore a levetta su ghiera tonda, come gli altri comandi da quadro.

    La prima versione era di tre quarti, con un corpo squadrato: in mezzo a
    pulsanti, selettori e chiave — tutti con la stessa ghiera Ø22 vista dal
    davanti — stonava. Ora condivide la ghiera, e quello che cambia è solo
    quello che ci sta sopra.
    """
    s = Simbolo("controls", "toggle-switch", 60, 80, tipo="interruttori", body="steel-dark",
                it="Interruttore a levetta", en="Toggle switch")
    s.forma(*C(30, 50, 26), mat="steel-dark")
    s.forma(*C(30, 50, 24), mat="steel", velo="metal-r")
    s.corpo()
    s.forma(*C(30, 50, 15), velo="dark-v")
    # Il dado esagonale schiacciato da cui esce la levetta.
    s.statico()
    s.forma(*E(30, 48, 11, 5), mat="steel", velo="metal-v")
    # La levetta: disegnata dritta, si inclina di ±26°.
    s.parte("lever", "lever", cx=30, cy=48, open=-26, closed=26)
    s.forma(*R(27, 16, 6, 32, 3), mat="steel", velo="metal-h")
    s.forma(*C(30, 16, 6), mat="steel", velo="metal-r")
    s.luce(*E(28, 14, 3, 2))
    s.statico()
    s.forma(*C(30, 48, 3), mat="steel-dark")
    return s


def selector_3():
    """Selettore a tre posizioni: la manopola è una leva a tre angoli."""
    s = Simbolo("controls", "selector-3", 60, 60, tipo="interruttori", body="steel-dark",
                it="Selettore a tre posizioni", en="Three-position selector")
    s.forma(*C(30, 30, 26), mat="steel-dark")
    s.forma(*C(30, 30, 24), mat="steel", velo="metal-r")
    # Le tre tacche incise sulla ghiera, dove la manopola si ferma.
    for g, d in ((-40, "M16.2 18.6 L20.1 22.2"), (0, "M30 6 L30 11"), (40, "M43.8 18.6 L39.9 22.2")):
        s.tratto(d, stroke_width=2, stroke_opacity=.5, stroke_linecap="round")
    s.corpo()
    s.forma(*C(30, 30, 16), velo="dark-v")
    # La manopola. `angoli` sono le tre posizioni, in ordine: il valore del tag
    # è l'indice. `open`/`closed` restano per i binari più vecchi.
    s.parte("lever", "lever", cx=30, cy=30, open=-40, closed=40, angoli=[-40, 0, 40])
    s.forma(*P("M26 30 L34 30 L31.5 13 L28.5 13 Z"), mat="steel", velo="metal-h")
    s.forma(*C(30, 30, 7), mat="steel", velo="metal-r")
    s.statico()
    s.luce(*E(26, 26, 5, 3))
    return s


def key_switch():
    """Interruttore a chiave: la chiave gira di 90°, le posizioni sono due."""
    s = Simbolo("controls", "key-switch", 60, 60, tipo="interruttori", body="steel-dark",
                it="Interruttore a chiave", en="Key switch")
    s.forma(*C(30, 30, 26), mat="steel-dark")
    s.forma(*C(30, 30, 24), mat="steel", velo="metal-r")
    s.corpo()
    s.forma(*C(30, 30, 15), velo="dark-v")
    # La chiave: disegnata verticale (posizione di riposo), ruota di 90°.
    s.parte("lever", "lever", cx=30, cy=30, open=0, closed=90)
    s.forma(*R(28.5, 8, 3, 22, 1), mat="stainless", velo="metal-h")
    s.forma(*R(24, 4, 12, 8, 2), mat="stainless", velo="metal-v")
    s.forma(*R(31, 14, 3, 3), mat="stainless")
    s.forma(*R(31, 20, 3, 3), mat="stainless")
    s.statico()
    s.forma(*C(30, 30, 4), mat="steel-dark")
    s.luce(*E(27, 7, 4, 2))
    return s


# ── Secondo lotto (21-10-2026) ──────────────────────────────────────────────
#
# Il maintainer, guardando i primi sei: «sono solo una piccola parte, spazia un
# po' su vari generi, anche interruttori più hold, stile selettori per l'alta
# tensione alla Frankenstein». Quindi: la stazione a due pulsanti, il pedale, la
# fune, il consenso ad azione mantenuta; il coltello mono e tripolare, il
# basculante, il rotativo a cinque posizioni; e una tipologia nuova, le
# manopole, per le cose che si girano invece di premerle.


def push_button_twin():
    """Stazione marcia/arresto: due pulsanti luminosi su una piastra sola."""
    s = Simbolo("controls", "push-button-twin", 60, 100, tipo="pulsanti", body="steel-dark",
                it="Stazione marcia/arresto", en="Start/stop station")
    s.corpo()
    s.forma(*R(6, 6, 48, 88, 5), velo="dark-v")
    s.statico()
    for cy in (30, 70):
        s.forma(*C(30, cy, 19), mat="steel-dark")
        s.forma(*C(30, cy, 17), mat="steel", velo="metal-r")
    # Marcia in alto (verde), arresto in basso (rosso): due spie indipendenti.
    s.forma(*C(30, 30, 12), mat="lamp-green-off")
    s.parte("marcia", "lamp")
    s.forma(*C(30, 30, 12), mat="lamp-green")
    s.statico()
    s.forma(*C(30, 70, 12), mat="lamp-red-off")
    s.parte("arresto", "lamp")
    s.forma(*C(30, 70, 12), mat="lamp-red")
    s.statico()
    s.luce(*E(26, 26, 6, 4))
    s.luce(*E(26, 66, 6, 4))
    return s


def foot_switch():
    """Pedaliera di lato: il pedale giallo è la cosa, la base sta sotto.

    Due versioni buttate prima di questa. La prima aveva il pedale orizzontale
    e si leggeva come uno scalino; la seconda aveva la base gialla e il pedale
    grigio, e l'occhio andava sulla base — sembrava una cucitrice. Qui il
    giallo di sicurezza sta **sul pedale**, che è la parte che si guarda e si
    preme, e la base è gomma scura come i piedini di tutti gli altri simboli.
    """
    # Il corpo ricolorabile è la **base**, non il pedale: uno strato di parte
    # viva non può essere anche lo strato `body`. Stessa divisione del
    # finecorsa, dove il corpo è la scatola e la leva è acciaio.
    s = Simbolo("controls", "foot-switch", 110, 80, tipo="pulsanti", body="steel-dark",
                it="Comando a pedale", en="Foot switch")
    s.corpo()
    s.forma(*P("M14 70 L14 50 L96 44 L96 70 Z"), velo="dark-v")
    s.statico()
    s.forma(*R(10, 68, 94, 8, 2), mat="rubber")
    s.tratto("M96 60 L106 60", mat="rubber", stroke_width=6, stroke_linecap="round")
    # La cerniera dietro.
    s.forma(*C(88, 50, 5), mat="steel-dark")
    # Il pedale, giallo e inclinato: è la parte viva, e il giallo di sicurezza
    # ce l'ha scritto addosso perché è lui che si guarda.
    s.parte("pedale", "lever", cx=88, cy=50, open=-11, closed=0)
    s.forma(*P("M20 48 L88 34 L88 46 L20 60 Z"), mat="safety-yellow", velo="paint-d")
    s.statico()
    # La zigrinatura antiscivolo, che dice «ci si appoggia un piede».
    for x in range(26, 84, 8):
        y = 47 - (x - 20) * 14 / 68
        s.tratto(f"M{x} {y:.1f} L{x + 3} {y + 11:.1f}", stroke_opacity=.35, stroke_width=1.8)
    s.luce(*P("M21 47 L87 33 L87 37 L21 51 Z"))
    s.statico()
    # La staffa di protezione: un arco sottile che scavalca il pedale, aperto
    # davanti. Sottile apposta: deve leggersi come una guardia, non come un
    # manico.
    s.tratto("M92 46 L92 18 Q92 12 84 12 L34 12 L34 22", mat="steel", stroke_width=4,
             stroke_linejoin="round", stroke_linecap="round")
    s.forma(*C(88, 50, 2.5), mat="steel")
    return s


def pull_cord_stop():
    """Fune di emergenza: la maniglia tirata è la parte viva."""
    s = Simbolo("controls", "pull-cord-stop", 60, 110, tipo="pulsanti", body="safety-yellow",
                it="Fune di emergenza", en="Pull-cord emergency stop")
    s.corpo()
    s.forma(*R(12, 6, 36, 44, 4), velo="paint-d")
    s.statico()
    s.forma(*C(30, 20, 8), mat="signal-red", velo="paint-r")
    s.forma(*R(26, 44, 8, 8, 2), mat="steel-dark")
    # La fune con la maniglia: tirata, ruota attorno all'uscita dalla scatola.
    s.parte("fune", "lever", cx=30, cy=50, open=0, closed=18)
    s.tratto("M30 50 L30 90", mat="signal-red", stroke_width=3)
    s.forma(*E(30, 98, 9, 8), mat="signal-red", velo="paint-r")
    s.forma(*E(30, 98, 5, 4), mat="steel-dark")
    s.statico()
    s.luce(*E(27, 17, 4, 3))
    return s


def hold_to_run():
    """Consenso ad azione mantenuta: va tenuto premuto, e si vede dal collare."""
    s = Simbolo("controls", "hold-to-run", 60, 60, tipo="pulsanti", body="steel-dark",
                it="Consenso ad azione mantenuta", en="Hold-to-run enabling switch")
    # Il collare di protezione, che impedisce di premerlo per sbaglio: è quello
    # che distingue a colpo d'occhio un consenso da un pulsante qualunque.
    s.forma(*C(30, 30, 27), mat="steel-dark")
    s.corpo()
    s.forma(*C(30, 30, 25), velo="dark-v")
    s.statico()
    s.forma(*C(30, 30, 18), mat="steel-dark")
    s.forma(*C(30, 30, 15), mat="gauge-green", velo="paint-r")
    s.parte("premuto", "lamp")
    s.forma(*C(30, 30, 15), mat="lamp-green")
    s.statico()
    s.luce(*E(26, 25, 7, 5))
    return s


def knife_switch():
    """Interruttore a coltello, monopolare: la lama è disegnata **alzata**.

    È il simbolo alla Frankenstein. Tre pezzi che si devono distinguere a
    colpo d'occhio: la base isolante, i due isolatori che reggono i morsetti,
    e la lama con la sua impugnatura isolata. La prima versione li aveva tutti
    dello stesso colore e si leggeva come un'asse con sopra una sbarra.
    """
    s = Simbolo("controls", "knife-switch", 110, 80, tipo="interruttori", body="rubber",
                it="Interruttore a coltello", en="Knife switch")
    s.corpo()
    s.forma(*R(6, 58, 98, 16, 3), velo="dark-v")
    s.statico()
    # I due isolatori in porcellana, che reggono i morsetti.
    for x in (20, 82):
        s.forma(*R(x - 7, 40, 14, 20, 2), mat="porcelain", velo="paint-r")
        s.forma(*E(x, 40, 9, 3.5), mat="porcelain-shed")
    # Il perno a sinistra e la ganascia a destra: la ganascia è una U aperta.
    s.forma(*C(20, 36, 5), mat="copper", velo="metal-r")
    s.forma(*P("M74 24 L74 40 L90 40 L90 24 L85 24 L85 35 L79 35 L79 24 Z"),
            mat="copper", velo="metal-v")
    # La lama, disegnata alzata (aperta): chiusa scende nella ganascia.
    s.parte("lama", "lever", cx=20, cy=36, open=0, closed=22)
    s.forma(*P("M20 32 L86 6 L90 15 L22 41 Z"), mat="copper", velo="metal-h")
    s.riflesso("path", {"d": "M22 33 L85 8 L87 12 L23 37 Z"}, opacita=.2)
    s.forma(*R(84, 2, 20, 11, 3), mat="rubber", velo="rubber-r")
    s.luce(*E(92, 5, 7, 2.5))
    s.statico()
    s.forma(*C(20, 36, 2.5), mat="steel-dark")
    return s


def knife_switch_3p():
    """Sezionatore a coltello tripolare: tre lame alzate su un'asta sola.

    Vista frontale: i tre poli affiancati, ciascuno coi suoi due isolatori, e
    le tre lame legate da una traversa con l'impugnatura al centro. Una parte
    viva sola, perché un gesto le muove tutte: è così che funziona davvero.
    """
    s = Simbolo("controls", "knife-switch-3p", 120, 100, tipo="interruttori", body="rubber",
                it="Sezionatore a coltello tripolare", en="Three-pole knife disconnector")
    s.corpo()
    s.forma(*R(6, 76, 108, 18, 3), velo="dark-v")
    s.statico()
    # Tre poli affiancati: due isolatori ciascuno.
    for cx in (24, 60, 96):
        for dy in (0, 0):
            pass
        s.forma(*R(cx - 8, 56, 16, 22, 2), mat="porcelain", velo="paint-r")
        s.forma(*E(cx, 56, 10, 4), mat="porcelain-shed")
        s.forma(*C(cx, 52, 5), mat="copper", velo="metal-r")
    # Le ganasce, più in alto: la lama ci entra scendendo.
    for cx in (24, 60, 96):
        s.forma(*P(f"M{cx - 8} 20 L{cx - 8} 34 L{cx + 8} 34 L{cx + 8} 20 L{cx + 4} 20 "
                   f"L{cx + 4} 30 L{cx - 4} 30 L{cx - 4} 20 Z"), mat="copper", velo="metal-v")
    # Le tre lame alzate, la traversa che le lega e l'impugnatura al centro.
    s.parte("lame", "lever", cx=60, cy=52, open=0, closed=26)
    for cx in (24, 60, 96):
        s.forma(*P(f"M{cx - 4} 50 L{cx - 4} 14 L{cx + 4} 14 L{cx + 4} 50 Z"),
                mat="copper", velo="metal-h")
    s.forma(*R(16, 8, 88, 7, 2), mat="steel-dark", velo="dark-h")
    s.riflesso("rect", {"x": 18, "y": 9, "width": 84, "height": 2, "rx": 1}, opacita=.22)
    s.forma(*R(48, 0, 24, 10, 3), mat="rubber", velo="rubber-r")
    s.luce(*E(56, 3, 7, 2))
    s.statico()
    for cx in (24, 60, 96):
        s.forma(*C(cx, 52, 2.5), mat="steel-dark")
    return s


def rocker_switch():
    """Interruttore basculante: la piastrella si inclina da una parte o dall'altra."""
    s = Simbolo("controls", "rocker-switch", 70, 50, tipo="interruttori", body="steel-dark",
                it="Interruttore basculante", en="Rocker switch")
    s.corpo()
    s.forma(*R(4, 8, 62, 34, 4), velo="dark-v")
    s.statico()
    s.forma(*R(10, 13, 50, 24, 3), mat="rubber")
    # La piastrella: a riposo inclinata a sinistra (I), premuta va a destra (O).
    s.parte("bilanciere", "lever", cx=35, cy=25, open=-9, closed=9)
    s.forma(*R(12, 15, 46, 20, 2), mat="label", velo="paint-h")
    # Il segno «I/O» inciso, e il filo di luce sul bordo alto della piastrella:
    # senza, un basculante è un rettangolo bianco.
    s.tratto("M24 21 L24 29", stroke_width=2.4, stroke_opacity=.45, stroke_linecap="round")
    s.forma(*C(46, 25, 4), fill="none", stroke_opacity=.45, stroke_width=2.2)
    s.riflesso("rect", {"x": 14, "y": 16.5, "width": 42, "height": 3, "rx": 1.5}, opacita=.5)
    s.statico()
    return s


def rotary_switch_5():
    """Selettore rotativo a cinque posizioni: la leva a N, spinta più in là."""
    s = Simbolo("controls", "rotary-switch-5", 70, 70, tipo="interruttori", body="steel-dark",
                it="Selettore rotativo a cinque posizioni", en="Five-position rotary switch")
    s.forma(*C(35, 35, 31), mat="steel-dark")
    s.forma(*C(35, 35, 29), mat="steel", velo="metal-r")
    # Cinque tacche a 30° l'una dall'altra, dove la manopola si ferma.
    for d in ("M18.5 18.5 L22 22", "M26.5 9.5 L28.3 14.2", "M35 7 L35 12",
              "M43.5 9.5 L41.7 14.2", "M51.5 18.5 L48 22"):
        s.tratto(d, stroke_width=2, stroke_opacity=.5, stroke_linecap="round")
    s.corpo()
    s.forma(*C(35, 35, 19), velo="dark-v")
    s.parte("manopola", "lever", cx=35, cy=35, open=-60, closed=60,
            angoli=[-60, -30, 0, 30, 60])
    s.forma(*P("M30 35 L40 35 L37 14 L33 14 Z"), mat="steel", velo="metal-h")
    s.forma(*C(35, 35, 8), mat="steel", velo="metal-r")
    s.statico()
    s.luce(*E(30, 30, 6, 4))
    return s


# ── Manopole ────────────────────────────────────────────────────────────────
#
# Tipologia terza, aggiunta col secondo lotto: le cose che si girano su una
# scala continua, non su posizioni discrete. La parte viva è `needle`, la
# stessa dei manometri, quindi il valore è un numero fra min e max.

def potentiometer():
    """Manopola graduata: l'indice gira su una scala continua."""
    s = Simbolo("controls", "potentiometer", 70, 70, tipo="manopole", body="steel-dark",
                it="Manopola graduata", en="Graduated knob")
    s.forma(*C(35, 35, 32), mat="dial", velo="dial-r")
    s.statico()
    # La scala, da -135° a +135° come i manometri della libreria.
    for i in range(11):
        g = -135 + i * 27
        import math
        a = math.radians(g - 90)
        x1, y1 = 35 + 27 * math.sin(a + math.pi), 35 - 27 * math.cos(a + math.pi)
        x2, y2 = 35 + 23 * math.sin(a + math.pi), 35 - 23 * math.cos(a + math.pi)
        s.tratto(f"M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}", stroke_width=1.6, stroke_opacity=.55)
    s.corpo()
    s.forma(*C(35, 35, 18), velo="dark-v")
    s.parte("indice", "needle", cx=35, cy=35, a0=-135, a1=135)
    s.forma(*P("M33.6 35 L36.4 35 L35.6 17 L34.4 17 Z"), mat="signal-red")
    s.statico()
    s.forma(*C(35, 35, 5), mat="steel", velo="metal-r")
    s.luce(*E(30, 29, 6, 4))
    return s


def joystick():
    """Manipolatore a leva, tre posizioni: sinistra, centro, destra."""
    s = Simbolo("controls", "joystick", 70, 80, tipo="manopole", body="steel-dark",
                it="Manipolatore a leva", en="Joystick")
    s.corpo()
    s.forma(*R(8, 52, 54, 22, 4), velo="dark-v")
    s.statico()
    s.forma(*E(35, 54, 18, 7), mat="steel", velo="metal-v")
    s.parte("leva", "lever", cx=35, cy=54, open=-25, closed=25, angoli=[-25, 0, 25])
    s.forma(*R(32, 18, 6, 36, 3), mat="steel", velo="metal-h")
    s.forma(*E(35, 16, 11, 9), mat="rubber", velo="rubber-r")
    s.luce(*E(31, 13, 5, 3.5))
    s.statico()
    s.forma(*C(35, 54, 4), mat="steel-dark")
    return s


def tutti():
    return [f() for f in (
        push_button,
        lit_push_button,
        emergency_stop_twist,
        toggle_switch,
        selector_3,
        key_switch,
        push_button_twin,
        foot_switch,
        pull_cord_stop,
        hold_to_run,
        knife_switch,
        knife_switch_3p,
        rocker_switch,
        rotary_switch_5,
        potentiometer,
        joystick,
    )]
