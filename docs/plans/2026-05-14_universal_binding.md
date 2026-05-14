# Plan — Universal tag binding + cross-cutting rotation/flip/opacity + demo Page 2 & 3

> **Status**: approved 2026-05-14, **execution deferred**. Pick this up at the next session.
>
> Planning notes saved to repo so future Claude Code sessions (or maintainer) can resume cold.

## Context

Three coupled asks from the maintainer:

1. **Uniformare le proprietà cross-cutting** — oggi solo `symbol` ha rotation/flip; il resto (rect, ellipse, text, image, gauge, led, progress_bar, table, button, navbutton) non li supporta. `visible`/`z_index` sono già cross-cutting. Va aggiunta `rotation/flip_h/flip_v/opacity` a tutti i tipi visivi.

2. **Tag-binding universale**: ogni parametro di ogni oggetto deve poter essere agganciato a un tag, con valore live override del valore statico. Oggi i `*_tag` sono hard-coded e sparsi (state_tag, alarm_tag, visible_tag, tag). Serve un meccanismo generico `bindings: { propName: tagId }` con resolver al render-time.

3. **Demo** — Page 2 di benvenuto (per fixare il navbutton orfano già evidenziato) + Page 3 "Demo binding" con un oggetto per tipo, tutti con `rotation` agganciato a uno stesso tag `demo.rotation`, slider per pilotarlo + altri (opacity, ecc.).

Stato di partenza (commit `dc8976b`):
- `SynopticObject` (TS [sws-editor/src/types/index.ts:101-160](../../sws-editor/src/types/index.ts), Rust [sws-runtime/crates/sws-web/src/synoptic.rs:17-110](../../sws-runtime/crates/sws-web/src/synoptic.rs)) ha ~50 campi opzionali, di cui solo `state_tag/alarm_tag/visible_tag/tag` sono tag-bound.
- `SvgCanvas.tsx` (~1040 righe) ha 16 rami `if (obj.type === "...")`. Resolver `truthy(id)` (linee 960-969) + `formatValue` (115-121) + `thresholdColor` (104-113) + `qualityColor` (97-101) usano direttamente `tagValues[id]`.
- Cross-cutting in ObjectProps: solo z_index/visible/visible_tag ([EditorShell.tsx:1011-1045](../../sws-editor/src/editor/EditorShell.tsx)).
- Demo: 5 tag, 1 source MQTT, 1 alarm, 2 funzioni Python, 14 oggetti in Page 1. navbutton verso Page 2 ROTTO (referenza orfana — id `mp472aq9q3yzc`).

## Phases & commits

### Phase 1 — Data model + cross-cutting transform (commit 1)

**TS type** (`sws-editor/src/types/index.ts`): aggiungi a `SynopticObject`:
```typescript
rotation?: number;              // gradi -180..+180
flip_h?: boolean;
flip_v?: boolean;
opacity?: number;               // 0..1, default 1
/** Generic prop-to-tag bindings. Render-time resolver overrides the
 *  static value with the live tag value. Use over `tag` for explicit
 *  property bindings (e.g. bindings.rotation = "demo.rotation"). */
bindings?: Record<string, string>;
```
(I 3 campi rotation/flip_* sono già su symbol — generalizzo. opacity e bindings sono nuovi.)

**Rust mirror** (`sws-runtime/crates/sws-web/src/synoptic.rs`): aggiungi gli stessi campi con `#[serde(default, skip_serializing_if = ...)]`. Per `bindings` usa `Option<HashMap<String, String>>`.

**Render resolver** (`sws-editor/src/canvas/SvgCanvas.tsx`):
- Nuova helper `resolveObject(obj, tagValues): SynopticObject` (top dello SvgObject). Per ogni entry in `obj.bindings`, se il tag ha valore valido, sovrascrive la prop di livello top con il valore live. Non coerce esplicitamente: SVG accetta number|string per la maggior parte degli attr; per `visible`/`flip_*` (bool) usa `truthy()`.
- Nuova helper `applyTransform(obj, w, h, content)`: avvolge `content` in `<g transform="rotate(R cx cy) scale(±1 ±1)" opacity={...}>` se almeno uno tra `rotation/flip_h/flip_v/opacity` è significativo. Centro = `(obj.x + w/2, obj.y + h/2)`.
- Applica il wrapper ai render branch dei tipi non-interattivi: **rect, ellipse, text, image, gauge, led, progress_bar, table, button, navbutton, symbol** (per symbol c'è già la transform — la sostituisco con la helper). Tipi esclusi: **line** (rotation = ridefinire x2/y2), **slider/checkbox/radio** (controlli HTML in `<foreignObject>`, rotation rompe l'interazione), **trend** (canvas 2D dentro `<foreignObject>`, idem).
- Status badge del symbol resta fuori dal wrapper (axis-aligned per leggibilità — già discusso prima).

**ObjectProps cross-cutting section** (`sws-editor/src/editor/EditorShell.tsx`): sezione "TRASFORMAZIONE" (nuova, sopra "LIVELLO E VISIBILITÀ"):
- rotation: slider -180..+180 + numeric + reset, **mostrata per tutti i tipi che la supportano** (lookup `SUPPORTS_TRANSFORM = new Set([...])`).
- flip_h, flip_v: checkbox.
- opacity: slider 0..1 step 0.05 + numeric + reset.
- Per le tipologie escluse (line/slider/checkbox/radio/trend), la sezione **non viene renderizzata** (nessun confusion UX).

**Cleanup symbol**: rimuovi i campi rotation/flip_h/flip_v dalla sezione symbol-specific (ora cross-cutting). UI rimossa = backward compatible per i YAML (sono opzionali e ora generalizzati).

**Test**: cargo check workspace, frontend type-check.

### Phase 2 — Universal `BindableInput` (commit 2)

**Nuovo componente** `sws-editor/src/components/BindableInput.tsx`:
```typescript
interface BindableInputProps {
  obj: SynopticObject;
  propName: string;
  onChange: (patch: Partial<SynopticObject>) => void;
  /** Inline static editor (number/text/color/checkbox/select).
   *  Renderizzato quando NON c'è binding. */
  children: ReactNode;
  /** Per coerenza di icone — default "🔗". */
  bindIcon?: string;
}
```
Render:
- Layout flex orizzontale: `[input statico O TagInput] [pulsante toggle 🔗/🔓]`.
- Se `obj.bindings?.[propName]` è settato → mostra TagInput legato a quella entry (cambio modifica `bindings`); pulsante mostra 🔗 con tooltip "Bound: cliccare per scollegare".
- Altrimenti → renderizza `children`; pulsante mostra 🔓 con tooltip "Lega a un tag".
- Toggle: bound→unbound rimuove la entry da `bindings` (e se mappa vuota, rimuove `bindings` interamente). unbound→bound aggiunge `bindings[propName] = ""` e il TagInput accetta la scelta.

**Integrazione in ObjectProps** ([EditorShell.tsx:600-1100 circa](../../sws-editor/src/editor/EditorShell.tsx)):
- Ogni `field("Label", textInput("xxx", "placeholder"))` o `field("Label", colorInput("xxx", "#default"))` o `field("Label", numInput("xxx", default))` diventa `field("Label", <BindableInput obj={obj} propName="xxx" onChange={onChange}>{static input}</BindableInput>)`.
- Esclusioni dal binding (proprietà meta o non senseful da legare): `id`, `name`, `type` (immutabili dal pannello), `bindings`, `on_press_fn`/`on_release_fn` (sono nomi di funzione, non valori), `on_press_args`/`on_release_args` (struttura nested), `options` (array nested radio), `table_rows` (array nested), `extra_tags` (array trend). Tutto il resto (x, y, width, height, fill, stroke, stroke_width, x2, y2, format, label, text, font_*, color, target_page, write_value, checked_value, unchecked_value, min, max, unit, step, warn_*, alarm_*, on_value, on_color, off_color, show_value, read_only, orientation, window_s, y_min, y_max, line_color, src, symbol_id, state_*_color, rotation, flip_*, opacity, ecc.) passa per BindableInput.
- Eccezione semantica: `state_tag`/`alarm_tag`/`visible_tag` sono GIÀ tag bindings — il TagInput esistente resta com'è (no doppio wrapping).

**Sezione "BINDING ATTIVI" in fondo al pannello**: se `obj.bindings` non vuoto, lista compatta "prop → tag" con × per rimuovere. Per debugging/audit.

**Render resolution** (Phase 1 ha già il resolver). Verifica che il resolver passi attraverso TUTTE le prop bindabili — non solo cross-cutting. Per i widget interattivi (slider/checkbox/button) il `tag` resta il primary write target; le altre prop possono essere bindate per visualizzazione (es. label legata a un tag, opacity legata a un altro).

**Test**: frontend type-check + smoke nel browser.

### Phase 3 — Demo Page 2 (welcome) + Page 3 (binding showcase) + nuovi tag (commit 3)

**Nuovi tag in `examples/demo/project.yaml`**:
```yaml
- id: demo.rotation
  description: Pilota la rotazione di tutti gli oggetti nella Page 3 (gradi 0-360)
  data_type: float
- id: demo.opacity
  description: Pilota l'opacità degli oggetti nella Page 3 (0-1)
  data_type: float
- id: demo.label
  description: Etichetta dinamica per i widget di Page 3
  data_type: string
- id: demo.fill_color
  description: Colore di fill (#RRGGBB) per oggetti Page 3
  data_type: string
```

**`examples/demo/synoptics/Page 2.yaml`** (welcome):
- Title text "Benvenuto in Page 2"
- 2 navbutton: "← Torna a Page 1", "Vai a Page 3 (Demo Binding)"
- id pagina = "mp472aq9q3yzc" (l'id orfano di Page 1 — fix gratuito).

**`examples/demo/synoptics/Page 3.yaml`** (binding showcase):
- 2 slider (Operator-writable):
  - `tag: demo.rotation`, min 0 max 360, label "Rotation"
  - `tag: demo.opacity`, min 0 max 1 step 0.05, label "Opacity"
- Text di stato in alto: "Rotation: {value:.0f}°" bind to demo.rotation; "Opacity: {value:.2f}" bind to demo.opacity.
- **Un oggetto per tipo visivo**, ognuno con `bindings: { rotation: "demo.rotation", opacity: "demo.opacity" }`. Disposti a griglia 4×3:
  - rect, ellipse, text (con `bindings.text = "demo.label"`), image (placeholder),
  - button (label dinamica), navbutton (verso Page 1), gauge (tag bound to demo.rotation, min 0 max 360),
  - led (tag: demo.rotation, on_value 0 per dimostrare il behavior),
  - progress_bar (tag bound to demo.rotation, min 0 max 360),
  - table (con righe live che riflettono i tag demo.*),
  - symbol (pump con bindings.rotation + state_tag: demo.rotation per cambio colore)
- Navbutton "← Torna a Page 1" e "Vai a Page 2" per chiudere il giro.
- Sliders non hanno rotation bindata (non si ruota un controllo interattivo) — restano fissi per pilotare gli altri.

**Aggiornamento Page 1.yaml**: il navbutton attuale ha target_page = "mp472aq9q3yzc" — già coincide con l'id che daremo a Page 2. **Fixed gratis**.

### Phase 4 — Docs + tests + commit finale (commit 4 oppure squash nel 3)

- `cd sws-runtime && PYO3_PYTHON=python3 cargo check --workspace` → green
- `cd sws-runtime && PYO3_PYTHON=python3 cargo test --workspace` → green (30 tests, no regression)
- `cd sws-editor && pnpm type-check` → green
- `cd sws-editor && pnpm build` → green
- `CHANGELOG.md` [Unreleased]: 3 nuove entry (cross-cutting transform, universal binding, demo pages)
- `STATUS.md`: aggiorna "What's working" con i 3 nuovi pezzi + porta in "Next session should" i seguenti follow-up:
  - Binding UI nelle MultiSelectionProps (oggi multi-select edita solo position/size)
  - Animation primitives (es. interpolazione su valori bindati)
  - Demo Page 4 con sliders verticali + colore tramite picker

## File modificati (riepilogo)

**Frontend** (`sws-editor/src/`):
- `types/index.ts`: aggiunge `rotation/flip_h/flip_v/opacity/bindings` a `SynopticObject`.
- `canvas/SvgCanvas.tsx`: nuove helper `resolveObject` + `applyTransform`; wrappa 11 render branch.
- `editor/EditorShell.tsx`: aggiunge sezione cross-cutting "TRASFORMAZIONE"; rimpiazza ogni input in ObjectProps con `<BindableInput>`; aggiunge sezione "BINDING ATTIVI" in fondo al pannello.
- `components/BindableInput.tsx`: NUOVO componente wrapper.

**Backend** (`sws-runtime/crates/sws-web/src/`):
- `synoptic.rs`: stessi campi sul Rust `SynopticObject`. `bindings: Option<HashMap<String, String>>`.

**Demo** (`examples/demo/`):
- `project.yaml`: 4 nuovi tag.
- `synoptics/Page 2.yaml`: nuovo file.
- `synoptics/Page 3.yaml`: nuovo file.

**Docs**:
- `CHANGELOG.md`: 3 entry sotto Added.
- `STATUS.md`: aggiornamento "What's working" + "Next session should".

## File NON modificati

- Endpoints `/api/project/*` (la patch_project esistente gestisce serializzazione bindings tramite serde).
- Resolver `truthy/formatValue/thresholdColor/qualityColor`: continuano a funzionare con il campo `tag` legacy, non vengono toccati.
- `useLogStream`, log panel: zero impatto.
- `dev.sh`: zero impatto.

## Verifica end-to-end

1. **Rotation cross-cutting**: aggiungi un rect, imposta rotation=45, ruota correttamente. Idem per ellipse/text/image/gauge/led/progress_bar/table/button/navbutton.
2. **Opacity**: imposta opacity=0.3 su un rect → bordi trasparenti. Imposta opacity 1.0 → ripristino.
3. **Flip**: flip_h ribalta orizzontalmente; combinato con rotation 90° produce le combinazioni attese.
4. **BindableInput UX**: clicca 🔓 sul campo "width" di un rect → diventa TagInput, scegli `counter` → il rect cambia larghezza in tempo reale quando il counter cambia. Disabbinda → il valore statico riprende.
5. **Demo Page 3**: login admin/admin, navbutton da Page 1 → Page 2 → Page 3. Muovi il slider Rotation → tutti gli oggetti ruotano insieme. Muovi Opacity → tutti svaniscono insieme.
6. **YAML round-trip**: dopo "Salva tutto", il file `Page 3.yaml` su disco contiene `bindings: { rotation: demo.rotation }` su ogni oggetto. Reload runtime → demo continua a funzionare.
7. **Cargo + frontend green**: 30 unit test, `pnpm type-check` + `pnpm build` senza warning nuovi.

## Out of scope (deferred)

- **MultiSelectionProps con binding**: oggi edita solo geometry; lasciamo il binding solo dalla single-select view.
- **Animation/interpolation**: nessun easing su valori bindati (jump istantaneo).
- **Formule multi-tag** (es. `rotation = demo.rotation * 2 + 90`): un solo tag per prop; per logiche più complesse l'utente scrive un Python handler.
- **Validation type-aware**: il resolver non controlla che il tag sia di tipo numerico per `rotation`, ecc. SVG accetta string/number; gli errori sono visibili al volo.
- **Hot-reload del binding via WS**: PUT /api/synoptics rigenera la pagina; non c'è push push-driven dei bindings stessi (basta refresh).
- **i18n delle nuove etichette**: testo italiano hardcoded come il resto della demo.

## Stima effort

Phase 1: 1.5h | Phase 2: 2-3h | Phase 3: 1h | Phase 4: 30 min — totale **~5-6h**, divisibile in 2 sessioni se necessario (Phase 1+2 = una sessione lunga, Phase 3+4 = sessione corta).
