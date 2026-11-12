# Stato del VPS — sws.soligo.net

> Riepilogo sintetico di com'è configurata questa macchina e perché.
> Si aggiorna a ogni modifica: se leggi questo file e non corrisponde alla realtà, il file ha torto
> ed è un difetto da correggere subito.
> Le decisioni numerate citate qui stanno nel repo SWS, in
> `docs/archive/2026-09-18-identita-utenti-istanze.md`.

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

## Il gateway SWS (09-10-2026)

`sws.soligo.net` **non è più un 404**: ci risponde il gateway, che serve l'IDE e mette ogni
progetto aperto nel suo container.

| | |
|---|---|
| unità | `sws-gateway.service` (quadlet `~/.config/containers/systemd/sws-gateway.container`) |
| immagine | `ghcr.io/soligolab/sws-runtime:1599b500-amd64`, inchiodata al commit (dal 10-10 sera: chiave di ritorno) |
| router | `~/sws-vps/traefik/dynamic/sws-gateway.yml` → `http://sws-gateway:8444` |
| progetti | `~/sws-vps/progetti` |
| configurazione | `~/sws-vps/gateway-config` (ci stanno `identita.db` e il segreto del gateway) |

**Perché il quadlet è fatto così.** Tre cose che non si indovinano, e sono scritte anche dentro al
file:

1. **Il socket di podman è montato in `/run/sws/`, non in `/run/user/1000/`.** Il gateway avvia un
   container per ogni progetto, quindi gli serve — e chi controlla quel socket controlla la
   macchina, lo stesso motivo per cui a Traefik non è stato dato. Qui è il mestiere del processo.
   Dentro il container si è uid 0, quindi `/run/user/1000/...` non è il percorso che il programma
   cercherebbe: si monta altrove e si dichiara `XDG_RUNTIME_DIR`.
2. **I progetti stanno allo stesso percorso dentro e fuori** (`/home/debian/sws-vps/progetti` in
   tutti e due i lati). Il gateway controlla che la cartella del progetto esista — controllo fatto
   *dentro* — poi passa quel percorso a podman come sorgente del bind mount del figlio, e podman lo
   risolve *fuori*. Con due percorsi diversi il controllo passa e il container del progetto parte
   vuoto.
3. **Nessuna porta pubblicata, né dal gateway né dai figli.** Traefik raggiunge il gateway per nome
   su `sws-rete`; il gateway raggiunge i figli **per IP** sulla stessa rete. Dall'esterno della
   macchina un progetto non esiste.

**Il TLS lo termina Traefik.** Da lì in poi si parla HTTP dentro `sws-rete`, che non esce dalla
macchina: il runtime accende il TLS da sé solo se trova `tls.crt` nella sua cartella di
configurazione, e lì non c'è apposta. Due terminazioni in fila non aggiungerebbero niente e
toglierebbero il certificato valido di Let's Encrypt.

**Provato il 09-10-2026**, da fuori e da dentro:

```
https://sws.soligo.net/health            → 200
https://sws.soligo.net/api/identita/stato → {"gateway":true,…}
http://sws.soligo.net/                    → 301 verso https
un container di progetto su sws-rete, chiamato dalla rete:
    senza il segreto del gateway          → 401
    con il segreto                        → 200
```

**`https://sws.soligo.net/` risponde 200 con dentro l'IDE**, dalla 2.23.6. Prima rispondeva 404
con la pagina dentro, perché `ServeDir` serviva il guscio della SPA come risposta «non trovato».
Ora una rotta della SPA (una richiesta di navigazione) ha 200, mentre un file davvero mancante
resta 404: così un bundle che manca non torna come HTML con stato 200.

**Il manuale pubblico** (12-11-2026): `sws-manuale` (nginx 1.27.3-alpine, sola lettura) dietro Traefik su
`/manuale/` e `/robots.txt`, 28 pagine; GPTBot e gli altri crawler IA ricevono 403. nginx vede l'indirizzo di Traefik
(`10.89.0.x`): il limite di 20 richieste/s vale per tutti insieme finché non c'è l'indirizzo vero (seme «indirizzo vero
dietro Traefik»). Si aggiorna con `scripts/manuale/pubblica.sh`.

**Versione in esecuzione: `671f67fd-amd64` (2.26.0-rc.16)** dal 12-11-2026 sera: «mai ricevuto» sui due motori,
segnaposto `{{sys:…}}`, battito su `/ws/tags`, «Commuta» su ON/OFF, manuale pubblico. Stessa sequenza della rc.15 (copia
del quadlet `.prima-rc16-2026-11-12`, `podman pull`, `sed` del sha in `Image=` e `--gateway-immagine`, `scp`,
`daemon-reload`, `restart sws-gateway`). Verificato: gateway `healthy`, radice 200, quadlet uguale al repo (`md5sum`).
Ripiego `100b952c-amd64` (rc.15).

Prima: **Versione in esecuzione: `100b952c-amd64` (2.26.0-rc.15)** dal 12-11-2026 mattina: «Aggiorna ora» staccato dalla
richiesta, parità LVGL (due giri), comandi critici su LVGL, zip 9, «Disabilita TLS», le etichette vecchie fuori
dall'immagine. La rc.14 è solo un tag, mai costruita. Stessa sequenza della rc.13; nessun progetto aperto. Verificato:
gateway `healthy`, radice 200, copia del quadlet uguale al repo (`md5sum`). Ripiego `125cec0f-amd64` (rc.13); tolta la
rc.12.

Prima: **Versione in esecuzione: `125cec0f-amd64` (2.26.0-rc.13)** dal 11-11-2026 sera: le anomalie del collaudo della rc.12
(assistente con finestre e testi, pallino di qualità, chat staccata), script Python più leggeri, la chat che pensa,
selezione e gruppi sul canvas, Ctrl+G. Sequenza: copia del quadlet (`.prima-rc13-…`), `podman pull`, `sed` del sha
(`Image=` e `--gateway-immagine` insieme), `daemon-reload`, `restart sws-gateway`; nessun container di progetto
attivo. Verificato: gateway `healthy`, radice 200, copia del quadlet uguale al repo (`md5sum`). Ripiego
`847ccd3f-amd64` (rc.12); tolta la rc.11 `e5f58031-amd64`.

Prima: **Versione in esecuzione: `847ccd3f-amd64` (2.26.0-rc.12)** dal 10-11-2026 sera (gateway riavviato alle 21:16 UTC): le
correzioni del collaudo della rc.11 (banco della chat per conversazione, foto della pagina col motore del progetto e
viewer LVGL nell'immagine x86_64 — +28 MB, fasce della cornice, viewer e IDE che aspettano il runtime, anteprima delle
foto), il cron nell'ora del pannello, la posta per azienda, la licenza doppia. Stessa sequenza della rc.11 (pull, `scp`
del quadlet, `daemon-reload`, restart). Verificato: gateway e Montagna `healthy`, radice 200, tunnel di `tc620-garage`
riaperto (il WP630 a quell'ora è spento), `check_gateway_immagine.sh` verde. Ripiego `e5f58031-amd64` (rc.11); tolta la
`be8066eb-amd64` (rc.10); disco 12 GB usati, con le copie giornaliere dei dati.

Prima: **Versione in esecuzione: `e5f58031-amd64` (2.26.0-rc.11)** dal 10-11-2026, 10:10 (09:10 UTC nel journal): la rc.10 più
«Aggiorna ora» che non parte due volte (il runtime prenota l'aggiornamento e risponde 409 al secondo clic) e `rusqlite` 0.41.
Quadlet aggiornato da `deploy/vps/quadlet/` (`Image=` e `--gateway-immagine` insieme), copia sul server identica al repo
prima e dopo (`md5sum`). Sequenza: `podman pull` dell'immagine, `scp` del quadlet, `systemctl --user daemon-reload`,
`systemctl --user restart sws-gateway.service`. Verificato: gateway `healthy` in 45 s, radice 200, il gateway ha rifatto
da sé il container di CasaDomotica sulla stessa immagine («container di progetto su un'immagine vecchia: lo rifaccio»),
tunnel di `tc620-garage` e `wp630-ufficio` riaperti da soli in un secondo, `check_gateway_immagine.sh` verde. Tenuta come
ripiego la `be8066eb-amd64` (rc.10); tolta la `17ae0a1f-amd64` (rc.9); disco a 8,9 GB usati.

Prima: **Versione in esecuzione: `be8066eb-amd64` (2.26.0-rc.10)** dal 09-11-2026, 20:42: il viewer leggero (mini tendenze
a secchielli, ridisegno mirato, valori una volta per fotogramma), la fascia «Dati in ritardo», le attese del login,
l'occhio sui campi password. Quadlet aggiornato da `deploy/vps/quadlet/` (`Image=` e `--gateway-immagine` insieme),
dopo un `diff` con la copia sul server, che era uguale alla rc.9. Verificato: gateway `healthy`, radice 200, tunnel di
`tc620-garage` riaperto da solo, `check_gateway_immagine.sh` verde. Tenuta come ripiego la `17ae0a1f-amd64` (rc.9);
tolte la `288b6e4e-amd64` (rc.8) e la `2.25.1-amd64`; disco a 9,0 GB usati.

Fra il 06-11 e il 08-11-2026 il VPS ha seguito le `2.26.0-rc.2` … `rc.9` (`f4627806`, `57af9904`, `288b305e`,
`9a7fcd98`, `fb36fa4f`, `288b6e4e`, `17ae0a1f`): i passaggi stanno in `STATUS.md` del repo, qui non erano stati
annotati.

Prima: **Versione in esecuzione: `2.25.1-amd64`** dal 05-11-2026, 08:20: le anomalie del collaudo 2.25.0 (chat e registro in
una finestra a parte che nel cloud parlano col progetto, menù di pagina col nome tradotto), le regole R6/R7/R8 su tutti
i template, il lucchetto col ruolo che serve. Quadlet, `identita.db` e `audit.jsonl` di prima in
`~/sws-vps/backup-prima-di-2.25.1/`; immagine scaricata prima del riavvio (ID `01e4377d94c3`, lo stesso costruito su
theobroma). Verificato: gateway `healthy` sulla 2.25.1 (log «SWS runtime starting, version 2.25.1»), radice, `/health`
e `/api/identita/stato` 200, tunnel di `tc620-garage` riaperto da solo. Tenuta come ripiego la `2.25.0-amd64`, tolta
la `2.24.1-amd64`; disco a 8,9 GB usati.

Prima: **Versione in esecuzione: `2.25.0-amd64`** dal 04-11-2026, 16:50: l'assistente IA che disegna i simboli e compone il
sinottico, il menù IA con un modello per scopo, gli sfondi in due passi, le foto negli `image` anche su LVGL, il template
«Montagna — fotovoltaico e idroelettrico». Quadlet, `identita.db` e `audit.jsonl` di prima in
`~/sws-vps/backup-prima-di-2.25.0/`; immagine scaricata prima del riavvio. Verificato: gateway `healthy` sulla 2.25.0
(log «SWS runtime starting, version 2.25.0»), radice, `/health` e `/api/identita/stato` 200, tunnel di `wp630-ufficio` e
`tc620-garage` riaperti da soli, `montagna-rinnovabile` fra i template del container. Tenuta come ripiego la
`2.24.1-amd64`, tolta la `2.24.0-amd64`; disco a 8,9 GB usati.

Prima: **Versione in esecuzione: `2.24.1-amd64`** dal 02-11-2026 sera: la release di correzioni dopo la 2.24.0. Quadlet di prima
in `~/sws-vps/backup-prima-di-2.24.1/`; verificato: radice e /health 200, gateway healthy, CasaDomotica rifatto sulla
nuova immagine. Tenuta come ripiego la `2.24.0-amd64`; tolte tutte le altre immagini di SWS (le commit del 02-11 e le
release fino alla 2.23.8), il disco è passato da 11 a 9,1 GB usati.

Prima: **Versione in esecuzione: `03919934-amd64`** dal 02-11-2026 pomeriggio: la `0b7d2135` più il ramo `feat/unita-dal-tag`
(membri delle variabili strutturate in Tag, Tipi nella colonna Tag, unità del tag precompilata negli oggetti).
Verificato: radice 200, gateway healthy, CasaDomotica rifatto, tunnel di `tc620-garage` e `wp630-ufficio` riaperti.

Prima: **Versione in esecuzione: `0b7d2135-amd64`** dal 02-11-2026, 13:05: la `c1e5e728` più il template «Slider — stili e modi»
(ramo `feat/template-demo-slider`). Verificato: radice 200, gateway healthy, `demo-slider` fra i template del
container, tunnel di `tc620-garage` e `wp630-ufficio` riaperti da soli.

Prima: **Versione in esecuzione: `c1e5e728-amd64`** dal 02-11-2026, 11:40: la 2.24.0 più il ramo `fix/riabbinare-dal-cloud`
(un pannello con utenti si riabbina dal cloud, la console segna chi è da riabbinare, istruzioni di aggiornamento coi
menù giusti, Installazione nel cloud coi comandi per il pannello). Quadlet della 2.24.0 in
`~/sws-vps/backup-prima-di-f66fd7ba/`; verificato: radice 200, gateway healthy, CasaDomotica e collaudo-slider-compresso
rifatti sull'immagine nuova, tunnel di `tc620-garage` e `wp630-ufficio` riaperti da soli. Prima `f66fd7ba-amd64`
dalle 10:40, e prima ancora la `2.24.0-amd64`.

Prima: **Versione in esecuzione: `2.23.8-amd64`** dal 01-11-2026: la release con l'IDE in stile VS Code e il pannello proprietà
riordinato. Quadlet di prima in `~/sws-vps/backup-prima-di-2.23.8/`; verificato: radice e /health 200, un file mancante 404,
CasaDomotica rifatto sulla nuova immagine. Tenuta come ripiego la `8f204595-amd64`, tolte le immagini di commit più vecchie.
Prima `8f204595-amd64` dal 31-10-2026, 20:46: il bordo del pannello proprietà segue il mouse.
Prima `f8724665-amd64` dalle 19:08: lo slider senza tag è inerte.
Prima `aa5317d8-amd64` dalle 18:20: il «-» da tastiera nei campi numerici.
Prima `985edd4e-amd64` dalle 17:05: Ctrl+Z per modifica e non per tasto, la
molla dello slider senza scatto. Prima `82209793-amd64` dalle 12:30: lo stesso freno su tutti i selettori
colore dell'editor. Prima `bf9843ea-amd64` da mezzogiorno: la `76aecffb` più il selettore
colore che scrive al massimo ogni 100 ms. La `76aecffb-amd64` (2.23.8-rc.1 più la lettura degli ZIP compressi), dal
31-10-2026 mattina: lo slider nuovo (fasi 1-6), il resto del ramo C (schema identità 6, chiusura
dell'account, inattività, registro a 12 mesi). Prima del cambio: copia di `identita.db`,
`audit.jsonl` e del quadlet in `~/sws-vps/backup-prima-di-76aecffb/`. Verificato dopo il riavvio:
gateway `healthy`, radice 200, tunnel di `tc620-garage` riaperto da solo.

Prima `2.23.7-amd64`, dal 29-10-2026 sera: lo schermo del pannello dal
cloud (`/schermo/<pannello>/`, col biglietto monouso e il cookie `sws_schermo`) e la disponibilità
delle sorgenti. Verificato dopo il riavvio: radice e `/health` 200, `/schermo/<pannello>/` senza
cookie 401, il tunnel di `tc620-garage` riaperto da solo, il container di CasaDomotica rifatto
sulla nuova immagine. Prima `2.23.6-amd64` dal 28-10-2026 sera, `2.23.5-amd64` dal 28-10,
`195e8c72-amd64` dalla notte del 27-10, `ed9d47b5-amd64` dalla sera del 26-10 e `2.23.0-amd64`
dallo stesso giorno.

> **Il gateway si tiene sempre all'ultima immagine costruita**, senza aspettare che qualcuno lo
> chieda: il maintainer lavora sempre da `sws.soligo.net`, e un IDE indietro mostra difetti che
> non esistono. Il 26-10 ha segnalato frasi italiane in un'interfaccia inglese: era la 2.21.0 sul
> VPS contro la correzione uscita nella 2.21.1.

**Prima**, `2.21.1-amd64` per poche ore lo stesso 26-10-2026; prima ancora dal 23-10-2026
(`2.16.2-amd64`, e prima `2.16.0-rc.1-amd64`).

Con la 2.16.2 il gateway aveva preso il cambio di porte del pannello — che però **non lo tocca**:
il gateway e i container dei suoi progetti restano sulla 8444, interna alla rete del VPS.
L'`HEALTHCHECK` dell'immagine, passato a 7443/7444 con tutto il resto, da quella versione prova
anche la 8444: senza, l'immagine usata come gateway sarebbe risultata «unhealthy» per sempre. Dalla
2.20.0 quel controllo prova **anche HTTPS** su tutte e tre le porte, il che qui non cambia niente
(il gateway parla in chiaro dietro Traefik) ma non fa danno.

**Col salto alla 2.20.0 la macchina ha preso anche una correzione che aveva saltato.** Il 23-10 si
è scoperto che il quadlet sul server era rimasto indietro rispetto alla copia maestra: gli
mancavano le sei righe `Label=net.soligo.sws.…=` aggiunte il 22-10, quelle che tolgono dal
container le etichette delle Novità. Sono 4 717 byte di testo che podman riscrive dentro **ogni**
evento mandato al journal, e il controllo di salute ne produce due ogni 30 secondi: misurato,
il 71 % di journal in meno per ciclo. Da questo giro il file sulla macchina è di nuovo una copia
esatta di quello nel repo, ed è il modo in cui va tenuto.

**Come si aggiorna.** L'immagine è inchiodata al commit, quindi `podman-auto-update` **non** la
tocca: è voluto, perché il gateway e i container dei progetti devono essere la stessa versione e
un tag mobile li farebbe divergere a metà aggiornamento. Si cambia `Image=` **e**
`--gateway-immagine` insieme nel quadlet, poi `systemctl --user daemon-reload` e
`restart sws-gateway`.

## La stabilità del tunnel, misurata (23-10-2026)

Quattro giorni di journal del gateway, due pannelli collegati. **La misura va fatta per pannello**:
letti insieme, gli eventi dei due si mescolano in una storia che non è di nessuno dei due — ci sono
cascato la prima volta, e il risultato sembrava l'opposto di quello che è.

| | `tc620-garage` | `wp630-ufficio` |
|---|---|---|
| finestra | 19-10 17:58 → 23-10 18:46 | 19-10 13:26 → 23-10 11:02 |
| tempo aperto | **3 g 6h09m** | 23h44m |
| tratta più lunga | 22h45m | 8h55m |
| interruzioni | **7, tutte < 5 min** | 9: cinque brevi, **quattro lunghe** |
| mediana delle brevi | 50 s | 29 s |
| la peggiore breve | 2m13s | 46 s |

**Il TC620 è stabile, e il test si chiude lì.** Sette interruzioni in quattro giorni, tutte
richiuse da sole, nessuna oltre 2m13s, nessun intervento. Era aperto **ininterrottamente da 18h32m**
quando l'aggiornamento alla 2.20.0 ha riavviato il gateway — e si è ricollegato in **2 secondi**.
L'unica chiusura non spontanea di tutta la finestra è stata quella.

**Il WP630 ha quattro interruzioni lunghe** (23h06m, 16h16m, 15h21m, 15h05m) e tutte e quattro
vanno da metà pomeriggio al mattino dopo. La lettura semplice è che il pannello fosse spento; le
sue cinque interruzioni *brevi* hanno la stessa mediana di quelle del TC620, quindi il meccanismo
di riconnessione si comporta uguale. **Ma dal lato del gateway le due cose non si distinguono**, e
questo è un difetto: vedi il seme
[il gateway non dice chi bussa](../../docs/plans/semi/2026-10-24-il-gateway-non-dice-chi-bussa.md).

## Il tunnel dei pannelli (10-10-2026)

`tunnel.soligo.net` risponde: è lo **stesso** container del gateway, con un router Traefik suo
(`~/sws-vps/traefik/dynamic/tunnel.yml`). Un nome diverso per la stessa macchina non è pignoleria:
l'indirizzo del gateway sta **dentro l'immagine del pannello** (decisione 13), e tenerlo separato
da `sws.soligo.net` vuol dire poter spostare un giorno i pannelli su un'altra macchina cambiando
un record DNS, senza toccare i pannelli già installati — che sono esattamente quelli che non si
possono toccare.

I pannelli ammessi stanno in `~/sws-vps/gateway-config/pannelli.yaml` (permessi 600, **contiene
segreti**), una voce per pannello con token e **azienda**. L'azienda decide chi può parlargli: chi
non è di quella prende 404 e non lo vede nemmeno nell'elenco. Il file si legge all'avvio, quindi
dopo averlo cambiato: `systemctl --user restart sws-gateway`.

Provato il 10-10-2026, dal dev server verso la produzione:

```
wss://tunnel.soligo.net/tunnel/v1   senza token            → 401
                                    con token sbagliato    → 401
                                    con token giusto       → «tunnel aperto» sui due lati
https://sws.soligo.net/dev/<pannello>/health  senza sessione → 401
https://sws.soligo.net/dev/mai-visto/health   senza sessione → 401
```

**I timeout lunghi dell'entrypoint `websecure` servono a questo.** Una connessione di pannello per
natura sta zitta per ore, e coi valori predefiniti Traefik la chiuderebbe. Erano già impostati dal
06-10 proprio in previsione.

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

- **Il journal si tiene 12 mesi** (30-10-2026, **da applicare**): `sistema/90-sws-journal.conf`,
  `MaxRetentionSec=12month` e un tetto di 2 GB. È la metà del «registro delle attività per 12 mesi»
  dell'informativa che il gateway non può fare da sé; l'altra metà, il registro di SWS, si pota nel
  giro quotidiano del gateway. Le due righe per applicarlo stanno in testa al file.

## La copia giornaliera dei dati (10-11-2026)

**Ogni giorno alle 03:15 UTC** `backup-dati.timer` lancia `~/sws-vps/backup-dati.sh` (in git: `deploy/vps/backup-dati.sh` e
`deploy/vps/sistema/backup-dati.*`): copia `gateway-config` (account, audit, posta, pannelli) e `progetti` in
`~/sws-vps/backup-dati/AAAA-MM-GG/`, e **tiene 30 giorni**. Decisione del maintainer del 10-11-2026, dichiarata
nell'informativa privacy. Prima c'era solo `salva-stato.sh` (certificati e Portainer, 14 giorni), che resta.

- I file non cambiati sono link fisici al giorno prima (`rsync --link-dest`). Misurato il 10-11: la prima copia 2,3 GB in
  13 s, la seconda **138 MB** in più (i database vivi). Trenta giorni ≈ 6,5 GB su 27 liberi.
- I 19 database SQLite vivi (quelli col `-wal`: `identita.db` e gli storici dei progetti) si copiano con l'API di backup di
  SQLite (python3), non col file: un'istantanea coerente senza fermare nessuno. `identita.db` copiato: `integrity_check` ok.
- Si scrive in `AAAA-MM-GG.parziale` e si rinomina alla fine; via le cartelle più vecchie di 30 giorni, per nome.
- **Ripristinare**: fermare il gateway (`systemctl --user stop sws-gateway`), copiare la cartella del giorno scelto al posto
  di `gateway-config` o del singolo progetto (`cp -a`), riavviare. Un progetto solo si ripristina anche da fermo il suo
  container.
- **Verifica**: `journalctl --user -u backup-dati.service -o cat | tail -1` dice giorni tenuti e spazio;
  `systemctl --user list-timers | grep backup`.
- La copia sta **sulla stessa macchina**: protegge da errori e cancellazioni, non dalla perdita del VPS. La seconda copia
  remota è il seme `docs/plans/semi/2026-11-10-backup-su-un-secondo-server.md`.

## La posta in uscita (26-10-2026)

Configurata dal maintainer dalla console, **Posta**. Vive in
`~/sws-vps/gateway-config/smtp.yaml`, `0600 debian`, e **non sta in git**: contiene una password.

| campo | valore |
|---|---|
| host | `mail.infomaniak.com` |
| porta | `587`, STARTTLS |
| mittente | `login@soligo.net` |
| utente | `mauro@soligo.net` |

È l'SMTP **dell'installazione**, cioè quello che manderà il PIN monouso e la verifica della
registrazione quando ci saranno — vedi
[aprire sws.soligo.net a utenti esterni](../../docs/archive/2026-10-26-aprire-sws-soligo-net.md).
Mittente e utente differiscono, e va bene: sono lo stesso dominio, quindi l'allineamento DMARC
regge.

**Il DNS di `soligo.net` è a posto** (misurato il 26-10-2026, non dedotto):

- SPF `v=spf1 a mx ptr include:spf.infomaniak.ch -all` — Infomaniak autorizzato, e `-all` rifiuta
  tutto il resto;
- DKIM pubblicato, selettore `dkim`;
- DMARC `p=none` con i rapporti a Cloudflare: **solo osservazione**, nessuna imposizione. È una
  scelta, non una dimenticanza — alzarla è una decisione del maintainer, non una pulizia.

**Quello che non è ancora provato**: il maintainer ha verificato che le e-mail arrivano. Resta da
vedere dove arrivano **fuori dal dominio** — una prova verso una casella Gmail o Outlook, per
sapere se finiscono in Posta in arrivo o nello spam. È lì che vivono gli utenti esterni, ed è il
solo posto dove la risposta conta.

**Il piano cloud (decisione 39) dava la porta 25 in uscita bloccata sui VPS OVH.** Misurato il
26-10-2026: 25, 587 e 465 sono tutte aperte su questa macchina. Con il 587 di Infomaniak non
cambia niente, ma la decisione 39 va corretta dove sta scritta.

## Da fare

- [ ] **Aggiornamenti automatici**: `unattended-upgrades` per il sistema e
      `podman-auto-update.timer` per le immagini (i quadlet hanno già `AutoUpdate=registry`).
- [ ] **Copia di sicurezza** di `~/sws-vps/` (configurazione, `acme.json`, dati di Portainer) fuori
      dalla macchina. L'istantanea giornaliera di OVH copia il disco, non è un dump da cui ripartire.
- [x] ~~Aggiornamenti automatici~~ — fatti, vedi sopra.
- [x] ~~Copia di sicurezza~~ — fatta, vedi sopra: configurazione in git, stato in archivio datato.
- [ ] **Relay SMTP sulla 587**: OVH blocca la 25 in uscita, e senza relay le email di verifica della
      registrazione non partono o finiscono nello spam.
- [x] ~~Immagine amd64 su ghcr~~ — c'era già dal 06-10 (`2.12.0-amd64`, `latest-amd64`); dal 09-10
      anche `2.13.0-rc.1-amd64`, `rc-amd64` e i tag di commit.
- [x] ~~Il gateway SWS~~ — **acceso il 09-10-2026**, vedi sotto.

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

curl -s -o /dev/null -w "%{http_code} tls=%{ssl_verify_result}\n" https://sws.soligo.net/health
#   atteso: 200 tls=0   (0 = certificato verificato)
#   sulla radice "/" lo stato e' 404 col corpo giusto: vedi «Il gateway SWS»

systemctl --user --no-pager list-units "*.service" | grep -E "traefik|portainer"
#   quali servizi girano davvero

sudo sshd -T | grep -i passwordauthentication     # atteso: no  (i FILE possono mentire)
sudo ufw status verbose                            # cosa e' aperto davvero
sudo fail2ban-client status sshd                   # quanti indirizzi bloccati
```
