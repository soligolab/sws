#!/usr/bin/env bash
#
# La via di fuga STOP del pannello è ancora raggiungibile?
#
# PERCHÉ ESISTE
#
# `pixsys-launcher` gira prima di Weston e per 10 s guarda dove sta il dito.
# Tenendo premuta l'icona STOP (in alto a destra) si finisce in **modalità
# configurazione**: solo `chromium@wp-control.service`, Cockpit sulla 9443,
# `desktop.target` mai raggiunto. È l'unico modo di rimettere a posto un
# pannello con la rete sbagliata. Chi gli ruba lo schermo lì rende il
# dispositivo **non configurabile** — non «scomodo»: non configurabile.
#
# In SWS è già successo (2.3.0): si teneva premuto STOP, compariva Cockpit, e
# un istante dopo ci finiva sopra la finestra LVGL.
#
# I vincoli sono scritti in `docs/archive/2026-09-03-via-di-fuga-stop-pixsys.md`
# (1-7 qui, 8 nei test di `display_target.rs`, 9-10 in `check_systemd_units.sh`).
# Erano rispettati dal codice ma **non da una guardia**: un refactoring che
# togliesse il controllo di modalità passava tutti i test, e il difetto si
# sarebbe visto solo su un pannello, con un gesto che nessuno fa per caso.
#
# COSA NON DICE
#
# Che sul dispositivo funzioni. Questa è lettura statica dei file che
# spediamo; la prova vera è il gesto — riavviare tenendo premuto STOP oltre
# 10 s e vedere che Cockpit ci resta (collaudo del 2026-08-29 sul WP630).
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - <<'PY'
import re, sys

APPLY = "deploy/container/sws-display-apply.sh"
QUADLET = "deploy/container/sws-runtime.container"
INSTALLER = "deploy/container/install-container.sh"

src = open(APPLY, encoding="utf-8").read()
esito = 0
def ok(m): print(f"  \033[32m✓\033[0m {m}")
def ko(m, extra=None):
    global esito; esito = 1
    print(f"  \033[31m✗\033[0m {m}")
    if extra: print(f"      {extra}")

# Il corpo eseguibile: si tolgono i commenti, perché un vincolo *descritto* in
# un commento e non più *eseguito* è esattamente il guasto da trovare.
codice = "\n".join(r for r in src.splitlines() if not r.lstrip().startswith("#"))

print("=== 1. la modalità si controlla prima di toccare lo schermo ===")
i_dec = codice.find("attendi_decisione; echo $?")
# Le *chiamate*, non le definizioni: `browser_spegni() {` sta per forza prima
# del `case`, ed è il suo corpo — la domanda è dove viene invocata.
azioni = [(r"browser_spegni(?!\s*\(\))", "spegne il browser"),
          (r"browser_accendi(?!\s*\(\))", "accende il browser"),
          (r"viewer restart", "riavvia il viewer"),
          (r"viewer start", "avvia il viewer"),
          (r"viewer stop", "ferma il viewer")]
if i_dec < 0:
    ko("il `case` su `attendi_decisione` non c'è più: nessuno controlla la modalità")
else:
    ok("il `case` su `attendi_decisione` c'è")
    prima = []
    for pat, nome in azioni:
        m = re.search(pat, codice)
        if m and m.start() < i_dec:
            prima.append(nome)
    if prima: ko(f"azioni sullo schermo PRIMA del controllo di modalità: {', '.join(prima)}")
    else:     ok("nessuna azione sullo schermo prima del controllo")

print("=== 2. si aspetta un esito, non un tempo ===")
corpo = re.search(r"attendi_decisione\(\)\s*\{(.*?)\n\}", codice, re.S)
if not corpo:
    ko("`attendi_decisione()` non esiste più")
else:
    c = corpo.group(1)
    if "while" in c and "sleep 1" in c: ok("ciclo a passi di 1 s, non una lettura sola")
    else: ko("il ciclo di attesa è sparito: una lettura sola al boot scambia un avvio lento per modalità configurazione")
    if "ATTESA_MAX_S" in c: ok("il ciclo ha un limite, e non aspetta per sempre")
    else: ko("nessun limite all'attesa")
    if "in_configurazione" in c and "in_modalita_normale" in c: ok("guarda entrambe le unit, vince la prima che sale")
    else: ko("non guarda più entrambe le unit")

print("=== 3. nel dubbio non si tocca lo schermo ===")
for frag, nome in [
    ('log "il launcher è in modalità configurazione', "in configurazione: si dichiara e si esce"),
    ("né $DESKTOP_UNIT né $CONFIG_UNIT sono attivi", "dopo il timeout: non commuta"),
    ("non esiste ancora: nessuna commutazione", "file di stato assente: non commuta"),
    ("valore non riconosciuto in", "valore ignoto: non commuta"),
]:
    if frag in src: ok(nome)
    else: ko(f"manca il ramo «{nome}»: prendere lo schermo nel dubbio È il difetto")

print("=== 4. la unit della configurazione non si comanda mai ===")
# `chromium@wp-control` può comparire solo in letture (`is-active`) e in
# commenti: qualunque verbo che la cambi è il guasto storico.
vietati = [r"systemctl\s+(start|stop|restart|enable|disable|kill)\b[^\n]*wp-control",
           r"browser\(\)[^\n]*wp-control"]
colpe = [r for pat in vietati for r in re.findall(pat, codice)]
if colpe: ko(f"la unit della configurazione viene comandata: {colpe}")
else:     ok("`chromium@wp-control` compare solo in letture")
if 'CONFIG_UNIT:-chromium@wp-control.service' in src: ok("ed è quella giusta, nominata una volta sola")
else: ko("la unit della configurazione non è più `chromium@wp-control.service`")

fuori = []
for f in ("deploy/container/install-container.sh", "deploy/container/sws-display.service",
          "deploy/container/sws-runtime.container", "deploy/container/sws-lvgl-viewer.container"):
    t = open(f, encoding="utf-8").read()
    if re.search(r"(enable|start)[^\n]*weston", t): fuori.append(f)
    if re.search(r"systemctl[^\n]*(start|stop|enable|disable)[^\n]*wp-control", t): fuori.append(f)
if fuori: ko(f"weston o wp-control comandati altrove: {sorted(set(fuori))}",
             "weston abilitato al boot parte prima del launcher e col suo Conflicts= uccide la finestra dei 10 s")
else: ok("nessun altro file abilita weston o comanda wp-control")

print("=== 5. il backend gira in entrambe le modalità ===")
q = open(QUADLET, encoding="utf-8").read()
if "WantedBy=default.target" in q: ok("sws-runtime.container su `default.target`")
else: ko("il backend non è più su `default.target`: si fermerebbe in modalità configurazione")

print("=== 6. il browser si comanda per politica, col ripiego dichiarato ===")
for frag, nome in [
    ("net.pixsys.Config1.WebBrowser", "politica via D-Bus"),
    ("GetEnabled", "disponibilità sondata con una lettura, non scrivendo"),
    ("SetEnabled b false", "SetEnabled per il prossimo avvio"),
    ("browser stop", "più lo stop per la sessione in corso"),
    ("RIPIEGO", "il ripiego pre-2.1.0 è marcato RIPIEGO"),
    ("browser disable --now", "e usa `disable --now`, non `stop`"),
]:
    if frag in src: ok(nome)
    else: ko(f"manca: {nome}")

print("=== 7. l'URL si imposta prima dello start ===")
i_url, i_start = codice.find("imposta_url_sws"), codice.find("browser_accendi ||")
if i_url >= 0 and i_start > i_url: ok("`imposta_url_sws` prima di `browser_accendi`")
else: ko("l'URL non è più impostato prima dello start: il browser partirebbe sulla pagina vecchia")
if "SetUrl" in open(INSTALLER, encoding="utf-8").read(): ok("e l'installer lo imposta a sua volta (un factory reset lo riporta alla 9443)")
else: ko("l'installer non imposta più l'URL")

print("=== 11. la decisione si legge nel journal, e c'è la prova in secco ===")
if src.count("log ") >= 10: ok(f"log espliciti sulla decisione ({src.count('log ')} chiamate)")
else: ko("i log sulla decisione sono spariti")
if "--dry-run" in src: ok("`--dry-run` c'è")
else: ko("`--dry-run` è sparito")

print()
if esito == 0: print("\033[32mvia di fuga: raggiungibile.\033[0m")
else:          print("\033[31mvia di fuga: a rischio.\033[0m")
sys.exit(esito)
PY
