# La rotazione dello schermo: progetto verticale e dispositivo capovolto

> Nato dal passo 8 di [funzioni di tyx_panelcontrol](2026-11-14-funzioni-di-tyx-panelcontrol.md), che lo lasciava
> come piano a sé. Richiesta del maintainer del 15-11-2026: «Implementa la rotazione».
> Ramo: `fix/sfondi-alla-misura` (lo stesso del pannello di controllo: tocca gli stessi file).

## Deciso dal maintainer (15-11-2026)

- **L'orientamento è del progetto**: «il progetto deve nascere nella IDE in landscape o portrait e poi nel device
  posso settare la rotazione 180 gradi». Sul dispositivo non si scelgono 90 o 270.
- **Scelta esplicita nel progetto**: «Orizzontale / Verticale» alla creazione e in Impostazioni progetto, accanto al
  dispositivo. Un campo nuovo, non dedotto dalle misure.
- **Si può cambiare dopo, e scambia anche le pagine**: cambiando orientamento il formato predefinito e tutte le
  pagine esistenti scambiano larghezza e altezza. Gli oggetti restano dove sono: qualcuno finisce fuori pagina, e
  l'IDE lo dice.
- **Verso del verticale: in senso orario.** Guardandolo di fronte il pannello si gira di 90° in senso orario: il
  lato che era a sinistra finisce in alto. L'altro verso è il capovolgimento di 180° dal pannello di controllo.
- **Gli angoli seguono il disegno, non il vetro**: «in alto a sinistra» è l'angolo in alto a sinistra della pagina
  come la vede chi sta davanti. Vale per l'angolo che riavvia, per quello che apre il pannello di controllo e per il
  riquadro di anteprima.
- **Prodotti**: adesso il viewer LVGL (Tiny TY, PC). Per i TC/WP si misura cosa fa `Display.SetRotation` di
  PixsysOS sul TC620 e si torna dal maintainer prima di scrivere.

## Misurato nel codice (15-11-2026)

- Il progetto ha `page_layout` (`PageLayoutConfig`): `default_width`, `default_height`, `dispositivo`. Le pagine
  portano sempre `width`/`height` espliciti, ed è da lì che il viewer LVGL prende la misura del display LVGL
  (`lvgl_display::ridimensiona`): il display LVGL è grande quanto la pagina, e la pagina si centra sullo schermo.
- Sul backend DRM lo schermo vero entra in due punti soli: `DrmDisplay::copia` (la zona ridisegnata copiata nel
  framebuffer) e `touch_indev` (le coordinate grezze portate alla misura della pagina). Tutto il resto, pannello di
  controllo e angoli compresi, ragiona già nello spazio della pagina.
- Sul backend SDL (PC) la finestra è grande quanto la pagina: una pagina verticale dà una finestra verticale. Lì
  non c'è niente da ruotare.
- L'immagine di avvio del Tiny TY è un file raw scritto nel verso del framebuffer (`boot_image::raw_bgra`).
- TC620, PixsysOS 2.1.3: `net.pixsys.Config1.Display` ha `GetRotation() -> u` (oggi 0) e `SetRotation(u)`.

## Il lavoro

1. **Il modello**: `page_layout.orientation` (`landscape` se manca, `portrait`), in `sws-core` e nei tipi dell'IDE.
2. **Il viewer LVGL su DRM**: una rotazione di 0, 90, 180 o 270 gradi, somma di progetto (verticale = 90) e
   dispositivo (capovolto = 180).
   - In uscita `DrmDisplay::copia` porta la zona nello spazio del vetro; margine e ritaglio si calcolano sulla
     misura ruotata.
   - In entrata `touch_indev` porta il tocco dallo spazio del vetro a quello della pagina.
   - Angoli e riquadro non cambiano: sono già nello spazio della pagina.
   - Un touch resistivo calibrato va ricalibrato dopo un cambio di rotazione: la calibrazione fatta a schermo
     ruotato contiene già la rotazione.
3. **Il dispositivo capovolto**: `flipped` in `control_panel.json`, una scheda in Schermo («Capovolto di 180°»),
   solo dove il viewer ruota da sé (`SWS_ROTATION_BY_VIEWER`, messo dal lanciatore del Tiny TY).
4. **L'immagine di avvio del Tiny TY**: il runtime la ruota prima di scriverla, con la stessa rotazione.
5. **L'IDE**: la scelta alla creazione e in Impostazioni progetto; il cambio scambia formato e pagine.
6. **TC/WP**: misura sul TC620 e domande al maintainer.

## Collaudo

Sul TY570: un progetto verticale mandato al pannello (pagine dritte guardandolo ruotato in senso orario, tocco
giusto, angoli giusti), il capovolgimento dal pannello di controllo, l'immagine di avvio nel verso giusto.

## Fatto il 15-11-2026

Passi 1-5 scritti (`ed12142d` viewer e runtime, poi l'IDE). Scelte prese scrivendo, da confermare al collaudo:

- girano le pagine grandi quanto lo schermo (pagine, boot, cornici); finestre e faceplate tengono la loro forma;
- la scelta sta in Impostazioni progetto → formato: è la finestra che l'IDE apre da sé alla nascita del progetto,
  quindi vale anche «alla creazione»;
- un preset di dispositivo scelto in un progetto verticale entra con le misure già girate;
- il tocco non calibrato passa dalla rotazione; un resistivo calibrato va ricalibrato a schermo girato.

Non provato su un dispositivo: serve un progetto verticale mandato al TY570. Resta il passo 6 (TC/WP): sul TC620
`GetRotation` dà 0; `SetRotation` non l'ho chiamato, perché gira lo schermo del pannello di prova.

## TC/WP: cosa dice PixsysOS (15-11-2026)

- `net.pixsys.Config1.Display.SetRotation(u)` **riavvia il pannello**: provato sul TC620, due riavvii (valore 1 e poi
  di nuovo 0). Al ritorno `GetRotation` dà il valore scritto. `weston.ini` resta `transform=normal`: la rotazione la
  applica PixsysOS da un'altra parte.
- **Valori** (maintainer, 15-11-2026): **1 = 90° in senso orario**, e così via per i valori successivi (2 = 180°,
  3 = 270°, da confermare guardando lo schermo). Il verso orario è quello che vuole il progetto verticale.
- **Il riavvio non è un problema** (maintainer): quello che serve sapere è che un deploy di un progetto con un
  orientamento diverso da quello del sistema **riavvia il pannello una volta**. Dopo il riavvio la rotazione
  coincide e non si riavvia più.
- Non ancora collegato: oggi cambiare l'orientamento nel progetto non tocca la rotazione di PixsysOS.

