# Revisione del parco template

> Proposta del maintainer, 14-09-2026: «se parliamo dei template direi di aggiornarli tutti, non
> esistono ad oggi applicazioni finali ma solo semplici test. Anzi, avvierei una sessione di
> revisione dei template».
>
> Il vincolo che rende questa sessione possibile è quella frase: **nessun template è
> un'applicazione consegnata**. Si possono cambiare, spostare oggetti, rinominarli. Un mese fa non
> sarebbe stato vero per `casa-locale`, che è l'impianto di casa del maintainer — resta comunque
> quello da toccare con più riguardo.

## Perché adesso

Il 14-09 due guardie sono state trovate rosse, entrambe da meno di 48 ore, entrambe per la stessa
ragione: un lavoro buono aveva cambiato il runtime e i template erano rimasti indietro. Non è la
prima volta — `7e222e15` (28-08) si chiamava «due template erano rotti da sempre». I template
derivano dal runtime e **niente li tiene agganciati** se non `check_templates.sh`, che controlla
la *verità* (asset che esistono, pagine con id, navbutton che puntano a qualcosa) ma non
l'**utilità**: un template può essere tutto vero e non mostrare niente di ciò che il prodotto sa
fare.

## Cosa dicono i numeri, misurati il 14-09-2026

| Template | Pagine | Tipi | Oggetti | Ultimo tocco |
|---|---:|---:|---:|---|
| `homeassistant-pro` | 6 | 12 | 441 | 28-08 |
| `casa-locale` | 5 | 15 | 292 | 14-09 |
| `homeassistant-demo` | 3 | 11 | 152 | 28-08 |
| `demo-items-web` / `-lvgl` | 4 | **35** | 130 | 13-09 |
| `grid-playground` | 2 | 15 | 48 | 13-09 |
| `opcua-demo` | 2 | 9 | 48 | 28-08 |
| `nebulizzatore-sandokan` | 1 | 6 | 17 | 12-08 |
| `sparkplug-demo` | 1 | 3 | 15 | 28-08 |
| `enip-demo` / `s7-demo` | 1 | 3 | 13 | 28-08 |

**La copertura dei tipi è completa**: tutti e 35 i tipi di oggetto compaiono da qualche parte, e
nessuno compare una volta sola. Merito dei gemelli `demo-items`, che sono l'inventario. Non è lì
il problema.

**Il problema è che intere funzioni non le esercita nessuno**, e si vede solo guardando i
`project.yaml`:

- **`min_role` — zero template su undici.** Tutto il lavoro di Q36 (il gate dei ruoli sugli
  oggetti, sia web sia LVGL, collaudato dal vivo) non ha un solo esempio nel parco. Chi apre un
  template non scopre che la funzione esiste.
- **`recipes:` — zero template**, eppure `recipe_panel` è piazzato su due pagine (`demo-items-web`
  e `-lvgl`, «Allarmi e composizione»). Quel pannello si disegna **vuoto** in entrambi: un widget
  in vetrina che non mostra niente è peggio di un widget assente.
- **`target:` — solo `demo-items-lvgl`.** Da T-58 il motore di rendering si sceglie dall'IDE; il
  resto del parco non dichiara niente e prende il default web.
- **I waypoint (T-53) — zero template.** Funzione di due giorni fa, nessun esempio.

**E c'è un residuo di licenza da chiudere.** `casa-locale/CREDITS.md` elenca 8 SVG Material Design
Icons «nella directory `sws-editor/public/symbols/`»: **sette di quei file non esistono più**,
cancellati dal commit di Q40 che ha reso builtin i simboli. Il documento promette di
ridistribuire file che non ridistribuiamo. Sull'altro lato, `public/symbols/ATTRIBUTION.md`
descrive il meccanismo `kind: "vendored"` — che dal 13-09 ha **zero utenti**, perché `VENDORED`
in `svg_assets.rs` è vuota.

## I passi

### 1. La verità dei documenti di licenza — **prima di tutto il resto**

Non è lavoro di grafica ed è l'unico pezzo con una conseguenza legale. Due fatti da accertare, una
domanda da fare al maintainer:

- `CREDITS.md` di `casa-locale` va riscritto su ciò che il repo **contiene davvero**.
- `ATTRIBUTION.md` descrive un meccanismo senza utenti: o si dichiara che è vuoto per scelta, o si
  toglie insieme al ramo `vendored` se nessuno lo userà più.
- **La domanda, che non decido io**: i 7 builtin che hanno sostituito le icone MDI risultano
  «ridisegnate da zero come icone stilizzate» (CHANGELOG, Q40). Se è così non sono opere derivate
  e l'attribuzione MDI non serve più; se invece sono ricalcate, serve. Decide il maintainer, e la
  risposta va scritta, non lasciata implicita.

### 2. Dare un ruolo dichiarato a ogni template

Oggi il parco mescola tre cose diverse senza dirlo, e si giudicano con lo stesso metro:

- **inventario** — `demo-items-web`/`-lvgl`: devono contenere *tutto*, e sono gemelli apposta;
- **banco di prova di un protocollo** — `enip`, `s7`, `sparkplug`, `opcua`: 3-9 tipi e una
  manciata di oggetti, perché il punto è la sorgente, non il disegno;
- **applicazione realistica** — `casa-locale`, i due `homeassistant`, `nebulizzatore-sandokan`:
  quelle che un cliente apre per capire com'è fatto un impianto vero.

Un README per cartella (o una riga nel `meta:` del progetto) che dica quale dei tre è, e il metro
con cui va giudicato. Senza questo passo il resto della revisione non ha un criterio: non si può
dire se `s7-demo` con 13 oggetti sia povero o giusto così.

### 3. Le funzioni senza vetrina

In ordine di valore, non di costo:

- **`recipes:` in `demo-items`**, perché `recipe_panel` smetta di essere un rettangolo vuoto in
  entrambi i gemelli. È il difetto più visibile del parco.
- **`min_role` su almeno un oggetto** di un template realistico — con l'avviso già presente
  nell'editor quando l'istanza è in no-auth, l'esempio si spiega da sé.
- **Un percorso con waypoint** (T-53) dove ha senso: il nebulizzatore è il candidato naturale.
- **`target:` esplicito** dove il template è pensato per un pannello.

### 4. La parità dei gemelli, verificata e non assunta

`demo-items-web` e `demo-items-lvgl` devono restare due viste della stessa cosa. `check_demo_templates.sh`
li confronta già; la verifica dal vivo del 12/13-09 ha comunque trovato **quattro divergenze
vere** (`radio`, `table`, `progress_bar`, `gauge_zones`) che la guardia non vedeva. Vale la pena
chiedersi cosa la guardia possa imparare da quelle quattro, invece di rifare a mano la stessa
verifica ogni volta.

### 5. I sei template fermi al 28-08

`enip`, `s7`, `sparkplug`, `opcua`, i due `homeassistant`: sedici giorni in cui il runtime ha
guadagnato xy_plot multi-coppia, bordi per-cella, simboli ricolorabili, gate dei ruoli. Non vanno
riempiti per forza — vanno **guardati uno per uno** con il metro deciso al passo 2, e per ognuno
si decide: aggiornare, lasciare com'è dichiarando perché, o togliere.

## Cosa NON fare in questa sessione

- **Non toccare `casa-locale` per estetica.** È l'impianto di casa del maintainer e ha un piano
  suo (`2026-09-12-casamauro-arricchimento-demo.md`). Qui rientra solo per i documenti di licenza
  del passo 1.
- **Non decidere la questione MDI** (passo 1) da soli: è una domanda al maintainer.
- **Non aggiungere un template nuovo.** Undici sono già tanti da tenere in pari; questa sessione
  serve a ridurre il debito, non ad aumentarlo.

## Verifica

`./scripts/check_static.sh` verde — ora è nella *definition of done* — con dentro
`check_templates.sh` e `check_demo_templates.sh`. Per i template che cambiano visibilmente, uno
sguardo nell'editor: la regola WYSIWYG dice che l'edit-mode e il runtime disegnano con lo stesso
codice, quindi guardare l'editor è guardare il pannello.

Se dal passo 2 esce un criterio scrivibile («un template di protocollo deve avere almeno una
pagina che mostra la sorgente viva»), diventa un controllo in `check_templates.sh` invece che un
proposito.
