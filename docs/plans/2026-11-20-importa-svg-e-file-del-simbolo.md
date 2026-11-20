# Importa SVG e il file del simbolo — la sessione 3 della fase 2

> Piano del 20-11-2026 (theobroma). Il maintainer: «fin che non torno puoi proseguire annidando il resto dello
> sviluppo?». È la **sessione 3** del [piano della fase 2](2026-11-19-editor-dei-simboli-fase-2.md): importa SVG
> esploso, esporta e importa il simbolo come file. Il maintainer non c'è: **le decisioni qui sotto le ho prese io**, e
> sono elencate in fondo per la revisione, come nelle [sessioni CRA](2026-11-17-cra-sessioni-e-decisioni.md).
> Ramo `feat/symbol-import`, **annidato su `feat/symbol-ai`** (i cinque rami sotto aspettano il collaudo). Codice
> nuovo in inglese.

## Cosa c'è oggi (misurato il 20-11-2026)
- Un simbolo del progetto (`prj:`) è un elenco di operazioni compilate da `sws-core/src/simboli_prj.rs`. Le forme
  ammesse sono `rect`, `circle`, `ellipse`, `path` (`FORME`). I colori propri sono `#rgb`/`#rrggbb` negli `extra`
  (`fill`, `stroke`), con `fill_opacity`, `stroke_opacity`, `stroke_width` (0–20), `stroke_linecap`,
  `stroke_linejoin`, `stroke_dasharray`. La `d` di un path ha solo comandi e numeri, al più 4000 caratteri. Al più
  300 operazioni, lato al più 512.
- L'editor ha già le funzioni pure sui tracciati (`model.ts`: `absolutePath`, `matrixPath`, `transformPath`) ma non
  leggono i flag degli archi scritti attaccati (`a1 1 0 0110 10`), che gli SVG ottimizzati usano.
- Il terzo punto della sessione 3 nel piano di fase 2, **allineare lo schema dell'assistente** («niente colori
  liberi»), è **già fatto**: `schema_simbolo` (`ai/tools.rs`) dice «stroke e fill none o un colore #rgb / #rrggbb».
- L'IDE non ha librerie zip; gli scaricamenti si fanno con `URL.createObjectURL` nel componente.

## Importa SVG
Un modulo puro, `symbols/editor/importSvg.ts`: `importSvg(text, fit) → { ops, size, warnings, skipped }`. Lavora nel
browser con `DOMParser`; nessun SVG arriva al runtime: escono solo operazioni, che il compilatore valida come le altre.
- **Esploso**: ogni forma diventa un'operazione sua; i gruppi spariscono, le trasformazioni (`matrix`, `translate`,
  `scale`, `rotate`, `skewX/Y`, anche su `<use>` e `<svg>` annidati) si applicano ai punti.
- **Forme**: `rect`, `circle`, `ellipse` restano tali se la trasformazione non ruota né inclina; altrimenti, e per
  `path`, `polygon`, `polyline`, `line`, diventano un `path` in coordinate assolute. Gli archi restano archi con una
  scala sugli assi, diventano curve di Bézier con una rotazione. Una linea aperta senza riempimento è un `tratto`.
- **Colori**: attributi, `style`, regole semplici di `<style>` (`.classe`, `#id`, elemento), ereditati dai gruppi.
  Nomi CSS comuni, `rgb()`, `rgba()`, `#rgba`, `currentColor` → `#rrggbb` più l'opacità. `opacity` dei gruppi si
  moltiplica in `fill_opacity`/`stroke_opacity`. Lo spessore del contorno segue la scala, fino a 20.
- **Gradienti**: il colore medio delle fermate, più il velo che gli somiglia (`paint-h`, `paint-v`, `paint-d`,
  `paint-r`). Avviso.
- **Lasciati con un avviso**: `fill-rule: evenodd` (i buchi possono riempirsi), `clip-path`, `mask`, `filter`,
  `pattern` (disegnati senza), `<text>` e `<image>` (saltati: il pannello non ha font, le foto sono della fase 3).
- **Misura**: il `viewBox` (o `width`/`height`, o il riquadro del disegno) entra nel simbolo con le proporzioni,
  centrato. Se il simbolo non ha ancora niente di disegnato, prende le proporzioni dell'SVG (lato lungo invariato).
- **Limiti**: testo fino a 2 MB, 5000 elementi; un path oltre i 4000 caratteri si riscrive con meno decimali, poi si
  divide nei suoi sotto-tracciati, poi si salta; oltre le 300 operazioni del simbolo il resto si salta. Tutto detto
  negli avvisi.
- **Dove finisce**: in uno strato fermo in cima (quello in cima se è già fermo, altrimenti uno nuovo); in un simbolo
  vuoto nel primo strato. Le forme importate restano selezionate: si spostano e si scalano insieme.

**Nell'editor**: «Importa SVG…» nella barra degli strumenti (file `.svg`), il trascinamento di un `.svg` sul disegno,
e **Ctrl+V di un testo SVG** (se negli appunti c'è codice SVG si importa, altrimenti Ctrl+V incolla le forme copiate
come oggi). Gli avvisi in una finestra dopo l'import.

## Il file del simbolo (`.swsym`)
- **«Esporta»** nella barra in alto dell'editor scarica `<slug>.swsym`: JSON
  `{ "format": "sws-symbol", "version": 1, "symbol": <descrizione> }`. Il disegno di adesso, anche non salvato;
  spento se il simbolo ha errori.
- **«Importa un simbolo…»** in Strumenti ▸ Simboli, sotto «+ Nuovo simbolo»: un file `.swsym` apre l'editor sul
  simbolo, come simbolo nuovo del progetto (slug reso unico, `overrides` tolto: non diventa la variante di un simbolo
  di libreria del progetto che lo riceve). Un file `.svg` apre l'editor su un simbolo nuovo col nome del file e il
  disegno importato. Si salva con «Salva», come ogni simbolo nuovo.
- **Perché JSON e non zip**: il piano di fondo voleva uno zip con `symbol.yaml` e le immagini, ma le immagini arrivano
  con la fase 3 e l'IDE non ha una libreria zip. Il lettore riconoscerà lo zip dai primi due byte (`PK`), quindi i
  file JSON di oggi resteranno leggibili.

## Test
- Vitest `importSvg.test.ts`: forme e trasformazioni (rect ruotato → path, cerchio scalato → ellisse), archi coi flag
  attaccati, colori (nomi, `rgb()`, classi di `<style>`, ereditati), opacità, gradiente → colore e velo, `<use>`,
  avvisi (testo, evenodd, clip), adattamento alla misura, limiti; ogni operazione rispetta le regole del compilatore
  (comandi della `d`, colori, chiavi degli extra).
- Vitest sull'editor: «Importa SVG…» aggiunge le forme selezionate in uno strato fermo; Ctrl+V con un SVG negli
  appunti; «Esporta» scarica il JSON; «Importa un simbolo…» apre l'editor con slug unico e senza `overrides`.
- A mano sull'IDE 8464: tre SVG veri (un'icona ottimizzata, un disegno di Inkscape, un'esportazione di Illustrator
  con le classi), compilati dal runtime e visti nell'editor.

## Documenti
Manuale (capitolo dei simboli), CHANGELOG, voci di collaudo, `NOVITA.yaml` al rilascio. CasaDomotica dopo il merge,
con un simbolo importato da SVG (regola di `CLAUDE.md`).

## Decisioni prese senza il maintainer (da rivedere)
1. Il file è **JSON**, non zip, finché non ci sono le foto.
2. Un simbolo importato da file **non è mai una variante**: `overrides` si toglie.
3. L'SVG importato va **in uno strato fermo**, con i suoi colori: non segue lo stato. Per farlo seguire, si sposta
   nel corpo e si sceglie «colore dello stato».
4. **Ctrl+V** importa un SVG se negli appunti c'è codice SVG; altrimenti incolla le forme copiate nell'editor.
5. `evenodd` resta **un avviso**, non un attributo nuovo del compilatore (`fill_rule` sarebbe facile da aggiungere: si
   decide al collaudo, se gli SVG veri ne hanno bisogno).
6. Un simbolo vuoto **prende le proporzioni** dell'SVG importato.
