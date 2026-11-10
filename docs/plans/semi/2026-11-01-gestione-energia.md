# Gestione dell'energia: contatori, gruppi, periodi — seme

> **Stato: seme — decisione.** Nato il 01-11-2026 dalla domotica di CasaDomotica; il maintainer ha chiesto di
> salvarlo come seme da riprendere più avanti. Contiene già un'analisi ampia (l'esistente misurato, una specifica
> proposta, le funzioni accessorie, le fasi) e sei domande aperte in fondo.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli**: prima le risposte alle sei domande, poi una nuova misura del codice (le righe citate qui
> invecchiano), e solo allora modello dati, nomi YAML, migrazioni e rami. La specifica qui sotto è materiale per
> quella sessione, non un piano d'esecuzione.

## L'idea, con le parole del maintainer

«Visto che sws lo sto usando per la domotica, pensavo di introdurre delle funzioni speciali per esempio per gestire
l'energia a partire dal dato istantaneo di consumo di un dispositivo. Qualcosa in cui inserisco un numero a piacere
di tag in ingresso e mi fornisca i dati di energia consumata per periodo di ciascuno e di gruppi di essi, aiutami a
definire bene le specifiche e tutte le funzioni accessorie o aggiuntive.»

## Cosa c'è oggi (misurato il 01-11-2026)

| Pezzo | Stato | Dove |
|---|---|---|
| Storico | SQLite/Postgres/ODBC; registra **al cambiamento** con banda morta e intervallo minimo, mai a periodo fisso; ritenzione per giorni o righe, **nessun riassunto** (rollup) | `sws-historian/src/sqlite.rs:67-89`, `registry.rs:44-75`, `ritenzione.rs` |
| Aggregati | `aggregate_samples` dà min, max, avg, first, last, count per bucket; **avg per campione, non pesata nel tempo**; bucket allineati all'epoch, **non al giorno locale**; nessuna somma né integrale | `sws-historian/src/lib.rs:504-530` |
| API storico | `/api/history/:tag?bucket_ms`, `/stats` (per campione), `/xy`, `/export` CSV | `sws-web/src/router.rs:3502-3752` |
| Tag calcolati | `expression` Python **senza stato**, ricalcolata a ogni aggiornamento; i derivati non si concatenano | `sws-runtime/src/main.rs:932-1015` |
| Script globali | `Interval`/`Cron`, `delta_ms()` e `state` — oggi l'unico posto dove scrivere a mano un integratore, ma `state` **si perde al riavvio** | `sws-web/src/global_scripts.rs`, `sws-pyscript/src/lib.rs:175-201` |
| Valori dei tag | **nessuna persistenza**: al riavvio valore iniziale e qualità Uncertain | `sws-core/src/project.rs:355` |
| Report | turno/giorno/settimana/mese a **finestra mobile** che finisce all'ora di generazione; solo min/max/media/conteggio | `sws-web/src/report/` |
| Widget | solo `trend` interroga bucket; `bar_chart` mostra valori vivi; nessun widget per periodo | `TrendCanvas.tsx:448`, `SvgCanvas.tsx:5510` |
| Allarmi | soglie su un tag vivo; nessuna soglia su un totale di periodo | `sws-core/src/alarm.rs` |
| Home Assistant | mappa stato o attributo su tag; nessuna conoscenza di energia/potenza | `sws-plugin-homeassistant/src/lib.rs` |

**Conseguenza**: l'energia non si può ricavare bene dalle funzioni di oggi. La media per campione di uno storico
«al cambiamento» è sbilanciata: un carico fermo a 0 W per sei ore e acceso a 2000 W per dieci minuti, con 3 campioni
fermi e 40 accesi, fa una media sbagliata di un ordine di grandezza. Serve un integrale **nel tempo**, con il valore
tenuto fra un campione e l'altro.

## Il cuore: il contatore di energia

Una sezione nuova del progetto, **Energia**, con tre oggetti: **contatori**, **gruppi**, **tariffe**.

### Il contatore (uno per tag d'ingresso, quanti se ne vuole)

| Campo | Significato |
|---|---|
| `id`, `nome` | come gli altri oggetti del progetto |
| `tag` | il tag d'ingresso |
| `modo` | **`potenza`**: il tag è una potenza istantanea (W o kW) e si **integra**; **`contatore`**: il tag è già un'energia cumulativa (kWh di uno Shelly, di un contatore Modbus) e si fa la **differenza**, gestendo azzeramenti e giri |
| `unita` | W, kW (potenza) o Wh, kWh (contatore), con fattore di scala; proposta automatica dall'`unit` del tag |
| `verso` | `consumo`, `produzione` (fotovoltaico) o `bidirezionale` (il punto di scambio: positivo prelievo, negativo immissione; due totali separati) |
| `vuoto_massimo` | oltre quanto tempo senza dati smettere di integrare (proposta: 15 min); il buco si segna, non si inventa |
| `gruppo` | il gruppo padre (vedi sotto) |
| `etichette` | categorie trasversali: illuminazione, clima, cucina… |
| `tariffa` | quale tariffa applica, se diversa da quella del gruppo |

**Come integra.** Nel runtime, non nello storico: a ogni aggiornamento del tag e a un battito fisso (proposta: 10 s),
`E += P_tenuta × Δt`. Si usa il valore **tenuto** dall'ultimo campione, la stessa semantica della registrazione «al
cambiamento» con banda morta. Qualità Bad o buco oltre `vuoto_massimo` → non si integra, e il periodo porta una
**copertura** (percentuale del tempo con dati buoni) che lo dice.

**Dove salva.** Una tabella sua, separata dallo storico e fuori dalla sua ritenzione:
`energia(contatore, inizio_quarto_d_ora, kwh, kwh_immessa, secondi_coperti)`. Il **quarto d'ora** è la stessa grana
dei contatori elettronici italiani; ore, giorni, mesi e anni si ottengono sommando quarti d'ora **nel fuso
locale**, con l'ora legale giusta (un giorno ha 92, 96 o 100 quarti). Sono circa 35.000 righe l'anno per contatore:
si tengono per sempre.

**Il riavvio.** L'accumulatore del quarto d'ora corrente si salva ogni minuto e allo spegnimento. Il tempo a runtime
spento è un buco, con la copertura che lo dice. In modo `contatore` il buco non c'è: la differenza al riavvio
recupera tutto.

**Ricostruire dal passato.** Se il tag ha lo storico, un bottone **«Ricalcola dallo storico»** riempie i quarti d'ora
all'indietro con lo stesso integrale. Su CasaDomotica, con 540 MB di storico, un contatore nuovo nasce già con mesi
di dati.

### I gruppi

- Un **albero** (Casa → Piano terra → Cucina → Forno): un contatore sta in un gruppo solo, così le somme non
  contano due volte.
- Un gruppo può avere un **contatore proprio** (il generale sulla linea, il sottoquadro). Allora il gruppo mostra
  anche **«non attribuito»** = proprio − somma dei figli: è quanto consuma la casa che nessun contatore vede, e di
  solito è la scoperta più utile.
- Le **etichette** danno il secondo taglio (tutta l'illuminazione, tutto il clima), senza toccare l'albero.

### I tag che il contatore espone

Ogni contatore e ogni gruppo pubblica tag di sola lettura, per esempio `energia.cucina.oggi`, `.ieri`, `.mese`,
`.mese_scorso`, `.anno`, `.totale`, `.potenza` (per un gruppo, la somma dei figli), `.costo_oggi`, `.costo_mese`.
Così **tutto quello che c'è già funziona subito**: `kpi_tile`, `text`, `gauge`, `bar_chart` vivo, gli allarmi a
soglia, gli script, LVGL compreso. Restano utilizzabili nelle espressioni.

## Le funzioni accessorie

Divise per quanto valgono in una casa; le prime due stanno nella fase 1 e 2, le altre sono da scegliere.

### A. Vedere (fase 2)
1. **Barre per periodo**: le ore di un giorno, i giorni di un mese, i mesi di un anno, con navigazione ◀ ▶ e il
   **confronto col periodo prima** (barra fantasma). Impilate per figli del gruppo. Si propone una modalità
   «storico per periodo» di `bar_chart`, con lo stesso disegno su web e LVGL.
2. **Ripartizione**: la torta o la tabella dei figli di un gruppo nel periodo scelto (`pie_chart` e `table` in
   modalità periodo), con «non attribuito» come fetta.
3. **Pagina Energia pronta**: un bottone che genera la pagina dal modello (totali, barre, ripartizione, potenza
   istantanea), da ritoccare come ogni altra pagina.
4. **Report**: una sezione energia nei report programmati, con **periodi da calendario** (ieri, la settimana
   scorsa, il mese scorso) e non finestre mobili; esportazione CSV/XLSX dei quarti d'ora.

### B. Costi (fase 3)
5. **Tariffe**: prezzo unico; **fasce F1/F2/F3** dell'ARERA con le festività; prezzo dell'energia immessa; quota
   fissa mensile facoltativa. Costo per contatore, gruppo e periodo.
6. **Fotovoltaico**: produzione, prelievo, immissione, **autoconsumo** = produzione − immissione, e
   **autosufficienza** % = autoconsumo / consumo.

### C. Proteggere (fase 4)
7. **Limite di potenza del contratto** (i 3 kW di casa, con la tolleranza del contatore): avviso quando la potenza
   del generale resta sopra soglia per N secondi, prima che il contatore stacchi.
8. **Distacco carichi**: un elenco di carichi con priorità; sopra il limite si spegne il meno importante scrivendo
   il suo tag, e si riaccende quando torna il margine, con un tempo di guardia per non farli ballare.
9. **Picco del quarto d'ora**: il massimo di potenza media per periodo, utile per scegliere la potenza del
   contratto.

### D. Capire (fase 4)
10. **Consumo di fondo**: il minimo notturno di ogni giorno (proposta: media fra le 2 e le 5), con la sua tendenza:
    il frigorifero che invecchia, la presa dimenticata.
11. **Cicli degli elettrodomestici**: inizio e fine riconosciuti da soglia di potenza e durata minima; kWh e durata
    di ogni ciclo, numero di cicli, e **la notifica «lavatrice finita»** tramite le notifiche che ci sono già.
12. **Anomalie**: oggi rispetto alla media dello stesso giorno della settimana; un carico acceso molto più a lungo
    del solito.
13. **Previsione**: a fine mese, al ritmo attuale, X kWh e Y €; allarme su un **budget** mensile.
14. **Soglie sui totali**: allarmi su `.oggi` o `.mese` sopra una soglia, con gli allarmi esistenti.

## L'interfaccia nell'IDE

- **Configurazione → Energia**, tre schede: **Contatori** (si scelgono i tag dall'albero, anche più insieme; unità
  e modo proposti dal tag; potenza viva e «oggi» accanto a ogni riga), **Gruppi** (albero con trascinamento),
  **Tariffe**.
- Il controllo che si vede subito: per ogni contatore la copertura degli ultimi 7 giorni e il bottone «Ricalcola
  dallo storico».
- API: `GET /api/energia?contatore|gruppo|etichetta&da&a&grana=15m|h|g|mese|anno` (fuso del progetto), più l'elenco
  e lo stato dei contatori.

## Dove nasce l'errore, detto chiaro

- Integrare una potenza campionata «al cambiamento» con banda morta sbaglia di poco sui carichi stabili e di più su
  quelli che variano veloci. **Quando il dispositivo ha un contatore cumulativo** (Shelly `aenergy.total`, i
  contatori Modbus), il modo `contatore` è più preciso: l'IDE lo suggerisce quando trova un tag in Wh/kWh dello
  stesso dispositivo.
- La copertura si mostra sempre: un totale con il 70 % di copertura non deve sembrare vero.

## Le fasi proposte

| Fase | Contenuto | Esito visibile |
|---|---|---|
| 1 | contatori (potenza e contatore), quarti d'ora salvati, riavvio, ricalcolo dallo storico, gruppi con «non attribuito», tag esposti, API, Configurazione → Energia | `kpi_tile` con «oggi» e «mese» su CasaDomotica |
| 2 | barre per periodo, ripartizione, pagina pronta, sezione nei report, parità LVGL | la pagina Energia di CasaDomotica |
| 3 | tariffe F1/F2/F3, costi, fotovoltaico e autoconsumo | € al giorno e al mese |
| 4 | limite di potenza e distacco carichi, picco, consumo di fondo, cicli, anomalie, previsione | scelte dal maintainer |

CasaDomotica: per la regola del 16-10-2026 ogni fase entra anche lì, con i dispositivi veri di casa.

## Domande per il maintainer

1. **Cosa misura oggi casa tua?** Potenza istantanea per dispositivo (prese Shelly, Zigbee)? Contatori cumulativi?
   Un contatore sul **generale** (Shelly EM o simili)? Fotovoltaico, accumulo?
2. **Gruppi**: basta l'albero, o servono subito anche le etichette trasversali?
3. **Riavvio**: il buco a runtime spento si lascia come buco (proposta), o si stima col valore di prima?
4. **Tariffa**: prezzo unico, fasce F1/F2/F3, o prezzo orario (PUN)?
5. **Fase 4**: quali delle funzioni C e D vuoi, e in che ordine? Il distacco carichi scrive sui dispositivi: è
   quella con più responsabilità.
6. **Grana**: il quarto d'ora va bene, o vuoi il minuto per vedere i cicli più fini (60 righe/ora per contatore)?
