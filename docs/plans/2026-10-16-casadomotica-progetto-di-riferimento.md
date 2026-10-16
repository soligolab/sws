# CasaDomotica come progetto di riferimento

> **Decisione del maintainer, 16-10-2026**: «usare CasaDomotica come progetto di riferimento in
> cui implementare man mano le cose che vengono aggiunte».
>
> Non è un seme da decidere: è una pratica che parte adesso. Restano aperte due domande
> pratiche, in fondo, che la prima sessione che ci lavora dovrà sciogliere.

## Perché, e cosa non è

Nel repo ci sono già **due template gemelli**, `examples/templates/demo-items-web` e
`demo-items-lvgl`, tenuti allineati dalla guardia `check_demo_templates.sh`: quattro pagine, 133
oggetti, e **tutti e 39 i tipi della palette** in tutte e due le varianti, con gli oggetti comuni
alle stesse coordinate. Quelli coprono i **tipi**: un oggetto per tipo, perché esista.

CasaDomotica è un'altra cosa e serve a un'altra: è un impianto **vivo**, con sorgenti vere,
allarmi veri e 540 MB di storico. Quello che i gemelli non possono dire — se una funzione regge
*in mezzo alle altre*, su dati che cambiano da soli, su uno schermo vero — lo dice solo un
progetto così.

**I due non si sostituiscono.** La guardia sui gemelli resta: è quella che impedisce a un tipo
nuovo di nascere senza una pagina che lo mostri.

## Misurato il 16-10-2026

| | CasaDomotica | i gemelli demo |
|---|---|---|
| pagine | 4 | 4 |
| oggetti | 48 | 133 |
| tipi della palette usati | **16 su 39** | 39 su 39 |
| dove vive | solo sul VPS, `~/sws-vps/progetti/` | nel repo, versionato |
| dati | sorgenti vere, 540 MB di storico | nessuno |

**I 23 tipi che CasaDomotica non usa ancora**: `alarm_history`, `alarm_viewer`, `button`,
`checkbox`, `clock`, `data_log`, `ellipse`, `grid`, `image`, `kpi_tile`, `navbutton`,
`page_navigator`, `pie_chart`, `progress_bar`, `radio`, `recipe_panel`, `rect`, `setpoint`,
`sparkline`, `state_lamp`, `table`, `text_list`, `xy_plot`.

Da cui parte l'elenco del «man mano», con in testa le cose aggiunte di recente e mai viste in un
progetto vero: **`clock`** (16-10), le **cornici di pagina** (16-10), il **cambio di risoluzione**
(16-10), le **assegnazioni dei bottoni** (11-10), il **simbolo che comanda** (15-10).

## Le due domande aperte

**1. CasaDomotica non è nel repo.** I gemelli sono versionati e viaggiano con git; CasaDomotica
vive sul VPS e basta. Come riferimento del prodotto è un punto debole: una sessione su un'altra
macchina non lo vede, e se il VPS si perde restano le copie di sicurezza. I 540 MB di storico
escludono di metterlo in git com'è — ma il **disegno** (project.yaml più le pagine) sono poche
centinaia di kilobyte. Da decidere: se e dove esportarlo periodicamente.

**2. È anche l'impianto di casa del maintainer.** Usarlo come banco di prova vuol dire fare
esperimenti su qualcosa che gira davvero. Da decidere se serve una copia di lavoro separata —
e, se sì, come tenerla allineata senza raddoppiare il lavoro, che è il motivo per cui questa
idea è nata.

## Come si applica, da subito

Quando una funzione visibile entra in `main`, **va messa anche in CasaDomotica** — non come
verifica che funzioni (quella è la *definition of done*), ma perché il progetto di riferimento
resti rappresentativo di cosa il prodotto sa fare. Se per una funzione non c'è un posto sensato
in un impianto domestico, vale la pena annotarlo: è un indizio su chi sia davvero il destinatario
di quella funzione.
