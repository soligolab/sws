# Seme — la finestra del viewer LVGL prende la misura dalla prima pagina, non dallo schermo

> **Seme — decisione.** Trovato il 17-10-2026 sul TC620 di casa (`tc620-garage`), cercando le fasce e la barra di
> scorrimento che il maintainer vedeva sullo schermo.
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**

## Cosa succede

Con il backend a finestra (SDL, `run_window` in `sws-lvgl-viewer/src/main.rs`) la finestra e il display LVGL nascono
alla misura della **prima pagina** aperta (`lvgl_render.rs`, `hor_res`/`ver_res` da `page.width/height`) e non
cambiano più. Una pagina iniziale 1280×768 su uno schermo 1280×800 dà una finestra di 1280×768, centrata da Weston:
due fasce da 16 px, e ogni pagina alta 800 scorre con la barra.

Il ramo DRM invece conosce lo schermo e centra le pagine più piccole (`page_offset`).

## Misurato il 17-10-2026

- TC620: `fb0` e `LVDS-1` a 1280×800, un modo solo; Weston con `desktop-shell`, `panel-position=none`; il viewer gira
  come finestra X11 (SDL via Xwayland).
- Quel giorno il difetto si è visto su un progetto **web** solo perché il viewer era stato riacceso a mano dopo la
  commutazione (errore di procedura, corretto). Nei progetti LVGL si vede comunque, ogni volta che la pagina
  iniziale non ha la misura dello schermo.

## Strade possibili

- finestra alla misura dello schermo (SDL la conosce), pagine centrate come nel ramo DRM;
- oppure riaprire la finestra quando la pagina cambia misura.
