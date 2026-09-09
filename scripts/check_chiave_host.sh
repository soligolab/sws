#!/usr/bin/env bash
#
# Il factory reset di un pannello non deve bloccare il deploy senza spiegazioni.
#
# Perché esiste: dopo un factory reset il dispositivo rigenera le chiavi host e
# ssh si rifiuta di collegarsi — giustamente, perché non può distinguere quel
# caso da un attacco. Il deploy dell'editor però finiva con «ERROR: ssh fallito
# (exit 255)», con la riga utile sepolta quindici righe più su nello stderr di
# ssh: il maintainer ci è inciampato due volte nello stesso giorno (2026-09-07).
#
# Ora il backend riconosce il caso e la UI offre un pulsante. La rimozione
# NON è automatica e non deve diventarlo: `StrictHostKeyChecking=no`
# spegnerebbe per sempre la protezione, questo endpoint la spegne una volta,
# per un host, su richiesta esplicita di una persona. Qui si prova che tolga
# quello che deve, che lasci il resto, e che non si faccia infilare un host
# malevolo (finisce in `ssh-keygen -R`).
#
# E si sorveglia il codice, non solo il comportamento: `StrictHostKeyChecking=no`
# non deve tornare. È la parte che si dimentica — il pulsante è stato scritto il
# 2026-09-07 mentre l'opzione restava in sedici invocazioni ssh, e con quella
# attiva il pulsante non sarebbe quasi mai comparso: `no` lascia PASSARE una
# chiave cambiata, disabilitando solo l'auth a password e non quella a chiave.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_chiave_host.sh
#
# Runtime scratch dichiarato (porta 8669, HOME finta in dir temporanea:
# NON tocca il known_hosts di chi lancia), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-chiavehost.$$"
APORT="${APORT:-8669}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects,.ssh}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

# Un known_hosts finto: il pannello (in chiaro e con porta), più un host che
# non c'entra e che deve sopravvivere.
KH="$WORK/.ssh/known_hosts"
cat > "$KH" <<'EOF'
tc620-prova.local ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFAKE1
tc620-prova.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE2
[tc620-prova.local]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE3
altro-dispositivo.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE4
EOF

echo "== l'opzione che vanificherebbe tutto non deve tornare nel codice =="
STATICI_ROSSI=0
# Si cercano le INVOCAZIONI, non le citazioni: la forma con le virgolette
# (`"StrictHostKeyChecking=no"` in Rust/TS) o preceduta da `-o` nello shell.
# Nominarla in un commento o in questa guardia deve restare lecito — altrimenti
# la regola vieterebbe di spiegare perché la regola esiste.
if colpe="$(grep -rnE '"StrictHostKeyChecking=no"|-o[= ]StrictHostKeyChecking=no' \
        "$REPO/sws-runtime/crates" "$REPO/sws-editor/src" "$REPO/scripts" \
        --include='*.rs' --include='*.ts' --include='*.tsx' --include='*.sh' \
        --exclude='check_chiave_host.sh' 2>/dev/null)"; then
    echo "  ✗ StrictHostKeyChecking=no è tornato:"
    echo "$colpe" | sed 's|^|      |'
    echo "      Va usato accept-new: accetta un dispositivo mai visto, RIFIUTA"
    echo "      un host la cui chiave è cambiata. Con «no» il deploy prosegue in"
    echo "      silenzio verso una macchina non verificata quando l'accesso è a"
    echo "      chiave — vedi run_ssh_cmd_stdin in packaging.rs e HOWTO.md §9."
    STATICI_ROSSI=1
else
    echo "  ✓ nessun StrictHostKeyChecking=no nel codice"
fi
n_an="$(grep -rc 'StrictHostKeyChecking=accept-new' "$REPO/sws-runtime/crates/sws-web/src/packaging.rs" || echo 0)"

# ── 2026-09-09: la password non va su argv, e user@host va controllato ───────
#
# `sshpass -p <password>` mette la password in chiaro in `ps aux` e in
# /proc/<pid>/cmdline per tutta la durata di scp/ssh, leggibile da qualunque
# utente della macchina dell'editor. Con `-e` la legge da SSHPASS nell'ambiente,
# che vede solo lo stesso uid (o root).
if grep -rnE 'sshpass"?\)?\s*\.?\s*(args\(\[)?\s*"-p"|vec!\["-p", password' \
        "$REPO/sws-runtime/crates/sws-web/src" --include='*.rs' >/tmp/sshpass_p.$$ 2>/dev/null \
   && [ -s /tmp/sshpass_p.$$ ]; then
    echo "  ✗ sshpass con la password su argv:"
    sed 's|^|      |' /tmp/sshpass_p.$$
    echo "      Usa -e con SSHPASS nell'ambiente: con -p la password si legge in ps aux."
    STATICI_ROSSI=1
else
    echo "  ✓ sshpass non riceve la password su argv"
fi
rm -f /tmp/sshpass_p.$$

# `{user}@{host}` è un argomento POSIZIONALE di ssh: se comincia per `-` diventa
# un'opzione, e `-oProxyCommand=…` è un comando eseguito su questa macchina.
# Ogni handler che fa ssh deve passare da `destinazione_ssh_sicura`. Sono
# quattro (deploy_device, deploy_device_container, manage_device_container in
# packaging.rs; deploy_remote in deploy.rs): se il conteggio scende, uno è
# rimasto scoperto.
n_dest="$(grep -rhc 'destinazione_ssh_sicura(&' "$REPO/sws-runtime/crates/sws-web/src/packaging.rs" "$REPO/sws-runtime/crates/sws-web/src/deploy.rs" | awk '{s+=$1} END{print s+0}')"
n_ssh="$(grep -rhcE '^pub async fn (deploy_device|deploy_device_container|manage_device_container|deploy_remote)\(' "$REPO/sws-runtime/crates/sws-web/src/packaging.rs" "$REPO/sws-runtime/crates/sws-web/src/deploy.rs" | awk '{s+=$1} END{print s+0}')"
if [ "$n_dest" -ge "$n_ssh" ] && [ "$n_ssh" -ge 4 ]; then
    echo "  ✓ ogni handler che fa ssh controlla user@host ($n_dest controlli, $n_ssh handler)"
else
    echo "  ✗ handler ssh: $n_ssh, controlli su user@host: $n_dest — uno è scoperto"
    echo "      Un utente o host che comincia per '-' diventa un'opzione di ssh."
    STATICI_ROSSI=1
fi
if [ "$n_an" -gt 0 ]; then
    echo "  ✓ il deploy usa accept-new ($n_an occorrenze in packaging.rs)"
else
    echo "  ✗ packaging.rs non passa StrictHostKeyChecking: il primo deploy verso un"
    echo "    dispositivo mai visto resterebbe appeso a una domanda che nessuno legge."
    STATICI_ROSSI=1
fi

# HOME finta: l'endpoint legge $HOME/.ssh/known_hosts, e non vogliamo che una
# guardia tocchi il file vero di chi la lancia.
HOME="$WORK" "$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

ROSSI=$STATICI_ROSSI
caso() { # caso <descrizione> <atteso> <ricevuto>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — atteso «$2», ricevuto «$3»"; ROSSI=$((ROSSI+1)); fi
}
chiama() { curl -s -o "$WORK/out" -w '%{http_code}' -X POST \
  "http://localhost:$APORT/api/device/hostkey/forget" \
  -H 'Content-Type: application/json' -d "$1"; }

echo "== un host che finisce in ssh-keygen -R non si accetta a scatola chiusa =="
caso "trattino iniziale (diventerebbe un'opzione) → 400" 400 "$(chiama '{"host":"-oProxyCommand=x"}')"
caso "punto e virgola → 400"                             400 "$(chiama '{"host":"h;rm -rf /"}')"
caso "barra → 400"                                       400 "$(chiama '{"host":"a/b"}')"
caso "vuoto → 400"                                       400 "$(chiama '{"host":""}')"

echo "== un host senza chiavi memorizzate lo dice, invece di fingere =="
st="$(chiama '{"host":"mai-visto.local"}')"
caso "200" 200 "$st"
grep -q "nessuna chiave memorizzata" "$WORK/out" \
  && echo "  ✓ lo dichiara invece di dire «fatto»" \
  || { echo "  ✗ risposta: $(cat "$WORK/out")"; ROSSI=$((ROSSI+1)); }

echo "== il caso vero: il pannello resettato =="
st="$(chiama '{"host":"tc620-prova.local","port":2222}')"
caso "200" 200 "$st"
caso "nessuna riga del pannello è rimasta" 0 "$(grep -c "tc620-prova" "$KH" || true)"
caso "l'host che non c'entra è intatto"    1 "$(grep -c "altro-dispositivo" "$KH" || true)"
[ -f "$KH.old" ] && echo "  ✓ l'originale resta in known_hosts.old" \
                 || { echo "  ✗ nessun backup"; ROSSI=$((ROSSI+1)); }
grep -q "device.hostkey_forget" <(curl -s "http://localhost:$APORT/api/audit") \
  && echo "  ✓ la rimozione è nell'audit" \
  || { echo "  ✗ non risulta nell'audit"; ROSSI=$((ROSSI+1)); }

echo "== Q49: il certificato TLS del dispositivo si dimentica solo su richiesta =="
# L'archivio vive accanto alla configurazione, come known_hosts per ssh.
ARCH="$WORK/config/dispositivi_conosciuti.yaml"
cat > "$ARCH" <<'EOF'
tc620-prova.local:8444:
  impronta: sha256:aaaa
  visto_il_ms: 1
tc620-prova.local:8443:
  impronta: sha256:bbbb
  visto_il_ms: 1
altro-dispositivo.local:8444:
  impronta: sha256:cccc
  visto_il_ms: 1
EOF
chiama_cert() { curl -s -o "$WORK/out" -w '%{http_code}' -X POST \
  "http://localhost:$APORT/api/device/cert/forget" \
  -H 'Content-Type: application/json' -d "$1"; }
caso "host che sarebbe un'opzione → 400" 400 "$(chiama_cert '{"host":"-oProxyCommand=x"}')"
caso "host vuoto → 400"                  400 "$(chiama_cert '{"host":""}')"
st="$(chiama_cert '{"host":"mai-visto.local"}')"
caso "host mai visto → 200" 200 "$st"
grep -q "nessun certificato memorizzato" "$WORK/out" \
  && echo "  ✓ lo dichiara invece di dire «fatto»" \
  || { echo "  ✗ risposta: $(cat "$WORK/out")"; ROSSI=$((ROSSI+1)); }
st="$(chiama_cert '{"host":"tc620-prova.local"}')"
caso "il pannello resettato → 200" 200 "$st"
caso "tolte entrambe le porte di quell'host" 0 "$(grep -c "tc620-prova" "$ARCH" || true)"
caso "l'altro dispositivo è intatto"         1 "$(grep -c "altro-dispositivo" "$ARCH" || true)"
grep -q "device.cert_forget" <(curl -s "http://localhost:$APORT/api/audit") \
  && echo "  ✓ la rimozione è nell'audit" \
  || { echo "  ✗ non risulta nell'audit"; ROSSI=$((ROSSI+1)); }

[ "$ROSSI" -gt 0 ] && { echo "FALLITO — $ROSSI controlli rossi"; exit 1; }
echo "chiave host e certificati: tutto verde."
