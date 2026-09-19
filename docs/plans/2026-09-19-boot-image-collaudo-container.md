# Immagine di boot: il giro completo col runtime nel container

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **verifica**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## Cosa è stato provato e cosa no

Il 19-09-2026, sul TC620 `tc620-a-p3-c6-07aff9` (PixsysOS 2.1.1, appena formattato) come `user`: la **metà host**
— le unit `sws-boot-image.{path,service}` e `sws-boot-image-apply.sh`, con un PNG 1280×800 e un trigger scritti
**a mano** — installa l'immagine, `GetBackgroundImage` risponde `boot.png`, e il maintainer ha visto l'immagine
al riavvio. La **metà runtime** (`sws-web/src/boot_image.rs`) è coperta dai test con cartelle temporanee, ma
**non è mai girata nel container sul dispositivo**: l'immagine del container non è stata ricostruita.

## Cosa resta da vedere

1. `./scripts/build_container.sh` (aarch64), poi `install-container.sh` sul dispositivo: le tre unit si installano
   da sole e `sws-boot-image.path` risulta attiva (l'installer lo controlla e lo dice).
2. Dall'IDE: progetto con una pagina di boot abilitata e il PNG generato → deploy → `boot-image/` compare in
   `/data/user/sws/config/` → `status` scritto dall'host → la riga «Immagine di boot» della scheda Runtime.
3. **Permessi fra container e host**: `boot-image/` la crea il container rootless (uid mappato), lo script host
   gira come `user` e deve poter **scrivere** `status` e `applied` in quella cartella e leggere `trigger` e
   `boot.png`. Nei test è ovvio; sul dispositivo con podman rootless non è stato guardato.
4. Un deploy **senza** pagina abilitata: `trigger` = `none`, stato `nessuna_immagine`, l'immagine del dispositivo
   intatta.
5. Un PC/scheda **senza** launcher: stato `non_supportato`, nessun errore.

## Da sapere prima di cominciare

Il ripristino sul dispositivo di prova: `busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher
net.pixsys.Config1.Launcher ResetBackgroundImage`. Il dispositivo è stato ripulito il 19-09 (unit e file tolti).

