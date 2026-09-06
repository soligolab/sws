# Revisione di cinque mesi di pianificazione

> Copia committata del piano approvato il 2026-09-06: il lavoro può attraversare
> più sessioni e il maintainer lavora da due macchine.

## Context

`docs/OPEN_QUESTIONS.md` (3476 righe), `STATUS.md` (4021) e `docs/plans/` (19 file, 4821)
sono cresciuti per cinque mesi senza una potatura. Il problema non è la dimensione: è che
**hanno smesso di dire il vero**. Stanotte, riverificando nove schede contro il codice, **tre
erano invecchiate** e due in modo che avrebbe portato a decidere su premesse false. Lo stesso
è successo alle guardie (tre non potevano passare) e ai numeri scritti in prosa
(«31/32 tipi», «nove guardie», «22 simboli»).

Un documento che nessuno rilegge non è neutro: costa. Q20 è costata una diagnosi sbagliata,
Q22 due giorni di crash inspiegabili — lo dice il piano del 2026-08-25, che aveva già affrontato
lo stesso sedimento a 22 domande. Oggi sono 41.

Esito atteso: `OPEN_QUESTIONS.md` contiene **solo ciò che aspetta davvero una decisione**;
`STATUS.md` solo ciò che serve a riprendere il lavoro; e quello che è stato resta leggibile in
`docs/history/`, non cancellato. Più un elenco corto delle questioni che aspettano te, da
decidere in una seduta come quella del 2026-08-25.

### Deciso con te

| Tema | Scelta |
|---|---|
| Criterio | **Verifica sul codice** prima di archiviare. Archiviare un'affermazione falsa la seppellisce |
| Dove | **`docs/history/`** — nome già previsto da `docs/CONTEXT.md:356` |
| Ampiezza | `OPEN_QUESTIONS.md`, `STATUS.md`, indice dei piani, `CONTEXT.md` §3 |

### Vincoli misurati, non supposti

- **`STATUS.md` cita i numeri di scheda in ~28 punti** (molti «Q14 seguito 9/13/15»), più
  `TESTING_GUIDE.md:523` e due `TODO(open-question)` nel codice. **Non si rinumera e non si
  cancella**: si sposta la scheda intera lasciando una riga d'indice nel file vivo.
- **I piani sono citati da altri documenti e da commenti nel codice** (31 riferimenti, `grep`
  fatto): spostarli o rinominarli romperebbe quei rimandi. **Restano dove sono.**
- Il precedente del 2026-08-25 dice: *«Le domande non vengono cancellate… il ragionamento che
  c'è dentro vale più della riga di elenco»*. Questo piano lo rispetta: nessuna scheda sparisce.
- Esiste già `docs/archive/` con **un solo file** (appunti di sessione). `docs/history/` è
  per i documenti; li lascio distinti e lo dico nel README.

## Cosa dicono gli inventari

**`OPEN_QUESTIONS.md`** — 18 schede «decise e fatte» occupano **2175 righe, il 63%**. Da sole
Q14 (1196 righe!) e Q30 (158) sono il 38% del file. Restano 15 aperte (753 righe), 6 decise-da-fare
e 2 incerte.

**Cinque schede si contraddicono**: Q16, Q18, Q19, Q20, Q21 hanno un `**Decided (2026-08-25)**`
in testa e un `**Decided**: not yet` (o «Stato: aperta») in coda — il piano dell'08-25 aggiunse
l'intestazione e non toccò la coda. Chi legge non sa quale delle due valga.

**`STATUS.md`** — **2815 righe su 4021 sono narrazione storica** anteriore al 2026-08-24. La
sezione «Release 2.1.0» (1340 righe) non è una release: è un log piatto di ~93 voci di sessione
**senza una sola intestazione markdown**, quindi invisibile al sommario. La sezione «Storico»
esiste già (riga 3909) col formato giusto: 18 righe coprono due mesi.

**`docs/plans/`** — 12 fatti, 3 parziali, 2 mai iniziati, 1 non-un-piano, 1 incerto. Uno
(`global-scripts-template-snippets.md`, senza data) punta a un file che **non esiste**.

---

## A — La verifica (~2 h). È il passo che dà valore a tutto il resto

Per ognuna delle **20 candidate** (18 «decise e fatte» + Q25 e Q31 «incerte»), controllo sul
codice l'affermazione che fa. Metodo di stanotte: si cerca l'artefatto che la scheda dichiara
esistere, non si legge la prosa. Esempi: Q22 → la patch in `patches/lvgl/` e la guardia che la
copre; Q24 → `LV_USE_FREETYPE` in `lv_conf.h`; Q30 → `patch_project_se` e `If-Match`.

Esito per scheda, uno dei tre:
- **confermata** → va in archivio;
- **invecchiata** → **resta viva**, con un `### ⚠ Riverificata il <data>` che dice cosa non è
  più vero (come Q31 e Q32 ieri);
- **parziale** → resta viva, con scritto cosa manca.

Le **cinque contraddittorie** (Q16, Q18, Q19, Q20, Q21) si risolvono qui **con un fatto, non con
una decisione**: la verifica dice quale delle due righe è vera, e la scheda lo registra. Per Q18
la risposta la conosco già — è implementata su entrambi i motori, verificato ieri.

Prodotto: una tabella (numero → esito → prova trovata) che va nel commit e nel report finale.

## B — `OPEN_QUESTIONS.md` (~2 h)

1. `docs/history/OPEN_QUESTIONS-chiuse.md`: le schede **confermate**, intere, numero
   invariato, in ordine. In testa: perché esistono e come si legge il file.
2. Nel file vivo, in coda, una **tabella d'indice** con una riga per scheda archiviata —
   numero, titolo, decisione, data, link. Serve a due cose: `grep Q14` continua a trovare
   qualcosa di utile, e i ~28 rimandi di `STATUS.md` non diventano vicoli ciechi.
3. Il file vivo resta con aperte + decise-da-fare + invecchiate. Attesa: **da 3476 a ~1200 righe**.
4. **`scripts/check_documenti.sh`** (nuova guardia, fra le statiche): verifica che vivo +
   archivio contengano insieme Q1…QN **senza buchi e senza doppioni**, e che ogni `Q<n>` citato
   in `STATUS.md`, `TESTING_GUIDE.md` e nel codice esista in uno dei due. È ciò che impedisce a
   questa pulizia — e alla prossima — di perdere una scheda in silenzio. Da provare anche rossa.

## C — `STATUS.md` (~2 h)

1. `docs/history/STATUS-2026-07_08.md`: le **2815 righe** storiche, integrali, in ordine
   cronologico. Comprese le ~93 voci della finta «Release 2.1.0», a cui do le intestazioni che
   non hanno mai avuto, così diventano navigabili.
2. In `STATUS.md` restano: l'avvertenza sulla **riscrittura git del 2026-08-31** (righe 9-56,
   operativa — non si tocca), «Da fare nella prossima sessione», «Da fare dalle sessioni
   precedenti», le verifiche mai eseguite (738-1046), «Remaining tasks», il feature set.
3. Le sezioni storiche diventano **una riga ciascuna** nella «Storico» che c'è già, col formato
   che ha già: hash, data, esito, e il rimando al file d'archivio. Attesa: **da 4021 a ~1200**.
4. Aggiorno la nota di pulizia in testa, come fu fatto per quella del 2026-07-27.

## D — Piani, CONTEXT, report (~1,5 h)

1. **`docs/plans/README.md`**: una riga per piano — data, esito (fatto / parziale / mai
   iniziato), e dove sta l'evidenza. Più una riga di stato in testa a ciascun file **fatto**
   (`> **Fatto**, mergiato in … — questo file resta come referto`). Nessuno spostamento.
2. `global-scripts-template-snippets.md`: senza data, mai iniziato, e punta a un file che non
   esiste. **Te lo segnalo, non lo cancello** — il precedente di `CHANGELOG.md:2585` permetterebbe
   di rimuoverlo, ma è una tua chiamata.
3. **`CONTEXT.md` §3** «Current state (as of June 2026)»: riscritto a settembre, contro il codice
   di oggi. È il documento che il tuo `CLAUDE.md` fa leggere per primo a ogni sessione.
4. **Il report per te**: l'elenco corto delle questioni che aspettano una decisione tua, ciascuna
   con la domanda in una riga e le opzioni in mezza. È il prodotto che serve a te, e il resto
   della pulizia esiste per renderlo leggibile.

## Cosa non faccio

- **Nessuna decisione** su nessuna questione: regola 3. La verifica constata, non sceglie.
- **Nessuna scheda cancellata**, nessun numero riusato, nessun piano spostato.
- **`CHANGELOG.md` non si tocca**: 416 KB, ma è un registro storico per definizione, già
  strutturato in 14 release. Comprimerlo significherebbe cancellare ciò per cui esiste.
- **Nessun push.** E resta in sospeso una cosa tua: il `--delete` dei rami su origin è fallito
  in blocco perché `feat/T-52-limite-pagina-morbido` non c'era più. I cinque rami sono ancora lì:
  ```bash
  git push origin --delete feat/T-50-chat-ai feat/lvgl-gap \
      feat/editor-runtime-chiarezza feat/chat-staccata-e-python fix/sws-display-path-loop
  ```

## Verifica

Automatica, a ogni passo:

```bash
./scripts/check_documenti.sh     # Q1…QN integre fra vivo e archivio, nessun rimando morto
./scripts/check_static.sh        # la guardia nuova entra qui
grep -c '^## Q' docs/OPEN_QUESTIONS.md docs/history/OPEN_QUESTIONS-chiuse.md   # somma = 41
wc -l STATUS.md docs/history/STATUS-2026-07_08.md                              # somma ≈ 4021
```

Più due controlli che faccio a mano e che la guardia non può fare: che ogni link
`docs/history/...` aperto porti davvero alla scheda giusta, e che le sezioni vive di `STATUS.md`
si leggano ancora come un discorso dopo l'asportazione.

**A te resta da guardare**: il report finale — sono le tue domande, e l'unica cosa che il
riordino deve produrre.

## File toccati

- `docs/OPEN_QUESTIONS.md`, `docs/history/OPEN_QUESTIONS-chiuse.md` (nuovo)
- `STATUS.md`, `docs/history/STATUS-2026-07_08.md` (nuovo)
- `docs/history/README.md` (nuovo — cosa c'è dentro e perché, e la differenza da `docs/archive/`)
- `docs/plans/README.md` (nuovo) + una riga in testa ai piani fatti
- `docs/CONTEXT.md` §3
- `scripts/check_documenti.sh` (nuovo) + `scripts/check_static.sh` + `scripts/README.md`
