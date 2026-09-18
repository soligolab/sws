#!/usr/bin/env bash
#
# Il testo di sistema è una tabella sola, scritta due volte: le due copie la
# contengono davvero?
#
# PERCHÉ ESISTE
#
# Le parole che il runtime scrive da sé dentro una pagina — «Ora», «sì», «N/D»
# — e dentro una notifica esistono in Rust (`sws-core/src/testi_sistema.rs`,
# per il pannello LVGL e per email/Telegram) e in TypeScript
# (`sws-editor/src/i18n/testiSistema.ts`, per il viewer web). La fonte è una,
# `tests/fixtures/testi-sistema.json`, e due test la confrontano con le due
# implementazioni.
#
# Ma i test non fanno parte della *definition of done* (`cargo check`,
# `pnpm build`, `check_static.sh`): `formattazione-valori.json` oggi vive solo
# dei test, e una divergenza lì passa un merge se nessuno li lancia. Questa
# guardia porta la parità dentro `check_static.sh` senza eseguire niente: legge
# la fixture e verifica che **ogni parola tradotta** e **ogni nome di voce**
# compaiano, tali e quali, in entrambi i file. Non prova che siano al posto
# giusto — quello lo fanno i test — prova che nessuno abbia toccato una copia
# dimenticando l'altra, che è come nascono le divergenze.
#
# Fino al 18-09-2026 il web aveva otto di queste parole in due lingue e il
# pannello cinque parole in cinque lingue: un operatore tedesco leggeva «Zeit»
# sul vetro e «Time» nel browser. Idioma di `check_off_page.sh`.
#
# Uso:  ./scripts/check_testi_sistema.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" <<'PY'
import json, sys

root = sys.argv[1]
FIXTURE = f"{root}/tests/fixtures/testi-sistema.json"
RS = f"{root}/sws-runtime/crates/sws-core/src/testi_sistema.rs"
TS = f"{root}/sws-editor/src/i18n/testiSistema.ts"

fatti = passati = 0
def esito(ok, msg):
    global fatti, passati
    fatti += 1
    if ok:
        passati += 1; print(f"  \033[32m✓\033[0m {msg}")
    else:
        print(f"  \033[31m✗\033[0m {msg}")

f = json.load(open(FIXTURE, encoding="utf-8"))
rs = open(RS, encoding="utf-8").read()
ts = open(TS, encoding="utf-8").read()
voci = f["voci"]

print(f"=== la fixture: {len(voci)} voci, ripiego «{f['ripiego']}» ===")
esito(len(voci) >= 5, f"almeno le cinque parole del pannello ({len(voci)} voci)")
esito(all(f["ripiego"] in l for l in voci.values()),
      f"ogni voce ha la lingua di ripiego «{f['ripiego']}»")

print("=== ogni nome di voce compare in entrambe le implementazioni ===")
for nome, impl, testo in (("Rust", RS, rs), ("TypeScript", TS, ts)):
    mancanti = [v for v in voci if f'"{v}"' not in testo and f"{v}:" not in testo]
    esito(not mancanti, f"{nome}: {'nessuna voce manca' if not mancanti else 'mancano ' + ', '.join(mancanti)}")

print("=== ogni parola tradotta compare in entrambe le implementazioni ===")
for nome, testo in (("Rust", rs), ("TypeScript", ts)):
    mancanti = []
    for v, lingue in voci.items():
        for l, parola in lingue.items():
            if json.dumps(parola, ensure_ascii=False) not in testo:
                mancanti.append(f"{v}/{l}={parola!r}")
    esito(not mancanti,
          f"{nome}: {'tutte le parole ci sono' if not mancanti else str(len(mancanti)) + ' mancanti — ' + ', '.join(mancanti[:4])}")

print("=== il web non ha più una copia propria fra le chiavi dell'IDE ===")
for lingua in ("it", "en"):
    j = json.load(open(f"{root}/sws-editor/src/i18n/{lingua}.json", encoding="utf-8"))
    esito("viewerChrome" not in j,
          f"{lingua}.json: {'nessun viewerChrome.*' if 'viewerChrome' not in j else 'viewerChrome.* è ancora lì — due copie, una sbagliata'}")

print()
if passati == fatti:
    print("\033[32mtesto di sistema: una tabella, due implementazioni d'accordo.\033[0m")
    sys.exit(0)
print(f"\033[31m{fatti - passati} controlli su {fatti} falliti.\033[0m")
sys.exit(1)
PY
