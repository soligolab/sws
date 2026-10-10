# `deploy/vps` — la macchina che ospita l'IDE come servizio

Configurazione del VPS su cui gira `sws.soligo.net`. **Questi file sono la copia maestra**: si
modificano qui, si committano, e poi si copiano sulla macchina — non il contrario. Quello che sta
sul server e non sta qui, al prossimo reinstallo è perduto.

Non ci sono segreti in questa cartella, ed è una proprietà da mantenere: `acme.json` (chiave privata
dei certificati) e il database di Portainer (credenziali) **restano sulla macchina** e si salvano
con `salva-stato.sh`, che ne fa un archivio datato.

Lo stato corrente della macchina, con il perché di ogni scelta e gli inciampi incontrati, sta in
[`STATO.md`](STATO.md) — copia maestra anche quella, da tenere allineata a `~/sws-vps/STATO.md`.

## Cosa c'è

| | |
|---|---|
| `traefik/traefik.yml` | configurazione **statica**: porte, certificati, provider. Letta solo all'avvio |
| `traefik/dynamic/` | configurazione **dinamica**: router e service, ricaricata a caldo |
| `quadlet/*.container`, `*.network` | i servizi come unità systemd utente (podman) |
| `sistema/99-sws-porte.conf` | `→ /etc/sysctl.d/`, abbassa la soglia delle porte privilegiate a 80 |
| `sistema/fail2ban-jail.local` | `→ /etc/fail2ban/jail.local` |
| `sistema/20auto-upgrades` | `→ /etc/apt/apt.conf.d/` |
| `sistema/salva-stato.*` | `→ ~/.config/systemd/user/`, archivio giornaliero dello stato |
| `salva-stato.sh` | `→ ~/sws-vps/`, lo script che l'unità esegue |

## Da una macchina nuova a questa

Presuppone una **VM** (non un container LXC: podman annidato vuole un kernel suo) con Debian 13 e
un utente non root con `sudo`.

```sh
# 1. DNS prima di tutto: il nome deve risolvere all'IP della macchina, altrimenti
#    Let's Encrypt non può verificare nulla e si perde tempo a capire perché.

# 2. Accesso: la propria chiave PRIMA di chiudere le password, mai dopo.
#    (Sulle immagini OVH le password sono attive via /etc/ssh/sshd_config.d/50-cloud-init.conf,
#     che VINCE su sshd_config. Il valore vero si legge con `sudo sshd -T`, mai dai file.)
ssh-copy-id debian@<ip>
sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' \
     /etc/ssh/sshd_config.d/50-cloud-init.conf
sudo sshd -t && sudo systemctl reload ssh      # validare PRIMA di ricaricare

# 3. Firewall: i permessi PRIMA dell'accensione, o si taglia la propria connessione.
sudo apt install -y ufw
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

# 4. podman e il suo contorno
sudo apt install -y podman fail2ban unattended-upgrades
sudo loginctl enable-linger $USER
sudo systemctl restart user@$(id -u).service   # vedi STATO.md: senza, il bus utente resta assente
systemctl --user enable --now podman.socket podman-auto-update.timer

# 5. i file di sistema
sudo cp sistema/99-sws-porte.conf   /etc/sysctl.d/   && sudo sysctl --system
sudo cp sistema/fail2ban-jail.local /etc/fail2ban/jail.local && sudo systemctl restart fail2ban
sudo cp sistema/20auto-upgrades     /etc/apt/apt.conf.d/

# 6. i servizi
mkdir -p ~/sws-vps/traefik/dynamic ~/sws-vps/portainer-dati ~/sws-vps/archivi \
         ~/.config/containers/systemd ~/.config/systemd/user
cp -r traefik/*            ~/sws-vps/traefik/
cp    salva-stato.sh       ~/sws-vps/           && chmod 700 ~/sws-vps/salva-stato.sh
cp    quadlet/*            ~/.config/containers/systemd/
cp    sistema/salva-stato.* ~/.config/systemd/user/
touch ~/sws-vps/traefik/acme.json && chmod 600 ~/sws-vps/traefik/acme.json
systemctl --user daemon-reload
systemctl --user start traefik portainer
systemctl --user enable --now salva-stato.timer
```

**Al primo giro, lasciare la CA di prova** di Let's Encrypt (la riga `caServer` in `traefik.yml`):
il server di produzione blocca dopo poche richieste fallite in un'ora, e restare bloccati mentre si
sta capendo è il modo peggiore di perdere tempo. A catena verificata, commentare quella riga **e
svuotare `acme.json`** — che contiene anche l'account presso la CA, non solo i certificati.

## Entrare nel VPS da una macchina nuova

**Le password sono spente** (`sudo sshd -T | grep -i passwordauthentication` → `no`): si entra
solo con una chiave già autorizzata. Questo ha una conseguenza che morde al momento sbagliato —
**una macchina nuova non può autorizzarsi da sola**. `ssh-copy-id` chiede la password, e la
password non c'è.

Quindi la chiave di una macchina nuova si aggiunge **da una macchina che entra già**, prima di
averne bisogno. Chi autorizza al 10-10-2026:

```sh
ssh debian@37.187.181.142 'ssh-keygen -lf ~/.ssh/authorized_keys'
#   edp@pixsys.net                       → il dev server in ufficio (theobroma)
#   ut1@windows per sws-vps              → la macchina Windows del maintainer
#   max_xxv@ufficio (casa) per sws-vps   → il PC di casa (host `ufficio`), dal 10-10-2026
```

**L'impronta del server**, da confrontare la prima volta che una macchina si collega (non accettarla alla
cieca: è l'unico momento in cui ci si accorge di parlare con la macchina sbagliata):

```text
ED25519  SHA256:PHO5hgDqiacWPMvFn/78GWwPjhb4gqS4DkMZZ6+kmfc
ECDSA    SHA256:1A5CmGxUWXZnO1CGZef6oDXBs+aVWZkdLogoNHHYYuQ
RSA      SHA256:pMhhuj+afI0mg3c7pj7lKOKOHW0rguQF7gDPGGn/7Nw
```

Sul server: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.

### Aggiungere una macchina

Sulla macchina nuova, prendere (o creare) la chiave pubblica:

```sh
ls ~/.ssh/id_*.pub || ssh-keygen -t ed25519 -C "$(whoami)@$(hostname) per sws-vps"
cat ~/.ssh/id_ed25519.pub
```

Da una macchina **che entra già**, aggiungerla:

```sh
ssh debian@37.187.181.142 "echo 'ssh-ed25519 AAAA… commento' >> ~/.ssh/authorized_keys"
```

Poi, sulla macchina nuova, un alias che usi **solo** quella chiave — **fail2ban banna dopo pochi
tentativi falliti**, e un client che prova una dopo l'altra tutte le chiavi di `~/.ssh` se li gioca
da solo. Visto il 10-10-2026 dal PC di casa: due chiavi rifiutate, e dalla terza il server chiudeva
la connessione prima ancora di provarla (ban per qualche minuto).

```text
# ~/.ssh/config
Host sws-vps
    HostName 37.187.181.142
    User debian
    IdentityFile ~/.ssh/id_ed25519_sws      # la chiave autorizzata, quale che sia sulla macchina
    IdentitiesOnly yes
```

E **verificare prima di averne bisogno**:

```sh
ssh -o PasswordAuthentication=no debian@37.187.181.142 'hostname; echo accesso ok'
```

Il `-o PasswordAuthentication=no` non è pignoleria: senza, un fallimento della chiave si
trasforma in una richiesta di password che non arriverà mai da nessuna parte, e si perde tempo a
guardare il prompt sbagliato.

### Se si resta fuori lo stesso

Resta la **console KVM di OVH** dal pannello cliente: dà una tastiera sulla macchina come se si
fosse davanti, senza passare da SSH. Da lì si aggiunge la chiave a mano. È lenta e scomoda, ed è
esattamente il motivo per cui conviene autorizzare la macchina nuova *prima* di partire.

## Verifiche

```sh
sudo sshd -T | grep -i passwordauthentication    # no   (i FILE possono mentire)
sudo ufw status verbose                           # 22, 80, 443 e nient'altro
podman info --format "{{.Host.CgroupManager}}"    # systemd (non cgroupfs)
curl -s -o /dev/null -w "%{http_code} tls=%{ssl_verify_result}\n" https://sws.soligo.net/
```

Dal 09-10-2026 l'ultimo comando dà `404 tls=0` **con dentro l'IDE**: lo stato 404 è come risponde
ogni istanza SWS sulla radice (vedi `STATO.md`), non un router mancante. Per una verifica che dia
200 netto, usare `/health`.

## Quello che qui non c'è ancora

L'**abbinamento dei pannelli** col codice mostrato sullo schermo: oggi un pannello si dichiara a
mano in `~/sws-vps/gateway-config/pannelli.yaml` (che **contiene segreti** e non sta in questa
cartella).

Il **gateway SWS** c'è dal 09-10-2026, e il **tunnel dei pannelli** dal 10-10: `quadlet/sws-gateway.container` e
`traefik/dynamic/sws-gateway.yml`. Il perché di ogni scelta sta in [`STATO.md`](STATO.md), sezione
«Il gateway SWS». In breve: serve anche `mkdir -p ~/sws-vps/progetti ~/sws-vps/gateway-config`
prima di avviarlo, e il codice di primo accesso si legge con
`journalctl --user -u sws-gateway`. Per i pannelli vedi «Il tunnel dei pannelli» in `STATO.md` e
il capitolo 24 di `docs/HOWTO.md`.
