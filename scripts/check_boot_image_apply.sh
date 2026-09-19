#!/usr/bin/env bash
#
# Lo script host che installa l'immagine di boot fa quello che dice? (T-72 F5)
#
# `sws-boot-image-apply.sh` gira sul dispositivo, come utente, e parla col D-Bus
# del launcher Pixsys: non si può provare in CI con un dispositivo vero. Qui lo
# si prova con un `busctl` finto che ricorda l'immagine impostata e conta le
# chiamate di scrittura, su una cartella temporanea.
#
# Cosa si verifica (ogni caso è uno di quelli che sul dispositivo contano):
#   1. `none`            → stato `nessuna_immagine`, NESSUNA scrittura sul launcher
#   2. PNG valido        → `installato`, percorso `assoluto` se /run/media non è scrivibile
#   3. stessa richiesta  → niente di nuovo: il launcher non viene richiamato
#   4. /run/media scrivibile → percorso `relativo`, PNG copiato lì
#   5. nessun busctl     → `non_supportato`, senza errori
#   6. PNG diverso dallo SHA richiesto → `errore`, senza toccare il launcher
#   7. `SetBackgroundImage` che fallisce → `errore`, e lo SHA NON viene ricordato
#   8. il launcher risponde un nome diverso da boot.png → `errore`
#   9. `--dry-run`        → nessun file scritto, nessuna scrittura sul launcher
#
# Uso:  ./scripts/check_boot_image_apply.sh
set -euo pipefail
cd "$(dirname "$0")/.."

APPLY="$PWD/deploy/container/sws-boot-image-apply.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
ko()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }
dice() { grep -q "^$1=$2\$" "$D/status" 2>/dev/null; }

# Un busctl finto: ricorda il nome del file impostato e conta le scritture.
cat > "$T/busctl" <<'FAKE'
#!/usr/bin/env bash
# busctl --system call <servizio> <oggetto> <interfaccia> <metodo> [firma valore]  ($6 = metodo, $8 = valore)
STATE="${FAKE_STATE:?}"
metodo="$6"
case "$metodo" in
  GetBackgroundImage)
      [ -f "$STATE/nome" ] && printf 's "%s"\n' "$(cat "$STATE/nome")" || printf 's "Default"\n' ;;
  SetBackgroundImage)
      echo x >> "$STATE/scritture"
      [ "${FAKE_SET_FALLISCE:-0}" = 1 ] && { echo "Access denied" >&2; exit 1; }
      basename "$8" > "$STATE/nome"
      [ -n "${FAKE_NOME:-}" ] && printf '%s' "$FAKE_NOME" > "$STATE/nome"
      printf "%s\n" "$8" > "$STATE/argomento" ;;
esac
FAKE
chmod +x "$T/busctl"

nuovo() {   # nuovo <nome-caso>: cartella pulita con un PNG e il suo trigger
    D="$T/$1/boot-image"; STATE="$T/$1/state"; MEDIA="$T/$1/media"
    mkdir -p "$D" "$STATE" "$MEDIA"; chmod 555 "$MEDIA"
    printf '\x89PNG\r\n\x1a\nprova-%s' "$1" > "$D/boot.png"
    SHA="$(sha256sum "$D/boot.png" | cut -d' ' -f1)"
    printf '%s\n' "$SHA" > "$D/trigger"
    export FAKE_STATE="$STATE" SWS_BOOT_IMAGE_DIR="$D" SWS_MEDIA_DIR="$MEDIA" SWS_BUSCTL="$T/busctl"
    unset FAKE_SET_FALLISCE FAKE_NOME
}
scritture() { [ -f "$STATE/scritture" ] && wc -l < "$STATE/scritture" || echo 0; }
lancia() { "$APPLY" "$@" >/dev/null 2>&1 || true; }

echo "=== sws-boot-image-apply.sh, con un launcher finto ==="

nuovo none; printf 'none\n' > "$D/trigger"; lancia
if dice esito nessuna_immagine && [ "$(scritture)" = 0 ]; then ok "none: nessuna_immagine, il launcher non è toccato"
else ko "none: atteso nessuna_immagine senza scritture"; fi

nuovo assoluto; lancia
if dice esito installato && dice percorso assoluto && dice sha256 "$SHA" && [ "$(cat "$STATE/argomento")" = "$D/boot.png" ]; then
    ok "PNG valido: installato, percorso assoluto quando /run/media non è scrivibile"
else ko "PNG valido: atteso installato con percorso assoluto"; fi

lancia
if [ "$(scritture)" = 1 ]; then ok "stessa richiesta: il launcher non viene richiamato"
else ko "la stessa richiesta ha richiamato il launcher ($(scritture) scritture)"; fi

lancia --force
if [ "$(scritture)" = 2 ]; then ok "--force reinstalla anche se lo SHA è già applicato"
else ko "--force non ha reinstallato"; fi

nuovo rel; chmod 755 "$MEDIA"; lancia
if dice esito installato && dice percorso relativo && [ "$(cat "$STATE/argomento")" = "sws-boot/boot.png" ] && [ -f "$MEDIA/sws-boot/boot.png" ]; then
    ok "/run/media scrivibile: percorso relativo, PNG copiato lì"
else ko "/run/media scrivibile: atteso percorso relativo"; fi

nuovo nobus; SWS_BUSCTL="$T/non-esiste" lancia
if dice esito non_supportato; then ok "senza busctl: non_supportato"
else ko "senza busctl: atteso non_supportato"; fi

nuovo sha; printf 'altro' >> "$D/boot.png"; lancia
if dice esito errore && [ "$(scritture)" = 0 ]; then ok "PNG diverso dallo SHA richiesto: errore, il launcher non è toccato"
else ko "PNG diverso dallo SHA: atteso errore senza scritture"; fi

nuovo fallisce; FAKE_SET_FALLISCE=1 lancia
if dice esito errore && [ ! -f "$D/applied" ]; then ok "Set fallita: errore, e lo SHA non viene ricordato (si riprova)"
else ko "Set fallita: atteso errore senza applied"; fi

nuovo nome; FAKE_NOME="altro.png" lancia
if dice esito errore && [ ! -f "$D/applied" ]; then ok "il launcher risponde un altro nome: errore"
else ko "nome sbagliato: atteso errore"; fi

nuovo secco; lancia --dry-run
if [ ! -f "$D/status" ] && [ "$(scritture)" = 0 ] && [ ! -f "$D/applied" ]; then ok "--dry-run: nessun file, nessuna scrittura"
else ko "--dry-run ha scritto qualcosa"; fi

echo
if [ "$FAIL" = 0 ]; then printf '\033[32mlo script host dell'"'"'immagine di boot fa ciò che dice.\033[0m\n'; else printf '\033[31mlo script host non si comporta come dichiarato.\033[0m\n'; exit 1; fi
