# Colori coerenti e pannello destro: gruppo affine, sezioni aperte

> **Stato**: approvato il 21-09-2026. R1 in corso su `fix/pannello-destro-affine-aperto`; R2 da aprire dopo il merge di R1.

## Contesto

Il maintainer, 21-09-2026: un oggetto piazzato dalla palette **non ha il colore che il pannello
destro dichiara** (Testo bianco sul canvas, nero nel pannello; Bottone idem per etichetta e sfondo);
piazzando un oggetto il pannello destro deve **restare sul gruppo corrente se esiste** e altrimenti
**saltare sul gruppo affine** del tipo; le **sezioni pieghevoli** del pannello destro, ora che sono
divise per tema, devono **nascere aperte**.

**Causa del primo difetto (misurata).** `handleAddObject` (`EditorShell.tsx:574-732`) scrive nel
modello stringhe CSS `var(--brand-text, #e2e8f0)`, `var(--brand-primary, #3b82f6)`… (dal commit
T-36). L'SVG le risolve; `<input type="color">` le sanifica a `#000000` (swatch nero); il pannello
LVGL le scarta in silenzio (`parse_hex_color` vuole 6 cifre, `apply_bg_color` no-op) e dipinge il
tema. Inoltre il pannello (`colorInput(key, fallback)`, `:2612-2631` e gemello `:2395-2414`) usa
in ~20 dei ~40 punti un `var(…)` **anche come ripiego**, quindi un campo vuoto è nero pure senza il
difetto di creazione; e canvas/pannello/LVGL hanno ripieghi diversi per lo stesso campo (rect
`#555` / `#4a90d9` / `#555555`; gauge `color` `#e2e8f0` e `#94a3b8` nello stesso file; navbutton
`var(--brand-bg)` vs `#4a90d9`). Non esiste un modulo di default condiviso né una guardia. I template
in `examples/templates` sono già senza `var(--`; i progetti locali del maintainer no.
`ai/prompt.rs:100` insegna al modello a scrivere `var(--brand-primary, #3b82f6)`.

**Causa del secondo.** `gruppoEffettivo` (`EditorShell.tsx:1327-1330`) ripiega sempre su
`oggetto` quando il gruppo scelto non esiste per il tipo; la parte «resta se esiste» vale già
(la scelta è globale, in `localStorage`, e non viene toccata dal cambio di selezione).

**Causa del terzo.** `CollapsibleSection` (`:1538-1539`) ha `defaultOpen = false`; solo quattro
sezioni lo alzano (`identita`, `aspetto`, `dato`, `parametri`).

### Decisioni del maintainer (21-09-2026)

| | Decisione |
|---|---|
| **D1** | colore di testo/linea/tubo alla creazione = **automatico**: campo assente, l'oggetto segue lo sfondo pagina (web `--synoptic-text`/`defaultObjectTextColor`, LVGL `default_text_rgb`). Il pannello mostra il colore effettivo con la dicitura «auto»; toccandolo diventa hex esplicito |
| **D2** | progetti vecchi con `var(--…)` **normalizzati all'apertura** nell'IDE: `--brand-text`/`--synoptic-text` → auto; ogni altro `var(--x, #hex)` → `#hex`; nel file al salvataggio successivo. Stessa regola nel prompt IA |
| **D3** | gruppo affine: `text` → Testo; tipi con la sezione Parametri (`TIPI_CON_PARAMETRI`) → Dato; forme pure → Oggetto. Vale **a ogni cambio di selezione**, la scelta memorizzata non si tocca |
| **D4** | **tutte** le sezioni del pannello destro nascono aperte (oggetto e pagina); la memoria per tipo resta |

**Assunzione dichiarata (da vetare se sbagliata):** il tubo (`pipe.stroke`) segue la pagina con il
**tono grigio di oggi** (`#64748b` su scuro, `#475569` su chiaro), non col tono testo — altrimenti
ogni tubo esistente diventerebbe quasi bianco dopo la normalizzazione.

## Ordine: due rami, uno alla volta

| # | Ramo | Contenuto | Taglia |
|---|---|---|---|
| R1 | `fix/pannello-destro-affine-aperto` | D3 + D4 (piccolo, si chiude e si mergia subito) | 45' |
| R2 | `fix/colori-coerenti` | D1 + D2 + tabella condivisa + LVGL + guardia | una sessione |

Regole comuni: guardia/test **rossi prima**; DoD `cargo check` + `pnpm build` + `check_static.sh` +
collaudo del maintainer; squash merge; `git branch -D` dopo il confronto degli alberi; push solo su
richiesta. Prima di aprire R1: eliminare `fix/lingue-marchio-auto` (fuso in `main`, remoto sparito;
albero ≠ solo per `STATUS.md`) — **con conferma del maintainer**, è un ramo della sessione
precedente.

---

## R1 — gruppo affine e sezioni aperte

**File**: `sws-editor/src/editor/EditorShell.tsx`, `sws-editor/tests/pannelloDestro.test.tsx`,
`CHANGELOG.md`.

1. **Rosso prima** in `pannelloDestro.test.tsx` (blocco `:209-242`): sostituire «passando da un
   testo a un rettangolo si torna a Oggetto» con tre casi: `gruppoEffettivo("testo","rect") ===
   "oggetto"`, `gruppoEffettivo("testo","button") === "dato"`, `gruppoEffettivo("testo","gauge")
   === "dato"`; tenere «tornando su un testo si ritrova il testo» e aggiungere «un gruppo che
   esiste per il tipo nuovo non si sposta» (`gruppoEffettivo("oggetto","text") === "oggetto"`,
   `("comportamento","button") === "comportamento"`). Nuovo test `gruppoAffine("text") ===
   "testo"`, `("pipe") === "dato"`, `("line") === "oggetto"`, per ogni tipo di `PALETTE_GROUPS`
   ritorna un gruppo che `gruppiPerTipo` contiene.
2. **`TIPI_CON_PARAMETRI`** (`:2757-2763`, locale a `ObjectProps`) sale a livello di modulo ed
   è esportato (serve a `gruppoAffine`; nessun altro cambiamento).
3. **`gruppoAffine(tipo): GruppoProprieta`** accanto a `gruppiPerTipo` (`:1310`): `text` →
   `"testo"`; in `TIPI_CON_PARAMETRI` → `"dato"`; altrimenti `"oggetto"`. Commento con il perché
   (la sezione Parametri è «la sezione grande del tipo», T-56).
4. **`gruppoEffettivo`** (`:1327-1330`): il ripiego diventa `gruppoAffine(tipo)` — e, se il
   gruppo affine non fosse fra quelli visibili (pagina di boot: `GRUPPI_BOOT`), `"oggetto"`.
   Aggiornare il commento `:1321-1326`. La scelta memorizzata resta intoccata: nessun
   `setGruppoDestro` in più.
5. **Sezioni aperte**: `defaultOpen = true` in `CollapsibleSection` (`:1539`); togliere le 7
   `defaultOpen` esplicite (tutte a `true`, diventano rumore). Le chiavi di memoria
   `sws.pannelli.props.<tipo>.<sezione>` restano: una sezione chiusa dall'utente resta chiusa.
   Verificare che `pannelloProprieta.test.tsx` (`apriTutto()` + `localStorage.clear()`) resti
   verde: apre ciò che è chiuso, quindi non cambia l'inventario.
6. `CHANGELOG.md` «[Unreleased]»: due righe; nota che la tabella «aperta/chiusa» del piano T-56
   archiviato (`docs/archive/2026-09-10-T56-pannelli-editor.md` §3) è superata da D4.

**Collaudo**: barra su Testo di un testo → piazzare un Bottone → il pannello è su **Dato**; piazzare
un Rettangolo → **Oggetto**; tornare sul testo → **Testo**. Barra su Comportamento → piazzare
qualunque cosa → resta Comportamento. Nuovo profilo browser (o `localStorage` pulito): ogni
sezione aperta.

---

## R2 — colori coerenti

### Tabella tipo×campo (fonte unica `tests/fixtures/colori-predefiniti.json`)

Specchiata in TS (`PREDEFINITI`) e in Rust (`colori_predefiniti::TABELLA`), confrontata dai test.
Valore scelto = **ciò che un oggetto piazzato mostra oggi sul web**.

| tipo.campo | regola | valore |
|---|---|---|
| text.color, line.stroke, navbutton.color, gauge.color, rect.stroke | auto «testo» | `defaultObjectTextColor(sfondo)` → `#e2e8f0`/`#0f172a` |
| pipe.stroke | auto «sottile» | `#64748b` su scuro, `#475569` su chiaro |
| rect.fill, ellipse.fill | hex | `#4a90d9` |
| button.fill / button.color | hex | `#3b82f6` / `#ffffff` |
| navbutton.fill / .stroke | hex | `#0f172a` / `#3b82f6` |
| led.on_color / off_color | hex | `#22c55e` / `#374151` |
| progress_bar/slider/checkbox/radio .fill, pipe.fill_color, sparkline.spark_color, bar_series[0] | hex | `#3b82f6` |
| gauge.fill / .stroke / gauge_sp_color | hex | `#22c55e` / `#e2e8f0` / `#f59e0b` |
| state_lamp/text_list entries, text_list_default_color | hex | `#94a3b8`/`#22c55e`/`#ef4444`; ripiego `#94a3b8` |
| pie_slices | hex | `#3b82f6`/`#22c55e`/`#f59e0b` |
| symbol state_off/on/alarm | hex | `#64748b`/`#22c55e`/`#ef4444` |
| grid_border_color; pipe gradient light/dark; alarm_bell.fill; quality_dot_* | hex | `#64748b`; `#94a3b8`/`#334155`; `#1e293b`; `#22c55e`/`#eab308`/`#ef4444` |

Ogni campo oggi passato a `colorInput` con un literal entra in tabella (anche
`gradient_light_color` e simili), così la guardia può dire «nessun literal nelle chiamate».

`normalizzaColore(v)`: non stringa → com'è; `^var\(--(brand-text|synoptic-text)\s*[,)]` (token
esatti, non `-muted`/`-subtle`) → `undefined`; `var(--x, #hex)` → `#hex` a 6 cifre minuscole;
`var(…)` senza ripiego → `undefined`; già hex → com'è.

### Passi

**0. Rosso prima.** `sws-editor/tests/coloriPredefiniti.test.ts`: (i) `normalizzaColore` sui
`casi_normalizzazione` della fixture; (ii) `coloreEffettivo` per text/line/pipe su `#1a1a2e` e
`#ffffff`; (iii) `PREDEFINITI` uguale a `fixture.predefiniti` (idioma `testiSistema.test.ts`);
(iv) per ogni tipo di `PALETTE_GROUPS` (import come `pannelloProprieta.test.tsx:5,96`)
`oggettoNuovo(type,0,0)` serializzato non contiene `var(--` e i campi auto sono assenti;
(v) `normalizzaColoriPagine` su una pagina con text/bottone/text_list/bar_series/pie_slices/
symbol_states/grid_cells in `var(…)` → tutto hex o assente, identità referenziale se nulla cambia.
Rust: `mod colori_predefiniti_tests` in `lvgl_render.rs` (copia di `formattazione_valori_tests`,
`:12463-12500`, stesso `concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tests/fixtures/…")`): per
ogni riga con `"lvgl": true`, `predefinito_lvgl(tipo,campo) == hex`.
`scripts/check_colori.sh` (python inline, idioma `check_testi_sistema.sh`): nessun `var(--` in
`oggettiNuovi.ts`; nessun `var(--` sulle righe con `colorInput(` di `EditorShell.tsx`; nessun
`var(--` in `examples/templates/*.yaml`; ogni `<input type="color"` di `EditorShell.tsx` sta in
`CampoColore.tsx` o nelle eccezioni dichiarate (le due celle griglia `:929/:943`). In `STATICHE`
di `check_static.sh` e nella tabella di `scripts/README.md`. Tutto rosso al primo giro.

**1. `sws-editor/src/coloriPredefiniti.ts`** (nuovo):
```ts
export type Tono = "testo" | "sottile";
export type RegolaColore = { auto: Tono } | { hex: string };
export const PREDEFINITI: Record<string, Record<string, RegolaColore>>;
export function regola(tipo, campo): RegolaColore | undefined
export function predefinito(tipo, campo): string | undefined           // solo hex fissi
export function normalizzaColore(v: unknown): string | undefined
export function normalizzaColoriOggetto(o: SynopticObject): SynopticObject  // ricorsiva su entries/series/slices/symbol_states/grid_cells; identità se nulla cambia (idioma normalizeTrendObjects, trendModel.ts:62-70)
export function normalizzaColoriPagine(pages: SynopticPage[]): SynopticPage[]
export function coloreEffettivo(obj, campo, sfondo?: string): string
```
`coloreEffettivo`: esplicito (normalizzato) → quello; `hex` → hex; `auto` con `sfondo` →
`defaultObjectTextColor(sfondo)` (testo) o `#64748b`/`#475569` per luminanza (sottile); `sfondo`
assente → il token CSS `var(--synoptic-text, var(--brand-text, #e2e8f0))` / `var(--synoptic-subtle,
#64748b)` (da aggiungere accanto a `--synoptic-text` in `SvgCanvas.tsx:1622`). Così il canvas chiama
senza sfondo e funziona anche nei renderer annidati; il pannello chiama con lo sfondo e ha hex.

**2. Creazione — `sws-editor/src/editor/oggettiNuovi.ts`** (nuovo): il corpo dello `switch` di
`handleAddObject` (`:574-732`) diventa `oggettoNuovo(type, x, y): Partial<SynopticObject> | null`
(`null` per `image`/`symbol`, che restano differiti). Campi auto **omessi**, fissi via
`predefinito()`. Stesso trattamento per il simbolo (`:794-796`). `handleAddObject` → `const o =
oggettoNuovo(...); if (o) addObject(o);`.

**3. Canvas — `SvgCanvas.tsx`**: i ripieghi passano da `coloreEffettivo`/`predefinito`: `:3515`
rect, `:3570` ellipse, `:3587` line, `:3606` pipe (+ `--synoptic-subtle`), `:3632` fill_color,
`:3797` text, `:3922/:3930` button, `:3955/:3956/:3968` navbutton, `:4076` led off, `:4141-4143`
state_lamp, `:4361` gauge (le `:4367/:4372` restano `#94a3b8` solo quando `obj.color` è assente),
`:5020` text_list, `:5749-5753/:5812-5814` symbol, `:5851` grid.

**4. Pannello — `sws-editor/src/editor/CampoColore.tsx`** (nuovo) + `EditorShell.tsx`.
`CampoColore({ valore, mixed, regola, sfondo, onChange })`: swatch `<input type="color"
value={hexEffettivo}>` **sempre** hex; campo testo `value=hex` se esplicito, altrimenti `value=""`
+ `placeholder={hexEffettivo}` + `<span>` «auto» (`t("props.colorAuto")`); se `regola.auto` e
valore esplicito → bottone `↺` (`title={t("props.colorAutoReset")}`) → `onChange(undefined)`;
`mixed` come oggi. In `ObjectProps` (`:2515`): `sfondoPagina = resolvePageBackground(pagina
corrente.background, .background_dark, s.themeMode) ?? "#1a1a2e"` (stesso default di
`SvgCanvas.tsx:656`; la prop `pages` esclude la pagina corrente, serve lo store). `colorInput(key)`
perde `fallback` e monta `CampoColore` con `regola(obj.type, key)`; le ~40 chiamate perdono il
secondo argomento. Gemello `:2395-2414` (symbol/faceplate): stesso componente con
`regola={undefined}` (nessun marcatore, sanificazione e ripieghi dalla tabella). Chiavi
`props.colorAuto`/`props.colorAutoReset` in `it.json` e `en.json` nello stesso commit.
L'inventario `campiPannelloProprieta.json` non cambia (il marcatore sta dentro il controllo).

**5. Normalizzazione all'apertura — `store/index.ts:992`**: `normalizzaColoriOggetti(
normalizeXyObjects(normalizeTrendObjects(p.objects)))`. `setPages` è l'unico imbuto (App,
MainMenu, LeftPanel, RuntimeViewer): copre IDE e viewer; il primo salvataggio scrive il file pulito.

**6. LVGL — `sws-lvgl-viewer/src/lvgl_render.rs`**: `mod colori_predefiniti { TABELLA,
predefinito_lvgl }`; literal allineati: `:2163/:3473` → `#4a90d9`, `:2884` off → `#374151`,
`:2591/:2639/:4139/:6439/:6460/:3760` via tabella; etichetta bottone (`:2592-2594`) con
`set_text_color(#ffffff)` (oggi eredita lo stile schermo: illeggibile su bottone blu con pagina
chiara); line (`:3521`) e pipe (`:6439`) senza `stroke` → colore di pagina (`default_text_rgb(
page.background)` calcolato una volta accanto a `:9366`; pipe tono sottile, soglia 0.5).
`parse_hex_color`/`apply_bg_color` restano: una stringa non valida si ignora in silenzio. Gauge:
`obj.color` ignorato dal motore — gap preesistente, annotato nel commento del campo, non toccato.

**7. `sws-web/src/ai/prompt.rs:100`**: «i colori di testi, linee e tubi non si scrivono: seguono
lo sfondo; gli altri sono hex a 6 cifre, mai `var(...)`». Verificare che `check_synoptic_schema.sh`
non citi la frase. Niente normalizzazione serde in `synoptic.rs` (~40 campi + `Value` annidate; il
web disegna `var()` senza danni, LVGL lo ignora, l'IDE ripulisce al primo salvataggio).

**8. Chiusura**: `pnpm test`, `cargo test -p sws-lvgl-viewer colori_predefiniti`,
`./scripts/check_static.sh`; `CHANGELOG.md` (con la nota «apri e salva i progetti vecchi»);
`STATUS.md`; segnalare che `check_f7.sh` misura contro `--brand-text` invece di `--synoptic-text`
(fuori ramo, già noto).

### Collaudo dal vivo (R2)
1. Pagina nuova (sfondo scuro): piazzare Testo, Linea, Tubo, Bottone → canvas e swatch coincidono;
   Testo dice «auto» con `#e2e8f0` in placeholder; toccare lo swatch → hex esplicito e compare ↺;
   ↺ → torna auto.
2. Sfondo pagina `#ffffff`: Testo/Linea `#0f172a`, Tubo `#475569`, bottone blu con etichetta
   bianca; cambiare tema IDE chiaro/scuro **non** cambia i colori degli oggetti.
3. Aprire un progetto vecchio con `var(--…)`: nessuno swatch nero; salvare; `grep -c "var(--"` nei
   file di pagina = 0.
4. LVGL (se disponibile): rettangolo `#4a90d9`, LED spento `#374151`, etichetta bottone bianca,
   linea/tubo dello stesso colore del web, su pagina scura e chiara.

## Rischi
- `coloreEffettivo` chiamato senza sfondo restituisce un token CSS: va bene solo nell'SVG; il
  pannello deve **sempre** passare lo sfondo (la guardia sull'`<input type="color">` lo protegge).
- La normalizzazione tocca ogni pagina all'apertura: identità referenziale obbligatoria, o il
  sorvegliante «progetto cambiato» scatta a vuoto.
- `EditorShell.tsx` è da 5900 righe: R2 lo tocca in ~45 punti — nessun altro ramo aperto nel
  frattempo (regola «un ramo alla volta»; il Passo 2 dei segreti aspetta).

## File critici
- `sws-editor/src/editor/EditorShell.tsx` (`handleAddObject :574-732`, simbolo `:794-796`,
  `colorInput :2395-2414` e `:2612-2631`, `gruppoEffettivo :1327`, `CollapsibleSection :1538`,
  `TIPI_CON_PARAMETRI :2757`)
- `sws-editor/src/canvas/SvgCanvas.tsx` (ripieghi `:3515-:5851`, `--synoptic-text :1622`, sfondo `:656`)
- `sws-editor/src/store/index.ts` (`setPages :982-1000`)
- `sws-editor/src/theme.ts` (`defaultObjectTextColor :219`, `resolvePageBackground :178`)
- `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`; `sws-runtime/crates/sws-web/src/ai/prompt.rs:100`
- `sws-editor/tests/pannelloDestro.test.tsx`, `pannelloProprieta.test.tsx`
