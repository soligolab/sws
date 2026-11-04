> **Fatto il 04-11-2026**: rapporto [SWS-RT-01](../rapporti/runtime-risorse.html), misure grezze in
> [`docs/prestazioni/2026-11-04-wp630-risorse.txt`](../prestazioni/2026-11-04-wp630-risorse.txt). Emerso nel farlo: lo storico non ha
> una ritenzione predefinita (cresce senza fine se non la si imposta), e il runtime 2.24.1 a riposo usa ~100 MB più
> del banco di ottobre — da rimisurare.

# Rapporto «Runtime SWS — struttura, file, risorse, comunicazione»

## Contesto
Chiedono un'analisi breve del runtime: struttura, file (nel container e mappati sull'host), occupazione
disco tipica, e come comunicano i pezzi (runtime, host, cloud, campo). L'interesse vero è **quante risorse
serve il runtime**. Documento formale, con intestazione di pagina e versione SWS di riferimento, da tenere
aggiornato. Scelte del maintainer: **PDF generato dal repo**, **uso interno**, **con una misura fresca su
un pannello vero**.

Materiale già esistente da cui sintetizzare (non da duplicare a mano, ma da riassumere):
- `docs/manual/18_container_e_comunicazione.md` — immagine, cartelle, quadlet, porte, flussi (molto completo).
- `docs/manual/16_prestazioni.md` + `docs/prestazioni/2026-10-17-{tc620,x86}.json` — CPU/RAM sotto carico.
- `docs/manual/08_historian.md` — formato storico: 7 M righe = 227 MB → **≈ 32 byte/campione**; ritenzione.
- Dimensioni immagini 2.24.1 misurate ora: arm64 (con LVGL) **562 MB**, amd64 **280 MB**. Strati arm64:
  Ubuntu 103 MB, pacchetti (grafica LVGL + Python) 388 MB, binari 60 MB, interfaccia 7,6 MB, font 2,2 MB, resto < 1 MB.
- Default: log 7 giorni (`SWS_LOG_RETENTION_DAYS`, `main.rs:518`); backup automatici senza storico
  (`backups.rs`); istantanea pre-aggiornamento = copia di config + progetti **storico compreso**
  (`istantanea_dati.rs`); `immagini.sh` tiene l'immagine attuale **e la precedente**.

## Dove e come
- Sorgente: `docs/rapporti/runtime-risorse.html` (HTML autonomo, CSS di stampa, diagrammi in SVG inline,
  niente CDN). Versione SWS e revisione **scritte nel documento** (cartiglio + tabella revisioni), non
  iniettate: dicono su quale versione è stato verificato.
- Stampa: `docs/rapporti/stampa.mjs` (Node, usa Playwright già in `sws-editor/node_modules`, Chromium in
  `~/.cache/ms-playwright`). `page.pdf()` A4 con `headerTemplate` (titolo · codice doc · «SWS 2.24.1 · rev. 1»)
  e `footerTemplate` («pag. X di Y», data). Avvisa se la versione in `sws-runtime/Cargo.toml` è diversa
  da quella del documento → promemoria di revisione. PDF in `sws/tmp/` (regola del repo).
- `docs/rapporti/LEGGIMI.md`: cos'è la cartella, come si stampa, quando si aggiorna (ogni rilascio che
  tocca immagine, volumi, porte o prestazioni).

## Contenuto (poche parole, tabelle e numeri)
0. **Cartiglio**: titolo, codice `SWS-RT-01`, rev. 1, data 04-11-2026, versione 2.24.1, tabella revisioni.
1. **In sintesi** — riquadro con i 6 numeri chiave: immagine, RAM a riposo e sotto carico, CPU, disco
   dati tipico, **spazio libero da tenere per l'aggiornamento**.
2. **Struttura** — un'immagine, quattro ruoli (runtime pannello, viewer LVGL, gateway, container di
   progetto); i crate del workspace in una riga ciascuno.
3. **File** — tre tabelle: nel container (percorso, contenuto, dimensione); sull'host (volumi
   `/data/user/sws/{config,projects,logs}`, quadlet `~/.config/containers/systemd/`, storage podman
   `~/.local/share/containers/`); dentro un progetto (`project.yaml`, pagine, `history/historian.db`,
   `backups/`, ricette).
4. **Disco** — immagine per strato (insight: ~87 % è Ubuntu + librerie; senza LVGL si dimezza);
   dati: formula storico ≈ 32 B × campioni con tabella esempi (100/1.000/5.000 tag, 1 campione/10 s,
   30 e 365 giorni); log; backup. **Picco durante l'aggiornamento**: immagine nuova + precedente +
   istantanea (= config + progetti con storico). Tabella «impianto piccolo / medio / grande».
5. **Memoria e CPU** — tabella compatta dal banco TC620 (100/1.000/5.000 tag), più la **misura fresca**:
   RAM a riposo del runtime, di Chromium kiosk vs viewer LVGL, `free`, `df`.
6. **Comunicazione** — un diagramma SVG (operatore/kiosk/LVGL → runtime; IDE LAN → 7444; tunnel WSS →
   gateway; runtime ↔ systemd via D-Bus; campo; registry) + tabella porte + firewall in una riga.
7. **Requisiti consigliati** — derivati dalle misure, dichiarati come tali (non certificati).
8. **Come rimisurare** — comandi (`banco_prestazioni.sh`, `/metrics`, pagina Prestazioni, `podman system df`)
   e riferimenti al codice.

## Passi
1. **Worktree da `main`** (`git worktree add ../sws-rapporto main`): il checkout attuale ha lavoro IA non
   committato su `feat/ia-un-modello-per-scopo` e non va toccato. Tutto sta in `docs/**` → commit
   «meta» diretto su `main`, ammesso da CLAUDE.md.
2. **Dati mancanti** (sola lettura): elenco crate; default backup automatici; dimensione **compressa**
   delle immagini (download) dal manifest; hardware TC620/WP630 dalla memoria/TEST_SETUPS.
3. **Misura sul pannello** — `pixsys@wp630-a-p3-07a077.local` (accesso concesso dal maintainer il
   04-11-2026, `sudo` disponibile ma usato solo se una lettura lo richiede). Solo lettura: `df -h /data`,
   `du -sh /data/user/sws/*` e dei progetti, `podman system df`, `podman images`, `podman stats --no-stream`,
   `free -m`, RSS di runtime / Chromium / viewer LVGL. Grezzo salvato in
   `docs/prestazioni/2026-11-04-<pannello>-risorse.txt`.
4. Scrivo `runtime-risorse.html`, `stampa.mjs`, `LEGGIMI.md`.
5. Stampo in `sws/tmp/SWS-RT-01_rev1_2.24.1.pdf`, rileggo le pagine del PDF (intestazione, numeri,
   tabelle che non si spezzano, diagramma leggibile in bianco e nero).
6. `./scripts/check_documenti.sh` e `./scripts/check_static.sh` verdi; commit `-s` su `main` nel worktree,
   rimozione del worktree. **Nessun push.**

## Verifica
- PDF apribile da `sws/tmp/`, ogni pagina con intestazione e «pag. X di Y».
- Ogni numero del documento ha la fonte (misura del 04-11, banco del 17-10, o file di codice).
- `node docs/rapporti/stampa.mjs` con una versione diversa in `Cargo.toml` stampa l'avviso.
