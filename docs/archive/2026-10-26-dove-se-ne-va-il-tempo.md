# Dove se ne va il tempo: misurare l'occupazione dei singoli lavori

> **Archiviato il 27-10-2026: tutti e cinque i punti fatti.** Il punto 4 — «la build e il numero
> per scegliere il rimedio del tubo» — e' stato misurato sul WP630, che e' il pannello LVGL
> raggiungibile dall'ufficio, e il numero sta qui sotto. La scelta del rimedio non si fa: il
> maintainer ha guardato il tubo in movimento e va bene cosi'. Le idee di ottimizzazione che
> restano — il corpo del tubo con le primitive di LVGL, e la copia sullo schermo che si mangia 23
> ms su 35 — sono in `docs/plans/Appunti.txt`, da riprendere quando la fluidita' diventera' un
> problema.
>
> Quello che la misura ha aperto, invece, e' vivo: lo storico scrive una transazione per campione
> e i thread non hanno un nome. Sta nel piano
> [i thread del runtime](../plans/2026-10-27-thread-con-un-nome-e-una-priorita.md).

> **Era un seme, dal 26-10-2026 (sera) è un piano d'esecuzione.** La sessione di plan l'ha fatta una sessione su
> `ufficio`, misurando il codice; le tre decisioni sono del maintainer. Il testo del seme resta in coda, perché è il
> motivo per cui il lavoro è nato.

> **Il punto 4 è cambiato il 27-10-2026.** Il tubo che resta indietro il maintainer l'ha visto sul TC620 «così
> com'è», e il TC620 mostra il **viewer web** (Chromium in kiosk), non LVGL: la diagnosi dello STATUS del 26-10 era
> sul motore sbagliato. Misurato in Chromium, era un fotogramma di ritardo di React, corretto con `flushSync` sul
> ramo annidato `fix/tubo-stesso-fotogramma` (scarto da 55,6 px a zero). La misura costruita qui resta valida per il
> runtime e per i pannelli che usano LVGL; il collaudo sul TC620 guarda la colonna del runtime.

> **Punti 1-3 e 5 FATTI il 26-10-2026 (sera)** sul ramo `feat/dove-se-ne-va-il-tempo`. Provato da capo a fondo in
> locale con un runtime di prova e il viewer SDL senza schermo: la richiesta accende il viewer, il riassunto arriva,
> la pagina lo mostra (PC, build di debug: 59 fotogrammi al secondo, 8,2 ms di lavoro per fotogramma, di cui 6,2 di
> LVGL e 1,5 di copia sul display). **Resta il punto 4**: la build e la misura sul TC620, collaudo in
> `COLLAUDI_IN_SOSPESO.md`. Due scostamenti dal testo qui sotto: le rotte del viewer stanno sulla **porta del viewer**
> (7443), dove il viewer parla, e sono **pre-auth ma innocue** invece che «solo da loopback» — sul pannello le porte
> sono pubblicate su una rete rootless, e l'indirizzo di chi chiama non dice se è la stessa macchina.

## Il numero, misurato il 27-10-2026 sul WP630

Il punto 4 chiedeva «quanto costa su quella CPU». Risposto, con la pagina Prestazioni aperta
mentre il maintainer muoveva lo slider e la pompa scorreva sul percorso. Pannello su
`195e8c72-arm64`, progetto CasaDomotica, pagina Sandokan.

**28 fotogrammi al secondo, 35 ms di lavoro per fotogramma.**

| Fase | Per fotogramma | Volte | Media | p95 | Max |
|---|---|---|---|---|---|
| Copia sul display | **23 ms** | 58 | 23 | 27 | 27 |
| Disegno LVGL | 6,7 ms | 58 | 6,7 | 21 | 21 |
| Tag e collegamenti | 5,8 ms | 58 | 5,8 | 16 | 18 |
| → di cui **tubo: corpo (SVG)** | **4,9 ms** | 24 | **12** | 15 | 15 |
| Trend | 0,08 ms | 3 | 1,5 | 1,6 | 1,6 |

**Le fasi sono annidate**: `canvas.tubo.corpo` si misura dentro `update_bindings`
(`lvgl_render.rs:13449`), che è dentro la fase `tag`. Quindi dei 5,8 ms di «tag e collegamenti»,
**4,9 sono la rasterizzazione del corpo del tubo** — l'84%. Le tre fasi di primo livello fanno
35,6 ms, cioè il fotogramma intero.

### Cosa dicono questi numeri sul rimedio del tubo

- **Rasterizzare il corpo costa 12 ms, una volta su due fotogrammi** (24 ridisegni su 58). Dodici
  millisecondi è quasi un fotogramma intero a 60 al secondo, per un oggetto solo.
- **La strada 1 del seme — «non rifare ciò che non cambia» — qui non si applica al corpo.** La
  pompa si muove, quindi un estremo del tubo si muove: la forma cambia davvero, e la cache
  andrebbe buttata comunque. Il candidato della strada 1 erano i **bocchettoni**, e quelli in
  questo campione **non compaiono affatto**: in quei secondi non sono stati rifatti, quindi non
  costano niente da togliere.
- Resta la **strada 2**: disegnare il corpo con le primitive di LVGL invece che con un SVG. Il
  guadagno massimo è 4,9 ms su 35, cioè da 28 a circa 33 fotogrammi al secondo. **Decisione del
  maintainer**, perché gli stili ricchi del tubo (materiali, volume, contorno) con le primitive
  non si rifanno uguali.
- **Il tetto però è un altro, e sta sopra tutti: la copia sul display, 23 ms, a ogni fotogramma.**
  Da sola ferma il pannello a ~43 al secondo anche se tutto il resto fosse gratis. L'ipotesi 1 di
  questo piano diceva «candidato numero uno a mangiarsi il giro», e aveva ragione — ma per un
  motivo diverso da quello scritto: il WP630 **non** è sul percorso DRM. Il suo quadlet dice
  `SDL_VIDEODRIVER=x11` (il backend Wayland nativo di SDL2 va in SIGSEGV su questo hardware,
  Q14), quindi la fase misura `Surface::from_data` + `blit` + `SDL_UpdateWindowSurface`, cioè uno
  `ShmPutImage` di 1280×800 verso XWayland, in software e dentro un container.

### E dal lato runtime, due cose che non si cercavano

- **`derivati` è il lavoro più pesante del runtime**: 21,6% dell'intervallo, 12,6 giri al secondo
  da 17 ms di media (p95 27). A pannello fermo era l'1,8%.
- **Lo storico ha una coda lunga**: media 0,61 ms su 153 scritture al secondo, ma **massimo
  115 ms**. Un picco così, se capita nel momento sbagliato, è sette fotogrammi.

## Decisioni del maintainer (26-10-2026)

1. **Il viewer misura sempre e manda al runtime solo a richiesta.** Prendere l'ora a inizio e fine di ogni fase
   costa decine di nanosecondi: si accumula sempre, in memoria. I numeri escono solo quando qualcuno li guarda.
2. **Si guardano in una pagina dell'IDE**, Configurazione → Istanza → **Prestazioni**, per il pannello collegato
   (viewer + runtime); e in `/metrics` per chi ha Prometheus.
3. **Si fa subito**, prima di scegliere il rimedio del tubo: la scelta fra «non rifare ciò che non cambia» e
   «corpo con le primitive di LVGL» si fa col numero del TC620.

## Quello che la misura del codice ha trovato (ipotesi da verificare coi numeri)

Ciclo DRM del viewer, `sws-lvgl-viewer/src/main.rs:1476-1620`:

- **Lo schermo intero si copia e si converte a ogni giro, anche fermo.** `lvgl_display::copy_frame_rgb888` restituisce
  sempre `true`: 3 MB copiati (1280×800×3) e poi `DrmDisplay::flush_rgb888` riscrive il buffer DRM **un byte alla
  volta**, ~1 milione di pixel × 4 scritture, sessanta volte al secondo. Candidato numero uno a mangiarsi il giro.
- **Il tempo di LVGL avanza di 16 ms fissi** (`tick_inc(16ms)`) anche quando il giro ne dura 40: con giri lunghi,
  tutto ciò che va a tempo in LVGL rallenta (`LV_DISP_DEF_REFR_PERIOD` è 30 ms).
- **La mappa dei tag si clona intera a ogni giro** (`shared_tags.lock().clone()`), e `update_bindings` ripassa tutti
  i collegamenti.
- **Il tubo**: pompa (`LiveKind::Motion`) e tubo (`LiveKind::PipeFill` → `corpo.riposiziona` → `aggiorna` →
  `disegna`) si aggiornano **nello stesso passaggio, dagli stessi tag**, e il canvas si rasterizza subito. Sulla
  carta lo scarto non c'è; sul TC620 si vede. È esattamente il caso in cui ragionare non basta più.

## Il lavoro

### 1. Viewer — le fasi del giro (`sws-lvgl-viewer/src/tempi.rs`, nuovo)

- Un accumulatore per fase: conteggio, somma, massimo, e un istogramma a secchi fissi (≤1, 2, 4, 8, 16, 33, 66,
  >66 ms). Niente allocazioni nel giro.
- **Fasi del giro**: `tag` (clone + `update_bindings`), dentro di essa `canvas` (le rasterizzazioni: corpo del tubo,
  bocchettoni, simboli, barre, trend, tabelle — una voce per tipo), `lvgl` (`task_handler`), `avviso`, `display`
  (copia + `flush_rgb888`), `giro` intero, `attesa` (il sonno), più i **fotogrammi al secondo veri**.
- Gli stessi punti nel ciclo SDL (`run_window`), così da poterlo provare sul PC.
- **Uscita a richiesta**: il thread di rete (`net_worker`) chiede ogni 10 s `GET /api/prestazioni/richiesta`
  (`{attiva}`, loopback, pochi byte); se è attiva, ogni 2 s manda il riassunto con
  `POST /api/prestazioni/viewer` e azzera i contatori. Il giro di disegno non tocca mai la rete.

### 2. Runtime — i lavori (`histogram!` già disponibile, mai usato)

- `sws_lavoro_secondi{lavoro=…}` attorno alle unità che esistono già: il giro di ogni sorgente (per protocollo e
  id), la scrittura dello storico, l'esecuzione di uno script e di una funzione, il ricalcolo dei tag derivati, la
  diffusione su `/ws/tags`. Gli stessi numeri anche in un riassunto JSON (stessi secchi del viewer).
- `GET /api/prestazioni` (Supervisor): runtime + ultimo riassunto del viewer, e accende la richiesta per 60 s (chi
  guarda la pagina la tiene accesa da sé). Gemello remoto `/api/remote/prestazioni`, rotta in `deploy_only_app`.
- `GET /api/prestazioni/richiesta` e `POST /api/prestazioni/viewer`: **solo da loopback** (il viewer sta sulla stessa
  macchina), come le altre rotte del viewer; voce in `check_rotte_preauth.sh` col motivo.

### 3. IDE — Configurazione → Istanza → Prestazioni

- Due colonne come Certificati: «questa istanza» e «pannello collegato».
- Viewer: fotogrammi al secondo, e una barra per fase con media, 95° percentile e massimo, nel giro da 16 ms.
- Runtime: una riga per lavoro, ordinata per tempo totale.
- Aggiorna ogni 2 s finché la pagina è aperta.

### 4. Usarla, e decidere il tubo

- Build (chiedere prima) e TC620: pagina Prestazioni con la pompa che scorre. Si legge quanto pesano `display`,
  `canvas/tubo` e `lvgl`.
- Con quel numero il maintainer sceglie il rimedio del tubo; se la voce grossa è `display`, il primo rimedio è
  copiare e convertire solo le aree che LVGL ha davvero ridisegnato — e quello va in un piano a parte, non qui.

### 5. Documenti e test

- Rust: accumulatore e secchi (puri), riassunto JSON, rotte loopback rifiutate da fuori, la richiesta che scade.
- Vitest: la pagina con una e due colonne.
- Manuale (capitolo della diagnostica), CHANGELOG, NOVITA, collaudi.

## Fuori, dichiarato

Profilazione campionaria (perf, flamegraph), misure dentro LVGL in C, storico delle prestazioni nel tempo: qui si
risponde a «dove va il tempo adesso», non a «com'era ieri».

---

## Il seme (26-10-2026)

> **Seme — decisione.** Nato il 26-10-2026, da una domanda a cui non si è potuto rispondere.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita
> per sviscerarne tutti i dettagli.** Quello che segue sono le misure di oggi e le strade che si
> vedono, non un disegno.
>
> **Porta con sé una domanda in più**, posta dal maintainer: *conviene farlo subito*, invece di
> rimandarlo, proprio per poter fare agevolmente le misure che servono adesso?

## Perché nasce

Il 26-10-2026 il maintainer ha visto sul TC620 un tubo che, mentre la pompa scorre lungo il suo
percorso, resta indietro di 2-3 mm — 10-15 pixel su uno schermo da 12,1". Il disallineamento è
**nella direzione del moto**: se la pompa va in verticale, lo scarto è verticale. Quindi è un
ritardo nel tempo, non un errore di geometria.

La causa si legge nel codice: il corpo del tubo e i suoi bocchettoni sono **canvas**, e
`riposiziona` azzera la cache (`self.disegnato = None`) a ogni cambio di percorso, quindi
`disegna` ricostruisce una stringa SVG, la fa analizzare da `usvg` e la rasterizza con `resvg`
**a ogni passo**. La pompa, invece, è un `lv_obj_set_pos`.

La domanda che segue è ovvia e non ha risposta: **quanto costa, davvero, quella rasterizzazione
su quella CPU?** Da essa dipende se basta non rifare ciò che non cambia, o se il corpo del tubo
va disegnato senza passare da un SVG. Oggi quel numero non si può avere senza aggiungere una
misura a mano, usarla una volta e buttarla.

E non è un caso isolato: la stessa domanda tornerà per i protocolli, per lo storico, per gli
script. Ogni volta che qualcosa «va a scatti» si finisce a indovinare.

## Cosa c'è già (misurato il 26-10-2026)

| Pezzo | Cosa misura | Limite |
|---|---|---|
| `GET /metrics` (`sws-web/src/metrics.rs`, 155 righe) | 15 misure in formato Prometheus: `sws_cpu_usage_pct`, `sws_process_cpu_pct`, `sws_process_rss_bytes`, `sws_tag_count`, `sws_alarm_*`, `sws_http_requests_total`, `sws_uptime_seconds`, disco e memoria | **Tutte di processo intero o conteggi.** Nessuna dice *dove* se ne va il tempo dentro al processo |
| `sws-banco` (`crates/sws-banco`, 410 righe) | banco di carico: N tag × K client, latenza dell'eco, CPU e memoria campionate da `/metrics` | Guarda il runtime **da fuori**. Dice che è lento, non quale lavoro lo rallenta |
| Il registro `metrics` | `counter!`, `gauge!`, `histogram!` già disponibili e già installati | Nessun `histogram!` è in uso oggi: la macchina per gli istogrammi c'è e non la usa nessuno |
| Il viewer LVGL | **niente** | È un processo a sé e non espone nulla. È esattamente dove sta la domanda di stasera |

## Le strade che si vedono

1. **Istogrammi per lavoro nel runtime.** `histogram!("sws_task_seconds", "task" => "modbus")`
   attorno ai pezzi che già esistono come unità: il giro di ogni plugin di protocollo, la
   scrittura dello storico, l'esecuzione di uno script, il ricalcolo dei tag derivati. La
   macchina c'è, la dipendenza c'è, e si leggerebbe da `/metrics` con il banco che già lo
   interroga. È la più economica.
2. **La stessa cosa nel viewer LVGL**, che oggi non misura niente. Ma il viewer gira su un
   pannello e non ha un server HTTP: la misura dovrebbe uscire altrove — nel log a intervalli, o
   attraverso il runtime, o su richiesta. **È la parte che richiede una decisione**, non solo del
   lavoro, perché decide se un pannello in produzione porta o no questo peso addosso.
3. **Una pagina che le mostra.** Numeri che nessuno legge non servono. Se la console mostrasse
   «dove se ne va il tempo» su un pannello collegato, la domanda di stasera si risponderebbe
   guardando, invece che compilando una misura usa e getta.

## Le domande da sciogliere nella sessione di plan

- **Sempre accese o a richiesta?** Misurare costa. Su un pannello che deve disegnare a 30
  fotogrammi al secondo, un istogramma per fotogramma potrebbe essere parte del problema invece
  che della misura.
- **Che granularità.** «Grafica» è una parola sola e dentro ci stanno il ricalcolo dei binding,
  la rasterizzazione dei canvas e il compositing di LVGL, che sono tre cose diverse con tre
  rimedi diversi. Troppo grossa non risponde, troppo fine costa e non si legge.
- **Dove escono, per il viewer.** È il punto 2, ed è quello che non si può decidere senza il
  maintainer.
- **Chi le guarda.** Un endpoint Prometheus serve a chi ha Prometheus. Il maintainer ha un
  pannello e un browser.

## Il precedente che dice che serve

`docs/plans/2026-10-17-tag-uguali-ritrasmessi.md` — «trovato col banco di prestazioni»: il
`TagDb` ritrasmette anche i valori invariati, e i generatori fanno 10 aggiornamenti al secondo
per tag verso ogni client. Quel difetto è stato trovato perché una misura esisteva. Quello di
stasera non si trova, perché la misura che servirebbe non c'è.
