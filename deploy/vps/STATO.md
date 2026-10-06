# Stato del VPS — sws.soligo.net

> Riepilogo sintetico di com'è configurata questa macchina e perché.
> Si aggiorna a ogni modifica: se leggi questo file e non corrisponde alla realtà, il file ha torto
> ed è un difetto da correggere subito.
> Le decisioni numerate citate qui stanno nel repo SWS, in
> `docs/plans/2026-09-18-identita-utenti-istanze.md`.

## Cos'è questa macchina

VPS OVH (`vps-5ea9b77b.vps.ovh.net`, 37.187.181.142), piano VPS-1: 2 vCore, 3,7 GiB RAM, 40 GB SSD.
Debian 13 (trixie), kernel 6.12, x86_64. Utente `debian`, sudo senza password.

Ospita **l'IDE SWS come servizio**. Non è una macchina di sviluppo e **non ci si compila nulla**:
una `target/` di SWS si mangia i 40 GB da sola. Le immagini si costruiscono altrove e si scaricano
da ghcr.io (decisione 39).

## Nomi

| nome | a cosa serve |
|---|---|
| `sws.soligo.net` | l'IDE, interfaccia web |
| `tunnel.soligo.net` | la connessione uscente dei pannelli |

Tutti e due su Cloudflare **come solo DNS** (nuvola grigia) → 37.187.181.142. Il proxy è spento di
proposito: terminerebbe il TLS vedendo in chiaro i dati d'impianto dei clienti, imporrebbe la sfida
DNS-01 per i certificati, e chiude le connessioni ferme dopo un centinaio di secondi — cioè
taglierebbe un tunnel che per natura sta zitto per ore (decisione 41).

## Fatto finora (06-10-2026)

- **podman 5.4.2**, dai pacchetti di Debian: nessun repository esterno, quindi gli aggiornamenti di
  sicurezza arrivano con quelli del sistema. Scelto perché è lo stesso motore dei pannelli e di
  quello che userà il gateway SWS per avviare un container per progetto — una tecnologia sola da
  conoscere, non due (decisione 40).
- **Senza root**: intervalli UID `100000:65536` per `debian`, già presenti nell'immagine OVH.
  Verificato davvero, non dedotto: dentro il container si è root, fuori si è `debian`.
- **Lingering acceso** (`loginctl enable-linger debian`). Senza, systemd chiude i servizi
  dell'utente quando esce dalla sessione, e i container si spegnerebbero **al logout dall'SSH** —
  un guasto che si manifesta ore dopo, quando nessuno collega più le due cose.

  *Inciampo incontrato, scritto perché non si ripeta*: subito dopo aver acceso il lingering,
  `user@1000.service` risultava **attivo ma vuoto** e `/run/user/1000/bus` non esisteva, quindi
  podman ripiegava su `cgroupfs` lamentandosi di non trovare il bus. Il gestore era partito prima
  di avere un motivo di esistere. Risolto con `sudo systemctl restart user@1000.service`.

- **Porte basse senza root**: `/etc/sysctl.d/99-sws-porte.conf` abbassa
  `net.ipv4.ip_unprivileged_port_start` da 1024 a **80**, così Traefik lega 80 e 443 restando non
  privilegiato. L'alternativa era far girare come root il processo esposto a Internet, cioè mettere
  nella posizione più potente della macchina proprio quello che parla col mondo. Verificato con un
  bind vero, non rileggendo il valore.

- **Traefik v3**, container podman gestito da systemd (quadlet
  `~/.config/containers/systemd/traefik.container`). Comandi:
  `systemctl --user status|restart traefik`, `journalctl --user -u traefik -f`.

  Configurazione in `~/sws-vps/traefik/`, divisa in due di proposito:
  - `traefik.yml` — **statica**, letta solo all'avvio: porte, certificati, provider. Si cambia e si
    riavvia.
  - `dynamic/` — **dinamica**, ricaricata a caldo: un file per servizio, con router e service.
    Aggiungere un servizio non richiede di riavviare il proxy.

  Scelta deliberata: **configurazione a file, non a etichette dei container**. Sta in un posto solo
  e versionabile, e soprattutto Traefik **non** ha accesso al socket dei container — che equivarrebbe
  a dargli i poteri di root, e non si dà a un processo esposto su Internet.

- **Rete `sws-rete`** (quadlet `sws-rete.network`). **Solo Traefik pubblica porte sull'host**; gli
  altri servizi vivono lì dentro e il proxy li raggiunge per nome, via DNS interno di podman. Un
  servizio che non pubblica porte non è raggiungibile da fuori: isolamento per costruzione, non per
  regola di firewall.

- **Certificati Let's Encrypt**, sfida HTTP-01 sulla porta 80 (possibile perché la 80 serve solo a
  reindirizzare — decisione 36). Storage in `acme.json`, permessi 600.

  *Metodo da riusare*: il primo giro è stato fatto contro la **CA di prova** di Let's Encrypt, che
  non ha limiti; solo a catena verificata si è passati alla produzione. Il server vero blocca dopo
  poche richieste fallite in un'ora, e restare bloccati mentre si sta capendo è il modo peggiore di
  perdere tempo. Per tornare alla prova: togli il commento a `caServer` **e svuota `acme.json`**, che
  contiene anche l'account presso la CA.

  Stato al 06-10-2026: certificato di produzione per `sws.soligo.net`, emittente Let's Encrypt YR1,
  scadenza 4 gennaio 2027, rinnovo automatico.

- **Timeout lunghi** già impostati sull'entrypoint `websecure` (`readTimeout`/`writeTimeout` a zero,
  `idleTimeout` un'ora): servono al tunnel dei pannelli, che per natura sta zitto per ore.

- **Intestazioni alias** (`aliasHeadersStrategy: delete` su tutti e due gli entrypoint). Senza,
  un client può mandare `X_Auth_User` sperando che a valle venga letto come `X-Auth-User`, cioè
  falsificare le intestazioni che il proxy gestisce. **Non è teorico qui**: il gateway SWS passerà
  l'identità ai container dei progetti con un'intestazione, quindi quella falla sarebbe un modo per
  entrare nel progetto di un'altra azienda. Scelto `delete` e non `reject` perché toglie
  l'intestazione senza rifiutare la richiesta: neutralizza l'attacco senza rompere un client
  legittimo un po' strano. Il nome esatto dell'opzione è stato chiesto a Traefik
  (`traefik --help | grep -i alias`), non indovinato.

- **Portainer** (quadlet `portainer.container`), GUI sui container. Dati in
  `~/sws-vps/portainer-dati`, in chiaro e copiabili, invece che in un volume anonimo.

  **Non è esposto su Internet**: ascolta solo su `127.0.0.1:9000`, verificato da fuori. Ci si arriva
  con un tunnel SSH dalla propria macchina:
  ```sh
  ssh -L 9000:127.0.0.1:9000 debian@37.187.181.142   # poi http://localhost:9000
  ```
  Una GUI che amministra i container è un bersaglio di prima scelta: su un nome pubblico la sua
  pagina di accesso sarebbe raggiungibile da chiunque, per sempre. Partire chiusi e aprire dopo è
  più facile del contrario — bastano un record DNS e un router.

  *Al primo avvio* Portainer vuole che si crei l'amministratore entro pochi minuti, altrimenti si
  blocca: `systemctl --user restart portainer` e la finestra riparte.

- **Socket di podman** acceso (`systemctl --user enable --now podman.socket`), montato in Portainer
  come `/var/run/docker.sock`. Va saputo: **chi controlla quel socket controlla la macchina** — può
  avviare un container privilegiato e uscirne. È inevitabile per uno strumento che gestisce
  container, ed è il motivo per cui a **Traefik quel socket non è stato dato**.

- **`whoami` rimosso**: era il servizio usa e getta che ha dimostrato instradamento e certificati.
  Da quando è sparito, `https://sws.soligo.net` risponde **404** — ed è lo stato giusto: il TLS
  funziona, ma nessun router serve quel nome finché non ci arriva l'IDE.

## Sicurezza dell'accesso (06-10-2026)

Trovato guardando, non sospettato: la macchina riceveva **22 063 tentativi di accesso falliti in
24 ore** — rumore di fondo di Internet, lo subisce qualunque IP pubblico — **e le password erano
attive**, con una password impostata per `debian`. Quindi quel rumore stava davvero provando a
entrare, invece di rimbalzare.

L'inganno da conoscere: `/etc/ssh/sshd_config` diceva `PasswordAuthentication no`, ma
`/etc/ssh/sshd_config.d/50-cloud-init.conf` diceva `yes` — **e vince quello**. Correggere il file
principale avrebbe dato l'illusione di aver risolto. Il valore vero si legge con `sudo sshd -T`,
mai dai file.

- **Password spente**, nel file di cloud-init (quello che vince). Verificato nei due versi: con la
  chiave si entra, con la password «Permission denied (publickey)».
- **L'ordine conta**: prima la chiave del maintainer sul VPS, poi la chiusura. Non si chiude una
  porta restando fuori — prima c'era una sola chiave autorizzata, quella del dev server in ufficio.
- **Prima di ricaricare**: `sudo sshd -t` valida la sintassi. Un errore lì, su una macchina
  raggiungibile solo via SSH, significa console di emergenza. E `reload`, non `restart`: le
  connessioni aperte sopravvivono e restano la rete di sicurezza.

- **Firewall `ufw`**: `deny` in ingresso, aperte solo **22, 80, 443** (IPv4 e IPv6). Scelto `ufw` e
  non nftables grezzo perché `ufw status` si legge in tre righe.
  *Accortezza*: le regole di permesso **prima** dell'accensione. `ufw enable` con la 22 non ancora
  permessa taglia la connessione con cui lo stai dando.
  Verificato da fuori: 22, 80 e 443 rispondono; 9000 e 8000 (porte di Portainer) sono chiuse.

- **`fail2ban`** con `backend = systemd` (Debian 13 tiene i log nel journal) e `banaction = ufw`,
  così i blocchi si vedono in `ufw status` e non in un posto separato. Tre fallimenti in dieci
  minuti → un'ora di blocco.
  *Cosa aggiunge davvero*: con le password spente quegli attacchi non possono riuscire. Serve a non
  sprecare CPU per 22.000 connessioni al giorno, a **tenere i log leggibili** — con quel rumore, il
  giorno che cercherai chi si è collegato davvero non lo troverai — e a coprire i servizi futuri che
  avranno una loro pagina di accesso. Nei primi otto secondi aveva già bloccato un indirizzo.

## Da fare

- [ ] **Aggiornamenti automatici**: `unattended-upgrades` per il sistema e
      `podman-auto-update.timer` per le immagini (i quadlet hanno già `AutoUpdate=registry`).
- [ ] **Copia di sicurezza** di `~/sws-vps/` (configurazione, `acme.json`, dati di Portainer) fuori
      dalla macchina. L'istantanea giornaliera di OVH copia il disco, non è un dump da cui ripartire.
- [x] ~~Aggiornamenti automatici~~ — fatti, vedi sopra.
- [x] ~~Copia di sicurezza~~ — fatta, vedi sopra: configurazione in git, stato in archivio datato.
- [ ] **Relay SMTP sulla 587**: OVH blocca la 25 in uscita, e senza relay le email di verifica della
      registrazione non partono o finiscono nello spam.
- [ ] **Immagine amd64** di `sws-runtime` su ghcr: oggi la CI la costruisce solo come build di
      sviluppo, e il gateway su questa macchina avrà bisogno di quella.
- [ ] **Il gateway SWS**: Fase 4 del piano del tronco cloud. Fino ad allora `sws.soligo.net` resta
      un 404 con un certificato valido, che è lo stato corretto.

## Decisioni prese, non dimenticanze (06-10-2026)

Queste due cose **non** sono nell'elenco di cosa manca, perché sono state guardate e decise.

- **La password dell'utente `debian` resta impostata.** Per SSH non serve più (si entra solo con
  chiave, verificato), ma il maintainer la tiene. Conseguenza da conoscere: se un domani si
  riaccendesse l'autenticazione a password — per esempio un aggiornamento di cloud-init che
  riscrive `50-cloud-init.conf` — quella password tornerebbe utilizzabile. Vale la pena ricontrollare
  `sudo sshd -T | grep -i passwordauthentication` dopo aggiornamenti grossi del sistema.
- **Il database di Portainer resta in chiaro**, in `~/sws-vps/portainer-dati`. Si cifra più avanti:
  la cifratura vuole un file di chiave, che diventa una cosa in più da custodire e da ricordare in
  un ripristino. Nel frattempo quei dati finiscono nell'archivio datato, quindi **l'archivio
  contiene credenziali** e va trattato come tale.

## Come si verifica che la base è a posto

```sh
podman info --format "{{.Host.CgroupManager}} rootless={{.Host.Security.Rootless}}"
#   atteso: systemd rootless=true

loginctl show-user debian | grep Linger
#   atteso: Linger=yes

ss -tlnp | grep -E ":80 |:443 "
#   dice chi ascolta davvero, che non sempre è chi credi

curl -s -o /dev/null -w "%{http_code} tls=%{ssl_verify_result}\n" https://sws.soligo.net/
#   atteso: 200 tls=0   (0 = certificato verificato)

systemctl --user --no-pager list-units "*.service" | grep -E "traefik|portainer"
#   quali servizi girano davvero

sudo sshd -T | grep -i passwordauthentication     # atteso: no  (i FILE possono mentire)
sudo ufw status verbose                            # cosa e' aperto davvero
sudo fail2ban-client status sshd                   # quanti indirizzi bloccati
```
