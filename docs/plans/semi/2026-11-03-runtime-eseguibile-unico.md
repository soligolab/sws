# Un runtime senza container, il più possibile un eseguibile unico — seme

> **Stato: seme — decisione.** Nato il 03-11-2026 da una richiesta del maintainer: «generare un runtime senza
> container che sia più possibile un singolo eseguibile, per la richiesta della famiglia di prodotti TY (Tony)».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 03-11-2026, non un progetto.

## L'idea

Sui Tiny TY (RV1106, un Cortex-A7, 256 MB, Ubuntu 22.04 armhf, **niente podman**) SWS deve arrivare come **un file
da copiare e lanciare**: niente container, niente cartelle di contorno da tenere allineate, un servizio systemd che
punta a un binario. Il piano dei TY ([`2026-10-30-sws-lvgl-sul-tiny-ty.md`](../../archive/2026-10-30-sws-lvgl-sul-tiny-ty.md))
prevede già l'installazione senza container (passo 3) e gli aggiornamenti senza registry (passo 4): questo seme è
il pezzo «un eseguibile» che li rende semplici, e vale anche fuori dai TY (un PC in reparto, un pannello senza
podman).

## Le misure di oggi

| Cosa | Oggi | Dove sta |
|---|---|---|
| Il runtime | un binario, `sws-runtime` | `sws-runtime/crates/sws-runtime` |
| Il viewer LVGL | **un secondo binario**, `sws-lvgl-viewer` (8,5 MB in release, x86_64), che parla col runtime via WebSocket | ADR 0002: due processi, l'unione («opzione B») si riconsidera se le misure lo chiedono |
| La SPA (IDE e viewer web) | **8,2 MB** di file in `sws-editor/dist`, passati con `--www` | |
| I template | 840 KB in `examples/templates` (`--templates-root`) | |
| Il catalogo dispositivi | 348 KB in `catalogo/` (`--catalog-root`) | |
| I simboli di libreria | 1,3 MB in `sws-editor/public/symbols` (dentro la SPA) | |
| Librerie dinamiche | `libpython3.x` (PyO3, per gli script e le espressioni λ), `libz`, `libexpat` (da Python), glibc | `ldd` del binario, 03-11-2026 |
| LVGL | C compilato e linkato dentro il viewer (`lvgl-sys` vendorizzato) | |
| Installazione senza container | esiste: `deploy/generic-linux/` (`install.sh`, unit systemd, script di lancio) | |
| Le note di rilascio | viaggiano come **etichette dell'immagine** (`NOVITA.yaml`), e l'aggiornamento legge i tag del registry (`versioni_dopo`, `sws-web/src/aggiornamento.rs`) | senza container non c'è né l'uno né l'altro |

## Le strade, da pesare nella sessione di plan

- **Asset dentro il binario**: SPA, template, catalogo e simboli inclusi in compilazione (`include_dir` /
  `rust-embed`), con `--www` e simili che restano per lo sviluppo. Costo: ~10 MB in più nel binario, ricompilare per
  ogni cambio della SPA.
- **Python**: tre opzioni — linkare `libpython` della distribuzione (sul TY c'è `libpython3.10.so`: un binario per
  distribuzione), Python statico dentro il binario (pesante, ma davvero un file), o una build senza script (feature
  cargo) per chi non li usa. Le espressioni λ delle variabili calcolate oggi passano da Python: andrebbero valutate
  anche senza.
- **Runtime e viewer in un processo**: su un core e 256 MB due processi e un WebSocket locale costano; l'ADR 0002
  diceva di riconsiderarlo «se le misure lo chiedono» — il TY è quel caso. Alternativa più leggera: un binario solo
  con due sottocomandi (`sws runtime`, `sws viewer`), un file ma due processi.
- **glibc o musl**: un binario statico musl gira su qualunque Linux armhf, ma PyO3 e LVGL (C) vanno verificati; con
  glibc il riferimento è la 2.35 di Ubuntu 22.04 (il builder aarch64 di oggi usa la 2.39 e non va).
- **Aggiornamento e note**: un pacchetto (il binario più un manifesto con versione e `NOVITA`) e un indice delle
  versioni pubblicato da qualche parte (GitHub Releases, il VPS); il pannello che si aggiorna da sé sostituendo il
  file e riavviando il servizio, col ritorno alla versione precedente come oggi.

## Domande per la sessione di plan

- Quanto deve essere «unico»: un file solo, o un file più `/etc/sws` e la cartella dei progetti?
- Gli script Python sui TY servono? (Decide quasi tutto sul fronte dimensioni e portabilità.)
- Un processo o due, misurando CPU e RAM sul TY570 con CasaDomotica.
- Come si integra col piano TY esistente: questo seme ne diventa il passo 3-4, o un ramo a sé prima?

## Dai piani archiviati il 16-11-2026

- **Il canale di aggiornamento dei Tiny TY.** Il piano [SWS sul Tiny TY](../../archive/2026-10-30-sws-lvgl-sul-tiny-ty.md)
  è chiuso con i passi 1-4 fatti: build armv7, copia sullo schermo, installazione con systemd, e `tyx_panelcontrol`
  che resta e avvia SWS come «Programma esterno» (`42201438`). Il passo 5, **aggiornare senza registry**, non è
  deciso. Oggi sul Tiny TY si aggiorna a mano: si scarica il pacchetto `.tar.gz` e si rilancia `install.sh`. L'aggiornamento
  del runtime passa da `podman-auto-update.service`, che lì non c'è; `versioni_dopo` legge i tag del registry e le
  Novità viaggiano come etichette dell'immagine. Serve un indice delle versioni e un pacchetto che porti le sue note: è la
  strada «Aggiornamento e note» qui sopra.
- **Il ripiego di `novita_da_etichette`.** Dalla rc.15 l'immagine non porta più le etichette vecchie
  `net.soligo.sws.changelog` e `net.soligo.sws.compat` (servivano ai runtime 2.12.0-rc.3…rc.8). Il runtime però le
  legge ancora come ripiego (`novita_da_etichette` in `sws-web/src/aggiornamento.rs`, col test
  `le_novita_brevi_prima_e_il_changelog_come_ripiego`). Da decidere: toglierlo (codice più semplice) o lasciarlo per le
  immagini vecchie ancora nel registry. Viene dal piano
  [manutenzione e verifiche rimandate](../../archive/2026-11-10-manutenzione-e-verifiche-rimandate.md), punto 2.
