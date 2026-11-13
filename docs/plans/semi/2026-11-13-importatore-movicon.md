# Importare progetti Movicon in SWS

**Seme, nato il 13-11-2026.** Richiesta del maintainer: un progetto **Movicon 11.6 per Windows CE** («KTD»,
importante) da portare in SWS per abbandonare Movicon; «vorrei fare un importatore per importarlo più possibile in
SWS». L'importatore deve servire **a qualunque progetto Movicon**: KTD è solo il primo esempio. Da fare in una
sessione separata, dopo il lavoro in corso.

**Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata per sviscerarne i dettagli.**

**Gli archivi del primo esempio sono riservati**: stanno in `sws/tmp/` (fuori da git) solo dove il maintainer li
copia a mano, non entrano nel repository e non si pubblicano in nessuna forma (artifact, documenti, commit).

## Cosa c'è nel primo esempio (misurato il 13-11-2026)

Solo numeri e categorie: **il contenuto del progetto è riservato** e non entra nel repository, né nei documenti
(richiesta del maintainer). Circa 116 pagine in 8 cartelle; il database delle variabili; allarmi; registrazioni e
ricette; eventi; scheduler; navigazione fra le pagine; rete Movicon; client OPC e OPC UA; 3 script Basic più uno in
chiaro; 6 lingue (circa 1000 stringhe ciascuna); circa 30 immagini.

Un progetto salvato come **cifrato** («progetto criptato» di Movicon) non si legge: l'importatore deve riconoscerlo e
chiedere di salvarlo in chiaro da Movicon, non tentare di forzarlo. Salvato in chiaro, il progetto è fatto di file
XML in UTF-16.

## Movicon → SWS, cosa c'è e cosa manca (da confermare sui file in chiaro)

| Movicon | SWS oggi | Note |
|---|---|---|
| Pagine `.movscr` (rettangoli, testi, pulsanti, display, barre, immagini, trend, gruppi) | sinottici, 39 tipi di oggetto, web e LVGL | la parte più grossa; i simboli Movicon vanno ridotti ai nostri tipi o a gruppi |
| Variabili (RealTimeDB), tipi, strutture | tag, tipi scalari | le **strutture** Movicon e gli array: da verificare come le rendiamo |
| Driver / OPC UA client / rete Movicon | sorgenti (Modbus, OPC UA, MQTT, …) | da leggere progetto per progetto |
| Allarmi (soglie, ritardi, testi multilingua) | allarmi con ritardo, ACK, metti a tacere | buona copertura |
| Registrazioni / ricette | storico (datastore) e ricette | da mappare campo per campo |
| Eventi, scheduler | funzioni, script a orario | |
| Script Basic (WinWrap/VBA) e script di pagina | Python (RestrictedPython) | **nessuna traduzione automatica affidabile**: elenco degli script e riscrittura assistita (anche con l'assistente IA) |
| Lingue (6) | lingue dei contenuti (T-40) | import quasi diretto: chiave → testi |
| Popup, tastierini propri | finestre, tastiera numerica/alfanumerica di SWS | i tastierini Movicon si lasciano fuori |
| Navigazione, alias/parametri di pagina | menù di pagina, navigazione | gli **alias di pagina** (una pagina riusata per N parti uguali della macchina) sono probabilmente il buco più grande |
| Utenti, livelli di accesso | utenti e ruoli | |
| Report creati da script, export su USB | report, backup | da vedere caso per caso |

Probabili mancanze di SWS, da confermare: pagine parametriche con alias, strutture di
variabili, oggetti Movicon senza un nostro tipo (da contare sui file in chiaro), script Basic di pagina.

## Come potrebbe funzionare l'import

1. **Inventario automatico** (primo passo, utile da solo): uno strumento che legge il progetto in chiaro e produce un
   rapporto — quante pagine, quali tipi di oggetto e quanti, variabili per tipo e sorgente, allarmi, script — con per
   ogni voce «si importa», «si importa approssimato», «a mano». Dice quanto lavoro resta prima di farlo.
2. **Importatore a fasi**, ognuna utile da sola: lingue e immagini → variabili e sorgenti → allarmi → ricette e
   registrazioni → pagine (oggetti mappati, il resto segnato come segnaposto visibile) → script (elencati, con il
   testo originale in commento, da riscrivere).
3. **Dove vive**: uno script/strumento fuori dal runtime che scrive un progetto SWS (`project.yaml`, sinottici, tag),
   poi aperto nell'IDE. Da decidere nella sessione di plan: Rust (riusa i tipi del modello) o Python/TS.
4. **Verifica**: istantanee web/LVGL delle pagine importate accanto agli screenshot di Movicon, pagina per pagina.

## Da chiedere nella sessione di plan
- qualche screenshot del runtime Movicon del primo esempio, per confrontare le pagine importate;
- altri progetti Movicon d'esempio (l'importatore è generale): versioni diverse, driver diversi.
