# Un faceplate si disegna, non si scrive in JSON

> **Seme — decisione.** Nato il 27-10-2026 da una richiesta del maintainer, mentre si collaudava
> lo slider sul WP630.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita
> per sviscerarne tutti i dettagli.** Quello che segue sono le misure di oggi e le due strade che
> si vedono, non un disegno.

## L'idea

Oggi un faceplate si modifica scrivendo JSON a mano. Il maintainer vuole disegnarlo come si
disegna una pagina, con gli strumenti che l'editor ha già — **e il JSON deve restare
raggiungibile e modificabile**, da un pulsante dedicato, non sparire.

Le sue parole, e sono due proposte, non una:

> «In Faceplates aggiungere una modalità grafica per il disegno dell'oggetto, come ora esiste per
> una pagina normale, il codice JSON deve rimanere accessibile e modificabile ma da un pulsante
> specifico nell'area. In pratica la sezione Preview diventa centrale allo strumento Faceplates ed
> editabile con gli strumenti pagina normali... non so se è meno lavoro rimpiazzare completamente
> "Faceplates" con una voce simile a "FRAMES" e "BOOT IMAGE" dove i FacePlates in pratica sono
> editati come fossero piccole pagine»

## Com'è adesso (misurato il 27-10-2026)

| Pezzo | Stato |
|---|---|
| `sws-editor/src/config/schede/FaceplatesTab.tsx` | 305 righe. Gli oggetti si scrivono in una **textarea di JSON** alta 340 px: `JSON.stringify(current.objects, null, 2)` in lettura, `JSON.parse` a ogni tasto, e un `catch` vuoto finché il testo non è valido |
| L'anteprima | c'è già, in una colonna da 320 px, e **non è un disegno finto**: usa `SvgObject` e `substituteFaceplateParams`, cioè lo stesso ramo `faceplate` di `SvgCanvas.tsx` che disegna un'istanza piazzata. Ogni parametro dichiarato si sostituisce col proprio nome, come segnaposto visibile |
| I parametri | una seconda textarea, una riga per parametro, con una grammatica sua: `nome:tipo(rif)=predefinito!`. I tipi sono `tag`, `string`, `number`, `color`, `istanza` |
| Su disco | **`faceplates/<id>.yaml`, un file per faceplate** — la stessa forma delle cornici, e `cornici.rs` lo dice in un commento: «come i faceplate in `faceplates/`» |

## La cosa che rende la seconda strada interessante

**Il modello «una pagina che non si naviga» esiste già, e due volte.**

- Le **cornici** (15-10-2026): nello store sono pagine con `kind: "cornice"`, si modificano sul
  canvas come una pagina qualunque, e su disco vivono in `cornici/<id>.yaml`.
  `corniceAPagina`/`paginaACornice` passano dall'una all'altra forma.
- Le **pagine di boot** (T-72): pagine con `kind: "boot"`, stesso canvas, cartella `boot/`, e in
  più una **lista chiusa di tipi ammessi** (`BOOT_TYPES`: sette tipi vettoriali statici) che il
  server rifiuta al salvataggio.

In tutti e due i casi `paginePerNavigazione` le tiene fuori dalla navigazione, e `LeftPanel.tsx`
le raggruppa in una sezione sua. Un `kind: "faceplate"` sarebbe la **terza** volta dello stesso
schema, su una cartella che ha già la forma giusta.

Detto questo, la domanda del maintainer — «non so se è meno lavoro» — resta aperta sul serio: le
due strade non costano uguale e non danno la stessa cosa.

- **Strada A, il canvas dentro la scheda**: l'anteprima diventa modificabile dove sta adesso. Si
  tocca un file solo, i faceplate restano in Configurazione, e il JSON resta a fianco. Ma il
  canvas dell'editor è fatto per una pagina dello store — farlo lavorare su un pezzo di stato che
  pagina non è, probabilmente, è il costo vero.
- **Strada B, il faceplate è una pagina**: si paga la conversione (`faceplateAPagina` e ritorno,
  come per le cornici) e si eredita **tutto** — strumenti, selezione multipla, annulla, griglia,
  allineamenti, copia-incolla, ricerca globale. Il JSON diventa un pulsante sulla pagina.

## Quello che un faceplate ha, e una cornice no

È qui che la terza volta non è una copia delle prime due, ed è il nodo da sciogliere nella
sessione di plan.

- **I parametri.** Un faceplate è un modello: i suoi figli contengono `{tag_prefix}` e compagnia.
  Sul canvas vanno **mostrati sostituiti** (altrimenti non si vede cosa si disegna) ma **scritti
  come riferimento** (altrimenti il modello non è più un modello). Dove si modifica l'elenco dei
  parametri, e come si lega un campo di un figlio a un parametro invece che a un valore.
- **Il riquadro.** Una pagina ha larghezza e altezza dichiarate; un faceplate no — oggi la sua
  misura la decide il rettangolo che contiene i figli, calcolato nell'anteprima. Chi la decide
  quando si disegna.
- **I tipi ammessi.** Le pagine di boot hanno una lista chiusa; un faceplate che gira anche su
  LVGL ne ha una di fatto, e oggi non è dichiarata da nessuna parte.
- **L'annidamento.** Un faceplate può contenerne un altro — l'anteprima riceve già l'elenco
  `faceplates` per questo. Un editor a pagine deve reggerlo e deve impedire il ciclo.
- **Il JSON bidirezionale.** Oggi ogni tasto valido riscrive gli oggetti. Con un canvas accanto,
  chi vince quando si modificano tutti e due, e cosa succede al JSON non valido a metà.

## Da guardare prima di scrivere

- `AlberoConfigurazione.tsx` e la ricerca globale: se i faceplate escono da Configurazione, i
  cinque mondi della ricerca cambiano, e il loro test con loro.
- I tre faceplate predefiniti (`assets/faceplates/motor_basic.yaml`, `valve_basic`, `tank_level`),
  che il runtime incorpora con `include_str!`.
- I gemelli `demo-items-*` e `check_demo_templates.sh`: 39 tipi su 39, e il faceplate è uno.
- **CasaDomotica** (regola del 16-10): usa `tank_level` sul WP630, quindi è il banco di prova già
  pronto.
