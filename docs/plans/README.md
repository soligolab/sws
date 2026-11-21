# I piani vivi — indice e stato

> Qui stanno i piani **ancora in gioco**: non finiti, o finiti a metà, o che sono vincoli
> riusabili invece che lavoro da fare. Quelli conclusi o superati sono stati spostati in
> [`docs/archive/`](../archive/README.md) l'11-09-2026, che ne tiene l'indice e l'evidenza.
>
> Un piano finito non si cancella: resta come **referto** — dice perché le cose sono fatte come
> sono fatte. C'è un precedente di cancellazione (`CHANGELOG` §2026.7.0: piani di lavoro già
> implementato, «recuperabili da git history»): vale solo per i piani mai iniziati e ormai falsi.
>
> **Nota sui percorsi**: fino all'11-09-2026 la regola era «i file di questa cartella non si
> spostano», perché citati da altri documenti e dal codice. Lo spostamento in archivio ha
> riscritto tutti e 33 i riferimenti; un `git log --follow` continua a seguirli.
> Il 10-11-2026 i 22 semi sono passati in [`semi/`](semi/README.md): 40 file con i rimandi riscritti, più sette
> link dell'archivio che erano già rotti.
> Il 16-11-2026 sono passati in archivio dodici piani finiti, dopo una ricognizione col maintainer. Lo stesso giorno, prima della rc.20, sono passati in archivio anche lo stile
> sobrio, l'assistente secondo giro e le chiavi IA dell'account.

## ▶ La serie coordinata del 04-11-2026 — l'ordine delle sessioni

La serie di sessioni decisa il 04-11-2026 («concludere il lavoro senza aprire altri plan») è finita, tranne il
manuale: restano **M3–M5** del [manuale pubblico](2026-11-03-manuale-pubblico.md) (le letture nella console, il link
prima del login e il menu Aiuto, i testi e le schermate). Le schermate di M5 si fanno
nello [stile sobrio](../archive/2026-11-14-stile-sobrio.md), finito il 16-11-2026. Le regole R6–R8 dei template, nate nella serie, stanno in
[`examples/templates/README.md`](../../examples/templates/README.md). La tabella della serie, con le anomalie della
2.25.0 e le decisioni di T1, è nella storia git di questo file (fino al 16-11-2026).

## I piani vivi, uno per file

Qui stanno solo i **piani**: lavoro definito, pronto o in corso. Le domande ancora da decidere — i **semi** — dal
10-11-2026 stanno in [`semi/`](semi/README.md), con il loro indice: richiesta del maintainer, «così da avere anche io il
colpo d'occhio su cosa sia poco più di una idea e cosa è attività in corso». Quando un seme diventa un piano, il file
passa da `semi/` a questa cartella (con `git mv` e i rimandi riscritti) e la riga passa a questa tabella.

Quattro stati, nella colonna «Cosa resta»: **pronto** (decisa o quasi, resta da costruire/misurare), **in corso** (c'è un
ramo o una serie di sessioni), **verifica** (il codice c'è già, manca la conferma a schermo), **parcheggiato** (resta
piano, ma si riprende dopo: dal 20-11-2026 CRA e manuale, perché «prima di questi è il caso di completare le funzioni»).

<!-- RIGHE-NUOVI-PIANI -->
| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-11-21-lock-salva-come-sorgenti-sandbox.md](2026-11-21-lock-salva-come-sorgenti-sandbox.md) | il maintainer, 21-11-2026: «gruppo 1», i difetti che possono far perdere lavoro; sessione di plan la sera stessa da quattro semi | **in corso** — quattro rami annidati su `feat/ai-fields`: sandbox piccola (C1, C2, C3, A3), sorgenti con «attiva» e tolleranza per giri, «Salva come…» con nuovo repository / nessuno / ramo, lock del progetto per scheda con battito, sola lettura e «Prendi il controllo» |
| [2026-11-20-dispositivo-ricordato-per-progetto.md](2026-11-20-dispositivo-ricordato-per-progetto.md) | il maintainer, 20-11-2026: cambiando progetto il collegamento resta sul pannello di prima, col rischio di un deploy sul pannello sbagliato; sessione di plan la sera stessa | **in corso** — `feat/device-per-project`: `last_device` in `project.yaml` (senza password), collegamento chiuso a ogni apertura e chiusura di progetto nell'IDE locale, la domanda «Ricollegarsi?» all'apertura. L'avviso al deploy su un progetto con un altro nome c'è già dal 03-10 |
| [2026-11-20-ia-sui-campi.md](2026-11-20-ia-sui-campi.md) | il maintainer, 20-11-2026, al collaudo; sessione di plan la sera stessa | **in corso** — `feat/ai-fields` (espressione λ e Formato; il resto nel seme `semi/2026-11-20-ia-sui-campi-altri-campi.md`): icona IA sui campi difficili (espressione λ, condizioni d'allarme, formati, regole d'animazione), il modello vede l'oggetto intero e il valore vivo, propone anche i campi vicini, chiede se è ambiguo; scopo nuovo `fields` |
| [2026-11-20-sfondi-alla-misura-della-pagina.md](2026-11-20-sfondi-alla-misura-della-pagina.md) | il maintainer, 20-11-2026: gli sfondi generati sono sempre 1536×1024 e su una pagina verticale se ne vede il 40 %; poi il pulsante «Assistente IA» nella barra | **verifica** — in `main` (`5d363c43a`) e nella rc.22: sfondi alla misura dell'area della pagina, intervista nella chat (esatta o una volta e mezza, uno o due versi con la gemella), la gemella che segue «Orientamento»; il pulsante «Assistente IA». Manca la prova vera col fornitore (voci in `COLLAUDI_IN_SOSPESO.md`) |
| [2026-11-19-collaudo-da-zero-wp630.md](2026-11-19-collaudo-da-zero-wp630.md) | il maintainer, 19-11-2026: collaudo «da 0 partendo dal factory reset», al lavoro | **pronto** — su `theobroma` + WP630: l'editor dei simboli dal ramo, poi squash e rc.22 (la rc.21 è uscita il 18-11 sera col CRA), factory reset, installazione, abbinamento, deploy, IA nel cloud, il pannello come dispositivo. Le voci sono quelle di `COLLAUDI_IN_SOSPESO.md`, in un ordine solo |
| [2026-11-18-editor-dei-simboli.md](2026-11-18-editor-dei-simboli.md) | sessione di plan del 18-11-2026 sugli appunti di una riunione (seme della libreria dei simboli) | **in corso** — un formato di simbolo nuovo (`sym:`): struttura con gli ingressi (tag o valore fisso), grafica disegnata, importata da SVG o generata dall'IA, foto di sfondo, pezzi con ancoraggio, regole e animazioni sui due motori, export `.swsym` e libreria personale. Modificare un simbolo di libreria crea una variante che lo sostituisce nel progetto, col comportamento e i collegamenti conservati. Otto fasi; si parte dalla 1 (`feat/symbol-def`, libreria modificabile) |
| [2026-11-17-cra-sessioni-e-decisioni.md](2026-11-17-cra-sessioni-e-decisioni.md) | richiesta del maintainer, 17-11-2026: la parte CRA una sessione alla volta, con le decisioni prese in autonomia da validare alla fine | **parcheggiato** (20-11-2026, il maintainer: «prima di questi è il caso di completare le funzioni») — sessioni 1-3 (testi veri, isolamento nel cloud e sandbox, accesso al pannello di controllo) rilasciate nella rc.21 il 18-11; restano reset di fabbrica (C5), firma SBOM e scansione (C7), avvisi, fascicolo (C8) |
| [2026-11-03-manuale-pubblico.md](2026-11-03-manuale-pubblico.md) | richiesta del maintainer, 03-11-2026 | **parcheggiato** (20-11-2026, il maintainer: «prima di questi è il caso di completare le funzioni») — M1–M2 nella rc.16: il sito su `sws.soligo.net/manuale/`, crawler IA respinti. Restano M3 (le letture nella console), M4 (il link prima del login e il menu Aiuto), M5 (testi e schermate, per ultimi) |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **pronto** per le funzioni (P2, P3, P4, P6); la parte CRA è **parcheggiata** dal 20-11-2026 con le sessioni CRA — P5 e C6 fatti il 18-10, C4 parziale dal 26-10 (rimisurato il 17-11). Restano P6 (2FA e LDAP, con sessione di plan) e C5, C7, C8, che si fanno nelle [sessioni CRA del 17-11](2026-11-17-cra-sessioni-e-decisioni.md) |
