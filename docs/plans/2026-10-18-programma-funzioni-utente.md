# Programma — le funzioni per chi usa SWS, in ordine

> 18-10-2026. Il maintainer: «porterei avanti tutte queste cose», sull'elenco dei piani e dei semi legati all'uso
> (pannello e IDE). Questo file **non è un piano d'esecuzione**: è l'ordine in cui si prendono, a gruppi. Ogni
> gruppo comincia con **una sessione di plan approfondita** sui suoi semi, con le decisioni del maintainer, e
> diventa un ramo, o rami annidati, secondo «Un ramo alla volta».
>
> L'onda 3 del [piano prima fascia e CRA](2026-10-15-piano-prima-fascia-e-cra.md) (2FA/LDAP e TLS di default)
> resta in coda a parte, perché vuole le sue tre decisioni.

## L'ordine

| # | Gruppo | Semi e piani | Perché qui |
|---|---|---|---|
| 1 | **Lo schermo LVGL a misura** | [finestra a misura dello schermo](../archive/2026-10-17-finestra-lvgl-misura-schermo.md), [LVGL e `size_mode`](2026-09-24-lvgl-ignora-size-mode.md), proposta di una cornice alla prima pagina ([cornici](../archive/2026-10-15-cornici-di-pagina.md)) | il difetto visto sul TC620; tocca lo stesso punto (la risoluzione del display), poco codice |
| 2 | **Font e display a segmenti** | [font](../archive/2026-10-15-font-e-display-a-segmenti.md) | si vede subito su web e pannello; LVGL oggi ha un font solo |
| 3 | **Trend sul pannello come sul web** | [trend LVGL](../archive/2026-10-04-trend-lvgl-come-il-web.md) | parità web/LVGL, più il tratto che oscilla da capire |
| 4 | **IDE quotidiano** | [archivio dei progetti](../archive/2026-10-15-archivio-dei-progetti.md), [log del dispositivo](../archive/2026-10-03-log-del-device-nell-ide.md), [scorciatoie](2026-09-25-scorciatoie-da-tastiera.md) | tre cose piccole e indipendenti |
| 5 | **Pezzi rimasti di piani avviati** | [strumenti, ramo 3](2026-10-14-strumenti-simboli-comandi.md), [tubazioni, punto 6 di B](2026-10-15-tubazioni-bocche-e-stili.md), [predefiniti, fasi 2-3](2026-09-30-predefiniti-espliciti.md), [tag, fasi dopo la 2](2026-09-21-gestione-tag-oggetto-unico.md) | ognuno ha già un piano: va riletto contro il codice di oggi |
| 6 | **Dispositivi di campo** | [configuratore dei moduli](2026-10-04-configuratore-moduli.md), [Modbus TCP senza bus](2026-10-06-modbus-tcp-senza-bus-e-trasporto-nel-catalogo.md) | stessa area (catalogo, sorgenti), da collaudare con l'MCM sul TC620 |
| 7 | **Immagine di accensione** | [widget congelati](2026-09-19-boot-image-widget-congelati.md) | dipende dal rasterizzatore, indipendente dal resto |
| 8 | **Certificati in un posto solo** | [certificati](2026-10-15-certificati-in-un-posto-solo.md) | si sovrappone a C4 (TLS di default): va con l'onda 3 |
| 9 | **Le funzioni grandi** | P3 report programmati, P4 notifiche SMS e voce, P2 template d'oggetto ([piano prima fascia](2026-10-15-piano-prima-fascia-e-cra.md)) | ognuna vuole il suo plan e decisioni di prodotto |

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
[il seme archiviato](../archive/2026-10-15-font-e-display-a-segmenti.md).

### Gruppo 3 — fatto il 18-10-2026, da collaudare

Decisioni: preset di tempo, schermo intero, CSV dall'IDE collegato. Il tratto che oscillava era lato server (anche
web). Vedi [il seme archiviato](../archive/2026-10-04-trend-lvgl-come-il-web.md).
