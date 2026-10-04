# Il trend LVGL come quello web

> **Seme — decisione** (04-10-2026). Osservazioni del maintainer sul TC620 durante il collaudo degli MCM260X («prendi
> nota per dopo»).
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## Cosa manca o non va, rispetto al trend web

1. **Espandi a schermo intero**: il web ce l'ha, LVGL no («non è indispensabile»).
2. **Preset di tempo**: ultimi 30 min, ultime 3 h… come i pulsanti del web.
3. **Download CSV** dei dati del trend.
4. **Comportamento strano**: nella parte destra del grafico il dato ha variazioni accentuate, da circa 2/3 in poi
   (verso sinistra o verso destra: da chiarire a schermo) sembra una media.

## Misurato il 04-10-2026

- `sws-lvgl-viewer/src/client.rs`: oltre `SECCHI_OLTRE_MS` (15 min) di finestra lo storico arriva **aggregato a
  secchi** (`GET /api/history/:tag?bucket_ms=`, `HistoryBucket { min, max, avg }`): la linea è la media, min e max la
  banda. Ipotesi da verificare per il punto 4: un tratto disegnato con le medie dei secchi e un tratto (la coda
  recente, o i campioni in diretta) disegnato coi campioni grezzi — due risoluzioni nella stessa linea. Va confrontato
  col web (`TrendWidget`), che ha la stessa soglia (F5.2).
- Il rendering è `render_trend` / `dati_trend` in `lvgl_render.rs`, la geometria in `crate::trend`.
- Il CSV su un pannello senza browser: dove va il file (USB? download dall'IDE?) è da decidere.
