# L'assistente, secondo giro: la planimetria, l'SVG libero, un secondo protocollo

> **Stato: FATTO, archiviato il 16-11-2026 prima della rc.20.** G1 chiuso col voto del maintainer (4 su 5); G2, G3, G4
> (Mistral) e G5 (FLUX.2 e la storia della spesa) fatte il 16-11 e provate con risposte finte, ognuna con la revisione
> del suo ramo. Le prove vere, il collaudo e CasaDomotica sono in `docs/COLLAUDI_IN_SOSPESO.md` («L'assistente: faceplate
> e sfondi», voci 4 e 5; «L'assistente, secondo giro», voci 1-4). I punti brevi rimasti sono nel seme
> [residui del secondo giro](../plans/semi/2026-11-16-assistente-residui-secondo-giro.md). Nato il 10-11-2026 chiudendo il piano
> [l'assistente disegna i simboli e compone il sinottico](2026-11-03-assistente-genera-simboli-e-sinottici.md)
> (F0–F4 fatte nella 2.25.0, F5 misurata a mano il 04-11): quello che restava era lavoro vero, non punti brevi, e il
> maintainer ha scelto di chiudere il primo piano e raccogliere il resto qui («ok» alla proposta del 10-11-2026).
> Il disegno di dettaglio di F6 e F7 sta ancora nel piano archiviato, sezioni «Il disegno» e «Le fasi»: si parte da lì.

## Da dove riparte

- **F5, banco dei tubi d'acciaio**: misurato a mano il 04-11-2026 con due conversazioni vere (resoconti in
  `tmp/ai-misure/2026-11-04-*.json`, solo su theobroma): `kimi-k3` 15 minuti, 1,01 $, 9 simboli nuovi, 37 oggetti;
  `kimi-k3.1-pro` 19 minuti, ≈2 $, 7 simboli nuovi + 3 di libreria, 56 oggetti. Non ci sono il progetto di prova fisso
  (`tests/fixtures/ai-bench/tubi-acciaio/`), il copione finto né il test e2e, e manca il giudizio del maintainer da 1 a 5.
- **Revisione delle prime bozze (03-11-2026)**: libreria da arricchire (seme
  [libreria più ricca](../plans/semi/2026-11-03-libreria-simboli-piu-ricca.md)), modello predefinito `claude-opus-5-5`, revisione
  dei simboli decisa dalla persona.

## Le fasi

**G1 — Il banco fisso dei tubi (era F5).** Il progetto vuoto a 1280×800 con cornice; il copione dell'agente finto e il
test e2e; il test `#[ignore]` col modello vero che scrive il resoconto in `sws/tmp/ai-misure/`. Poi il **giudizio del
maintainer** sulle due pagine del 04-11 e su una nuova con `claude-opus-5-5`: è quello che decide quanto lavoro di
prompt serve prima di promettere il «prompt semplice».

**G1, fatto il 12-11-2026 notte** (ramo `feat/assistente-g1`, annidato su `fix/aggiornamento-timeout-avvio`):
banco `tests/fixtures/ai-bench/tubi-acciaio/`, copione `sinottico-tubi.json` (scritto a mano: le tracce del 04-11 stanno
solo su theobroma), test Rust `ai/banco_tubi.rs`, e2e `chat-tubi.spec.ts`, `scripts/banco_tubi.sh [--vero]`.
**Scostamento**: la prova col modello vero non è un `#[ignore]` ma `banco_tubi.sh --vero`, perché dal 10-11 la foto di
un progetto web la fa il browser dell'IDE. Due prove con `kimi-k3` (unica chiave su `ufficio`):
- 22:39, **1,43 $, 15 min**, 20 giri, 8 bozze, 4 istantanee: proposta validata ma rimandata (bozze nello stesso turno),
  e il test non ha mai risposto «procedi» perché la riga dello strumento restava «scrivo» — difetto della chat,
  corretto;
- 23:25, **0,95 $, 10 min**, 18 giri, 5 bozze, 2 istantanee, 0 correzioni, un «procedi»: 25 oggetti, 5 simboli
  `prj:`, 6 di libreria, 2 tubi, il tipo `macchina_linea` e un faceplate «Macchina di linea» per ogni macchina.
  Materiale in `sws/tmp/banco-tubi/2026-11-12-232548-vero/` (progetto salvato, `pagina.png`, `misure/`).

**G1 chiuso il 16-11-2026.** Prova con `claude-opus-5-5` (chiave dell'IDE su theobroma): **1,26 $, 5,5 min**, 17 giri,
28 oggetti, 5 simboli `prj:`, 6 di libreria, 2 tubi, i tipi `macchina_linea` e `pompa` con un faceplate per macchina.
Materiale in `sws/tmp/banco-tubi/2026-11-16-161617-vero/` (solo theobroma). **Voto del maintainer: 4 su 5**, «più che
accettabile per questa fase»: il lavoro sulle istruzioni non è un prerequisito di G2-G5.

**G2 — Planimetria e banco della casa (era F6).** L'assistente scrive una `Planimetria` nel modello che esiste
(`sws-editor/src/planimetrie/modello.ts`, `planimetrie/<id>.yaml`, in metri); `pianta_svg` in Rust (muri, porte con
l'arco, finestre, aree, niente testo) come sfondo della pagina; lo strumento `pianta` dà stanze e finestre in pixel di
pagina; una **tapparella `prj:` con parte `level`** generata; il progetto di prova con una quindicina di variabili in
stile Home Assistant. Misurato il 10-11-2026: lo strumento `pianta` e `pianta_svg` non esistono.

**G2, fatto il 16-11-2026** (ramo `feat/assistente-g2-g3`). Le misure del 10-11 erano giuste: non c'era niente, e
`sws-web/src/planimetrie.rs` archivia la planimetria senza leggerla (il modello vive solo in TypeScript). Fatto:
- **`sws-web/src/floor_plan.rs`**: la lettura tipizzata della planimetria (le chiavi del file restano `muri`,
  `aperture`, `aree`), `normalize` (riempie le misure mancanti con i predefiniti dell'editor e dice gli errori col
  percorso), `svg` (aree, muri aperti alle aperture, vetro delle finestre, anta e arco delle porte, niente testo) e
  `layout` (stanze, finestre e porte in pixel di pagina; per una finestra la stanza e un punto `inside`).
- **Lo strumento `floor_plan`** (`ai/floor_plan_tool.rs`, definizione in `ai/tools.rs`): riceve la planimetria in
  metri, la tiene sul banco della conversazione come le bozze dei simboli, manda il disegno alla chat (frame
  `floor_plan`) e risponde con `background`, `area`, `rooms`, `windows`, `doors`. Con `id` rilegge una bozza o una
  planimetria del progetto. `fit` dice in quale riquadro della pagina deve stare.
- **Lo sfondo**: il disegno è `images/ai-floor-plan-<id>.svg`, grande quanto l'area libera della pagina, e va in
  `sfondo_immagine`. Viaggia nella proposta dentro `sfondi` (`{file, svg}` accanto a `{file, jpg}`); la planimetria in
  `floor_plans`. L'editor li scrive al Salva (`ai:sfondi:<id>`, `ai:floor_plans:<id>` in `applyAiProposal`), il diff
  ha le due voci, la chat mostra la bozza, e l'elenco Planimetrie si aggiorna da solo. La foto dal browser e quella
  LVGL ricevono il disegno come gli sfondi.
- **Il banco della casa**: `tests/fixtures/ai-bench/house/` (15 variabili in stile Home Assistant, una pagina vuota
  con cornice), copione `sws-web/tests/ai/house-floor-plan.json` (pianta di 12 × 8 m, cinque stanze, la tapparella
  `prj:shutter-position` con parte `level`: il vetro sopra le stecche, quindi il livello è l'apertura), test Rust
  `ai/bench_house.rs` (controlla anche che luci e tapparelle stiano nella stanza della loro variabile), e2e
  `e2e/chat-house.spec.ts`, `scripts/bench_house.sh [--real]`. Il giro finto è stato eseguito: verde, pagina in
  `sws/tmp/bench-house/`.
- **Prompt**: una sezione «A house on its floor plan» in `ai/prompt.rs`.

**Scelte prese senza fermarsi (da rivedere se non vanno)**:
- *Nomi in inglese*, per la regola del 13-11: lo strumento è `floor_plan` e non `pianta`, la funzione è
  `floor_plan::svg` e non `pianta_svg`. In inglese anche la descrizione dello strumento, i suoi errori e la sezione
  del prompt: il resto del prompt è in italiano, e se il prompt va considerato un documento si traduce in un commit.
- *Le aperture con un punto*: chi scrive la planimetria dà `at: [x, y]` e il server trova muro e frazione `t`. Nel
  file resta solo il modello di prima.
- *Le porte*: il modello non ha lato né mano. Il cardine sta sul primo bordo del vano e l'anta apre a sinistra del
  verso in cui il muro è disegnato.
- *Fuori da MCP*: `floor_plan` scrive sul banco, quindi sta con `bozza_simbolo` in `FUORI_DA_ESEGUI`.
- *I colori*: le aree hanno il loro colore pieno; muri `#475569` (o `wall_color`), vetri azzurri. Lo sfondo è
  trasparente dove non c'è niente.
- *Una planimetria del progetto non si sostituisce* (dalla revisione del ramo). Al Salva la planimetria della
  proposta riscrive il file intero: con lo stesso id avrebbe cancellato muri, blocchi 3D e camera disegnati a mano.
  Ora `floor_plan` rifiuta un `plan` con l'id di una planimetria che il progetto ha già, e dice gli id presi; quella
  che c'è si usa con `id`, così com'è. `leggi_progetto` elenca le planimetrie in `floor_plans` (id e nome) e il
  prompt dice di usare quella che c'è. Unica eccezione: una bozza di questa stessa conversazione che nel frattempo
  è stata salvata si può ridisegnare, e allora la proposta porta `replaced_floor_plans` e il diff la segna con `~`
  invece di `+`. L'assistente non modifica una planimetria disegnata a mano: quello si fa nel suo editor.

**Resta di G2**: la prova col modello vero (`./scripts/bench_house.sh --real`, a pagamento) e il voto; il collaudo
(una pagina accettata, vista nel viewer web e su LVGL: su LVGL non è stata ancora guardata); CasaDomotica. Un punto
aperto: se la planimetria cambia poi nel suo editor, lo sfondo SVG non si rigenera da solo — oggi lo rifà
l'assistente (`floor_plan` con l'`id`). Un altro: annullare una proposta applicata non toglie la planimetria e il
disegno in attesa del Salva (vale già per gli sfondi generati), quindi il Salva li scrive lo stesso, non usati.

**G3 — SVG libero con le bocche (era F7, richiesta dal maintainer il 03-11-2026).** `bozza_simbolo` accetta un SVG con
`view_box` e `ports` → `custom:` con bocche; i due campi facoltativi nuovi su `CustomSymbol` (`sws-core/src/project.rs`),
letti da `bocchePer`, `ancora_di` e dal validatore; validazione con `svg_ostile`, i vietati di `genera.py`, i limiti di
dimensione e la tavola LVGL. Misurato il 10-11-2026: `CustomSymbol` non ha `view_box` né `ports`.

**G3, fatto il 16-11-2026** (ramo `feat/assistente-g2-g3`, sopra G2). La misura del 10-11 era giusta. Fatto:
- **Il modello**: `CustomSymbol` (`sws-core/src/project.rs`) ha `view_box: [w, h]` e `ports`, con le stesse bocche
  della libreria (`PortaLib`: `id`, `x`, `y`, `side`, `d`). Sono facoltativi: un `project.yaml` di prima si legge e si
  riscrive uguale. Le bocche valgono solo insieme alla misura del disegno (`ports_with_view_box`).
- **Il controllo**: `sws-core/src/free_symbol.rs`. Limiti: 32 KB, 400 elementi, lati multipli di 10 fino a 510. Elementi
  ammessi: `g`, `defs`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `use`, i due gradienti con
  `stop`, `clipPath`, `mask`. Fuori i vietati di `genera.py` (`text`, `style`, `image`, `filter`, `animate*`…) e
  quello che il browser toglierebbe in silenzio. `href` e `url()` solo verso id dello stesso disegno. Bocche dentro
  il disegno, con un lato noto e un id che non sia `left`, `right`, `top`, `bottom`, `center`. Il disegno esce
  riscritto in una forma sola: un elemento per riga, id col prefisso `cs-<slug>-`. Dalla revisione del ramo: `url(`
  si riconosce in ogni scrittura (`URL(`, `url (`) ed esce sempre come `url(#id)`; è rifiutato quello che un lettore
  XML rigoroso rifiuta (un attributo scritto due volte, un nome di attributo che non è un nome) e ogni valore con
  `&` o `\`, perché un'entità o una sequenza di escape scrive un `url(` che il controllo non vede. Un test legge il
  risultato con `roxmltree`, il lettore con cui il pannello disegna i simboli custom.
- **Lo strumento**: `bozza_simbolo` accetta, al posto di `descrizione`, `slug`, `it`, `en`, `svg`, `view_box` e `ports`
  (`ai/free_symbol_tool.rs`, definizione in `ai/tools.rs`). Passa da `svg_ostile` e da `free_symbol::check`, va sul
  banco (`Banco.free_symbols`) e in chat come le altre bozze, e risponde con `custom:<slug>` e le bocche. La tavola
  delle bozze, `valida` e `istantanea_pagina` la vedono, su LVGL e nella foto dal browser. La proposta la porta in
  `project.custom_symbols`. Il prompt ha la sezione «A symbol drawn as free SVG»: la descrizione resta la via normale.
- **Il validatore** (`sws-web/src/validate.rs`): le bocche di un `custom:` sono quelle che dichiara; bocche fuori dal
  disegno sono un errore del progetto, bocche senza `view_box` un avviso. La rotta `PUT /api/project/custom-symbols`
  rifiuta bocche sbagliate. Solo nella validazione dell'assistente, una pagina proposta che nomina un `custom:` che
  non c'è è un errore — ma non se la pagina sul disco lo nominava già: allora è un rilievo preesistente e non costa
  giri di correzione.
- **Due regole per le bocche, non tre** (dalla revisione del ramo). Per un simbolo scritto a mano in `project.yaml`
  vale solo quello che rende una bocca non piazzabile (`free_symbol::check_ports`): fuori dal disegno, lato
  sconosciuto, due con lo stesso id, senza id, diametro non positivo. Validatore e `PUT` usano la stessa funzione:
  quello che è errore nel primo è rifiuto nella seconda, e niente altro. Bocche senza `view_box` sono ignorate dai
  due motori: avviso nel validatore, e la `PUT` le lascia passare (prima rispondeva 400 e bloccava ogni Salva
  dell'IDE). I lati multipli di 10 fino a 510, le 12 bocche, gli id da slug e il nome diverso dalle ancore restano
  regole dei soli disegni dell'assistente (`free_symbol::check`, `check_drawn_ports`).
- **Web**: `bocchePer` (`canvas/tubazioni.ts`) legge le bocche dei `custom:` da un registro in
  `symbols/lib/libreria.ts`, che lo store tiene allineato ai suoi `customSymbols`. Vale per editor e viewer:
  aggancio, percorso, calamita, elenco delle bocche nel pannello proprietà. Il disegno è quello di sempre, uguale in
  edit e a runtime.
- **LVGL**: il viewer legge `view_box` e `ports` da `/api/project` (`model.rs`). `simbolo_lib::manifest_for_pipe` li
  aggiunge al manifesto che `ancora_di` già usa, e solo quando un capo del tubo sta su un `custom:`. Il disegno resta
  rasterizzato, contenuto e centrato come sul web.
- **Editor**: `applyAiProposal` unisce i simboli custom della proposta a quelli dello store (`mergeCustomSymbols`); li
  scrive il Salva di sempre. Il diff ha la voce «simbolo `custom:…`» e la miniatura.
- **Prove**: Rust — `free_symbol.rs` (accetta, rifiuta, bocche, compatibilità del file), `ai/free_symbol_tool.rs`,
  `ai/free_symbol_bench.rs` col copione `tests/ai/free-svg-symbol.json` sul banco dei tubi (un ciclone con due
  bocche e due tubi), il validatore, e il test con i binari veri `a_pipe_reaches_the_port_of_a_free_svg_draft`
  (`istantanea.rs`, entra in `check_istantanea.sh`). LVGL — `a_pipe_attaches_to_the_ports_of_a_free_svg_symbol`.
  Vitest — `tests/customSymbolPorts.test.tsx` e due casi in `store/aiTransaction.test.ts`. Web e LVGL si aspettano gli
  stessi tre punti per lo stesso tubo.

**Scelte prese senza fermarsi (da rivedere se non vanno)**:
- *Un elenco di ammessi, non solo di vietati*: è più stretto del piano. Così un elemento non può essere disegnato dal
  pannello e tolto dal browser. Per lo stesso motivo la radice `<svg>` porta solo `xmlns` e `viewBox`: il browser ne
  tiene il contenuto, il pannello anche gli attributi.
- *I simboli custom non passano dal modello*: `leggi_progetto` li dà senza `svg` (anche via MCP), e la proposta
  riceve sempre quelli del disco più le bozze. Il modello ne aggiunge o ne ridisegna uno suo, non può perderne. Chi
  manda a `valida` un `custom_symbols` diverso da quello del disco (una bocca spostata, un simbolo tolto) riceve un
  avviso su `project.custom_symbols`: il giudizio è stato dato sui simboli del disco.
- *Applicare non toglie mai un simbolo custom*, e annullare la proposta non lo toglie di nuovo: resta fra i simboli
  del progetto, non usato. Il Salva riscrive l'elenco intero, e un elenco accorciato per errore cancellerebbe simboli
  importati a mano.
- *Un SVG libero è un disegno fermo*: niente parti vive, niente colore di stato, niente stile del progetto.
- *`svg_ostile` corretto*: leggeva `<polygon points=` come un gestore `onpoints` e rifiutava ogni simbolo con un
  poligono. Ora cerca il gestore dove comincia un attributo.
- *In inglese* i messaggi nuovi del validatore, dello strumento e del prompt (regola del 13-11), come in G2.
- *Con un modello dei simboli a parte* (`disegna_simbolo`) `bozza_simbolo` non c'è, quindi nemmeno l'SVG libero.

**Resta di G3**: il collaudo (un simbolo SVG libero agganciato a un tubo, su web e LVGL) e la prova col modello vero;
CasaDomotica. La scheda Risorse non mostra né modifica le bocche. Un runtime più vecchio ignora i due campi: lì il
tubo cade sul centro del riquadro. In `NOVITA.yaml` la voce non c'è: il blocco 2.26.0 ha già le sue 15 voci.

**G4 — Un secondo protocollo per il testo.** Oggi `enum Fornitore` (`ai/client.rs`) ha `Anthropic` e `Kimi`, che parlano
la stessa API Messages. Un secondo ciclo SSE, un secondo formato dei blocchi e una seconda resa degli strumenti, in
stile OpenAI «chat completions»: apre **OpenAI** e soprattutto un **fornitore europeo** (Mistral, o modelli aperti da
Scaleway/OVH) — vedi il seme [fornitore IA europeo](2026-11-10-fornitore-ia-europeo.md), che con questa fase si
assorbe. Da misurare sui banchi G1 e G2 prima di proporlo.

**G4, fatto il 16-11-2026** (ramo `feat/assistente-g4-mistral`, annidato su `feat/ai-keys-account-complete`). **Mistral**
è il terzo fornitore di testo, col secondo protocollo:
- **Un traduttore al confine, non un secondo agente**: `sws-web/src/ai/chat_completions.rs`. Il ciclo dell'agente, le
  conversazioni salvate, il banco, il modello dei simboli e il traduttore continuano a parlare il formato Messages; il
  modulo traduce la richiesta in uscita (`request_body`) e il flusso SSE al ritorno (`StreamState`: testo a pezzi,
  `tool_calls` con gli argomenti JSON a pezzi e intrecciati, `usage` coi nomi che `costo_usd` legge). Una conversazione
  può cambiare fornitore a metà. `client.rs`: `Fornitore::Mistral`, `Protocol`, `chat_turn`, `ask_chat_once`.
- **Le differenze fra fornitori stanno in un `Dialect`**: per OpenAI come testo (o Scaleway, OVH) servono una voce di
  `Fornitore` e un `Dialect`, non altro codice. Non è acceso: nessuno l'ha chiesto e non si può provare.
- **Quattro cose che Mistral non accetta come le scriviamo**, tutte coperte da test: gli id delle chiamate (solo nove
  lettere o cifre: quelli di un altro fornitore si mappano); le immagini in un risultato di strumento (vanno in un
  messaggio utente subito dopo); **un messaggio utente dopo un risultato di strumento** (errore 3230: è la forma di
  ogni domanda dopo una proposta, `domanda_dopo`; in mezzo va un turno dell'assistente di una parola); un messaggio
  dell'assistente vuoto (si salta).
- **Dove compare**: `scopi::FORNITORI` (assistente, simboli, traduzione), `mistral.key` e `MISTRAL_API_KEY`, «Prova la
  chiave» (`GET api.mistral.ai/v1/models`, senza i modelli che non conversano), `prezzi()`, la scheda IA dell'IDE, «Le
  mie chiavi IA» (`AI_PROVIDERS`, `aiProviders.mistral`), le chiavi per utente del gateway e `user_keys::PROVIDERS` del
  container. Il modello preferito dell'account vale anche qui.
- **Modello predefinito `mistral-large-latest`**: letto il 16-11-2026 su docs.mistral.ai, oggi è Mistral Large 4 (uscito
  il 05-11-2026; Large 3, `mistral-large-2512`, è deprecato dal 31-10). Prezzi in tabella: 0,7 $ e 2,1 $ per milione,
  cache 0,07 $; `mistral-small-latest` 0,15 $ e 0,6 $. Gli altri id che Mistral elenca (quelli datati, Codestral,
  Ministral) si contano al prezzo della loro famiglia, come stima, e non a quelli di Opus 5: lo scarto era di dieci
  volte. Senza preferenze l'ordine resta Anthropic, Kimi, poi Mistral.
- **Prove, tutte finte**: flussi registrati a mano nella forma di Mistral (testo, una chiamata spezzata su più pezzi,
  più chiamate, `usage`, un evento di errore, un flusso troncato, un carattere tagliato fra due pezzi di rete); un
  fornitore finto su `localhost` che passa per il client HTTP vero (`client.rs`, `fake_provider`); il copione del banco
  dei tubi rigiocato attraverso il protocollo (`banco_tubi.rs`).

**Scostamenti di G4.** Non è misurato sui banchi G1 e G2 col modello vero: la chiave non c'è (Decisioni del
16-11-2026), la prova è una voce di `COLLAUDI_IN_SOSPESO.md`. Non si chiede il ragionamento (`reasoning_effort`): quello
che un modello manda da sé si vede in chat e non si conserva. `max_tokens` è fermo a 32768 e la cache non si pilota
(`prompt_cache_key`): si decide con la prova vera. In `NOVITA.yaml` non c'è una voce nuova (il blocco 2.26.0 è a 15 su
15): mezza frase in coda a una voce esistente. La riga del piano in `docs/plans/README.md` dice ancora che G4 resta:
è una riga sola per i quattro rami paralleli, la riscrive chi li mette in fila.

**Resta di G4, dal seme, al maintainer**: l'informativa e le condizioni d'uso (`docs/legale/`) elencano «Anthropic o
Moonshot/Kimi» e non nominano Mistral; se nel cloud Mistral debba essere il predefinito.

**G5 — Immagini e spesa.** Altri fornitori di immagini (FLUX.2 Pro, Imagen 4) accanto a `gpt-image-2`
(`ai/immagini.rs`); una **storia della spesa** per scopo e per mese nell'installazione (`config_dir`, accanto a
`ai.yaml`: chiavi e tetti stanno lì), oggi assente — c'è solo il tetto per conversazione e per scopo. Il prezzo di
`kimi-k3.1-pro` in `prezzi()` (`ai/client.rs`, oggi stimato «≈» ai prezzi di Opus 5) quando si conosce il listino.

**G5, fatto il 16-11-2026** (ramo `feat/assistente-g5-flux-spesa`). Provato solo con risposte finte: nessuna chiamata a
pagamento, nessuna chiave vera.
- **FLUX.2 per gli sfondi** (`ai/bfl.rs`). Black Forest Labs è il secondo fornitore di immagini: id `bfl`, chiave in
  `bfl.key` o `BFL_API_KEY`, modello predefinito `flux-2-pro`. L'API è asincrona: si manda la richiesta, si interroga
  l'indirizzo che torna indietro ogni 1,5 s per al più 4 minuti, si scarica la foto. Chiave e scaricamento vanno solo a
  indirizzi `*.bfl.ai`, **anche dopo un redirect**: la chiave sta nell'intestazione `x-key`, che reqwest non toglie
  quando un redirect cambia sito, quindi le chiamate a BFL hanno un client loro (`bfl::client`) che segue un redirect
  solo verso un altro indirizzo di BFL e tratta gli altri come errore. La foto si legge a pezzi e si lascia cadere
  appena passa i 20 MB. Stessa misura di OpenAI (1536×1024, JPEG) e stessi due passi (base, poi varianti). FLUX non ha
  una qualità: nel menù il campo c'è solo con OpenAI.
- **Il prompt della variante non si riscrive**, e il campo per dirlo cambia col modello (`keep_prompt_field`, da
  `api.bfl.ai/openapi.json` letto il 16-11): `disable_pup: true` per [pro] e [max], `prompt_upsampling: false` per
  [flex], niente per [klein], che non riscrive.
- **Lo scopo `sfondi` sceglie il fornitore** (`scopi::ImageProvider`, `carica_sfondi_con`): quello salvato; senza,
  OpenAI e poi BFL; un fornitore salvato senza chiave cede all'altro. La chiave è del progetto, poi dell'account
  (`user_keys::PROVIDERS`, `provider_known` del gateway, la finestra «Le mie chiavi IA»).
- **Il costo nel tetto**: prima della chiamata la stima dal listino di bfl.ai letto il 16-11 (`flux-2-pro`: 0,03 $ il
  primo megapixel, 0,015 $ i successivi e quelli della foto di partenza; 1536×1024 conta 2 MP, quindi 0,045 $ una base
  e 0,075 $ una variante). Dopo, vale il costo che BFL dichiara nella risposta (`cost`, in crediti da 0,01 $).
  **Una richiesta accettata e poi fallita si conta lo stesso** (`bfl::Charge`, `failed_background`): scaduti i 4 minuti,
  rifiutata un'interrogazione o non scaricata la foto, il costo dichiarato all'invio (o la stima) entra nel tetto dello
  scopo, in quello della conversazione e nella storia. Senza, un BFL lento lasciava aprire al modello una richiesta a
  pagamento dopo l'altra col tetto degli sfondi fermo a zero. Se lo stato finale di BFL porta il costo definitivo, vale
  quello, zero compreso.
- **«Prova la chiave»** di BFL chiama `GET /v1/credits`, che è gratis e vuole una chiave valida. BFL non ha un elenco
  dei modelli: il menù offre i sei modelli FLUX.2 del suo riferimento (`scopi::BFL_MODELS`).
- **La storia della spesa** (`ai/spending.rs`): `config_dir/ai-spending.json`, somme per mese, scopo e fornitore
  (dollari e numero di chiamate), ultimi 36 mesi, riscritto in modo atomico sotto un lucchetto del processo. Solo un
  file che **manca** è una storia vuota: uno che non è più JSON valido viene messo da parte come
  `ai-spending.json.broken-<data>-<ora>` prima di ricominciare, e con un altro errore di lettura la scrittura si salta
  (si perde quella voce, non i mesi). Ci
  scrivono i giri dell'assistente, il disegno dei simboli, la traduzione «IA» (che prima non contava il costo) e gli
  sfondi. Si legge da `GET /api/ai/spending` (Admin, solo istanza IDE) e si vede in **Configurazione → IA → Spesa**
  (`IaSpendingTab`): il mese in corso e i precedenti, per scopo e fornitore, con i totali.
- **Il listino di Kimi** in `prezzi()`, letto il 16-11 da platform.kimi.ai: `kimi-k3.1-pro` 2 $ / 10 $ / 0,20 $ per
  milione di token (ingresso, uscita, cache letta), `kimi-k3.1-pro-highspeed` 4 $ / 20 $ / 0,20 $, `kimi-k3` 3 $ / 15 $ /
  0,30 $. Scrivere la cache a 5 minuti costa quanto l'ingresso, non 1,25 volte.

**Scostamenti di G5**:
- la rotta è `/api/ai/spending` e non `/api/ai/spesa`, e la scheda ha id `ia_spending`: sono nomi nuovi, quindi in
  inglese (regola del 13-11-2026). A schermo la scheda si chiama «Spesa»;
- **Imagen 4 non c'è**: la decisione del 16-11 nomina solo FLUX.2;
- un punto dell'API di BFL è una lettura e non una citazione: la variante manda la foto di partenza in **base64** nel
  campo `input_image`. La guida di FLUX.2 mostra solo indirizzi; il base64 è quello che accettava FLUX.1 Kontext. Si
  vede alla prima variante vera;
- una richiesta di FLUX accettata e poi fallita si conta **per eccesso**: quando lo stato finale non porta il costo
  definitivo (un rifiuto del filtro dei contenuti, un errore di BFL) si conta quello dichiarato all'invio, anche se BFL
  potrebbe non addebitarlo. Se BFL lo addebiti davvero in quei casi non è scritto nel suo riferimento;
- le copie `ai-spending.json.broken-*` non si cancellano da sole: ognuna nasce da un file rovinato da fuori;
- la spesa conta le chiamate di **questa installazione**. Nel cloud ogni progetto ha la sua `config_dir`, quindi la
  scheda mostra la spesa del progetto aperto, anche quando la chiave è dell'account di chi scrive. Una spesa per
  account è un altro lavoro;
- `NOVITA.yaml` non è toccato: il blocco 2.26.0 è pieno (15 voci) e chi usa il pannello non vede niente di nuovo.

**Resta di G5**: la prova vera, voce di `COLLAUDI_IN_SOSPESO.md` («L'assistente: faceplate e sfondi», punto 4), e
CasaDomotica (regola del progetto di riferimento): uno sfondo fatto con FLUX.2, quando c'è la chiave.

## Decisioni del 16-11-2026 (per chiudere il piano prima della rc.20)

- **G1**: la prova vera con `claude-opus-5-5` si fa con la chiave Anthropic dell'IDE su 8460; poi il voto del maintainer.
- **G4**: per primo **Mistral** (API in stile OpenAI «chat completions» con strumenti); lo stesso codice apre OpenAI.
- **G5**: si aggiunge **FLUX.2 Pro** (Black Forest Labs); la storia della spesa si vede in **Configurazione → IA**, una
  scheda «Spesa» accanto a Fornitori e Scopi (per scopo, per fornitore, per mese).
- **Prove**: le chiavi Mistral e FLUX.2 non ci sono. G4 e G5 si provano con risposte registrate (test finti); la prova
  vera diventa una voce di `COLLAUDI_IN_SOSPESO.md`.
- G2, G3, G4 e G5 si fanno in parallelo, in rami separati annidati su `feat/ai-keys-account-complete`, e si mettono in
  fila prima della build.

## Fuori da questo piano (dal piano archiviato, «In Appunti, a fine lavoro»)

Una libreria aziendale nel cloud (`prj:` condivisi fra progetti); un faceplate generato per tipo; le sorgenti dal
catalogo dispositivi; un'impaginazione automatica con tubi che girano intorno agli ostacoli; un editor a mano delle
descrizioni; `clear_tool_uses` lato server se le misure lo chiedono. Se uno diventa una domanda, nasce un seme.

MCP resta di sola lettura (14 strumenti il 10-11-2026): riaprire solo con un bisogno vero, la motivazione è nel piano
archiviato, «Nota a parte».

## Collaudo

Le voci del primo giro stanno in `docs/COLLAUDI_IN_SOSPESO.md`, «L'assistente: faceplate e sfondi». Per questo piano:
G1 il giudizio sulle pagine; G2 una pagina della casa accettata e vista nel viewer web e su LVGL; G3 un simbolo SVG
libero agganciato a un tubo; G4 una conversazione con il fornitore nuovo sul banco dei tubi; G5 la spesa del mese in
console. Prima di chiudere, la funzione va in CasaDomotica (regola del progetto di riferimento).
