← [Indice](MAIN.md) | [← Multilingua](15_multilingua.md) | [Successivo → Sicurezza](17_sicurezza.md) →

---

# 16 — Prestazioni misurate

> Quanto regge il runtime con tanti tag e tanti client, su un pannello e su un server, e su quali numeri sono tarati
> i limiti alle richieste. Per chi dimensiona un impianto.
>
> Misurato sul codice il 20-10-2026; le misure sono del 17 e 18-10-2026.

Quanto regge il runtime, misurato e non stimato (P5 dell'onda 2, 17-10-2026; piano
`docs/archive/2026-10-17-onda-2-prestazioni-e-protezioni.md`). I numeri grezzi sono in `docs/prestazioni/`.

## Cosa si misura

Per ogni casella della griglia (tag × client), 60 secondi:

- **il carico**: un produttore scrive ognuno degli N tag **una volta al secondo**, come farebbe un driver;
- **i client**: K connessioni al WebSocket dei tag del viewer, come K browser aperti sulla pagina;
- **aggiornamenti arrivati**: quanti valori riceve ogni client al secondo (atteso: N). Il numero un po' più alto
  dell'atteso è lo snapshot che ogni client riceve appena si collega;
- **latenza**: dal momento in cui il banco scrive un tag d'eco a quando ogni client lo vede, misurata sulla stessa
  macchina del banco, quindi indipendente dagli orologi. Dipende soprattutto dal raggruppamento dei messaggi ogni
  50 ms: per questo oscilla fra pochi millisecondi e circa 50;
- **CPU e memoria del processo del runtime**, da `/metrics` (`sws_process_cpu_pct`, `sws_process_rss_bytes`), un
  campione al secondo. La CPU è in percentuale di **un** core: oltre 100 vuol dire più di un core.

Non si misura il disegno: un browser vero aggiunge il proprio lavoro, che dipende dalla pagina e dal dispositivo.

## TC620 (pannello)

Il runtime del pannello, client dal PC in rete locale sulla porta del viewer.

| tag | client | aggiornamenti arrivati al secondo, per client | latenza mediana ms | latenza 95° perc. ms | CPU del runtime media / max % | memoria del runtime max MB |
|---|---|---|---|---|---|---|
| 100 | 1 | 101 | 50 | 51 | 2 / 3 | 65 |
| 100 | 5 | 101 | 50 | 51 | 3 / 4 | 66 |
| 100 | 20 | 101 | 5 | 53 | 5 / 6 | 67 |
| 1.000 | 1 | 1.010 | 54 | 56 | 10 / 15 | 90 |
| 1.000 | 5 | 1.011 | 4 | 7 | 13 / 17 | 94 |
| 1.000 | 20 | 1.010 | 14 | 28 | 24 / 29 | 104 |
| 5.000 | 1 | 5.031 | 7 | 9 | 47 / 55 | 138 |
| 5.000 | 5 | 5.032 | 16 | 18 | 57 / 65 | 146 |
| 5.000 | 20 | 5.033 | 29 | 49 | 100 / 140 | 165 |

## x86 (riferimento server)

Intel Core i5-2500 a 3,3 GHz (2011), runtime e client sulla stessa macchina.

| tag | client | aggiornamenti arrivati al secondo, per client | latenza mediana ms | latenza 95° perc. ms | CPU del runtime media / max % | memoria del runtime max MB |
|---|---|---|---|---|---|---|
| 100 | 1 | 101 | 50 | 50 | 1 / 2 | 41 |
| 100 | 5 | 101 | 50 | 51 | 1 / 2 | 41 |
| 100 | 20 | 101 | 50 | 52 | 1 / 3 | 43 |
| 1.000 | 1 | 1.013 | 52 | 53 | 3 / 5 | 47 |
| 1.000 | 5 | 1.013 | 53 | 56 | 4 / 7 | 52 |
| 1.000 | 20 | 1.013 | 5 | 11 | 7 / 9 | 65 |
| 5.000 | 1 | 5.009 | 2 | 4 | 10 / 14 | 83 |
| 5.000 | 5 | 4.881 | 59 | 66 | 12 / 19 | 104 |
| 5.000 | 20 | 4.936 | 14 | 43 | 20 / 26 | 159 |

## Come leggerli

- Sul TC620, **1.000 tag aggiornati ogni secondo verso 20 browser** costano un quarto di core, con latenza sotto i
  30 ms; **5.000 tag verso 5 browser** poco più di mezzo core. Il limite pratico si vede a **5.000 tag × 20
  browser**: un core intero in media, con picchi a 1,4, e nessun aggiornamento perso.
- Su x86 a 5.000 tag con più client si perde l'1-3% degli aggiornamenti: è il punto in cui il raggruppamento a 50 ms
  comincia a non bastare. Sul TC620, nella stessa griglia, non succede.
- La memoria cresce con il numero di tag e di client, senza derive nel minuto di misura.

## Rifare la misura

```bash
./scripts/banco_prestazioni.sh x86                       # runtime di prova su questa macchina, fermato alla fine
SWS_BANCO_UTENTE=admin SWS_BANCO_PASSWORD=… \
  ./scripts/banco_prestazioni.sh tc620 <host> <progetto>  # un pannello, riapre <progetto> alla fine
```

Sul pannello il banco carica un progetto suo (`banco-prestazioni`, con un Admin uguale a quello con cui entra) e alla
fine riapre il progetto indicato, anche se la misura fallisce; la cartella del progetto di prova resta sul pannello e
va tolta a mano. `SWS_BANCO_TAG`, `SWS_BANCO_CLIENT` e `SWS_BANCO_DURATA` cambiano la griglia.

## I limiti alle richieste, tarati su queste misure

Dal 18-10-2026 il runtime limita le richieste alle API **per indirizzo**, con due secchi di gettoni distinti
(`sws-web/src/limiti.rs`): oltre il tetto risponde `429 Too Many Requests` con `Retry-After` e un messaggio leggibile.

| Secchio | Raffica | Al secondo | Da dove viene |
|---|---|---|---|
| letture (`GET`) | 500 | 75 | aprire l'IDE e girare tre pagine fa 151 richieste, con un picco di 23 al secondo; il viewer 32 (picco 17/s). ×3 |
| scritture (il resto) | 100 | 25 | il banco ne fa una al secondo per client, un cursore scrive solo al rilascio, i clic di una persona sono sotto le 10 al secondo. Più di ×3 |

- **Non si contano** i file dell'interfaccia, i WebSocket dei dati vivi (sono una connessione sola), `/health`, il
  **loopback** (sul pannello: kiosk, viewer LVGL, tunnel SSH dell'IDE) e il traffico dei container di progetto dietro
  il gateway, già contato dal gateway.
- **Nel cloud oggi il limite non agisce**: dietro Traefik rootless ogni visitatore arriva con lo stesso indirizzo
  interno, e il gateway non conta gli indirizzi privati per non rifiutare tutti insieme. Vedi il seme
  `docs/plans/2026-10-18-indirizzo-vero-dietro-traefik.md`.
- **Più persone dietro lo stesso indirizzo** (un ufficio dietro un NAT, verso il cloud) dividono lo stesso secchio. Per
  quel caso: `SWS_LIMITE_LETTURE=<raffica>/<al secondo>` e `SWS_LIMITE_SCRITTURE=…`, oppure `0` per spegnere il limite.
- **Verificato** il 18-10-2026 su x86, con le richieste dall'indirizzo di rete: il banco a 1.000 tag × 20 client e
  l'apertura di IDE e viewer non hanno ricevuto nessun 429; con `SWS_LIMITE_LETTURE=20/1`, 60 richieste in raffica
  hanno ricevuto 20 risposte e 40 rifiuti, mentre dal loopback sono passate tutte.

## Dove se ne va il tempo, guardando

Le misure sopra dicono **quanto** regge il runtime visto da fuori. Per sapere **quale lavoro** lo occupa c'è
**Configurazione → Istanza → Prestazioni** (dal 26-10-2026; piano `docs/plans/2026-10-26-dove-se-ne-va-il-tempo.md`):
una colonna per questa istanza e, con un pannello collegato, una per il pannello. Si aggiorna ogni 2 secondi.

- **Viewer LVGL**: i fotogrammi al secondo veri e, per ogni fase del fotogramma, quanto pesa **in media su un
  fotogramma** (la barra è piena a 16 ms, un fotogramma a 60 al secondo), con media, 95° percentile e massimo:

  | Fase | Cosa c'è dentro |
  |---|---|
  | Tag e collegamenti | la copia dei valori e l'aggiornamento di ogni oggetto legato a un tag |
  | Disegno LVGL | il lavoro di LVGL: layout, ridisegno delle zone cambiate |
  | Copia sul display | il fotogramma copiato e convertito nel buffer dello schermo |
  | Tubo: corpo (SVG), bocchettoni, simboli, barre, trend, tabelle | le rasterizzazioni dei canvas, quando si ridisegnano |

- **Runtime**: per ogni lavoro — il giro di ogni sorgente (`sorgente.<id>`), un messaggio MQTT o un valore OPC-UA,
  lo storico, gli allarmi, i tag calcolati, ogni script (`script.<id>`), l'invio dei tag a un client (`ws.tags`) —
  quante volte al secondo, media, 95° percentile, massimo e quota dell'intervallo. Sono **tempi di parete**: il giro
  di una sorgente comprende l'attesa della risposta del dispositivo.
- **Il viewer parla solo se qualcuno guarda.** Misura sempre (pochi nanosecondi per fase), ma manda i numeri al runtime
  solo mentre la pagina è aperta: ogni 10 secondi chiede se c'è una richiesta, e finché c'è manda il riassunto ogni
  2. Chiusa la pagina, entro un minuto torna zitto. Il primo riassunto arriva entro 10 secondi dall'apertura.
- **Per chi usa Prometheus**: gli stessi lavori del runtime in `/metrics`, come istogramma
  `sws_lavoro_secondi{lavoro=…}` (cumulato dall'avvio).

---

← [Indice](MAIN.md) | [← Multilingua](15_multilingua.md) | [Successivo → Sicurezza](17_sicurezza.md) →
