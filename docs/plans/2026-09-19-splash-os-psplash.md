# Lo splash del sistema operativo, prima del launcher (ex Q13)

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **decisione**. Il testo integrale della scheda Q13 sta nell'Appendice B del piano archiviato.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## L'idea

T-72 porta un'immagine al **launcher Pixsys**, che disegna a `sysinit.target`, prima di Weston. Resta scoperto
ciò che appare **prima** del launcher: lo splash del sistema operativo (psplash o simile). È la domanda Q13
originale, invariata.

## Cosa è noto

- Nessun meccanismo di splash OS-level esiste in `deploy/yocto/` o `scripts/`.
- Il launcher legge il suo TOML all'avvio; l'immagine di T-72 compare quando parte il launcher, non prima.
- Le risoluzioni target e il metodo di composizione (master 1920×1080, safe-area 1280×720) stanno in
  `docs/branding/BRAND_SWS.md`.
- Il provisioning OS-level dei pannelli Pixsys è **fuori dal perimetro software di questo repo**: è una
  configurazione del sistema (immagine Yocto), non del progetto.

## La domanda

Se e come il repo debba toccare lo splash del sistema operativo — o se resti una consegna a mano al
provisioning. Da rileggere: `docs/archive/2026-09-18-immagine-di-boot.md`, Appendice B.

