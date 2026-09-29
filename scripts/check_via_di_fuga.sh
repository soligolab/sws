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
# I vincoli sono in `docs/archive/2026-09-03-via-di-fuga-stop-pixsys.md`. Fino
# al 29-09-2026 li rispettava uno script sull'host (`sws-display-apply.sh`);
# dalla Fase 4 del piano dell'aggiornamento la commutazione la fa il runtime,
# via D-Bus, in `sws-web/src/display_target.rs` — e questa guardia legge quello.
# Un refactoring che togliesse il controllo di modalità passerebbe tutti i test:
# il difetto si vedrebbe solo su un pannello, con un gesto che nessuno fa per caso.
#
# COSA NON DICE
#
# Che sul dispositivo funzioni. Questa è lettura statica; la prova vera è il
# gesto — riavviare tenendo premuto STOP oltre 10 s e vedere che Cockpit ci resta.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - <<'PY'
import re, sys

SRC = "sws-runtime/crates/sws-web/src/display_target.rs"
QUADLET = "deploy/container/sws-runtime.container"
INSTALLER = "deploy/container/install-container.sh"
src = open(SRC, encoding="utf-8").read()
esito = 0

def ok(m): print(f"  \033[32m✓\033[0m {m}")
def ko(m, extra=None):
    global esito; esito = 1
    print(f"  \033[31m✗\033[0m {m}")
    if extra: print(f"      {extra}")

# Il codice senza commenti: un vincolo *descritto* in un commento e non più
# *eseguito* è esattamente il guasto da trovare.
codice = "\n".join(r.split("//")[0] for r in src.splitlines())
m = re.search(r"async fn commuta\(.*?\n\}\n", codice, re.S)
if not m:
    print("  \033[31m✗\033[0m `commuta` non esiste più in display_target.rs"); sys.exit(1)
commuta = m.group(0)

print("=== 1. la modalità si controlla prima di toccare lo schermo ===")
i_cfg = commuta.find("unit_attiva(&sistema, CONFIGURAZIONE)")
azioni = [(r'bus::unit\(', "comanda una unit"), (r'browser_abilitato\(', "cambia la politica del browser"),
          (r'browser_url\(', "cambia l'URL del browser")]
if i_cfg < 0:
    ko("il controllo di `CONFIGURAZIONE` non c'è più in `commuta`: nessuno guarda la modalità")
else:
    ok("`commuta` guarda la unit della configurazione")
    prima = [n for p, n in azioni if (x := re.search(p, commuta)) and x.start() < i_cfg]
    if prima: ko(f"azioni sullo schermo PRIMA del controllo di modalità: {', '.join(prima)}")
    else: ok("nessuna azione sullo schermo prima del controllo")

print("=== 2. si aspetta un esito, non un tempo ===")
if re.search(r"loop\s*\{", commuta) and "from_secs(1)" in commuta: ok("ciclo a passi di 1 s, non una lettura sola")
else: ko("il ciclo di attesa è sparito: una lettura sola al boot scambia un avvio lento per modalità configurazione")
if "ATTESA_MAX_S" in commuta: ok("il ciclo ha un limite, e non aspetta per sempre")
else: ko("nessun limite all'attesa")
if "unit_attiva(&sistema, DESKTOP)" in commuta: ok("guarda entrambe le unit, vince la prima che sale")
else: ko("non guarda più `desktop.target`")

print("=== 3. nel dubbio non si tocca lo schermo ===")
for frag, nome in [('"configurazione"', "in configurazione: si dichiara e si esce"),
                   ('"indeciso"', "dopo il timeout: non commuta"),
                   ('"non_supportato"', "senza launcher Pixsys ≥ 2.1: non commuta"),
                   ("progetto non leggibile, schermo non toccato", "progetto illeggibile: non commuta")]:
    if frag in src: ok(nome)
    else: ko(f"manca il ramo «{nome}»: prendere lo schermo nel dubbio È il difetto")

print("=== 4. la unit della configurazione non si comanda mai ===")
if re.search(r"bus::unit\([^)]*CONFIGURAZIONE", codice): ko("`CONFIGURAZIONE` passata a un comando di unit")
else: ok("`chromium@wp-control` compare solo in letture")
if 'const CONFIGURAZIONE: &str = "chromium@wp-control.service";' in src: ok("ed è quella giusta, nominata una volta sola")
else: ko("la unit della configurazione non è più `chromium@wp-control.service`")
fuori = []
for f in (INSTALLER, QUADLET, "deploy/container/sws-lvgl-viewer.container"):
    t = open(f, encoding="utf-8").read()
    if re.search(r"(enable|start)[^\n]*weston", t): fuori.append(f)
    if re.search(r"systemctl[^\n]*(start|stop|enable|disable)[^\n]*wp-control", t): fuori.append(f)
if fuori: ko(f"weston o wp-control comandati altrove: {sorted(set(fuori))}",
             "weston abilitato al boot parte prima del launcher e col suo Conflicts= uccide la finestra dei 10 s")
else: ok("nessun altro file abilita weston o comanda wp-control")

print("=== 5. il backend gira in entrambe le modalità ===")
if "WantedBy=default.target" in open(QUADLET, encoding="utf-8").read(): ok("sws-runtime.container su `default.target`")
else: ko("il backend non è più su `default.target`: si fermerebbe in modalità configurazione")

print("=== 6. il browser si comanda per politica, e si ferma anche adesso ===")
for frag, nome in [('"GetEnabled"', "disponibilità sondata con una lettura, non scrivendo"),
                   ("browser_abilitato(&sistema, false)", "SetEnabled(false) per il prossimo avvio"),
                   ('bus::unit(&sistema, "StopUnit", BROWSER)', "più lo stop per la sessione in corso"),
                   ('bus::unit(&utente, "RestartUnit", VIEWER)', "il viewer si RIAVVIA, non si avvia (progetto nuovo)")]:
    if frag in src: ok(nome)
    else: ko(f"manca: {nome}")

print("=== 7. l'URL si imposta prima dello start, e c'è il ripiego ===")
i_url, i_start = commuta.find("browser_url("), commuta.find('bus::unit(&sistema, "StartUnit", BROWSER)')
if 0 <= i_url < i_start: ok("`SetUrl` prima dello `StartUnit` del browser")
else: ko("l'URL non è più impostato prima dello start: il browser partirebbe sulla pagina vecchia")
if '"ripiego_lvgl"' in commuta: ok("se il browser non parte si ripiega su LVGL, e lo si dice")
else: ko("il ripiego su LVGL è sparito: uno schermo nero al posto del motore sbagliato")
if "SetUrl" in open(INSTALLER, encoding="utf-8").read(): ok("e l'installer imposta l'URL a sua volta (un factory reset lo riporta alla 9443)")
else: ko("l'installer non imposta più l'URL")

print()
if esito == 0: print("\033[32mvia di fuga: raggiungibile.\033[0m")
else:          print("\033[31mvia di fuga: a rischio.\033[0m")
sys.exit(esito)
PY
