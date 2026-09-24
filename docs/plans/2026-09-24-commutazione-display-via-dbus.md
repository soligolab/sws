# La commutazione web/LVGL senza niente sull'host — seme

> Nato il 24-09-2026, subito dopo che l'immagine di accensione ha smesso di avere pezzi sull'host
> ([`launcher_dbus.rs`](../../sws-runtime/crates/sws-web/src/launcher_dbus.rs), commit
> `2749b043`). Vincolo del maintainer di quel giorno: «nell'host non puoi toccare nulla, tutto
> deve essere fatto con chiamate dBus dal container».
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Qui c'è solo l'idea e ciò che
> è stato misurato adesso: fra la domanda e il lavoro cambiano sia PixsysOS sia il nostro
> container, e un disegno scritto mesi prima è un disegno che mente.

## L'idea

La commutazione fra viewer web e viewer LVGL è **l'ultimo meccanismo a file** rimasto: il runtime
scrive `display-target` (`web` o `lvgl`, derivato da `target.kind` del progetto) e sull'host tre
pezzi installati a mano lo osservano e applicano. È esattamente il disegno che l'immagine di boot
aveva fino al 24-09 e che il vincolo ha appena eliminato. Stesso trattamento, stesso movente:
**quello che il container sa, il container lo chiede da sé.**

## Cosa c'è oggi, misurato sul WP630 (PixsysOS 2.1.1, 24-09-2026)

Sull'host, fuori dalla nostra immagine:

| pezzo | dove |
|---|---|
| `sws-display.path`, `sws-display.service` | `~/.config/systemd/user/` |
| `sws-display-apply.sh` (~200 righe) | `/data/user/sws-container/` |

Lo script fa **quattro** cose, e solo la prima è già D-Bus:

1. **Politica del browser** — `net.pixsys.Config1.WebBrowser.{GetEnabled,SetEnabled,SetUrl}` sul
   bus **di sistema**. Il container `sws-runtime` quel socket ce l'ha già montato
   (`/run/dbus/system_bus_socket`, verificato oggi): questa parte si sposta senza aggiungere niente
   al quadlet.
2. **Fermare/avviare il browser** — `systemctl stop chromium@main-app.service`, unit di
   **sistema**. In D-Bus è `org.freedesktop.systemd1.Manager.StopUnit` sul bus di sistema. Polkit
   lo concede all'utente `user` (verificato il 2026-08-27, commento nello script), e dal container
   l'uid visto dall'host è 1000 grazie a `UserNS=keep-id` — la stessa riga che ha sbloccato la
   chiamata al launcher.
3. **Avviare/fermare il viewer LVGL** — `systemctl --user sws-lvgl-viewer.service`, unit
   **utente**. Qui serve il bus di **sessione**, `/run/user/1000/bus`, che nel container oggi
   **non c'è** (verificato: `No such file or directory`). È l'unica riga di quadlet nuova che
   servirebbe — e la domanda vera di questo seme: montare il bus utente dà al runtime il diritto
   di comandare ogni unit dell'utente, non solo la nostra.
4. **Il ripiego per PixsysOS < 2.1.0** — `systemctl disable/enable --now` sul browser, concesso
   dalla regola polkit `17-chromium.rules`. In D-Bus sono `DisableUnitFiles`/`EnableUnitFiles`.
   Lo script lo marca `RIPIEGO` e dice che va tolto quando 2.1.0 sarà ovunque: se al momento del
   lavoro lo è, il punto sparisce invece di essere tradotto.

## Una cosa scoperta oggi e che non era scritta da nessuna parte

Il viewer LVGL **non disegna sul framebuffer**. Il suo container non vede né `/dev/fb0` né
`/dev/dri`; ha `SDL_VIDEODRIVER=x11` e `DISPLAY=:0`, e all'avvio del viewer parte un **Xwayland**
(pid vicino al suo) che presenta la finestra a Weston. La catena è
`sws-lvgl-viewer → SDL/X11 → Xwayland → Weston`, ed è per questo che browser e viewer, prima che
lo script esistesse, si **sovrapponevano** invece di escludersi: erano due finestre dello stesso
compositore. Chi rifarà la commutazione deve sapere che l'esclusione è una scelta nostra, non una
proprietà dello schermo.

Corollario per il collaudo: **non esiste una prova a schermo automatica**. `weston-screenshooter`
sul WP630 risponde `unauthorized` (serve un client privilegiato, e l'host non si tocca), il
framebuffer è `root:video` e l'utente non è nel gruppo. Si verifica per processi e per log — o con
l'occhio del maintainer.

## Le opzioni già visibili

- **A — tutto nel container**: montare anche `/run/user/1000/bus`, tradurre i quattro punti in
  chiamate D-Bus, cancellare `.path`, `.service` e lo script. Zero pezzi sull'host, come l'immagine
  di boot. Costo: il runtime può comandare qualunque unit utente.
- **B — misto**: spostare solo i punti 1 e 2 (bus di sistema, già montato) e lasciare all'host
  l'avvio del viewer LVGL. Riduce l'host a un pezzo solo, ma non lo elimina: il vincolo del
  maintainer resta disatteso a metà.
- **C — il viewer lo avvia il runtime**: niente unit utente, il container LVGL lo lancia il
  runtime via Podman. Cambia il modello di deploy, non solo la commutazione — da pesare a parte.

## Cosa la sessione di plan dovrà decidere

- Se montare il bus utente, e con quale limite (esiste un modo di concedere una sola unit?).
- Che fine fa `display-target`: resta come stato leggibile, o sparisce con il meccanismo?
- Chi applica la commutazione al **primo avvio**, quando il runtime parte e il progetto chiede già
  `lvgl`: oggi lo fa il `.path` al primo cambio di file.
- Come si disinstalla il vecchio meccanismo sui dispositivi che ce l'hanno già installato a mano.
