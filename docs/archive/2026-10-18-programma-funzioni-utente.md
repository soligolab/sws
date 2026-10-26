# Programma — le funzioni per chi usa SWS, in ordine

> **CONCLUSO il 26-10-2026, archiviato.** Tutti e nove i gruppi sono chiusi: fatti (molti ancora da collaudare, e i
> collaudi stanno in `COLLAUDI_IN_SOSPESO.md`) o decisi con un no. Lo stato di ogni gruppo è in fondo al file.

> 18-10-2026. Il maintainer: «porterei avanti tutte queste cose», sull'elenco dei piani e dei semi legati all'uso
> (pannello e IDE). Questo file **non è un piano d'esecuzione**: è l'ordine in cui si prendono, a gruppi. Ogni
> gruppo comincia con **una sessione di plan approfondita** sui suoi semi, con le decisioni del maintainer, e
> diventa un ramo, o rami annidati, secondo «Un ramo alla volta».
>
> L'onda 3 del [piano prima fascia e CRA](../plans/2026-10-15-piano-prima-fascia-e-cra.md) (2FA/LDAP e TLS di default)
> resta in coda a parte, perché vuole le sue tre decisioni.


> **25-10-2026**: il maintainer ha chiesto di portare a termine **tutto il programma**: il gruppo 5 e poi i gruppi
> 6-9, ognuno aperto dalla sua sessione di plan come dice la regola del programma.

## L'ordine

| # | Gruppo | Semi e piani | Perché qui |
|---|---|---|---|
| 1 | **Lo schermo LVGL a misura** | [finestra a misura dello schermo](2026-10-17-finestra-lvgl-misura-schermo.md), [LVGL e `size_mode`](2026-09-24-lvgl-ignora-size-mode.md), proposta di una cornice alla prima pagina ([cornici](2026-10-15-cornici-di-pagina.md)) | il difetto visto sul TC620; tocca lo stesso punto (la risoluzione del display), poco codice |
| 2 | **Font e display a segmenti** | [font](2026-10-15-font-e-display-a-segmenti.md) | si vede subito su web e pannello; LVGL oggi ha un font solo |
| 3 | **Trend sul pannello come sul web** | [trend LVGL](2026-10-04-trend-lvgl-come-il-web.md) | parità web/LVGL, più il tratto che oscilla da capire |
| 4 | **IDE quotidiano** | [archivio dei progetti](2026-10-15-archivio-dei-progetti.md), [log del dispositivo](2026-10-03-log-del-device-nell-ide.md), [scorciatoie](2026-09-25-scorciatoie-da-tastiera.md) | tre cose piccole e indipendenti |
| 5 | **Pezzi rimasti di piani avviati** | [strumenti, ramo 3](2026-10-14-strumenti-simboli-comandi.md), [tubazioni, punto 6 di B](../plans/2026-10-21-tubo-che-segue-gli-oggetti.md), [predefiniti, fasi 2-3](2026-09-30-predefiniti-espliciti.md), [tag, fasi dopo la 2](2026-09-21-gestione-tag-oggetto-unico.md) | ognuno ha già un piano: va riletto contro il codice di oggi |
| 6 | **Dispositivi di campo** | [configuratore dei moduli](2026-10-04-configuratore-moduli.md), [Modbus TCP senza bus](2026-10-06-modbus-tcp-senza-bus-e-trasporto-nel-catalogo.md) | stessa area (catalogo, sorgenti), da collaudare con l'MCM sul TC620 |
| 7 | **Immagine di accensione** | [widget congelati](2026-09-19-boot-image-widget-congelati.md) | dipende dal rasterizzatore, indipendente dal resto |
| 8 | **Certificati in un posto solo** | [certificati](2026-10-15-certificati-in-un-posto-solo.md) | si sovrappone a C4 (TLS di default): va con l'onda 3 |
| 9 | **Le funzioni grandi** | P3 report programmati, P4 notifiche SMS e voce, P2 template d'oggetto ([piano prima fascia](../plans/2026-10-15-piano-prima-fascia-e-cra.md)) | ognuna vuole il suo plan e decisioni di prodotto |

## Gruppo 1 — misurato il 18-10-2026

- La finestra SDL è **già** a schermo intero (`fullscreen_desktop()` in `run_window`, `sws-lvgl-viewer/src/main.rs`):
  è il **display LVGL** dentro che nasce alla misura della prima pagina (`resolve_resolution` in `lvgl_render.rs`) e
  non cambia più. Con una prima pagina di 1280×768 su 1280×800: display da 768, centrato con `page_offset`, quindi
  due fasce, e le pagine alte 800 scorrono.
- Il ramo DRM conosce lo schermo e centra le pagine più piccole (`page_offset` a `main.rs:309`).
- `size_mode` non compare nel crate del viewer LVGL: `ratio` e `fluid` divergono dal web (vedi il seme).
- La proposta di una cornice alla prima pagina è già decisa nel piano delle cornici (quattro scelte: navigazione in
  alto, in basso, solo testata, vuota).

### Gruppo 1 — fatto il 18-10-2026, da collaudare

Decisioni del maintainer: una pagina più piccola dello schermo va **centrata col margine neutro**; per `ratio`/`fluid`
su LVGL **un avviso nell'IDE adesso**, la scalatura vera dopo, come piano a parte.

- il display LVGL segue la pagina aperta (`lvgl_display::ridimensiona`); SDL, DRM, touch e istantanea rileggono la
  misura; `--istantanea --poi <pagina>` per provarlo senza pannello;
- avviso `page_layout.size_mode` per i progetti LVGL non `fixed`;
- `PropostaCornice` nel ramo Cornici.

Resta da fare, sul pannello: un progetto LVGL con pagine di misure diverse, sul TC620.

### Gruppo 2 — fatto il 18-10-2026, da collaudare

Decisioni: base + segmenti + extra, grassetto vero, alias ricondotti e avviso per i nomi sconosciuti. Vedi
[il seme archiviato](2026-10-15-font-e-display-a-segmenti.md).

### Gruppo 3 — fatto il 18-10-2026, da collaudare

Decisioni: preset di tempo, schermo intero, CSV dall'IDE collegato. Il tratto che oscillava era lato server (anche
web). Vedi [il seme archiviato](2026-10-04-trend-lvgl-come-il-web.md).

### Gruppo 4 — fatto il 18-10-2026, da collaudare

Archivio dei progetti (con i permessi di eliminare, contato nella quota di spazio), log del pannello nell'IDE (INFO;
DEBUG a richiesta per l'amministratore di piattaforma), scorciatoie modificabili.

### Gruppo 5 — chiuso il 26-10-2026

Strumenti ramo 3, predefiniti fasi 2-3 e tag dopo la Fase 2 sono in archivio (il piano dei tag chiuso col client
OPC-UA delle strutture, `dcc4dfdb`). Il [tubo che segue gli oggetti](../plans/2026-10-21-tubo-che-segue-gli-oggetti.md) è
fatto e uscito nella 2.19.0; resta in `plans/` solo per la conferma sullo schermo di un pannello.

### Gruppo 6 — fatto il 26-10-2026, da collaudare

Trasporto Modbus dichiarato nel catalogo (`09de3f23`), bus TCP implicito (`3366e8f7`), configuratore dei moduli
applicato a ogni collegamento scrivendo solo le differenze (`ad654a53`). Collaudo con l'MCM sul TC620.

### Gruppo 7 — deciso: no (22-10-2026)

L'immagine di accensione resta vettoriale statica: vedi il [seme archiviato](2026-09-19-boot-image-widget-congelati.md).

### Gruppo 8 — fatto

Certificati in un posto solo, archiviato (`9d58dbf3`); C4, l'HTTPS proposto col certificato del dispositivo
(`d3e807f4`), archiviato.

### Gruppo 9 — fatto il 26-10-2026, da collaudare

P2 «Crea faceplate dalla selezione» (`736c714a`), P3 [report programmati](../plans/2026-10-26-report-programmati.md)
(`b000f309`), P4 [SMS, voce e reperibilità](../plans/2026-10-26-sms-voce-reperibilita.md) (`2d8d50b7`).
