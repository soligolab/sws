# La fiducia nel browser del pannello, al posto della chiave del dispositivo

> **Seme — decisione.** Nato il 26-10-2026. La strada è **provata sul WP630** ed è quella che indica
> chi sviluppa PixsysOS. Restano da decidere i dettagli.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita
> per sviscerarne tutti i dettagli.** Quello che segue sono le misure di oggi, non un disegno.

## Perché nasce

Il 25-10-2026 il maintainer ha scelto: il TLS di default si accende solo dove c'è il certificato
del dispositivo ([C4, pezzo 3](../archive/2026-10-23-c4-tls-di-default.md)). Quella scelta si regge
sulla chiave privata `/mnt/protected/ssl/<seriale>.server.key`, che è `root:root 0600` e che
`deploy/container/certificato-dispositivo.sh` copia con `sudo` (2.21.0, HOWTO §29).

Il 26-10-2026 il maintainer ha chiesto a chi sviluppa PixsysOS un modo per leggere quella chiave
da un'applicazione non-root. La risposta:

- la chiave sul filesystem è **già un errore**, e in futuro **potrebbe essere rimossa** perché è
  una falla;
- la strada prevista per un'applicazione è **rendere fidato il proprio certificato
  nell'archivio del browser** dell'utente `user`.

Quindi sulla chiave del dispositivo non si costruisce più niente.

## La prova del 26-10-2026: funziona

Sul WP630 (`wp630-a-p3-07a077`), con il maintainer ai comandi:

1. «Genera self-signed» nella card TLS del pannello: nasce `config/tls.crt` e il runtime passa in
   HTTPS.
2. Come `user`, senza `sudo`:
   ```
   certutil -A -d sql:/home/user/.pki/nssdb -n "SWS pannello" -t "P,," -i /data/user/sws/config/tls.crt
   ```
   Dopo, `certutil -L` mostra `PixsysRootCA` (`C,,`) e `SWS pannello` (`P,,`).
3. L'impronta servita sulla 7443 (`openssl s_client`) è uguale a quella del file.
4. Riavvio del pannello: **il kiosk mostra il sinottico senza avviso**, anche in `--incognito`.

Basta il certificato del server, importato da solo come «peer fidato» (`P,,`). **Non serve una
CA del pannello**, quindi sul disco non finisce nessuna chiave capace di firmare altri nomi.

**La persistenza**, confermata dal maintainer: `/home/user/.pki/nssdb` resta com'è dopo un
aggiornamento di PixsysOS. Si cancella solo col factory reset, e in quel caso si reinstalla
tutto, SWS compreso.

Già noto dal 24-10-2026 (misura sul TC620): `/home` è un overlay persistente scrivibile da `user`,
e sul pannello c'è `certutil`.

## Cosa c'è oggi nel codice (misurato il 26-10-2026)

- **Il generatore** è uno solo: `sws_web::system::genera_certificato` (`system.rs:1155`). Fa un
  autofirmato foglia con i nomi `localhost`, nome del pannello, `<nome>.local`, `127.0.0.1` e l'IP
  di LAN del momento. Nessuna scadenza (rcgen: 1975 → 4096).
- **Il TLS si accende se `config/tls.crt` esiste** (`main.rs:516`). Se la chiave manca o non si
  carica, il runtime ne genera un'altra (`main.rs:2199`).
- **Il container non vede `/home/user`**: il quadlet monta solo `/data/user/sws/{config,projects,
  logs,viewer}` (`sws-runtime.container:85-93`). Quindi l'importazione si fa **sull'host**, come
  `user`.
- **Il percorso del certificato del dispositivo**, da ritirare:
  - `deploy/container/certificato-dispositivo.sh`, che copia catena e chiave con `sudo`, lanciato
    come `pixsys`;
  - l'installatore, che scrive `config/certificato-dispositivo` se la catena è leggibile
    (`install-container.sh:386-393`);
  - `proposta_tls` (`system.rs:813`), il campo `proposta` di `GET /api/system/tls`, la rotta
    `POST /api/system/tls/scelta` col suo gemello remoto, il marcatore `config/tls-scelta`;
  - la guardia in `check_quadlet.sh:130`, l'HOWTO §29 e il testo della proposta nella card.
- **Un difetto latente in quel percorso.** Lo script controlla solo la catena (riga 57). Se la
  chiave sparisce, copia `tls.crt` e poi fallisce sulla chiave (righe 90-91). Al riavvio dopo, il
  runtime trova `tls.crt` senza `tls.key` e genera un autofirmato: un pannello che girava in
  chiaro si riaccende con l'avviso. Il ritiro lo toglie.

## I pezzi già visibili (da decidere nella sessione di plan)

1. **Chi importa.** L'installatore: così anche il factory reset è coperto, senza casi speciali. In
   più serve un passo che **segua ogni certificato nuovo**: «Genera self-signed», il caricamento
   di un certificato (`PUT /api/system/tls`), e più avanti il rinnovo automatico. Un'unità
   `systemd --user` che osserva `config/tls.crt` è una strada; da misurare.
2. **Togliere il vecchio.** Ogni nuova importazione deve togliere la precedente (`certutil -D`
   per nome), e «Rimuovi» deve togliere quella in uso. Va verificato cosa fa `certutil` con due
   certificati sotto lo stesso nome.
3. **Quando il browser se ne accorge.** Nella prova si è riavviato il pannello. Non è misurato se
   basta riavviare il kiosk, o se Chromium rilegge l'archivio da solo.
4. **La regola del 25-10 cambia.** Diventa: TLS di default su **tutti** i pannelli Pixsys, perché
   la fiducia si installa senza root. Il marcatore `tls-scelta` («ha scelto no») si può riusare.
   Da decidere se vale anche per i pannelli non Pixsys che hanno Chromium con lo stesso archivio.
5. **Il ritiro** del percorso del certificato del dispositivo (elenco sopra), con la sua voce in
   `NOVITA.yaml`. Le copie della chiave del dispositivo già fatte sui pannelli di prova (il TC620)
   vanno tolte.
6. **Il rinnovo** ([seme](2026-10-23-rinnovo-del-certificato-firmato.md)). Con questa strada il
   kiosk si aggiusta da solo a ogni rinnovo, purché il punto 1 lo segua. Il problema del pinning
   di chi si collega dalla rete resta tutto in quel seme.

## Fuori

- **Chi si collega dalla rete** (IDE, viewer LVGL, browser in LAN): resta la fiducia al primo
  contatto con l'impronta mostrata, com'è oggi.
- **L'HTTP solo sul loopback per il kiosk**: proposto il 26-10-2026 come ripiego se la fiducia nel
  browser non avesse funzionato. Non serve più.
