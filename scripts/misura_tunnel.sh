#!/usr/bin/env bash
# La tenuta del tunnel dei pannelli, contata dai log (ramo 7 del piano
# docs/archive/2026-10-19-chiusura-dei-residui.md; fetta 3 della fase 6).
#
# Per ogni «tunnel aperto» nei log del pannello cerca la causa:
#   - avvio: il runtime del pannello è partito poco prima («SWS runtime starting»);
#   - gateway: il gateway del cloud, o Traefik davanti a lui, è ripartito poco prima
#     (journal di sws-gateway e traefik sul VPS);
#   - non spiegata: nessuna delle due. È il numero che conta.
# Criterio di uscita deciso dal maintainer il 19-10-2026: meno di una riapertura non
# spiegata al giorno, su sette giorni di pannello acceso.
#
#   PANNELLO_SSH="user@192.168.1.204 -o HostKeyAlias=tc620-a-p3-c6-07aff9.local" \
#   VPS_SSH="debian@37.187.181.142" ./scripts/misura_tunnel.sh [dal AAAA-MM-GG]
#
# Avvio del pannello (26-10-2026): «SWS runtime starting» si scrive prima che il bus
# dei log si agganci e nel file spesso manca (23 contro 27 spegnimenti nella prima
# settimana): valgono anche «runtime instance id» e «shutdown signal received».
# Gateway giù visto dal pannello: un «tunnel non aperto: … 502» poco prima (Traefik c'è,
# il gateway dietro no). Il journal del VPS ruota, e di alcuni giorni non resta niente.
# Traefik: i suoi riavvii (aggiornamento dell'immagine) tagliano il tunnel come quelli
# del gateway, e la prima misura li contava come non spiegati.
#
# Traefik si legge dai soli messaggi di systemd (`_COMM=systemd`, indicizzato): con
# `-u traefik` journalctl scorrerebbe tutti i log di accesso, minuti per una settimana.
#
# Legge soltanto: i file runtime-*.jsonl del pannello e il journal utente del VPS.
set -euo pipefail
: "${PANNELLO_SSH:?serve PANNELLO_SSH (utente@host e opzioni ssh del pannello)}"
: "${VPS_SSH:?serve VPS_SSH (utente@host del VPS)}"
DAL="${1:-$(date -d '-7 days' +%F)}"
LOGS="${PANNELLO_LOGS:-/data/user/sws/logs}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# shellcheck disable=SC2086
ssh -o BatchMode=yes $PANNELLO_SSH "cat $LOGS/runtime-*.jsonl" \
  | grep -E '"message":"(tunnel aperto|SWS runtime starting|shutdown signal received|runtime instance id[^"]*|tunnel non aperto: [^"]*502[^"]*)"' > "$TMP/pannello" || true
# shellcheck disable=SC2086
{
  ssh -o BatchMode=yes $VPS_SSH "journalctl --user -u sws-gateway --since '$DAL' --no-pager -o short-iso" \
    | grep -E 'Started ' || true
  # shellcheck disable=SC2086
  ssh -o BatchMode=yes $VPS_SSH "journalctl --user _COMM=systemd --since '$DAL' --no-pager -o short-iso" \
    | grep -E 'Started traefik' || true
} > "$TMP/gateway"

python3 - "$TMP/pannello" "$TMP/gateway" "$DAL" <<'PY'
import json, sys, collections
from datetime import datetime, timezone, timedelta
pannello, gateway, dal = sys.argv[1], sys.argv[2], sys.argv[3]
FINESTRA = timedelta(minutes=3)
avvii, aperti, giu = [], [], []
for riga in open(pannello):
    try:
        ev = json.loads(riga)
    except Exception:
        continue
    # Due forme: il file del bus dei log (`ts_ms`, `message`) e l'uscita di
    # `podman logs` (`timestamp`, `fields.message`).
    if "ts_ms" in ev:
        t = datetime.fromtimestamp(ev["ts_ms"] / 1000, tz=timezone.utc)
        msg = ev.get("message", "")
    else:
        t = datetime.fromisoformat(ev["timestamp"].replace("Z", "+00:00"))
        msg = ev.get("fields", {}).get("message", "")
    if msg == "tunnel aperto":
        aperti.append(t)
    elif msg.startswith("tunnel non aperto"):
        # Traefik ha risposto 502: il gateway dietro era giù. Lo dice il
        # pannello stesso, anche quando il journal del VPS non c'è più.
        giu.append(t)
    else:
        avvii.append(t)
riavvii = []
for riga in open(gateway):
    try:
        riavvii.append(datetime.fromisoformat(riga.split()[0]).astimezone(timezone.utc))
    except Exception:
        pass
inizio = datetime.fromisoformat(dal).replace(tzinfo=timezone.utc)
per_giorno = collections.defaultdict(lambda: collections.Counter())
non_spiegate = []
for t in sorted(aperti):
    if t < inizio:
        continue
    vicino = lambda lista: any(timedelta(0) <= t - x <= FINESTRA for x in lista)
    causa = "avvio" if vicino(avvii) else "gateway" if vicino(riavvii) or vicino(giu) else "non spiegata"
    per_giorno[t.date()][causa] += 1
    if causa == "non spiegata":
        non_spiegate.append(t)
print(f"Tunnel dal {dal}: aperture per causa (finestra di {int(FINESTRA.total_seconds() // 60)} min)\n")
print("| giorno | avvio del pannello | riavvio del gateway | non spiegate |")
print("|---|---|---|---|")
for g in sorted(per_giorno):
    c = per_giorno[g]
    print(f"| {g} | {c['avvio']} | {c['gateway']} | {c['non spiegata']} |")
giorni = max(1, len(per_giorno))
print(f"\nnon spiegate: {len(non_spiegate)} in {giorni} giorni ({len(non_spiegate) / giorni:.2f} al giorno; soglia < 1)")
for t in non_spiegate:
    print(f"  - {t.isoformat()}")
PY
