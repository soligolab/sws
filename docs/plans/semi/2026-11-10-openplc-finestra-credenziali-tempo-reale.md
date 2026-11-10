# OpenPLC sul pannello: una finestra sua nell'IDE, le credenziali, e il tempo reale senza root (seme)

> Nato il 10-11-2026 da `Appunti.txt` (punti del 29-10-2026 e del 03-11-2026), quando il maintainer
> ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan
approfondita e dedicata, per sviscerarne tutti i dettagli. Quello che segue è materiale — misure,
comandi, decisioni già prese — non un piano d'esecuzione.

OpenPLC è arrivato sul pannello col piano archiviato
[OpenPLC sul dispositivo](../../archive/2026-10-20-openplc-sul-dispositivo.md) (20-10-2026). Il seme
vicino è [server Modbus](2026-10-23-server-modbus.md), nato decidendo chi legge chi fra SWS e OpenPLC.

## L'idea

Oggi quello che l'IDE sa di OpenPLC è sparso in più posti: il riquadro di stato e installazione nella
scheda Connessione, lo scambio della logica del progetto, un testo sulle porte. Il 03-11-2026, davanti
a un problema di credenziali (sotto), il maintainer ha deciso: «segna l'opzione 2, l'idea è di avere
una finestra dedicata a OpenPLC». Cioè non un bottone in più nel riquadro di Connessione, ma **un
posto suo nell'IDE** che raccolga tutto quello che oggi è sparso:

- stato e installazione (oggi il componente `OpenplcSulPannello`, nella scheda Connessione);
- la logica del progetto (Scarica/Carica zip, oggi `LogicaPlcDelProgetto`);
- le credenziali: dire se c'è un utente, e azzerarle;
- porte e indirizzo per l'Editor di OpenPLC;
- e magari il programma in esecuzione — nome e data — che la discovery UDP 33333 già dà
  (`project_name`, `project_timestamp`).

**Da chiarire col maintainer prima di scrivere codice:**

- dove sta nella barra dell'IDE: una voce sua, o una scheda di Dispositivo;
- se vale anche senza pannello collegato: la logica del progetto sì, il resto no.

## Le credenziali di OpenPLC sul pannello (03-11-2026, WP630)

Ricreando il container, l'utente dell'Editor **non** si perde: sta in `/data/user/openplc/restapi.db`,
tabella `users`, accanto a `bootstrap_marker` (misurato sul WP630, non è nel repo). Ma l'installer dice lo
stesso «Crea subito il suo utente: finché non ne ha, il primo che si collega lo crea», e così il testo
`openplc.porte` dell'IDE (`sws-editor/src/i18n/it.json`, riga 3348 il 10-11-2026, e la copia inglese in
`en.json`).

Il maintainer non ricordava la password del 30-10 e SWS non offriva niente: «non è così scontato».

Le due cose da fare, com'erano scritte il 03-11:

1. installer e IDE dicono se un utente c'è già («OpenPLC ha già l'utente admin: le credenziali restano
   quelle»);
2. nel riquadro OpenPLC del pannello un'azione «Azzera le credenziali di OpenPLC», solo Admin, con
   conferma, fatta dal pannello con un servizio transitorio come l'installazione
   (`sws-runtime/crates/sws-web/src/openplc.rs`): ferma il container, svuota `users` (verificare cosa fa
   OpenPLC v4 con `bootstrap_marker`), riavvia; il programma non si tocca.

La decisione del maintainer («segna l'opzione 2») sposta il punto 2 dentro la finestra dedicata: la
finestra è il posto dove le credenziali si vedono e si azzerano.

## OpenPLC in tempo reale sul pannello, senza root per `user`

Provato il 29-10-2026 nel progetto `/home/ut1/GitPixsys/openplc` (su theobroma: `analisi.md` §9
«Verifiche» e `docs/1-install.md` «Real-time scheduling»), su un **PLX800** (`plx800-a-p3-l2-a2-07db62`,
RK3399, PixsysOS 2.1.1, kernel 6.12 PREEMPT_RT, Podman 5.0.2, OpenPLC Runtime v4.2.3).

**Da tenere a mente finché chi sviluppa PixsysOS non mette quel setup nell'immagine**: allora va solo
verificato. Contraddice quello che SWS diceva al 29-10 («in rootless il tempo reale non si ha»: HOWTO
cap. 28, il quadlet `openplc-runtime.container`, il piano archiviato
[OpenPLC sul dispositivo](../../archive/2026-10-20-openplc-sul-dispositivo.md)). Al 10-11-2026 il quadro
è questo:

- la riga «Tempo reale» della tabella di `docs/HOWTO.md` cap. 28 dice già la cosa giusta («Non è il
  rootless: è il limite RTPRIO di `user`, che è 0»); per i passi rimandava a `Appunti.txt`, e dal 10-11-2026
  rimanda a questo seme;
- `deploy/container/install-container.sh` lo stesso: il commento sopra `OPENPLC_IMG` spiega che il
  container eredita i limiti di chi lo avvia, e per il drop-in rimanda anch'esso a questo seme (prima ad
  `Appunti.txt`);
- il quadlet `openplc-runtime.container` (23-10-2026) non esiste più: l'installer lo toglie se lo trova
  («non partiva, e se partiva perdeva il programma a ogni avvio») e fa `podman create` + avvio da
  `podman-restart.service`;
- il piano archiviato dice ancora che il tempo reale in rootless non si ha (righe su `sched_setscheduler`
  che fallisce): è la storia, resta com'è.

### Il punto

In rootless `CAP_SYS_NICE` dentro il container non conta (il kernel guarda il namespace iniziale);
conta il **limite**. Un processo senza privilegi passa a SCHED_FIFO fino a `RLIMIT_RTPRIO` e fa
`mlockall` fino a `RLIMIT_MEMLOCK`. Di fabbrica `user` ha rtprio 0 e memlock 8 MB, quindi il runtime
logga `sched_setscheduler failed` e gira col tempo normale.

### Il setup, una volta da root (o nell'immagine di PixsysOS), niente sudo a `user`

```sh
mkdir -p /etc/systemd/system/user@1000.service.d
printf '[Service]\nLimitRTPRIO=99\nLimitMEMLOCK=infinity\n' \
    > /etc/systemd/system/user@1000.service.d/realtime.conf
systemctl daemon-reload && reboot
```

`/etc` è persistente su PixsysOS (verificato: dopo il reboot il file c'è).

Vale per i servizi del systemd **dell'utente**, non per le shell ssh (`pam_limits` non è nel PAM di
sshd, quindi un `limits.d` non basterebbe). Conseguenze pratiche:

- il container va avviato dal gestore utente (al boot `podman-restart.service`, o un quadlet come era il
  nostro): eredita RTPRIO 99 e MEMLOCK infinito. Un `podman start/restart` scritto in ssh lo avvia
  **senza** tempo reale;
- `systemd-run --user podman restart` **non** va: conmon resta nel servizio transitorio, systemd lo
  uccide alla fine e il container resta bloccato in `stopping` (sbloccato scrivendo 0 in
  `/run/user/1000/libpod/tmp/exits/<id>`). Nel progetto GitPixsys/openplc hanno risolto con
  `podman create` + `systemctl --user restart podman-restart.service` — ed è quello che fa oggi anche
  `install-container.sh`;
- sul container: `--ulimit rtprio=99 --ulimit memlock=-1` (nel quadlet `Ulimit=rtprio=99`,
  `Ulimit=memlock=-1`); `--cap-add SYS_NICE SYS_RESOURCE` serve solo in rootful. Un container creato
  senza `--ulimit` eredita comunque i limiti da chi lo avvia. Il nostro installer **non** mette
  `--ulimit rtprio=99` di proposito: senza il drop-in il limite massimo è 0 e crun rifiuterebbe di
  avviare il container (commento in `install-container.sh`).

### Verifica, col PLC in RUN

```sh
grep 'realtime priority' /proc/$(podman inspect -f '{{.State.Pid}}' openplc)/limits   # 99
podman logs openplc | grep -E 'Scheduler set|SCHED_FIFO priority'
```

(Sul pannello SWS il container si chiama `openplc-runtime`, non `openplc`.)

### Numeri misurati

Risvegli a 1 ms per 30 s, con le altre applicazioni accese, load ~5:

| Modo | Ritardo massimo | Risvegli oltre 1 ms |
|---|---|---|
| tempo normale | 4,5 ms | 590 |
| SCHED_FIFO | 120 µs | nessuno |

Il runtime usa FIFO 99 per il dispatcher e la priorità del **task IEC** per ogni task (1..98); il
sistema rinfresca l'I/O a FIFO 80, quindi i task stiano sotto 80. Il kernel non ha
`CONFIG_RT_GROUP_SCHED`: nessun budget RT per cgroup da configurare (`sched_rt_runtime_us` resta
950000).

### Due cose da sapere per i pannelli piccoli

1. `mlockall` blocca ~330 MB di RAM (sul WP630 ce ne sono 1979).
2. Dallo stesso progetto, un difetto che vale anche per il nostro container: il **PID 1 dell'immagine di
   OpenPLC ignora SIGTERM**, quindi `podman stop` uccide il runtime dopo il timeout e le uscite restano
   congelate all'ultimo stato. Rimedio provato: avviare con

   ```sh
   bash -c 'set -m; ./start_openplc.sh & trap "kill -INT -- -$!" TERM INT; wait; wait'
   ```

   (nel quadlet `$$!` al posto di `$!`) e `StopTimeout=30`: lo stop diventa un SIGINT al runtime, che
   ferma il PLC e porta le uscite nello stato sicuro. Al 10-11-2026 `install-container.sh` ha
   `--stop-timeout 30` ma **non** il rimedio: il `podman create` non cambia il comando dell'immagine.

### Da riverificare quando si riprende

- L'immagine installata oggi è `ghcr.io/autonomy-logic/openplc-runtime:v4.3.1`; le misure sono sulla
  v4.2.3. Il log `sched_setscheduler failed` e il comportamento con SIGTERM vanno ricontrollati.
- Se PixsysOS avrà messo il drop-in nell'immagine, resta solo la verifica col `grep` sopra.

## Cosa c'è nel codice il 10-11-2026

- `sws-editor/src/boot/OpenplcSulPannello.tsx`: i componenti `OpenplcSulPannello` e
  `LogicaPlcDelProgetto`; li usano `sws-editor/src/config/schede/RuntimeConnectionTab.tsx`,
  `sws-editor/src/config/schede/InstallTab.tsx` e `sws-editor/src/components/benvenuto/InstallaRuntime.tsx`.
  Test: `sws-editor/tests/openplcSulPannello.test.tsx`, `sws-editor/tests/logicaPlc.test.tsx`.
- `sws-runtime/crates/sws-web/src/openplc.rs`: installazione con un servizio transitorio dell'utente
  (`--solo-openplc`), esito in `openplc-esito.json`, `PORTA_API = 8443`. La logica del progetto passa da
  `GET`/`PUT /api/project/logica-plc`, tetto 32 MiB (HOWTO cap. 28).
- `deploy/container/install-container.sh`, `installa_openplc`: porte 8443, 1502→502, 10102→102,
  14840→4840, 33333/udp; volume `/var/run/runtime` sulla cartella `openplc` accanto ai dati di SWS
  (`/data/user/openplc` sul pannello); `--hostname` perché la risposta alla ricerca porti il nome della
  macchina. La ricerca: l'Editor manda `OPENPLC_DISCOVER_V1` in broadcast sulla 33333/udp e il runtime
  risponde (`webserver/discovery/network_discovery.py` dell'immagine).

## Le opzioni già visibili

1. **Solo le credenziali**, dentro il riquadro di Connessione (l'«opzione 1» del 03-11): il testo che dice
   se l'utente c'è già, e il bottone di azzeramento. Respinta dal maintainer a favore della 2.
2. **La finestra dedicata** («opzione 2», scelta il 03-11-2026): stato, installazione, logica, credenziali,
   porte, programma in esecuzione in un posto solo. Da decidere la collocazione nella barra e cosa mostra
   senza pannello.
3. **Il tempo reale** è una cosa separata: non è dell'IDE ma dell'immagine di PixsysOS. Finché non c'è,
   SWS può al massimo **dirlo** nella finestra (leggere il log `sched_setscheduler failed`, o il limite in
   `/proc/<pid>/limits`) e rimandare ai comandi qui sopra. Il rimedio al SIGTERM invece è dell'installer,
   e si può fare da subito.
