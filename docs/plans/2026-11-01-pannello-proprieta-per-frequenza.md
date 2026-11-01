# Il pannello proprietà ordinato per frequenza, con i tag tutti insieme

**Stato:** piano d'esecuzione, **da fare**, su un ramo annidato su `feat/ide-stile-vscode` (vedi «Il ramo cambia»).

## Da dove nasce

Il maintainer, 01-11-2026, guardando il pannello destro:

> «le voci sono organizzate in modo strano e quando edito un oggetto mi trovo a dover navigare tra tutte le schede
> per le configurazioni più classiche, è poco ergonomico ma non ho idea di come riorganizzare»

E dopo aver visto la proposta:

> «vorrei che i campi dei tag associati a funzioni (dati in ingresso e uscita) fossero tutti vicini per quello che
> è possibile»

La tavola di confronto è in `sws/tmp/pannello-destro/tavola.png`, scratch e non versionata. Il maintainer l'ha
approvata.

## Cosa c'è oggi (misurato il 01-11-2026 su demo-items-web)

**I rami** sono `GRUPPI_PROPRIETA` in `sws-editor/src/editor/EditorShell.tsx`:
- tipo 🎛;
- aspetto 📐 «Posizione e aspetto»;
- dati 🔗 «Dati e collegamenti»;
- interazione ⚡ «Animazione e interazione».

**Dove finiscono le sezioni** (tabella `ORDINE_SEZIONI`):
- `parametri`, `testo`, `forma` e `dato` stanno in «tipo»;
- `identita`, `aspetto`, `transform` e `layer` stanno in «aspetto»;
- `bindings` e `quality` stanno in «dati»;
- `motion`, `events` e `security` stanno in «interazione».

**Cosa non va:**
- **Le categorie sono tecniche, non d'uso.**
  - Un bottone «normale» chiede 3 rami su 4:
    - tag, etichetta e comando sono in «tipo»;
    - il colore è in «aspetto»;
    - ruolo e conferma sono in «interazione».
  - Lo slider ha l'opposto: circa 35 campi in una sola «Parametri», con colori, comportamento e dati mescolati.
- **«Dati e collegamenti» è quasi sempre vuoto:** contiene solo l'indicatore di qualità e l'elenco dei binding.
- **Su slider e gauge la sezione «Dato» è vuota:** il tag sta in «Parametri».
- **I tag sono sparsi.** Il simbolo è l'esempio peggiore:

  | Tag | Dove sta |
  |---|---|
  | stato, allarme, comando | in testa a Parametri |
  | rotazione, lampeggio, livello | più in basso, fra i colori |
  | tag di stato per la qualità, `blink_tag` | Indicatore qualità, ramo dati |
  | `visible_tag` | Layer |
  | `motion_tag` | Movimento, ramo interazione |

- **Gli altri tipi sparsi allo stesso modo:**
  - lo slider ha `slider_pv_tag` in fondo;
  - il gauge ha `gauge_sp_tag` in «Secondo indicatore»;
  - il tubo ha livello, stato, allarme, etichetta e flusso alternati agli stili;
  - il bottone ha «Al clic, assegna» in Parametri.

## La forma decisa (01-11-2026)

Quattro rami, ordinati per frequenza d'uso.

| ramo | contenuto |
|---|---|
| 🎛 **&lt;Tipo&gt;: la funzione** | **Collegamenti** (in testa), Scala, Testo, Comando, Accesso |
| 🎨 **Aspetto** | tutti i colori, stile, traccia, tacche, font e corpi, sfondo, opacità, luminosità |
| 📐 **Posizione** | nome, X Y W H, layer e visibilità, rotazione e rifletti, movimento su percorso |
| ⚙ **Avanzate** | indicatore qualità, stale, lampeggio di qualità, eventi verso funzioni, durata transizione |

**Il primo ramo, sezione per sezione:**
- **Scala:** min, max, step, unità e decimali.
- **Testo:** etichetta e formato.
- **Comando:** modalità, valore, azione, solo lettura, scrittura al rilascio, molla, deadband.
- **Accesso:** ruolo minimo, conferma, messaggio, password.

**La sezione «Collegamenti»** è la richiesta del maintainer: tutti i tag dell'oggetto vicini.
- **Ingressi (lettura):**
  - tag principale, PV, setpoint;
  - stato, allarme;
  - livello, flusso, etichetta del tubo;
  - rotazione, lampeggio;
  - tag di stato per la qualità;
  - visibilità, movimento.
- **Uscite (scrittura):** tag comando, scritture «Al clic, assegna».
- **I 🔗 sui singoli campi** restano accanto al campo che pilotano. In «Collegamenti» compare il loro elenco, solo
  in lettura: un clic porta al campo e al suo ramo. Oggi quell'elenco è «Binding attivi», nel ramo dati.
- **I parametri delle funzioni negli eventi** restano con l'evento: staccati dalla funzione non si capiscono.

**Il ramo «Dati e collegamenti» sparisce.**

**Le regole che restano:**
- **Ogni campo in un punto solo** (regola UI n. 2 del CLAUDE.md): i campi si spostano, non si duplicano.
- **Vale per tutte e due le disposizioni,** «Classica» e «Stile VS Code», che condividono `GRUPPI_PROPRIETA`.
- **Le pagine di boot** tengono solo funzione (senza Collegamenti) e aspetto/posizione, come `GRUPPI_BOOT` oggi.

## Rivista da UI designer (01-11-2026), e approvata

La forma qui sopra è stata rivista lo stesso giorno, e il maintainer ha approvato le correzioni («Sì, mi sembra
sensato, procedi»). **Dove questa sezione contraddice quella sopra, vale questa.**

1. **Tre rami, non quattro:** 🎛 **Funzione**, 🎨 **Aspetto**, ✨ **Comportamento**.
   - **Spariscono «Posizione» e «Avanzate».** Un cassetto «Avanzate» non lo apre nessuno, perché nessuno sa cosa
     sia «avanzato».
   - **Comportamento** tiene eventi verso funzioni, movimento su percorso e durata della transizione.
2. **Una striscia fissa in testa alla colonna**, sempre visibile e fuori dai rami, come in Figma: nome, tipo/id,
   X Y W H.
   - Il resto della posizione va in Aspetto, nelle sezioni chiuse: layer, z-index, bloccato, rotazione, rifletti.
   - X, Y, W e H si cambiano quasi sempre trascinando: non meritano un ramo.
3. **L'indicatore di qualità va in «Collegamenti»,** accanto al suo tag: colori buono/incerto/errore, bordo su
   allarme, valore Bad in grigio, stale. La norma ISA-101 tratta la salute del dato come essenziale, non avanzata.
4. **I colori che dipendono da un dato stanno nella Funzione;** quelli fissi stanno in Aspetto. Quindi la
   mappatura stato→colore (acceso, spento, allarme del simbolo; colore a soglia del testo; bande e zone colorate)
   sta vicino al tag di stato che la comanda.
5. **In «Collegamenti» si vedono solo i tag collegati.**
   - Il pulsante **«+ Collega…»** elenca le funzioni libere del tipo: rotazione, lampeggio, livello, visibilità…
   - Ogni riga mostra:
     - **la direzione**, ← per l'ingresso e → per l'uscita;
     - **l'effetto scritto**, per esempio «Visibilità ← plant.mode»;
     - **il valore live** (regola WYSIWYG: dati veri quando ci sono, una lettura e niente polling in edit).
   - Il tag principale del tipo, se ce l'ha, c'è sempre, anche vuoto.
6. **Dove un tag è stato tolto dalla sua sezione**, per esempio la visibilità da Layer, resta una riga in sola
   lettura, «comandata da un tag», con il rimando a Collegamenti. Non scrive il campo, quindi la regola UI n. 2
   tiene.
7. **Il filtro «Filtra proprietà» non è più facoltativo.**
   - Sta in testa alla colonna e cerca in tutti e tre i rami.
   - È la promessa dello stile VS Code: «trovo tutto cercando», come nelle Impostazioni di VS Code.

### Come si giudica: tre compiti misurati

Tre compiti, prima e dopo, contando i rami aperti e lo scorrimento:
- **Bottone:** scrive con conferma.
- **Slider:** con il valore misurato (PV).
- **Simbolo:** con stato, allarme e rotazione.

La tavola li mostra **insieme allo stile VS Code**: il maintainer vuole valutare le due cose insieme («per vedere
se è tutto coerente e funzionale»).

### Il ramo cambia

**Il ramo sarà annidato su `feat/ide-stile-vscode`** (opzione 2 di «Un ramo alla volta»), non aperto dopo: lo
stile VS Code non si chiude prima, perché si valuta insieme a questo lavoro. Stessi file (`EditorShell.tsx`), e
rientrano insieme.

## Il lavoro grosso

**Spezzare la «Parametri» di ognuno dei 33 tipi** di `TIPI_CON_PARAMETRI` fra Collegamenti, Scala/Testo/Comando e
Aspetto. Oggi la sezione è il pezzo più piccolo che si sposta; servirà un'unità più fine, sezioni per tipo con il
loro `gruppo`.

**Il resto:**
- **Tabelle e voci:** `ORDINE_SEZIONI`, `GRUPPI_PROPRIETA`, `ramoEffettivo` e le chiavi ricordate in localStorage
  (un ramo salvato che non esiste più deve ricadere sul primo).
- **Icone:** `iconeAttivita.ts`, con «dati» che esce e «posizione» e «avanzate» che entrano.
- **i18n, test e manuale:** i18n it/en; i test del pannello destro, `campoNumero.test.tsx` (cerca «Min» nei rami) e
  il gemello `check_synoptic_schema`, se tocca gli esempi; il capitolo `docs/manual/04_editor_guide.md`.

**Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita**, in Plan mode. Serve a
decidere tipo per tipo dove va ogni campo, l'ordine dei rami di uscita e il modo di farlo a fasi senza lasciare
`main` a metà. Gli oggetti di prova sono quelli di `demo-items-web` (bottone, slider, gauge, simbolo, tubo, testo),
e lo script d'inventario è in `sws/tmp/pannello-destro/`.

## CasaDomotica

Riguarda l'IDE, non il progetto: la regola non si applica.
