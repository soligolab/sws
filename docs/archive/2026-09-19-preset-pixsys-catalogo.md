# Preset dei dispositivi Pixsys: quali risoluzioni, con che nome

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **decisione**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## L'idea

`sws-editor/public/branding/pixsys/brand.json` elenca i preset di risoluzione che l'IDE offre («Preset
dispositivo» nelle proprietà di pagina). Il piano dell'immagine di boot voleva aggiungerci le risoluzioni della
tabella di `docs/branding/BRAND_SWS.md` che mancano.

## Cosa è stato misurato (19-09-2026)

Il preset oggi ha cinque righe per prodotto (WP570, WP800, WP815/WP615, WP820/WP620, WP830/WP630). Nella tabella
di `BRAND_SWS.md`:

| Pollici | Risoluzione | Stato nella tabella |
|---|---|---|
| 4.3" | 480 × 272 | da confermare |
| 7" | 800 × 480 | **confermato (TD710)** — aggiunto il 19-09 |
| 10.1" | 1280 × 800 | da confermare (esiste già come WP815/WP615) |
| 10.1" | 1280 × 768 | confermato («device attuale»), senza nome di prodotto |
| 15" | 1366 × 768 | da confermare |
| 15.6" | 1920 × 1080 | da confermare (esiste già come WP830/WP630) |

Il TC620 provato il 19-09 ha un display **1280×800** (`/sys/class/graphics/fb0/virtual_size`).

## La decisione da prendere

Un preset ha un **nome di prodotto**, e i nomi dei modelli con 480×272, 1280×768 e 1366×768 non stanno in nessun
file del repo: inventarli sarebbe sbagliato. Servono dal maintainer (o dal catalogo Pixsys): il nome di ogni
modello e la conferma della risoluzione. Opzione se i nomi non ci sono: preset per **sola risoluzione**
(«480×272», senza prodotto), meno informativo ma vero.

