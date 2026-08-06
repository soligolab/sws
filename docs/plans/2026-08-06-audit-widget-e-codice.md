# Audit notturno: gap nel catalogo widget + qualità del codice

## Contesto

Fine sessione 2026-08-06 (notte), dopo aver completato T-41/T-42/T-43/T-44/T-45 e un
fix sistemico al mirror Rust↔TypeScript (62 campi mancanti su `SynopticObject`, vedi
STATUS.md). Il maintainer ha chiesto di sfruttare il tempo restante per indagare
migliorie al catalogo widget e alla qualità del codice, non necessariamente
implementarle tutte alla cieca durante la notte.

Due Explore agent hanno indagato in parallelo: uno sul catalogo widget (inconsistenze
fra tipi oggetto, widget mancanti, altri gap di mirror Rust↔TS), uno sulla qualità del
codice (duplicazione, codice morto, complessità strutturale, TODO). Quanto trovato di
**basso rischio e meccanico** è stato implementato subito stanotte (vedi CHANGELOG,
commit `1f53140`/`0571231`/`bf300b1` sul branch `fix/T-41-page-delete-persist`) — stesso
standard di verifica di tutta la sessione (build+test, spesso anche verifica dal vivo
con istanza isolata o harness Playwright). Quanto segue è invece **documentato per la
tua revisione**, non implementato: sono scelte di design/priorità, non bug con
un'unica risposta ovvia.

## Già fatto stanotte (per riferimento, non richiede azione)

- `SynopticPage.background_dark` mancante dallo specchio Rust (stessa classe del bug
  dei 62 campi).
- `MqttConfig.max_silence_secs` esposto in UI (esisteva solo lato Rust, nessun modo di
  impostarlo se non a mano in YAML — chiude un loose end della sessione precedente su
  Sandokan).
- Colori severità allarme unificati (`alarm_viewer` aveva un hex diverso da
  `alarm_bell`/`alarm_banner` per "Warning").
- Filtro severità aggiunto a `alarm_viewer` (aveva già il campo dati, mai esposto in UI).
- `TrendCanvas.tsx`: `getXDomain()` (introdotto da T-48 solo per il drag-to-zoom) ora
  usato anche da polling/draw/CSV — prima ciascuno ricalcolava la stessa cosa a mano.
- `PALETTE` colori Trend deduplicata fra `TrendCanvas.tsx`/`TrendExpanded.tsx`.
- `SUPPORTS_TRANSFORM` corretto (mancavano `lang_button`/`lang_selector`).
- Pannello "Eventi" nascosto per `grid` (dispatcha per-cella, non a livello oggetto —
  era UI morta).
- Codice morto rimosso: `_force_login_ok_used()` in `router.rs`, modulo
  `sws-auth::session` (un solo commento TODO, mai implementato lì), commento TODO
  obsoleto in `main.rs`.

## Da rivedere/decidere — NON implementato

### 1. Inconsistenze `BindableInput` (binding di una tag su un campo numerico/colore)

Alcuni widget hanno il binding su campi come min/max/soglie, altri con campi
concettualmente identici no:
- `bar_chart` (min/max/warn_high/alarm_high) non è bindable, `gauge`/`progress_bar`
  (stessi campi, stessa semantica) sì.
- `sparkline` (`spark_window_s`/`y_min`/`y_max`) non è bindable, `trend` (equivalenti)
  sì.
- `pipe` (il widget più "live/animato" del set: `stroke`, `gradient_light_color`/
  `gradient_dark_color`, `fill_color`, `marker_size`, e i tre `state_*_color` già
  bindable per `symbol`) non ha binding su nessuno dei suoi campi colore/numerici.
- `alarm_viewer_max_rows`, `pie_inner_ratio`/`pie_center_text` mai bindable.

**Decisione da prendere**: quali di questi meritano davvero il binding (probabilmente
`pipe` è il candidato più forte, essendo pensato per animazione da tag) — non è un bug,
è più lavoro di quanto valga fare stanotte senza conferma sulla priorità.

### 2. Color picker mancante per `slider`/`checkbox`/`radio`

Tutti e tre leggono `obj.fill` come colore accento/stato-selezionato nel renderer
(`SvgCanvas.tsx`), ma il pannello proprietà non espone mai un color picker per questi
tre tipi (il `fill` color picker generico è gated a `rect/ellipse/button/navbutton`
soltanto) — oggi impostabile solo modificando lo YAML a mano.

**Decisione da prendere**: aggiungere il color picker è un fix piccolo e sicuro (un
`colorInput("fill", ...)` per tipo), ma tocca l'aspetto visivo di tre widget già in uso
— meglio con conferma piuttosto che a sorpresa in un progetto reale.

### 3. `alarm_viewer`/`alarm_bell` vs `alarm_banner`: quali allarmi contano

`alarm_viewer` e `alarm_bell` filtrano su `a.active`; `alarm_banner` filtra su
`a.isa_state !== "normal"`, che include anche `normal_unacked` (allarmi rientrati ma
non ancora confermati) — lo stesso allarme può comparire nella barra ma non nella
campanella/vista.

**Non un bug ovvio**: potrebbe essere intenzionale (mostrare nella barra anche gli
allarmi "da confermare" è un pattern ISA-18.2 comune). Da confermare con te prima di
uniformare in una direzione o nell'altra.

### 4. Widget `faceplate` non piazzabile dall'UI

Completamente cablato nel renderer (`SvgCanvas.tsx`, legge `faceplate_id`/
`faceplate_params`) e nel tipo, ma **assente sia dalla palette** (`LeftPanel.tsx`) **sia
dal pannello proprietà** (`EditorShell.tsx`) — oggi non esiste modo di piazzare
un'istanza faceplate dall'editor. Feature a metà, non un difetto di una riga.

**Serve**: UI per scegliere quale `FaceplateDef` istanziare + editor dei parametri
(`Record<string, string>`) — lavoro di design/UI vero, non una riga.

### 5. Possibili nuovi tipi widget (nessuno urgente, solo segnalati)

- **Casella numerica di setpoint** (scrivere un valore esatto su una tag) — genuinamente
  assente: `slider` è impreciso, `button` scrive un solo `write_value` fisso.
- **Editor ricette come widget piazzabile** — dati/endpoint già completi
  (`RecipeDef`/`RecipeSetpoint`), oggi solo un modale fisso in `RuntimeView.tsx`; stesso
  tipo di promozione già fatta per allarmi in T-42/43. Candidato naturale per un T-46+.
- **Lampada multi-stato colorata** — `led` è binario, `text_list` ha già il modello dati
  giusto (N valori → colore) ma renderizza sempre testo, mai una forma.
- **Readout numerico con soglie colorate** — `thresholdColor()` esiste già ed è usato da
  gauge/progress_bar, mai da `text`.
- **Grafico XY/scatter** — genuinamente assente (trend/sparkline/bar/pie coprono
  serie-tempo e proporzioni, non una tag contro un'altra).

### 6. Altri gap di mirror Rust↔TypeScript (verificati oggi, in sync — nessuna azione,
   solo da tenere a mente per il futuro)

`AlarmDef`, `RecipeDef`/`RecipeSetpoint`, `NotificationConfig`, `FaceplateDef`, tutte le
varianti di `SourceDef`, `FunctionDef`, `DatastoreConfig` — tutti controllati
campo-per-campo stanotte, tutti allineati. Nessuno di questi ha un derive-macro o un
test di round-trip che lo garantisca automaticamente: la stessa fragilità dei 62 campi
di `SynopticObject` esiste strutturalmente anche qui, semplicemente non si è ancora
manifestata. Vale la pena, in futuro, uno script/test di confronto automatico (simile a
quello ad-hoc usato stanotte) piuttosto che affidarsi ad audit occasionali.

### 7. Generazione ID duplicata 4-6 volte

`Date.now().toString(36) + Math.random().toString(36).slice(2, N)` reimplementato
indipendentemente in `store/index.ts`, `EditorShell.tsx`, `SvgCanvas.tsx`,
`ConfigView.tsx` (3 varianti, una delle quali — `fp-${Date.now().toString(36)}` per
nuove faceplate — senza suffisso random, quindi collidibile su doppio click rapido).
Rischio pratico basso (editor single-user, finestra di collisione di 1ms), ma un
`src/id.ts` condiviso rimuoverebbe la duplicazione. Bassa priorità.

## Nota per chi riprende

Tutto quanto sopra è **osservazione**, non impegno — nessuna di queste voci blocca
niente. Se vuoi procedere con una di queste, converti la sezione corrispondente in un
piano vero (o chiedi di farlo) prima di implementare.
