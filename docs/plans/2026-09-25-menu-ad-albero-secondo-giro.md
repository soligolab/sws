# Il pannello ad albero, secondo giro — piano

> **Proposto il 25-09-2026**, dopo che il maintainer ha usato l'albero unico nato il giorno prima
> (`683baf05`). Non è un seme: le decisioni sono state prese, e sotto ci sono i passi.
> **In attesa del via libera prima di scrivere codice.**

## Contesto

L'albero unico funziona, ma usandolo sono emerse tre cose. Parole del maintainer:

1. **Il ramo Istanza va riorganizzato**: Stato, Device e Runtime aggregati in un ramo «Device» con
   sotto-alberi mirati; **Runtime è troppo lungo** e va diviso in «Runtime connection», «Install on
   device» e «Container management»; la sezione «Pacchetto runtime (solo sviluppo)» diventa un
   **menù sviluppatore** nel ramo principale di Istanza.
2. **Le variabili live sotto PROJECTS › Tags**: cliccando la foglia si editano le variabili, e
   subito sotto nell'albero si vedono le stesse **live**, raggruppabili.
3. **Gli oggetti della pagina diventano un albero** con la stessa struttura delle pagine.

## Misurato sul codice il 25-09-2026 (`main` a `749a9c95`)

- **L'albero non è una struttura dati sola: è ibrido.** I rami dell'editor (Pagine, Strumenti,
  Oggetti, Funzioni, Tag) sono JSX scritto a mano in `LeftPanel.tsx:1883-1892`; i cinque rami di
  configurazione sono **generati** ciclando su `RAMI` in `config/schede.ts`. Non esiste un tipo
  `NodoAlbero` comune, e i tre alberi (pagine, oggetti, configurazione) hanno **tre implementazioni
  indipendenti** di righe, rientro, espansione e memoria. Il solo pezzo condiviso è
  `editor/stilePannelli.tsx`.
- **Il registro ha due livelli, non tre.** `RamoConfig` è un'unione chiusa
  (`progetto | dati | sicurezza | istanza | ide`, `schede.ts:22`) e l'albero fa ramo → scheda →
  elementi. Un ramo «Device» *dentro* Istanza è un livello nuovo.
- **`RuntimeConnectionTab.tsx` è 1 740 righe**, il file più grosso rimasto dopo lo smontamento di
  `ConfigView`. Le sue sezioni, in ordine di schermo: connessione remota (878-1028), banner di
  stato senza titolo (1031-1063), deploy progetto (1067-1127), riapri il progetto del dispositivo
  (1134-1249), log remoti (1251-1258), `<StatoBootImage/>` (1262), variabili live del **device**
  (1266-1289), pacchetto runtime solo-sviluppo (1295-1350), installa su dispositivo in cinque passi
  (1359-1737), e **dentro** il passo 5 la gestione container (1652-1735).
- **`SystemTab.tsx` 747 righe**, **`DevicesTab.tsx` 561**. Fra Devices e Runtime c'è un **import
  circolare**: `DevicesTab` prende `RT_URL_KEY`/`RT_USER_KEY` da `RuntimeConnectionTab`, che a sua
  volta prende `registraDispositivo`/`flushBeforeDeploy` da `DevicesTab`.
- **Non esiste un flag «modalità sviluppatore»**: zero occorrenze di `import.meta.env.DEV`,
  `devMode`, `developerMode`. L'unica nozione è `repoDisponibile`, `useState` **privato** di
  `RuntimeConnectionTab` alimentato da `api.buildStato()` (il server risponde `{repo: bool}`,
  `packaging.rs:95-107`; Q51 dice già che questi sono strumenti di sviluppo).
- **`TagsSection`** (`LeftPanel.tsx:1702-1806`) legge `s.tagValues` alimentato da `useTagStream()`
  su `/ws/tags`; mostra id, pallino qualità, valore, e un pallino ambra se il tag non è usato.
  **Nessun filtro, nessun raggruppamento**, e **solo le radici dichiarate**: di `motore1` non si
  vedono le foglie. È **l'unico ramo senza gate di permesso** (test apposta in
  `pannelloSinistro.test.tsx:94`).
- **`ObjectsSection`** (`LeftPanel.tsx:897-1439`) elenca **solo la pagina corrente**: prima i
  gruppi coi membri, poi gli oggetti sciolti in z-order. Ha già drag&drop, rinomina inline, menu
  contestuale, selezione sincronizzata col canvas, e una **ricerca cross-pagina** (`findObjects`)
  che **raggruppa già i risultati per pagina** — ma solo con una query non vuota, e nell'ordine di
  `pages`, non di `page_tree`.
- **Da riusare, e già pronto**: `pageTree.righe(albero, chiusi)` e `pageTree.ordinaPagine()`
  (`src/pageTree.ts`); `tagCatalog(project)` (`src/tagCatalog.ts`, dà `tipo = type_ref ?? data_type`
  e `livello`); `foglieDiTolleranti` (`src/tag/forma.ts:120`); `categoriaDi` (`src/tag/tipiScalari.ts:57`).

## Decisioni del maintainer (25-09-2026)

| domanda | scelta |
|---|---|
| «Device › Device» | **rinominare le foglie**, non il ramo |
| oggetti: quali pagine | **tutte**, albero completo |
| raggruppamento dei tag live | **un selettore nel pannello**, scelta ricordata |
| chi vede i tag live | **la foglia Tags si vede sempre**: fuori dal gate `puoConfigurare`; chi non configura non apre la tabella, ha solo i figli live |
| albero lunghissimo | **niente tetti di altezza**: rami grossi **chiusi** di default, coerente con la scelta del 25-09 |
| foglie dei tipi struttura | **sì, si espandono** coi valori veri |

### Assunzioni dichiarate (da vetare se sbagliate)

- Le foglie sotto «Device» si chiamano **Stato**, **Dispositivi**, **Connessione**,
  **Installazione**, **Container**. Nessuna ripete il nome del ramo.
- `<StatoBootImage/>` non è connessione né installazione né container: va sotto **Stato**.
- La sezione «Variabili live» dentro Runtime **resta dov'è**: mostra i tag del **device remoto**
  (`/ws/remote/tags`), non quelli locali del ramo Tag — non è un doppione.
- Il deep link `#config/runtime` continua a funzionare e apre **Connessione**.

## R1 — Istanza riorganizzato · `feat/albero-istanza`

**Il livello nuovo.** `SchedaConfig` prende `sottoRamo?: SottoRamo`
(`"device" | "sviluppatore"`); `AlberoConfigurazione` disegna, dentro un ramo, prima le schede
senza sotto-ramo e poi un nodo per ogni sotto-ramo con le sue foglie. Un elenco solo, come vuole il
commento in testa a quel file: il sotto-ramo si deduce dal registro, non da un secondo array.

**La divisione di Runtime.** Tre schede nuove al posto di una, tre file al posto di uno da 1 740
righe:

| scheda | file | da dove |
|---|---|---|
| `runtime` (Connessione) | `RuntimeConnectionTab.tsx`, ridotto | sezioni 1-5 e 7 |
| `install` (Installazione) | `InstallTab.tsx` | sezione 9, i cinque passi |
| `container` (Container) | `ContainerTab.tsx` | sezione 9b |

Due nodi da sciogliere, e sono la parte vera del lavoro:

1. **Container è annidata dentro il passo 5** dell'installazione e ne condivide lo stato
   (`deviceHost`, `devicePort`, `deviceUser`, `devicePass`, `dataPath`). Ha già un interruttore
   locale/remoto suo (`manageLocal`, default `true`). I campi comuni salgono in un hook condiviso
   accanto a `config/credenzialiDispositivo.ts`, che già esiste per questo mestiere.
2. **Il banner di stato** (senza titolo) serve a tutte e tre: diventa un componente in `comuni.tsx`
   montato da ognuna.

Nello stesso ramo si scioglie **l'import circolare** Devices↔Runtime spostando `RT_URL_KEY`/
`RT_USER_KEY` nel modulo comune.

**Il menù sviluppatore.** Sotto-ramo `sviluppatore` con la scheda `devpackage` (sezione 8 di oggi,
righe 1295-1350) e il selettore binario/container che oggi è gated dallo stesso flag.
`repoDisponibile` **sale nello store** da `useState` privato: una chiamata sola ad `api.buildStato()`
all'avvio, e il sotto-ramo non si disegna se `repo` è falso. Senza questo, il menù sviluppatore
comparirebbe anche su un'installazione di un cliente.

**Da aggiornare**: `COMPONENTI` in `ConfigView.tsx` (esaustivo: il compilatore obbliga), `config.tabs.*`
e `config.rami.*` in `it.json`/`en.json`, e `e2e/screenshots.spec.ts:132,156` (il test «10 — runtime /
package builder tab» va spezzato).

## R2 — Le variabili live sotto Tags · `feat/albero-tag-live`

La foglia `tags` guadagna dei figli, ma **non** sono `VoceElencoConfig {id, etichetta, modificato}`:
quella forma non porta valore, qualità né gerarchia. Il ramo `tags` ha un **renderer suo** dentro
`AlberoConfigurazione`, che riusa le righe di `TagsSection` invece di reinventarle.

- **Le righe** escono da `TagsSection` in un componente proprio (`editor/RigaTagLive.tsx`), usato
  sia dal ramo vecchio sia dal nuovo: pallino qualità, id, valore, pallino ambra dei non usati,
  espansione degli usi. Nessuna logica duplicata.
- **Le foglie dei tipi**: un'istanza (`type_ref`) diventa un nodo espandibile; i figli vengono da
  `foglieDiTolleranti(tag, types)` e il valore si legge da `tagValues[percorso]`. `tagCatalog` dà già
  `tipo` e `livello`, e `confrontaPercorsi` ordina `valvole[2]` prima di `valvole[10]`.
- **Il selettore di raggruppamento** in cima al ramo: *nessuno* (ordine del progetto), *tipo di dato*
  (via `categoriaDi`), *tipo struttura* (via `type_ref`), *sorgente*. Scelta ricordata sotto
  `PREFISSO_MEMORIA + "albero.tagRaggruppa"`, come le altre memorie del pannello.
- **Il gate**: la foglia `tags` esce da `puoConfigurare`. Chi non può configurare la vede, con i
  figli live, e il clic **non** apre la tabella. Il ramo `TagsSection` di primo livello **sparisce**:
  la sua funzione è assorbita qui. Il test `pannelloSinistro.test.tsx:94` va riscritto di conseguenza
  — è il caso che dimostra che il ruolo minimo non è rimasto senza niente.
- **Chiuso di default**, perché su un progetto vero sono centinaia di righe.
- **Gli usi di una variabile si raggruppano per categoria** (decisione del maintainer, 25-09-2026,
  guardando l'albero vero: «mostrati così quei dati non dicono nulla all'utente finale»). Oggi
  espandendo un tag escono righe come `· page "Home"` e in fondo la frase «Recipes and Python
  functions are not checked». Diventano: **Pagine (2)**, **Allarmi (1)**, **Espressioni**,
  **Script**, ognuna col conteggio e le voci sotto — e la voce di pagina dice **quale oggetto**,
  non solo la pagina. Il limite su ricette e Python smette di essere una riga di testo sotto ogni
  tag e diventa un ⓘ da sfiorare.

## R3 — Gli oggetti di tutte le pagine · `feat/albero-oggetti`

`ObjectsSection` passa da «gli oggetti della pagina corrente» a «l'albero del progetto»:

- **la spina dorsale** è `pageTree.ordinaPagine(pagine, albero)` con `riconcilia` — le pagine
  nell'ordine e nel rientro veri, gli stessi del ramo Pagine, boot escluse
  (`paginePerNavigazione`);
- **sotto ogni pagina** l'albero di oggi (gruppi coi membri, poi gli sciolti in z-order);
- **solo la pagina corrente nasce aperta**; le altre si calcolano quando si aprono, così il costo
  non si paga all'avvio;
- **la ricerca** smette di essere un ramo separato: `findObjects` alimenta lo stesso albero,
  filtrando le pagine senza risultati. Sparisce la casella «Cerca in tutte le pagine», perché
  l'albero è già di tutte;
- **drag&drop, rinomina, menu contestuale e selezione** restano, ma **solo dentro la pagina
  corrente**: trascinare un oggetto da una pagina all'altra è un'altra funzione e non entra qui.

**Due buchi noti, dichiarati e non chiusi qui**: i figli annidati delle sub-grid (`GridCell.sub`,
ricorsivo) non compaiono nell'albero nemmeno oggi, e i figli dei faceplate vivono in
`FaceplateDef.objects` e non nella pagina. Se vanno mostrati è un lavoro a parte.

## Rischi

- **`LeftPanel.tsx` è a 1 902 righe** e R2+R3 lo toccano in profondità. I pezzi estratti
  (`RigaTagLive`, l'albero degli oggetti) escono in file propri: è la direzione del seme
  [riorganizzare i file dell'editor](2026-09-22-riorganizzare-i-file-dell-editor.md), fatta per
  necessità invece che per programma.
- **Tre alberi, tre implementazioni.** Questo piano non le unifica: sarebbe un quarto lavoro, e
  unificare mentre si cambia il contenuto è il modo di rompere entrambi. Se dopo R3 la duplicazione
  è evidente, diventa un seme.
- **Nessun test unitario** copre `RuntimeConnectionTab`, `SystemTab`, `DevicesTab`: la divisione di
  R1 non ha rete. La rete è il collaudo a schermo e le e2e.
- Il collaudo a schermo dell'albero unico (`STATUS.md`, punto 1 dei «da fare») **non è ancora
  stato fatto**: questo piano ci costruisce sopra.

## Verifica, per ogni ramo

`cargo check`, `pnpm build`, `pnpm test`, `./scripts/check_static.sh` verdi; poi a schermo con
`./scripts/start_editor_develop.sh`.

- **R1**: le cinque foglie sotto Device, i deep link `#config/runtime`, `#config/install`,
  `#config/container`, il menù sviluppatore che **non** compare quando il repo non c'è (si prova
  spegnendo `repo`), un non-admin che vede solo Stato.
- **R2**: la foglia Tags con un ruolo che non può configurare; i quattro raggruppamenti; un'istanza
  di tipo struttura che si espande e mostra valori veri; la memoria della scelta dopo un ricarico.
- **R3**: albero con due pagine annidate, la corrente aperta e le altre no; selezione dal canvas che
  apre il ramo giusto; ricerca che filtra le pagine; drag&drop ancora funzionante.

Un ramo alla volta, in quest'ordine, ognuno mergiato e cancellato prima del successivo.
