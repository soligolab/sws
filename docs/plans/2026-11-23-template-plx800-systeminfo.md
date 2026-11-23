# Il template `plx800-io` a 1920×1080, con le pagine SystemInfo di CasaDomotica

> **Stato: pronto, rimandato.** Richiesta del maintainer del 23-11-2026, durante il collaudo di `feat/plx800-io` sul
> PLX800: «Nel progetto template riprendi la scheda Systeminfo che ho su casadomotica ed inserisci le informazioni che
> hai messo nella pagina del demo plx800 graficando i dati di temperatura e tensione», e poi «come schermo, sul PLX,
> configuralo a 1920x1080». Lo stesso giorno il maintainer ha scelto di chiudere subito `feat/plx800-io` e di fare
> prima le correzioni della rc.30 (piano comune `2026-11-23-correzioni-collaudo-rc30.md`): questo lavoro diventa **un
> ramo suo da `main`**, dopo `fix/rc30-collaudo`.

## Cosa si fa

1. **Il template passa a 1920×1080**: la pagina «Modulo IO» (34 oggetti), la cornice (`cornici/cornice.yaml`,
   `larghezza`/`altezza`) e le pagine nuove. L'IDE ha già lo strumento che converte da 1280×800 a 1920×1080 con un
   fattore uniforme 1,35 e due bande laterali di 96 px (`sws-editor/src/scala/scalaPagina.ts:21-25`);
   `scripts/riflussa_pagina.py` invece è fisso su 1280×800 e riscalerebbe anche le finestre.
2. **Le pagine SystemInfo di CasaDomotica**: la principale (indicatori CPU, RAM, temperatura e disco; due trend; cinque
   riquadri KPI; il banner degli allarmi; cinque pulsanti alle finestre) e le cinque finestre di dettaglio a 800×600
   (CPU con i sei core, Temperature, Memoria, Rete, Dispositivo con nome, modello, seriale, tempo di accensione, carico e
   selettore della lingua). Sorgente: `~/sws-vps/progetti/CasaDomotica/synoptics/SystemInfo*.yaml` sul VPS (copia del
   23-11 in `tmp/casadomotica-systeminfo/`, non versionata: rileggerla dal VPS quando si parte).
3. **I dati del modulo PLX800 con i grafici**: temperatura della scheda (`io.board_temp_c`) e le tensioni
   (`io.supply_main_mv`, `io.supply_cpu_mv`, `io.supply_sec_mv`, `io.vcap_mv`, `io.vcap_switch_mv`) in trend, con
   `history: true` su quei tag. Oggi nel template solo `io.board_temp_c` ha lo storico.
4. **Una sorgente `host`** con i nomi del PLX800, già provata sul pannello il 23-11 (test 3 del collaudo: 13 metriche
   Good): temperature `cpu-thermal`, `gpu-thermal`, `mule/temp1`, `mule/temp2` (anche `cpu_thermal/temp1` e
   `gpu_thermal/temp1` come hwmon); rete **`ethernet0`** (non `eth0`); disco con param **`/var/sws/projects`** (il
   container monta solo i progetti, non `/data`); sei core (`cpu_core_pct` con param `'0'`..`'5'`). Tre tag di
   CasaDomotica sono **espressioni** e vanno copiati come tali: `host.uptime_h = round(tags['host.uptime_s'] / 3600, 1)`,
   `host.net_rx_kbs` e `host.net_tx_kbs` = `round(tags['host.net_*_bps'] / 1024, 1)`.

## Decisioni da chiedere al maintainer prima di scrivere

- **R1 dice 1280×800 per ogni pagina** (`examples/templates/README.md:16-25`, guardia `scripts/check_templates.sh:658-668`).
  1920×1080 è una scelta voluta, non un debito: `R1_DEBITO` vuol dire «pagine vecchie ancora da ridimensionare»
  (decisione D1 dell'archivio `2026-09-17-regole-dei-template.md`). Le strade: una voce in `R1_DEBITO` con le parole
  del maintainer; una tabella di eccezioni come `R7_PERMESSI`; o una R1 riscritta («oppure la risoluzione nativa del
  dispositivo, dichiarata»). In ogni caso diventano false le righe 18, 151 e 153 del README dei template.
- **R3 vuole al più 6 pagine**, finestre comprese (`check_templates.sh:697-718`): Modulo IO + SystemInfo + 5 finestre fa 7.
  O una voce `R3_DEBITO` nella forma `(7, 0, "<motivo>")` (il secondo numero conta solo le pagine sopra i 60 oggetti),
  o si accorpa una finestra (Rete ripete i KPI di rete della principale).
- **Le finestre a 1920×1080**: restano 800×600 o si portano a 1080×810.

## Trappole già viste (raccolta del 23-11)

- R2: le unità `MB`, `GB` e `kB/s` non sono fra quelle ammesse; si mettono in un formato della tabella delle lingue
  (come `tc620-sistema`: `'{value:.0f} MB'`) o si aggiungono a `UNITA` di proposito.
- La tabella delle lingue di CasaDomotica ha solo it/en: le 40 chiavi `t0038`–`t0077` non hanno lo spagnolo, che il
  template chiede (R2) e nessuna guardia controlla.
- Un `{{user.*}}` dentro un valore della tabella delle lingue fa fallire `check_templates` (cerca i token orfani su
  tutto il `project.yaml`, commenti compresi).
- Una metrica `host` sbagliata non la vede nessun test: `deserialize_sources_tolerant` (`sws-core/src/project.rs`)
  scarta tutta la sorgente con un avviso e il progetto si carica lo stesso. La prova è sul pannello.
- I tag senza storico (`uptime_h`, `disk_free_gb`, `ram_*_mb`, e la radice `core`) danno KPI e trend solo dal vivo.
- Con un progetto aperto, l'unica verifica di tutte le regole del validatore è `GET /api/project/findings`.

## Verifica

`./scripts/check_static.sh` (in particolare `check_templates.sh` e `check_demo_templates.sh`), il test che apre ogni
pagina di ogni template (`istantanea.rs`, `ogni_pagina_del_template`), `cargo test`, `pnpm exec vitest run`, e la prova
sul PLX800 con il monitor a 1920×1080: un progetto nuovo dal template, tutte le pagine, i trend che si riempiono.
