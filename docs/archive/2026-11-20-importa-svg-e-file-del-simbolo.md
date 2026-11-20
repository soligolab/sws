# Importa SVG e il file del simbolo — la sessione 3 della fase 2

> **Stato: archiviato il 20-11-2026** — **FATTO**, in `main` il 20-11-2026 (squash `7b8e7acc0`); collaudo del 20-11 sull'IDE 8462: voci 1, 4, 6 e 7 passate, le altre in `docs/COLLAUDI_IN_SOSPESO.md`.

> Piano del 20-11-2026 (theobroma). Il maintainer: «fin che non torno puoi proseguire annidando il resto dello
> sviluppo?». È la **sessione 3** del [piano della fase 2](2026-11-19-editor-dei-simboli-fase-2.md): importa SVG
> esploso, esporta e importa il simbolo come file. Il maintainer non c'è: **le decisioni qui sotto le ho prese io**, e
> sono elencate in fondo per la revisione, come nelle [sessioni CRA](../plans/2026-11-17-cra-sessioni-e-decisioni.md).
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
  ancora vuoto nel **corpo**, al posto del riquadro con cui nasce un simbolo nuovo (il compilatore vuole almeno una
  forma nel corpo). Le forme importate restano selezionate: si spostano e si scalano insieme.

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
   nel corpo e si sceglie «colore dello stato». In un simbolo ancora vuoto va **nel corpo** (vedi l'esecuzione), coi
   suoi colori lo stesso.
4. **Ctrl+V** importa un SVG se negli appunti c'è codice SVG; altrimenti incolla le forme copiate nell'editor.
5. `evenodd` resta **un avviso**, non un attributo nuovo del compilatore (`fill_rule` sarebbe facile da aggiungere: si
   decide al collaudo, se gli SVG veri ne hanno bisogno).
6. Un simbolo vuoto **prende le proporzioni** dell'SVG importato.

## Esecuzione (20-11-2026, theobroma)
Ramo `feat/symbol-import`, commit `72f9662ce`. Definition of done verde sul ramo (vitest 2820, cargo test,
`check_static` 58/58, eslint, tsc, build); collaudo del maintainer da fare.

**Differenze dal piano**
- **Un simbolo «vuoto» nel corpo, non nel primo strato.** Il compilatore rifiuta un simbolo senza forme nel corpo
  («manca lo strato body»). E un simbolo nuovo non è vuoto: nasce con un riquadro nel corpo. Quindi «vuoto» vuol dire
  «nessuna forma, o solo quel riquadro» (`isBlank`); in quel caso il riquadro se ne va, il disegno entra nel corpo e il
  simbolo prende le proporzioni dell'SVG.
- **Le forme fuori dal disegno diventano path.** Il compilatore rifiuta un rect, un cerchio o un'ellisse che escono
  dal simbolo di più di un'unità; un path no. Un SVG con forme oltre il `viewBox` (capita) le ha come path, tagliate
  dal disegno come nel browser.
- **Contorno e spigoli sempre scritti.** Gli strati del simbolo compilato danno a tutte le forme un contorno
  (`stroke`, spessore 1, spigoli arrotondati): una forma importata scrive sempre `stroke` (anche «none») e gli spigoli
  quando non sono arrotondati, altrimenti erediterebbe il contorno dello strato.
- **Una `<line>` non si riempie mai** (in SVG non ha un dentro); una linea aperta solo contorno è un `tratto`.
- **«Volume», non «velo»**: nell'editor i veli si chiamano «Volume», e così le finestre dell'import.
- **Ctrl+V**: il tasto non ferma più l'evento del browser; l'incolla delle forme copiate parte un attimo dopo, e
  l'evento `paste` lo annulla se negli appunti c'è codice SVG. L'editor ferma anche l'evento `paste`, perché la pagina
  sotto non incolli immagini mentre l'editor è aperto.

**Le prove**
- 30 SVG veri (i primi quattro di ogni famiglia della libreria, e dieci icone di sistema: Inkscape con sfumature e
  filtri, Breeze con le classi CSS e `currentColor`, un'icona di Firefox) importati e compilati dal runtime dell'IDE
  8464: **30 su 30 senza errori**, e a vista uguali agli originali, salvo i filtri (sfocature) che mancano. Le tavole
  di confronto erano in `sws/tmp/svg-import/`.
- Nell'IDE 8464: «Importa SVG…» su un simbolo nuovo (44 forme dall'icona di GParted, 32 sfumature dette), Ctrl+V di
  codice SVG (uno strato fermo nuovo), «Esporta» e «Importa un simbolo…» (46 forme, compilato senza errori), Ctrl+C e
  Ctrl+V di una forma coi tasti veri.

**Trovato lungo la strada**: Ctrl+Z dopo «Duplica» (e dopo un import) bloccava l'editor: la selezione è per indice e
restava su forme che non c'erano più. Annulla e ripristina ora tolgono la selezione.

**Sullo stesso ramo, a parte** (`bcbc2df29`): Invio nel nome di una bocca non confermava, perché l'editor fermava
tutti i tasti sulla finestra prima di React (annotato nel piano dell'assistente IA). Ora un campo dentro l'editor
riceve i tasti e la radice dell'editor li ferma prima della pagina; nella scheda «IA» torna Ctrl+Invio.

**Resta aperto**: le sei decisioni qui sopra, da confermare al collaudo; CasaDomotica dopo il merge.
