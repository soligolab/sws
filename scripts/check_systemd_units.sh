#!/usr/bin/env bash
#
# Le unit systemd che spediamo hanno una trappola nota dentro?
#
# PERCHÉ ESISTE
#
# `sws-display.path` univa `PathChanged=` e `PathExists=` sullo stesso file,
# con `sws-display.service` `oneshot` e `RemainAfterExit=no`. Sembra una doppia
# rete: in realtà `PathExists` è una condizione **di livello**, non di fronte —
# appena il servizio finisce, il file esiste ancora, la condizione è ancora vera
# e systemd rilancia. Subito, in cerchio, finché non scatta il limite di
# riavvii; poi la unit resta `failed` per sempre.
#
# Sul WP630, il 2026-08-31, era failed da dieci secondi dopo l'accensione. Non
# se n'era accorto nessuno: quelle cinque volte il servizio aveva funzionato
# benissimo, e a mancare era solo la commutazione dopo un caricamento — cioè
# l'unica cosa per cui la unit esiste.
#
# Controlla:
#   1. la trappola di livello: `PathExists=` su un file che il servizio non
#      cancella, con `RemainAfterExit=no` — il ciclo garantito;
#   2. un `.path` che punta a una unit inesistente;
#   3. `ExecStart=` con un percorso relativo (systemd lo rifiuta al caricamento,
#      e l'errore si vede solo nel journal del dispositivo);
#   5. le unit del Tiny TY (deploy/tiny-ty, 13-11-2026): non girano come root e
#      cedono al PLC — peso della CPU sotto il predefinito, `OOMScoreAdjust`
#      positivo, un tetto di memoria. Sono la decisione del piano, passo 3: una
#      riga tolta non dà errori, il PLC perde semplicemente la precedenza.
#
# Uso:  ./scripts/check_systemd_units.sh
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import glob, os, re, sys

root = sys.argv[1]
D = f"{root}/deploy/container"

fail = []
def problema(msg, spiega=None):
    print(f"  \033[31m✗\033[0m {msg}")
    if spiega:
        for r in spiega.splitlines():
            print(f"      {r}")
    fail.append(msg)

def direttive(testo):
    """Le direttive `Chiave=valore`, ignorando commenti e righe vuote."""
    out = []
    for riga in testo.splitlines():
        r = riga.strip()
        if not r or r.startswith("#") or r.startswith(";") or r.startswith("["):
            continue
        if "=" in r:
            k, v = r.split("=", 1)
            out.append((k.strip(), v.strip()))
    return out

unita = sorted(glob.glob(f"{D}/*.path") + glob.glob(f"{D}/*.service") + glob.glob(f"{D}/*.container"))
print(f"\033[1m{len(unita)} unit systemd in deploy/container\033[0m\n")

testi = {os.path.basename(p): open(p).read() for p in unita}
# Le unit del Tiny TY col prefisso della cartella: `sws-runtime.service` esiste
# anche lì, e non è la stessa unit.
tiny = sorted(glob.glob(f"{root}/deploy/tiny-ty/*.service"))
for p in tiny:
    testi["tiny-ty/" + os.path.basename(p)] = open(p).read()
print(f"\033[1m{len(tiny)} unit systemd in deploy/tiny-ty\033[0m\n")

for nome, testo in testi.items():
    d = direttive(testo)
    chiavi = {k: v for k, v in d}

    # 1. la trappola di livello
    if nome.endswith(".path") and any(k == "PathExists" for k, _ in d):
        bersaglio = chiavi.get("PathExists", "")
        unit_svc = chiavi.get("Unit") or nome[:-5] + ".service"
        svc = testi.get(unit_svc, "")
        cancella = bersaglio and (f"rm {bersaglio}" in svc or f"rm -f {bersaglio}" in svc)
        resta = any(k == "RemainAfterExit" and v.lower() in ("yes", "true", "1")
                    for k, v in direttive(svc))
        if not cancella and not resta:
            problema(
                f"{nome}: `PathExists={bersaglio}` con `{unit_svc}` che non cancella il file "
                f"e non ha `RemainAfterExit=yes`",
                "PathExists è una condizione di LIVELLO: finita la unit il file esiste\n"
                "ancora, la condizione è ancora vera, systemd rilancia. In cerchio,\n"
                "finché scatta il limite di riavvii — poi la unit resta failed.\n"
                "`PathChanged=` da solo scatta anche alla prima creazione del file\n"
                "(provato sul WP630 il 2026-08-31): quasi sempre è tutto ciò che serve.")

    # 2. un .path che punta a una unit che non spediamo
    if nome.endswith(".path"):
        bersaglio_unit = chiavi.get("Unit", nome[:-5] + ".service")
        if bersaglio_unit not in testi:
            problema(f"{nome}: `Unit={bersaglio_unit}` non è fra le unit spedite")

    # 3. ExecStart relativo
    for k, v in d:
        if k.startswith("ExecStart") and v and not v.lstrip("-+!@").startswith("/"):
            problema(f"{nome}: `{k}={v}` non è un percorso assoluto — systemd rifiuta la unit")

# 5. Il Tiny TY: SWS cede al PLC, e non da root.
for nome, testo in testi.items():
    if not nome.startswith("tiny-ty/"):
        continue
    c = dict(direttive(testo))
    if c.get("User", "root") == "root":
        problema(f"{nome}: gira come root", "le unit del Tiny TY girano come `sws` (CRA, sicuri per default)")
    try:
        peso = int(c.get("CPUWeight", "100"))
        oom = int(c.get("OOMScoreAdjust", "0"))
    except ValueError:
        peso, oom = 100, 0
    if peso >= 100 or oom <= 0 or "MemoryMax" not in c:
        problema(
            f"{nome}: non cede al PLC (CPUWeight={c.get('CPUWeight')}, "
            f"OOMScoreAdjust={c.get('OOMScoreAdjust')}, MemoryMax={c.get('MemoryMax')})",
            "sul Tiny TY SWS divide un core e 256 MB con CODESYS: CPUWeight sotto 100,\n"
            "OOMScoreAdjust positivo e un MemoryMax (piano sws-lvgl-sul-tiny-ty, passo 3).")

# 4. Impostare l'URL del browser e ricaricarlo devono viaggiare insieme.
#
# `chromium-start main-app` legge l'URL da D-Bus SOLO all'avvio: un `SetUrl`
# senza un riavvio della unit lascia il pannello sulla pagina di prima, e dopo
# un factory reset quella pagina è Cockpit. Successo silenzioso: l'installazione
# dice «fatto» e lo schermo non cambia — costato una serata il 2026-09-07.
#
# Il riavvio deve essere condizionato a `is-active`: tenendo premuto STOP il
# launcher apre Cockpit su `wp-control` e non avvia `main-app`. Farlo partire
# noi coprirebbe la via di fuga con cui si sistema un dispositivo.
inst = f"{root}/deploy/container/install-container.sh"
if os.path.exists(inst):
    testo_inst = open(inst).read()
    # Si cerca il comando ESEGUITO, non una menzione: il primo giro di questa
    # guardia passava perché la stringa compariva dentro un `echo` di aiuto
    # («sul dispositivo: systemctl restart …»), quindi non avrebbe visto la
    # sparizione del riavvio vero.
    def esegue(frammento):
        for riga in testo_inst.splitlines():
            r = riga.strip()
            if not r or r.startswith("#") or r.startswith("echo"):
                continue
            if frammento in r:
                return True
        return False

    # Un SetUrl che fallisce senza dirlo è indistinguibile da uno riuscito:
    # e' il difetto che il 2026-09-07 ha lasciato il pannello su Cockpit con
    # l'installazione «riuscita» e nessuna riga nel log a spiegarlo.
    righe_inst = testo_inst.splitlines()
    for i, riga in enumerate(righe_inst):
        if "WebBrowser SetUrl" not in riga or riga.strip().startswith("#"):
            continue
        seguito = "\n".join(righe_inst[i:i + 14])
        if "else" not in seguito or ">&2" not in seguito:
            problema(
                "install-container.sh: il SetUrl del browser non riporta il fallimento",
                "senza un ramo `else` che scriva su stderr, una chiamata rifiutata\n"
                "(permessi, utente sbagliato, D-Bus assente) si legge come un successo:\n"
                "il pannello resta sulla pagina di prima e nel log non c'è una riga.")
        break

    if "WebBrowser SetUrl" in testo_inst:
        if not esegue("systemctl restart chromium@main-app.service"):
            problema(
                "install-container.sh imposta l'URL del browser ma non lo ricarica",
                "chromium-start legge l'URL solo all'avvio: senza il riavvio della unit\n"
                "il pannello resta sulla pagina di prima (dopo un factory reset: Cockpit),\n"
                "e l'installazione sembra riuscita mentre lo schermo non cambia.")
        elif not esegue("is-active --quiet chromium@main-app.service"):
            problema(
                "install-container.sh riavvia il browser senza controllare se è attivo",
                "in modalità configurazione (STOP premuto all'avvio) il launcher tiene\n"
                "Cockpit su wp-control e NON avvia main-app: avviarlo noi coprirebbe la\n"
                "via di fuga con cui si sistema un dispositivo mal configurato.")

if fail:
    print()
    print(f"\033[31m{len(fail)} problemi nelle unit.\033[0m")
    sys.exit(1)

print(f"  \033[32m✓\033[0m nessuna condizione di livello che possa ciclare")
print(f"  \033[32m✓\033[0m ogni `.path` punta a una unit che spediamo")
print(f"  \033[32m✓\033[0m ogni `ExecStart=` è un percorso assoluto")
print(f"  \033[32m✓\033[0m le unit del Tiny TY girano come `sws` e cedono al PLC")
print(f"  \033[32m✓\033[0m l'installer ricarica il browser del pannello dopo aver cambiato l'URL,")
print(f"    e solo se era già attivo (in modalità configurazione non gli ruba lo schermo)")
print()
print("\033[32mLe unit systemd non hanno trappole note.\033[0m")
PY
