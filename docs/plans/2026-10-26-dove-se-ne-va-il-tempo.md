# Dove se ne va il tempo: misurare l'occupazione dei singoli lavori

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
