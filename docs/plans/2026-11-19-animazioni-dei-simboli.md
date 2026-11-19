# L'editor dei simboli, fase 2 sessione 2 — le animazioni agganciate ai tag

> Piano del 19-11-2026, sessione di plan col maintainer dopo la chiusura della sessione 1 (`b99855ddf`). È la sessione 2
> del piano [fase 2](2026-11-19-editor-dei-simboli-fase-2.md), divisa in quattro (2a–2d) su un ramo solo,
> `feat/symbol-anim`. Codice nuovo in inglese, documenti in italiano.

## Contesto
Il maintainer vuole animare i simboli del progetto (`prj:`) con i tag: rotazione, colore/accensione/visibilità/lampeggio,
movimento fra due posizioni, riempimento in ogni direzione, vibrazione e pulsazione, su web e sul pannello LVGL.

Misurato oggi (tre esplorazioni del codice):
- **Ci sono già cinque parti vive**: `level`, `rotor`, `needle`, `lever`, `lamp`. Ognuna è uno **strato** del simbolo
  (`parte {id, kind, geo}` in `sws-core/src/simboli_prj.rs`). Sul pannello ogni strato è un'immagine a parte
  (`lv_canvas`), quindi la cosa più piccola che si può muovere è uno strato.
- **Legami in pagina**: `symbol_parts[id] = {tag, min, max}` per lancetta, leva e spia (`Collegamenti.tsx`
  `PartiDelSimbolo`); la girante e il livello hanno un legame solo per tutto il simbolo (`symbol_spin*`,
  `fill_level_tag`). Il rinomina dei tag e la raccolta dei tag (`collectTagIds.ts`) coprono già `symbol_parts`.
- **Web**: `SimboloLibSvg` (`symbols/lib/SimboloLib.tsx`) con trasformazioni CSS, un keyframe di rotazione, e gli
  effetti a tempo spenti nell'editor se «Anteprima effetti» è spento.
- **LVGL**: nessun timer; ogni fotogramma (20 al secondo) ricalcola e scrive solo se cambia. Girante a fotogrammi
  pronti (fino a 8 MiB l'una), lancetta con `transform_angle`, livello con una finestra di ritaglio solo verticale,
  colore del corpo con una cache che, se manca il colore, ridisegna con resvg dentro il fotogramma.
- **Valutatori condivisi**: `parti-simbolo.json` e `stato-simbolo.json` (Rust e TypeScript leggono lo stesso file).
  Niente di condiviso per gli effetti a tempo.
- **Rischio di compatibilità**: sul pannello un `kind` sconosciuto rende illeggibile l'intero manifesto dei simboli
  del progetto (tutti diventano segnaposto). Le chiavi dentro `geo` invece viaggiano sempre.
- **Difetti trovati**: (1) il lampeggio morbido e il **grigio dei dati vecchi** probabilmente non arrivano sugli strati
  dei simboli `lib:`/`prj:` in LVGL (il recolor non si eredita): non verificato; (2) a 20 fotogrammi al secondo una
  girante veloce sembra ferma o al contrario; (3) allocazioni a ogni fotogramma in `aggiorna_simbolo_lib`; (4) le
  misure M2 sono del 14-10, a 16 bit e 60 fps: vanno rifatte sul TY570.

## Decisioni del maintainer (19-11-2026)
1. **Il pezzo animato è uno strato**: si scelgono le forme, «Anima…», e finiscono in uno strato nuovo con la sua
   animazione e il suo ingresso. Il raggruppamento ⧉ resta solo un aiuto per modificare.
2. **Pulsazione = respiro di trasparenza**, uguale su web e pannello.
3. **Il pezzo «segnale» sceglie il colore da una lista valore → colore**, come gli «Stati» del simbolo (valore o
   intervallo, colore, lampeggio; più «nascosto»).
4. Dal piano già approvato: tutte e quattro le famiglie, web e LVGL, misurate sul TY570; in pagina ogni pezzo prende
   un tag **o** un valore fisso; si continua sulle descrizioni `prj:`.

## Decisioni mie, approvate col piano
- **«Rotazione a un valore» non è un tipo nuovo**: è la lancetta (`needle`), che può avere qualunque forma.
  «Anima…» la offre come «Ruota fino a un valore». Allo stesso modo «Ruota fra posizioni» è la leva.
- **La spia (`lamp`) resta** per i simboli che l'hanno, ma «Anima…» non la offre: la fa il segnale.
- **Il movimento è proporzionale**: 0..1 di default, così un tag vero/falso va da un capo all'altro, e lo stesso pezzo
  fa anche un pistone o una saracinesca al 40 %.
- **La vibrazione è a scatti** (0, +a, 0, −a) con periodo minimo 200 ms: a 20 fotogrammi al secondo un'onda morbida
  verrebbe diversa sul pannello. A scatti è identica sui due motori.
- **Girante e livello nella sezione «Parti» solo se il simbolo ne ha più di uno.** Con uno solo resta il legame di
  oggi del simbolo (Rotazione, Livello): due punti del pannello per la stessa cosa violerebbero la regola «una sezione
  per dato».
- **Verso antiorario della girante** (`ccw`): costa poco, si fa.

## Prima, a parte: il grigio dei dati vecchi sui simboli del pannello
Se un tag diventa vecchio, il simbolo `lib:`/`prj:` sul pannello potrebbe restare a colori pieni: **un dato vecchio
mostrato come buono**, cioè un'anomalia che passa davanti (regola di `CLAUDE.md` del 09-11-2026). Primo passo: provarlo
sul viewer LVGL del desktop (un tag che smette di aggiornarsi su una pompa). Se è vero, ramo `fix/lvgl-stale-lib-layers`
da `main`: in `crea_effetti` (`lvgl_render.rs` ~3483) si raccolgono anche i `lv_canvas` degli strati, e il recolor
(~17499) va su quelli; `check_fade_raster.sh` con un caso su un simbolo `lib:`. Collaudo, squash, poi il ramo delle
animazioni.

## Il formato: tipi di parte, tutto dentro `geo`
`parte {id, kind, geo}` non cambia; le chiavi nuove stanno in `geo`, tutte con un default.

| kind | geo (unità del simbolo) | ingresso | cosa fa |
|---|---|---|---|
| `rotor` | `cx, cy, symmetry`, `ccw?` | vero/falso del pezzo, altrimenti la Rotazione del simbolo | gira |
| `needle` | come oggi | valore → frazione (min/max) | ruota fino all'angolo |
| `lever` | come oggi | vero/falso o posizione | ruota fra posizioni |
| `lamp` | come oggi | vero/falso | acceso = visibile |
| `level` | `x, y, w, h`, **`dir`** su/giù/sinistra/destra | frazione del pezzo, altrimenti il Livello del simbolo | riempie |
| `slide` **nuovo** | `dx, dy`, `transition_ms` (300) | frazione 0..1 (vero = 1) | si sposta |
| `vibrate` **nuovo** | `amplitude`, `axis` x/y, `period_ms` (200, minimo) | vero/falso | vibra |
| `pulse` **nuovo** | `depth` (0,6), `period_ms` (1000) | vero/falso | respira |
| `signal` **nuovo** | `color` (come disegnato), `entries` (al massimo 8): `{value` oppure `value_min/value_max, color?, blink?, hidden?}` | valore confrontato come negli «Stati» | colore, lampeggio, nascosto |

- Il compilatore scrive `color` del segnale come `fill` sullo strato: le forme senza materiale lo prendono, come il
  corpo prende il colore dello stato. Nessuna voce che vale = come disegnato.
- **In pagina** `ParteLegata` diventa `{tag?, value?, min?, max?}`: il tag decide; senza tag, il valore fisso; senza
  nessuno dei due, girante e livello seguono il simbolo e gli altri restano come disegnati. Nessun campo nuovo
  sull'oggetto (`symbol_parts` è già libero in `synoptic.rs`, `model.rs`, `types/index.ts`).
- **Compatibilità in avanti**: `ParteLib` (`sws-core/src/simboli_lib.rs`) guadagna `#[serde(other)] Unknown`: un tipo
  futuro diventa uno strato fermo invece di rompere il manifesto. Primo test: che serde lo accetti con chiavi in più.
  Un pannello più vecchio della rc che porta questo lavoro mostra segnaposto: va bene, i pannelli si aggiornano.

## Il valutatore condiviso
- `sws-core/src/symbol_behaviour.rs` (nuovo): `ValoreParte` e `valori_parti` si spostano qui dal viewer (stessi nomi,
  il viewer li riesporta). Varianti nuove: `Active(Option<bool>)` per girante, vibrazione, pulsazione;
  `Entry(Option<usize>)` per il segnale; il movimento usa `Frazione`. Una funzione che scrive in un `Vec` riusato, senza
  `String` a ogni fotogramma.
- Funzioni pure a tempo: `vibrate_step`, `pulse_opacity` (stessa curva di `fattore_respiro`), `blink_dim`,
  `level_window(dir, rect, f)`, `slide_offset`, una transizione lineare, `rotor_period_for_fps` (contro l'effetto
  «ferma o al contrario» sul pannello; il web tiene la velocità vera).
- Gemello TypeScript: `valoriParti` in `symbols/lib/libreria.ts` esteso, `symbols/lib/behaviour.ts` (nuovo) con le
  funzioni a tempo e `signalEntry` (stessa regola di `matchTextListEntry`).
- **Una fixture**: `tests/fixtures/symbol-pieces.json` (valori per ogni tipo, tag che batte il valore, valore fisso, le
  voci del segnale, le tabelle a tempo). La leggono un test Rust e `sws-editor/tests/symbolBehaviour.test.ts`.

## Web (`symbols/lib/SimboloLib.tsx`)
- `valori.animate` (spento di default: le miniature restano ferme); il canvas lo accende con
  `!isEditMode || previewEffects`.
- Sempre visibili, perché seguono un valore: movimento (`translate` con transizione), livello in ogni direzione
  (`clipPath` da `levelWindow`), colore e «nascosto» del segnale.
- Solo con `animate`, e marcati `data-anim` (si fermano con `prefers-reduced-motion`): girante, vibrazione, pulsazione,
  lampeggio del segnale.
- `symbols/lib/keyframes.ts` (nuovo): i keyframe con un nome per parametro (`sws-vib-x-2`, `sws-pulse-60`) in un solo
  `<style>`; il test controlla che i passi siano quelli della fixture. Così anche l'editor dei simboli non dipende più
  dal canvas montato sotto.

## Pannello LVGL
- `simbolo_lib.rs::prepara`: per il segnale **un'immagine per ogni colore diverso** delle voci, preparate col resto
  della pagina (mai resvg dentro il fotogramma); per il livello la finestra calcolata in unità e portata in pixel
  (specchi compresi).
- `lvgl_render.rs` (`VivoLib`, `aggiorna_simbolo_lib`): più livelli per simbolo; `MobileLib` (movimento e vibrazione
  con `set_pos`, solo quando cambia); `PulseLib` e `SignalLib` (cambio d'immagine, `HIDDEN`, `img_opa`); la girante
  per pezzo, che ripiega sulla Rotazione del simbolo.
- **Opacità composta**: oggi il lampeggio degli Stati scrive `img_opa` su tutti gli strati e cancellerebbe pulsazione e
  lampeggio del segnale. Diventa `finale = lampeggio_stato × opacità_pezzo`, scritta solo quando cambia.
- Le allocazioni a ogni fotogramma tolte; `rotor_period_for_fps` nella scelta del fotogramma.
- **Budget di memoria per pagina** (`simbolo_lib.rs`): 6 MiB di partenza, `SWS_ANIM_BUDGET_KB` per le prove. Conta i
  fotogrammi delle giranti oltre il primo e i colori del segnale oltre quello disegnato. Se non basta: meno fotogrammi
  (fino a ferma), colori mancanti nel colore disegnato, una riga di log per pezzo. All'apertura della pagina una riga
  `animations: X KB di Y KB; ridotti: …` con `VmRSS`.
- **Misure sul TY570** (SSH solo dopo averlo chiesto): una pagina di prova in `~/sws_projects/test/` con 4 scenari
  (tutto fermo; tutto attivo; 20 pulsazioni + 10 vibrazioni; 10 giranti da 140 px con simmetria 60 e 360). Si annota:
  preparazione per simbolo, KB, memoria del servizio, tempo per fotogramma (media e p95), CPU. Soglie: fotogramma
  p95 ≤ 50 ms, animazioni p95 ≤ 5 ms, memoria < 36 MB. Dai numeri si fissa il budget.

## L'editor dei simboli
- `model.ts`: i tipi nuovi in `INPUT_KINDS` e in `addInput`; `setPartParam` (testi, liste, caselle); `setPartKind`;
  **`animateSelection(d, forme, kind)`**: le forme scelte vanno in uno strato nuovo del tipo scelto, coi parametri presi
  dal loro riquadro (perno al centro, finestra = riquadro, movimento verso l'alto di metà altezza, colore del segnale =
  colore della prima forma). L'ordine di disegno resta quello di prima; uno strato rimasto vuoto si toglie.
- `AnimationProps.tsx` (nuovo, `SymbolEditor.tsx` ha già 1400 righe): un editor di parametri per ogni tipo, usato dal
  «Pezzo» e dagli «Ingressi»; per il segnale l'elenco delle voci come quello degli Stati.
- «Anima…» nel «Pezzo» quando ci sono forme scelte, con i tipi divisi per famiglia; «Togli animazione».
- Maniglie: il perno (c'è già), la posizione d'arrivo del movimento (sagoma tratteggiata da trascinare), la finestra
  del livello con la freccia della direzione.
- «Prova»: un controllo per ogni pezzo e un interruttore **«Anima»** (spento di default) per vedere gli effetti a tempo.
- Al salvataggio: rinominare o togliere un pezzo legato in pagina chiede conferma e propone di aggiornare i legami,
  come per le bocche.

## La pagina
- `Collegamenti.tsx`: una riga per ogni pezzo legabile, con la scelta **Tag | Valore**; per lancetta, livello e
  movimento anche min/max; per il segnale le voci del simbolo in sola lettura.
- `validate.rs`: il tag di `symbol_parts` deve esistere (errore); un id che non è un pezzo del simbolo (avviso); valore
  non semplice (errore); tag e valore insieme, `min == max` (avvisi). Schema rigenerato dopo il commento di
  `symbol_parts` in `synoptic.rs`.
- Assistente: `schema_simbolo` (`ai/tools.rs`) con i tipi nuovi, `dir`, il legame per pezzo; corretta la frase sui
  colori liberi.

## Test e guardie
- Rust: `symbol_behaviour` sulla fixture; il compilatore con ogni tipo (`fill` del segnale, regole: intervalli, 8 voci,
  colori, `dir`, arrivo del movimento dentro il disegno); il tipo sconosciuto che diventa fermo; `prepara` del viewer
  (colori senza doppioni, budget ridotto, finestra con gli specchi); i controlli nuovi di `validate.rs`.
- Vitest: `symbolBehaviour.test.ts`; il disegno per tipo (trasformazioni, ritaglio, keyframe, `data-anim`, `animate`
  spento); le righe Tag | Valore; `animateSelection` (ordine, strato vuoto tolto); «Anima…», maniglie, «Prova».
- Guardie: fixture `tests/fixtures/simboli-prj/animated-pieces.json`; `check_simboli_lvgl.sh --simboli` su di essa, con
  istantanee a valori fissi (movimento 0 e 1, segnale fra due voci e nascosto, livello a sinistra al 30 e al 70 %,
  vibrazione e pulsazione che cambiano nel tempo); `check_i18n_parita`, `check_tag_refs`, `check_synoptic_schema`.

## Le sessioni (un ramo, `feat/symbol-anim`, uno squash alla fine)
Il pannello viene prima dell'editor: è la parte più rischiosa, e la fixture fa da simbolo di prova senza editor.

| | ore | cosa | dove ci si ferma |
|---|---|---|---|
| 2a | 3,5 | valutatore condiviso e fixture; tipi nuovi e `Unknown`; compilatore e regole; `ParteLegata.value`; viewer sul valutatore di `sws-core` (niente di visibile); schema dell'assistente; schema degli oggetti | tutto verde, niente di nuovo a schermo |
| 2b | 3,5 | web: disegno per tipo, keyframe, `animate`; pagina: righe Tag \| Valore, `validate.rs` | il simbolo della fixture si anima nel browser |
| 2c | 4 | LVGL: pezzi nuovi, opacità composta, budget, giranti veloci, allocazioni; guardie; misure sul TY570 | guardie verdi sul desktop; misure fatte con te |
| 2d | 3,5 | editor: «Anima…», parametri, maniglie, «Prova» con «Anima», avviso sui legami; CasaDomotica; definition of done | pronto per `/test-changes` |

Dopo, la sessione 3 del piano della fase 2 (importa SVG, esporta/importa il simbolo).

## Rischi
1. L'opacità composta può rompere il lampeggio degli Stati sui simboli di oggi: test dedicati e la guardia
   `check_simboli_lvgl.sh` su tutta la libreria.
2. Il costo della pulsazione sul TY570 (un ridisegno a fotogramma per pezzo): opacità a passi e periodo minimo.
3. La memoria: colori del segnale per misura, fotogrammi delle giranti per ogni copia del simbolo (non si condividono
   fra copie: se le misure lo chiedono, diventa un seme).
4. L'ordine di disegno in «Anima…» quando la scelta attraversa il corpo o una parte.
5. Le giranti con simmetria alta e periodo corto girano più lente sul pannello che sul web (scelta voluta).

## Verifica
1. Definition of done (`cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, `vitest`) e i controlli della CI
   (`cargo fmt --check`, `clippy -D warnings`, `cargo audit`, `pnpm lint`, `pnpm type-check`).
2. IDE 8460: il simbolo della fixture importato in un progetto di prova; ogni tipo legato a un tag del simulatore e a un
   valore fisso; «Anteprima effetti» spento = fermi, acceso = animati.
3. Viewer LVGL del desktop e TY570: gli stessi pezzi, le misure dei quattro scenari annotate nel piano.
4. Editor: «Anima…» su forme di una pompa (girante, segnale d'allarme, saracinesca che scorre), «Prova» con «Anima».
5. Collaudo del maintainer con `/test-changes`; CasaDomotica con almeno un pezzo animato su dati veri (regola di
   `CLAUDE.md`).
