# Immagine di boot: tornare a quella di fabbrica dall'IDE

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **decisione**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## L'idea

Oggi un progetto senza pagina di boot abilitata **non tocca** l'immagine del dispositivo: `none` non è «ripristina
l'originale». Per tornare a quella di fabbrica bisogna andare sul dispositivo (`ResetBackgroundImage` via
`busctl`, in `docs/HOWTO.md` §17). Il piano dell'immagine di boot dichiarava un'**azione esplicita** dell'IDE
come lavoro futuro.

## Cosa è stato misurato (TC620, 19-09-2026)

`ResetBackgroundImage` chiamata come `user` funziona, senza polkit: `GetBackgroundImage` torna a `"Default"` e il
file sparisce da `/etc/pixsys/pixsys-launcher/assets/`. Come `SetBackgroundImage`, ha effetto al prossimo avvio.

## Opzioni visibili

- **Pulsante nella scheda Runtime**, dopo la connessione («Ripristina l'immagine di fabbrica»): il runtime scrive
  una richiesta diversa da `trigger` (per esempio `boot-image/reset`) e lo script host la esegue e scrive `status`.
  Riusa il canale di F5, con la stessa unit `.path`.
- **Un terzo valore del trigger** (`reset` accanto a `none` e allo SHA): un file solo, ma `none` e `reset`
  diventano facili da confondere.
- **Non farlo**: `HOWTO` §17 dà già il comando, e il caso è raro.

Da decidere anche: se serve una conferma (è un'azione sul dispositivo, non sul progetto) e chi la può fare
(Admin?).

