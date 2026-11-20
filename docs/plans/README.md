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

Tre stati, nella colonna «Cosa resta»: **pronto** (decisa o quasi, resta da costruire/misurare), **in corso** (c'è un
ramo o una serie di sessioni), **verifica** (il codice c'è già, manca la conferma a schermo).

<!-- RIGHE-NUOVI-PIANI -->
| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-11-19-assistente-ia-simboli.md](2026-11-19-assistente-ia-simboli.md) | il maintainer, 19-11-2026: «il prossimo step dell'editor dei simboli, dovrebbe essere l'assistente IA» | **fatto sul ramo, da collaudare** — `feat/symbol-ai` (annidato su `feat/image-library`): la scheda «IA» dell'editor (nuovo, modifica, da una foto) con anteprima e «Accetta», la rotta `POST /api/symbols/ai`; col 9b locale il flusso va, i disegni quasi mai (misure nel piano) |
| [2026-11-19-libreria-immagini.md](2026-11-19-libreria-immagini.md) | il maintainer, 19-11-2026: «non esiste un metodo ordinato per caricare una immagine e piazzarla» | **in corso** — due sessioni su `feat/image-library` (annidato su `feat/symbol-anim`): A caricare e piazzare (libreria con «Del progetto» e «+ Carica», ottimizzazione, proporzioni), B gestire (rinomina, sostituisci, elimina, dove si usa), trascinamento e incolla |
| [2026-11-19-animazioni-dei-simboli.md](2026-11-19-animazioni-dei-simboli.md) | sessione di plan col maintainer del 19-11-2026: la sessione 2 della fase 2 dell'editor dei simboli | **in corso** — quattro sessioni su `feat/symbol-anim`: 2a valutatore condiviso e formato, 2b web e pagina, 2c pannello LVGL e misure sul TY570, 2d editor («Anima…»). Prima, a parte, la verifica del grigio dei dati vecchi sui simboli del pannello |
| [2026-11-19-editor-dei-simboli-fase-2.md](2026-11-19-editor-dei-simboli-fase-2.md) | sessione di plan col maintainer del 19-11-2026, dopo il collaudo della fase 1: «l'editor è estremamente scarno» | **in corso** (sessione 1 fatta, `b99855ddf`; la sessione 2 ha un piano suo, [animazioni](2026-11-19-animazioni-dei-simboli.md)) — tre sessioni: 1) bocche dei tubi esplicite, strumenti di disegno, vista esplosa, anteprima degli ingressi, «+ Nuovo simbolo» in vista; 2) animazioni agganciate ai tag (con una sessione di plan prima); 3) importa SVG ed esporta/importa il simbolo. Prima, a parte, il QR della schermata d'abbinamento (`e068ebd23`) |
| [2026-11-19-galleria-simboli-stesso-tipo.md](2026-11-19-galleria-simboli-stesso-tipo.md) | il maintainer, 19-11-2026: cambiare un simbolo con uno qualsiasi della libreria confonde | **in corso** — ramo `feat/symbol-gallery-kind`, annidato su `fix/setpoint-lvgl`: la galleria del pannello proprietà solo della stessa tipologia, le varianti al posto dell'originale, la Categoria dell'editor da un elenco |
| [2026-11-19-setpoint-lvgl-come-il-web.md](2026-11-19-setpoint-lvgl-come-il-web.md) | il maintainer, 19-11-2026, sul TY570: i setpoint di «Idrico - Parametri» diversi dal web e il tastierino coperto dagli oggetti della pagina | **in corso** — ramo `fix/setpoint-lvgl`, annidato su `feat/nav-links`: la scheda del tastierino come sul web sul layer superiore, conferma e min/max anche su LVGL, la riga con le misure del web, il colore del ✓ (`confirm_fill`) |
| [2026-11-19-navigatore-pulsanti-in-piu.md](2026-11-19-navigatore-pulsanti-in-piu.md) | il maintainer, 19-11-2026, per la demo della fiera: nel navigatore di pagine un ingresso a un sotto-menù (pagina d'inizio e nome scelti) e un'uscita | **in corso** — ramo `feat/nav-links`, annidato su `feat/symbol-def`: il campo `nav_links` («Pulsanti in più») sui due motori e nel pannello proprietà; poi il collaudo e il progetto della fiera, che aggiorna il maintainer |
| [2026-11-19-collaudo-da-zero-wp630.md](2026-11-19-collaudo-da-zero-wp630.md) | il maintainer, 19-11-2026: collaudo «da 0 partendo dal factory reset», al lavoro | **pronto** — su `theobroma` + WP630: l'editor dei simboli dal ramo, poi squash e rc.22 (la rc.21 è uscita il 18-11 sera col CRA), factory reset, installazione, abbinamento, deploy, IA nel cloud, il pannello come dispositivo. Le voci sono quelle di `COLLAUDI_IN_SOSPESO.md`, in un ordine solo |
| [2026-11-18-editor-dei-simboli.md](2026-11-18-editor-dei-simboli.md) | sessione di plan del 18-11-2026 sugli appunti di una riunione (seme della libreria dei simboli) | **in corso** — un formato di simbolo nuovo (`sym:`): struttura con gli ingressi (tag o valore fisso), grafica disegnata, importata da SVG o generata dall'IA, foto di sfondo, pezzi con ancoraggio, regole e animazioni sui due motori, export `.swsym` e libreria personale. Modificare un simbolo di libreria crea una variante che lo sostituisce nel progetto, col comportamento e i collegamenti conservati. Otto fasi; si parte dalla 1 (`feat/symbol-def`, libreria modificabile) |
| [2026-11-17-cra-sessioni-e-decisioni.md](2026-11-17-cra-sessioni-e-decisioni.md) | richiesta del maintainer, 17-11-2026: la parte CRA una sessione alla volta, con le decisioni prese in autonomia da validare alla fine | **in corso** — sessioni 1-3 (testi veri, isolamento nel cloud e sandbox, accesso al pannello di controllo) rilasciate nella rc.21 il 18-11; restano reset di fabbrica (C5), firma SBOM e scansione (C7), avvisi, fascicolo (C8) |
| [2026-11-17-cra-1-testi-veri.md](2026-11-17-cra-1-testi-veri.md) | sessione 1 delle [sessioni CRA del 17-11](2026-11-17-cra-sessioni-e-decisioni.md) | **fatto, nella rc.21** (squash `78ab8543a`) — solo documenti e commenti: le frasi false corrette e la prima bozza di `docs/sicurezza/valutazione-rischio.md` con la sua guardia |
| [2026-11-18-cra-2-isolamento-cloud-e-sandbox.md](2026-11-18-cra-2-isolamento-cloud-e-sandbox.md) | sessione 2 delle [sessioni CRA del 17-11](2026-11-17-cra-sessioni-e-decisioni.md) | **fatto, nella rc.21; collaudo da fare** (squash `ae47dd371`, gateway col segreto nuovo dal 18-11) — segreto per container, pannello di controllo solo sui dispositivi, espressioni in sandbox, tetti agli zip |
| [2026-11-18-cra-3-accesso-pannello-di-controllo.md](2026-11-18-cra-3-accesso-pannello-di-controllo.md) | sessione 3 delle [sessioni CRA del 17-11](2026-11-17-cra-sessioni-e-decisioni.md), decisioni riviste col maintainer il 18-11 | **fatto, nella rc.21; collaudo da fare** (squash `5bdaba816`) — PIN iniziale solo dallo schermo, codice di abbinamento solo allo schermo, cambio password sul viewer LVGL, native senza `admin`/`admin` e senza root, utente di OpenPLC, tetto di CPU nel cloud |
| [2026-11-03-manuale-pubblico.md](2026-11-03-manuale-pubblico.md) | richiesta del maintainer, 03-11-2026 | **in corso** — M1–M2 nella rc.16: il sito su `sws.soligo.net/manuale/`, crawler IA respinti. Restano M3 (le letture nella console), M4 (il link prima del login e il menu Aiuto), M5 (testi e schermate, per ultimi) |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **pronto** — P5 e C6 fatti il 18-10, C4 parziale dal 26-10 (rimisurato il 17-11). Restano P6 (2FA e LDAP, con sessione di plan) e C5, C7, C8, che si fanno nelle [sessioni CRA del 17-11](2026-11-17-cra-sessioni-e-decisioni.md) |
