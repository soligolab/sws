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
| [2026-11-19-collaudo-da-zero-wp630.md](2026-11-19-collaudo-da-zero-wp630.md) | il maintainer, 19-11-2026: collaudo «da 0 partendo dal factory reset», al lavoro | **pronto** — su `theobroma` + WP630: l'editor dei simboli dal ramo, poi squash e rc.21, factory reset, installazione, abbinamento, deploy, IA nel cloud, il pannello come dispositivo. Le voci sono quelle di `COLLAUDI_IN_SOSPESO.md`, in un ordine solo |
| [2026-11-18-editor-dei-simboli.md](2026-11-18-editor-dei-simboli.md) | sessione di plan del 18-11-2026 sugli appunti di una riunione (seme della libreria dei simboli) | **in corso** — un formato di simbolo nuovo (`sym:`): struttura con gli ingressi (tag o valore fisso), grafica disegnata, importata da SVG o generata dall'IA, foto di sfondo, pezzi con ancoraggio, regole e animazioni sui due motori, export `.swsym` e libreria personale. Modificare un simbolo di libreria crea una variante che lo sostituisce nel progetto, col comportamento e i collegamenti conservati. Otto fasi; si parte dalla 1 (`feat/symbol-def`, libreria modificabile) |
| [2026-11-03-manuale-pubblico.md](2026-11-03-manuale-pubblico.md) | richiesta del maintainer, 03-11-2026 | **in corso** — M1–M2 nella rc.16: il sito su `sws.soligo.net/manuale/`, crawler IA respinti. Restano M3 (le letture nella console), M4 (il link prima del login e il menu Aiuto), M5 (testi e schermate, per ultimi) |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **pronto** — restano P5 (prestazioni misurate e pubblicate), P6 (2FA e LDAP, con sessione di plan) e C5–C8 (reset di fabbrica, header e limiti, firma/SBOM/scansione, fascicolo) |
