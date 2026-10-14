# Entrare in un runtime di prova come ci entrerebbe una persona.
#
# Si include con `. "$REPO/scripts/accesso_guardie.sh"` dalle guardie che
# provano l'autenticazione, e che quindi non possono usare
# `--senza-autenticazione` (quella spegne tutto, anche gli utenti che la
# guardia vuole vedere al lavoro).
#
# Perché esiste: dal 06-10-2026 l'IDE chiede le credenziali dell'installazione,
# dall'11-10-2026 un pannello senza utenti è «da abbinare» e non lascia entrare
# nessuno. Sette guardie davano per scontato il mondo di prima («senza utenti
# è aperto») e rispondevano 401 a ogni passo.

GUARDIA_EMAIL="admin@guardia.local"
GUARDIA_PASSWORD="guardia-segreta"

# Il primo amministratore di un **IDE**, col codice monouso che il runtime
# stampa all'avvio. Stampa il token di sessione.
#   $1 = porta admin, $2 = file di log del runtime
primo_amministratore_ide() {
  local codice
  codice=$(grep -oE 'codice: [0-9a-f]{32}' "$2" | head -1 | cut -d' ' -f2)
  [ -n "$codice" ] || { echo "nessun codice di primo accesso in $2" >&2; return 1; }
  curl -sf -o /dev/null -X POST "http://localhost:$1/api/identita/primo-amministratore" \
    -H 'Content-Type: application/json' \
    -d "{\"codice\":\"$codice\",\"email\":\"$GUARDIA_EMAIL\",\"password\":\"$GUARDIA_PASSWORD\"}" \
    || { echo "primo amministratore rifiutato su :$1" >&2; return 1; }
  accedi "$1" "$GUARDIA_EMAIL" "$GUARDIA_PASSWORD"
}

# Abbina un **pannello** col codice di `<config>/abbinamento.json`: nasce il
# suo Admin del dispositivo. Stampa il token di sessione.
#   $1 = porta admin, $2 = cartella --config, $3 = utente, $4 = password
abbina_pannello() {
  local codice
  codice=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["codice"])' \
             "$2/abbinamento.json" 2>/dev/null)
  [ -n "$codice" ] || { echo "nessun codice di abbinamento in $2" >&2; return 1; }
  curl -sf -X POST "http://localhost:$1/api/abbinamento/rivendica" \
    -H 'Content-Type: application/json' \
    -d "{\"codice\":\"$codice\",\"username\":\"$3\",\"password\":\"$4\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' \
    || { echo "abbinamento rifiutato su :$1" >&2; return 1; }
}

# Login. Stampa il token di sessione.
#   $1 = porta admin, $2 = utente, $3 = password
accedi() {
  curl -sf -X POST "http://localhost:$1/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$2\",\"password\":\"$3\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' \
    || { echo "login rifiutato su :$1 per $2" >&2; return 1; }
}
