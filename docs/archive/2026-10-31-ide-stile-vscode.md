# Le disposizioni dell'IDE, e la prima in più: stile Visual Studio Code

## Context

Il maintainer (31-10-2026): «vorrei riorganizzare l'IDE in modo da avere più configurazioni grafiche per
l'interfaccia e, la prima configurazione aggiuntiva vorrei che portasse l'ambiente ad un aspetto stile Visual Studio
Code. A sinistra un menù di icone compatto (con pop-up di spiegazione) e poi una colonna con gli strumenti di quel
menù, stessa cosa per il pannello a destra con le proprietà». Le icone devono essere **colorate**, a differenza di
VS Code. «Analizzalo e poi iniziamo subito l'implementazione.»

**La disposizione di oggi resta, e si chiama «Classica».** È l'albero unico del 25-09-2026 (`683baf05`): a
sinistra un pannello con le sezioni in fila, a destra i rami a fisarmonica. **«Stile VS Code»** si aggiunge accanto
e si sceglie per browser, come la misura delle icone.

### Cosa c'è già (misurato oggi)

**Pannello sinistro** (`sws-editor/src/editor/LeftPanel.tsx`, montato in `App.tsx:1096` sia in edit sia in
config):
- le sezioni in un unico albero che scorre:
  - `CampoRicerca`/`RisultatiRicerca`;
  - `PagesSection`, con i rami Pagine, Cornici, Faceplate, Immagini di boot, Planimetrie;
  - `RamoStrumenti` (la palette);
  - `ObjectsSection`;
  - `FunctionsSection`;
  - `AlberoConfigurazione` (le schede ⚙, con dentro le Variabili).
- **una colonna di icone c'era già** fino al 25-09-2026 (T-56 passo 2), ed è stata tolta per l'albero unico.
  Il codice della «vista» è ancora lì e si riusa:
  - il contesto `ModoVista` (`LeftPanel.tsx:81`), oggi senza nessun Provider;
  - i suoi rami in `Section` e `useCorpo`: titolo fisso con `TitoloVista`, corpo a tutta altezza, sezione non
    chiudibile.

**Pannello destro** (`PannelloDestro`, `EditorShell.tsx:~1728`):
- i rami sono `GRUPPI_PROPRIETA`: tipo 🎛, aspetto 📐, dati 🔗, interazione ⚡;
- uno solo è aperto (`scelto`, ricordato in `CHIAVE_RAMO_DESTRA`), più quelli appuntati 📌;
- un ramo senza sezioni per l'oggetto non si mostra (`presenti`/`conSezioni`);
- la barra si vede solo con un oggetto singolo (`barraGruppiVisibile`).

**Preferenze dell'IDE:**
- lo schema c'è già: la misura delle icone vive nello store (`misuraIcone`, chiave `sws.ide.misuraIcone`,
  `store/index.ts:266`);
- si sceglie in `config/schede/IdePreferencesTab.tsx`.

**Icone:**
- `editor/iconeStrumenti.ts` + `IconaStrumento.tsx`: una famiglia SVG nostra, 24×24, tratto, `currentColor`;
- la guardia `check_icone_strumenti.sh` le controlla.

**Bordi:** `editor/bordoPannello.ts` (`trascinaBordo`, di oggi) vale per tutti e due i pannelli.

## Il ramo e il piano

- **Il ramo:** `feat/ide-stile-vscode`, annidato su `fix/bordo-pannello` (opzione 2: stessi file,
  `EditorShell.tsx`). Si chiude passando da lì.
- **Il piano:** si copia in `docs/archive/2026-10-31-ide-stile-vscode.md` appena approvato, con la riga nel README.

## Il lavoro, in quattro passi (ciascuno verde e committato)

### 1. La scelta della disposizione

- **Nello store:**
  - `disposizioneIde: "classica" | "vscode"`;
  - chiave `sws.ide.disposizione`, letta come `misuraIconeSalvata()`;
  - `setDisposizioneIde`.
- **In `IdePreferencesTab.tsx`:** una riga «Disposizione dell'interfaccia» con due scelte e una frase ciascuna.
  È un elenco, non un interruttore: la richiesta è «più configurazioni», e le prossime ci entrano senza rifare
  niente.
- **i18n:** it/en (la guardia `check_i18n_ui`).

### 2. `BarraAttivita`: la colonna di icone, una per i due lati (`editor/BarraAttivita.tsx`)

Le proprietà sono `voci: { id, icona, colore, titolo, spiegazione, badge? }[]`, `attiva`, `lato: "sinistra" |
"destra"` e `onScegli(id)`.

- **Forma:**
  - larga 48 px, icone da 24 su fondo `--brand-surface`;
  - la voce attiva ha una barretta di 2 px sul lato esterno, come VS Code, e l'icona piena;
  - le altre stanno al 70 %.
- **Icone colorate:**
  - una famiglia nuova in `editor/iconeAttivita.ts`, stesso formato di `iconeStrumenti.ts`;
  - ogni voce ha un suo colore, con variante chiara e scura in token CSS (`--sws-att-pagine` …) definiti nel tema;
  - contrasto ≥ 3:1 sul fondo, misurato nel test.
- **Il pop-up di spiegazione:** al passaggio del mouse, o con il fuoco da tastiera, appare un riquadro accanto
  alla colonna. Ha il titolo in grassetto e una riga di spiegazione: è più di un `title`, che arriva tardi e non
  si vede col tocco.
- **Il clic:**
  - su un'altra voce cambia la colonna;
  - **sulla voce attiva chiude la colonna** (come VS Code), e il canvas si allarga;
  - un altro clic la riapre.
- **Accessibilità:** `role="tablist"`/`tab`, `aria-selected`, frecce su e giù, Invio.

### 3. Sinistra in stile VS Code (`LeftPanel.tsx`)

**Le voci:**

| icona | voce | colonna |
|---|---|---|
| 🔍 | Cerca | `CampoRicerca` + `RisultatiRicerca` |
| 📄 | Pagine | `PagesSection` (pagine, cornici, faceplate, boot, planimetrie) |
| 🧰 | Strumenti | `RamoStrumenti` |
| 🧱 | Oggetti | `ObjectsSection` |
| ƒ | Funzioni | `FunctionsSection` |
| ⚙ | Configurazione | `AlberoConfigurazione` |

- Le icone qui sopra sono indicative: saranno SVG della famiglia nuova, colorate.
- **Pagine, Strumenti, Oggetti e Funzioni** spariscono per chi non può modificare: è la stessa regola di
  `conPagine`.
- **La colonna** ha in testa il titolo in maiuscoletto (`TitoloVista`, come «EXPLORER») e sotto **una sola**
  sezione, con `ModoVista.Provider value={true}` al posto di `InAlbero`. Sono i rami già scritti per questo:
  non si chiude e scorre fino in fondo.
- **La voce scelta e la colonna chiusa** si ricordano in `sws.ide.vscode.sinistra`.
- **Il bordo** usa `trascinaBordo`, e il pannello sinistro smette anche di ridisegnarsi a ogni pixel.
- **Cosa non cambia:** il comportamento delle sezioni (clic su uno strumento, su una scheda ⚙, ricerca). In
  modalità config la colonna ⚙ è quella che guida `ConfigView`, esattamente come oggi.

### 4. Destra in stile VS Code (`PannelloDestro` in `EditorShell.tsx`)

- **La barra sta sul bordo esterno destro.** Le voci sono i `gruppiVisibili` già filtrati per l'oggetto, con
  l'icona della famiglia nuova colorata.
- **La colonna mostra solo il ramo `effettivo`.** Senza appuntati: in questa disposizione la colonna è una, e il
  📌 non si mostra. Il ramo scelto si ricorda come oggi, in `CHIAVE_RAMO_DESTRA`.
- **Un clic sulla voce attiva chiude la colonna.** Resta la barra di 48 px: il canvas guadagna la larghezza.
- **Senza oggetto, o con più oggetti** (dove oggi la barra dei gruppi non c'è):
  - la barra mostra una voce sola, «Pagina» o «Selezione»;
  - la colonna mostra il contenuto di oggi, cioè `PageProps` / `MultiSelectionProps`;
  - così la colonna non salta da una forma all'altra.

## Fuori da questo piano (righe in `Appunti.txt`)

- **Chat e log come voci della barra** (in VS Code stanno in fondo alla barra e nel pannello in basso): oggi
  sono cassetti, e funzionano.
- **Una barra di stato in basso** in stile VS Code.
- **Altre disposizioni oltre a queste due:** l'elenco è già pronto ad accoglierle.
- **CasaDomotica:** la regola del CLAUDE.md non si applica, perché è l'IDE e non il progetto. Lo si annota
  così com'è, come chiede la regola.

## Test (vitest)

- **`barraAttivita.test.tsx`:**
  - il pop-up compare al passaggio e al fuoco;
  - il clic sull'attiva chiude, un altro clic riapre;
  - le frecce da tastiera;
  - il contrasto dei colori, chiaro e scuro.
- **`pannelloSinistro.test.tsx`, in disposizione `vscode`:**
  - una sola sezione per volta;
  - le voci nascoste a chi non può modificare;
  - la scelta ricordata.
- **`pannelloDestro.test.tsx`, in disposizione `vscode`:**
  - un solo ramo, niente 📌;
  - senza selezione la voce «Pagina».
- **La disposizione classica:** i test di oggi restano verdi senza toccarli. È la prova che «Classica» non è
  cambiata.

## Verifica

- `pnpm exec vitest run`, `pnpm build`, `./scripts/check_static.sh` (`check_i18n_ui`, `check_icone_strumenti`,
  eventuale guardia per le icone nuove), `cargo check`.
- **Dal vivo:** immagine amd64 sul VPS (regola di fine task), su `sws.soligo.net` con CasaDomotica:
  - Configurazione → IDE → «Stile VS Code»;
  - le due barre, i pop-up;
  - chiudere e riaprire le colonne;
  - il canvas che si allarga;
  - il tema chiaro e quello scuro;
  - il ritorno a «Classica» identico a prima.
- **Manuale:** il capitolo dell'IDE (`docs/manual/`) con le due disposizioni. CHANGELOG, e NOVITA se c'è posto
  (il blocco 2.23.8 è pieno: la voce va nel blocco successivo).
