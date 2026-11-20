# L'assistente IA nell'editor dei simboli

> Piano del 19-11-2026 (notte), sessione di plan col maintainer: «implementa il prossimo step dell'editor dei
> simboli, dovrebbe essere l'assistente IA». È la fase 6 del piano di fondo
> ([editor dei simboli](2026-11-18-editor-dei-simboli.md)), anticipata sulla sessione 3 della fase 2 (importa SVG,
> esporta/importa), che viene dopo. Ramo `feat/symbol-ai`, **annidato su `feat/image-library`** (i rami aperti
> aspettano il collaudo). Codice nuovo in inglese.

## Contesto
Oggi l'IA disegna simboli **solo dalla chat del progetto** (`/ws/ai`): lo strumento `bozza_simbolo` o, se lo scopo
«Simboli» ha un modello suo, `disegna_simbolo` (`sws-web/src/ai/strumenti_scopi.rs:99`: una chiamata al modello dei
simboli con lo schema, compilazione, fino a 3 tentativi con gli errori). La bozza resta sul banco della chat e
arriva nel progetto solo con una proposta da «Applicare». L'editor dei simboli è a schermo intero e copre la chat;
non esiste una chiamata «descrizione + istruzione → descrizione nuova»; la chat non vede la descrizione dei `prj:`
già fatti (`leggi_progetto` toglie `simboli`).

Esistono i pezzi da riusare:
- `client::chiedi_con_uso(http, &Scelta, istruzioni, messaggi, max_tokens)` (`ai/client.rs:481`): una chiamata
  senza streaming per i quattro fornitori (Anthropic, Kimi, Mistral, locale);
- `scopi::carica_per_con(config, Scopo::Simboli, &chiavi)` (`ai/scopi.rs:134`): il modello dello scopo «Simboli»,
  con ripiego su quello dell'assistente; il tetto di spesa dello scopo; `spending::add`;
- `tools::schema_simbolo()`, `tools::compila_bozza`, `strumenti_scopi::estrai_json`;
- il modello della chiamata HTTP una tantum: il traduttore (`traduttore.rs:297`, `POST /api/project/languages/
  translate`, `solo_ide`, chiavi dell'utente);
- le immagini verso il modello: `Scelta.sees_images`, e `chat_completions::image_part` per i fornitori locali.

## Decisioni del maintainer (19-11-2026)
1. Una scheda **«IA»** nell'editor, accanto a Pezzo / Struttura / Prova, con tre cose: **disegna un simbolo
   nuovo** da una descrizione, **modifica quello aperto**, **disegna da una foto** (serve un modello che vede le
   immagini).
2. **Anteprima, poi «Accetta»**: la proposta compare nella scheda accanto al simbolo di adesso; «Accetta» la mette
   nell'editor come un passo normale (Ctrl+Z lo annulla); si può chiedere un altro ritocco partendo dalla proposta.
3. L'IA adesso, la sessione 3 della fase 2 dopo.
4. Le prove col **modello locale** (Ollama in ufficio, `http://192.168.0.225:11434/v1`, `qwen3.5:9b` che vede le
   immagini; verificare l'indirizzo con `curl …/v1/models`), niente chiamate a pagamento.

## Il server (`sws-runtime/crates/sws-web/src/`)
- **Il cuore di `disegna` diventa una funzione sua**, `ai/symbol_draw.rs` (nuovo): `draw(http, &Scelta, system,
  messages, fixed: Fixed) -> Result<Drawn, DrawError>` con i tentativi (3), `estrai_json`, i campi imposti
  (slug, etichette, `overrides`, `tipo`) e `compila_bozza`; `Drawn { description, compiled, usage, attempts, cost_usd }`.
  `strumenti_scopi::disegna` la chiama e resta com'è per la chat (banco, misure, frame `risorse_extra`).
- **`POST /api/simboli/ia`** (nuovo, in `simboli_progetto.rs`, accanto a `/api/simboli/compila`), solo nell'IDE
  (`solo_ide`), stessi permessi della traduzione. Corpo:
  `{ mode: "new"|"edit", instruction, description?, photo?: { media_type, data /*base64*/ } }`.
  - `new`: il sistema è quello di `disegna` (schema + regole «simboli» del progetto); lo slug e le etichette sono
    quelli della bozza aperta nell'editor (imposti);
  - `edit`: in più il JSON della descrizione aperta, e la regola «restituisci la descrizione completa; tieni gli id
    delle bocche e delle parti, salvo che l'istruzione chieda di cambiarli»;
  - `photo`: un blocco immagine nel messaggio, con «disegna il simbolo di questa macchina, nello stile della
    libreria»; se il modello non vede le immagini (`sees_images` falso) risponde 400 `blind_model` prima di pagare.
  Risposta: `{ ok, description, svg, voce, attempts, cost_usd, model }`, oppure `{ ok: false, errors, attempts }`
  dopo tre tentativi falliti. Errori: nessun modello configurato (`no_model`), tetto dello scopo superato
  (`cap_reached`), errore del fornitore (il messaggio). Costo in `spending::add(Scopo::Simboli)`; il tetto dello
  scopo si controlla prima della chiamata, come in `disegna`.
- **L'assistente della chat** (`schema_simbolo`) è già allineato coi pezzi animati sul ramo delle animazioni: niente
  da cambiare lì.

## L'editor (`sws-editor/src/symbols/editor/`)
- **`AiPanel.tsx`** (nuovo), quarta scheda «IA» del pannello di destra:
  - un campo di testo per l'istruzione e due pulsanti: **«Modifica questo»** (predefinito quando il simbolo ha già
    delle forme) e **«Disegna nuovo»**; **«Aggiungi una foto»** (la foto ridotta nel browser a 1024 px JPEG con
    `images/optimize.ts`, mostrata in miniatura, togliibile);
  - durante la chiamata: «L'IA sta disegnando…» col tempo che passa; niente altro si blocca;
  - la **proposta**: il disegno proposto (compilato, con `SimboloLibSvg`) accanto a quello di adesso, il modello, i
    tentativi, il costo; **«Accetta»** (`commit` nella cronologia dell'editor: Ctrl+Z la annulla), **«Scarta»**;
    l'istruzione successiva parte dalla proposta se c'è (un ritocco dopo l'altro), altrimenti dal simbolo aperto;
  - gli errori detti in chiaro: nessun modello (con il rimando a Configurazione ▸ IA ▸ Scopi), tetto raggiunto,
    modello che non vede le immagini, simbolo non valido dopo tre tentativi (con gli errori).
- `api.symbolAi(req)` in `api/client.ts`.
- Dopo «Accetta» valgono i controlli che ci sono già al salvataggio: bocche e pezzi rinominati o tolti con tubi o
  legami in pagina chiedono conferma.

## Test
- Rust (`symbol_draw.rs`, la rotta): col fornitore finto di `client.rs` (`fake_provider`, dialetto locale): una
  risposta valida compila al primo tentativo; una sbagliata poi giusta fa due tentativi; `edit` tiene slug ed
  etichette anche se il modello li cambia; `photo` con un modello cieco è rifiutata senza chiamarlo; il costo va
  nello scopo «Simboli». `disegna` della chat continua a passare i suoi test.
- Vitest (`AiPanel`): con `api.symbolAi` finto: «Modifica questo» manda la descrizione aperta; la proposta appare
  con i suoi numeri; «Accetta» la mette nell'editor e Ctrl+Z la toglie; «Scarta»; il ritocco parte dalla proposta;
  gli errori.
- A mano sull'IDE di prova (istanza 8464, scopo «Simboli» sul modello locale `qwen3.5:9b`): un simbolo nuovo da una
  frase, una modifica di una pompa, un simbolo da una foto.

## Documenti
Manuale (capitolo dei simboli: la scheda IA), CHANGELOG, voci di collaudo, la tabella delle fasi del piano di fondo
(fase 6 anticipata), `NOVITA.yaml` al rilascio.

## Verifica
1. Definition of done e controlli della CI (`cargo fmt/clippy/test`, `pnpm lint/type-check/build`, vitest,
   `check_static.sh`).
2. Le prove a mano col modello locale, annotate (quanto tempo, quanti tentativi, cosa disegna bene e cosa no).
3. Collaudo del maintainer con `/test-changes`; CasaDomotica con un simbolo disegnato dall'IA (regola di `CLAUDE.md`).

## Esecuzione (20-11-2026, theobroma)

Fatta in una sessione sul ramo `feat/symbol-ai`, annidato su `feat/image-library`. Tutto come sopra, con queste
differenze:

- **La rotta è `POST /api/symbols/ai`**, in inglese come il codice nuovo, non `/api/simboli/ia`. Risponde sempre 200
  con `ok` e, quando non va, un `code` (`no_model`, `blind_model`, `bad_request`, `cap_reached`, `provider`,
  `invalid`): l'editor lo dice nella sua lingua. Anche `blind_model` è un 200, non un 400: il client dell'IDE tratta
  ogni 4xx come un'eccezione e il messaggio si perdeva.
- **Il tetto dello scopo vale per una richiesta**, come per una conversazione nella chat. Con un modello locale il
  costo è zero.
- **Niente Ctrl+Invio** nel campo: l'editor ferma tutti i tasti sulla finestra (`stopPropagation` in cattura), e
  un `onKeyDown` dentro l'editor non arriva mai. Lo stesso vale per l'Invio che dovrebbe confermare il nome di una
  bocca (`SymbolEditor.tsx`, campo `symbol-port-id`): non funziona da prima, non è stato toccato. *Corretto il
  20-11-2026 sul ramo annidato `feat/symbol-import` (`bcbc2df29`): i campi dell'editor ricevono i tasti, e Ctrl+Invio
  c'è.*
- **Accettando**, nome, etichette, categoria e variante restano quelli che l'editor ha in quel momento, anche se
  sono cambiati mentre il modello disegnava.

### Le prove col modello locale

`qwen3.5:9b` su Ollama (`http://192.168.0.225:11434/v1`, vede le immagini), IDE di prova 8464.

1. **Con il ragionamento acceso** (come risponde Ollama di suo) il modello pensa per tutti gli 8192 token del
   dialetto locale, tre minuti, e la risposta arriva vuota: «no text in the answer». Lo stesso valeva già per la
   traduzione con un modello locale che ragiona. Da qui la correzione in `client.rs`: alle domande secche di un modello
   locale si chiede `reasoning_effort: "none"`, e se il server lo rifiuta (vLLM accetta solo low, medium, high) la
   domanda riparte senza. Con 24000 token e il ragionamento acceso, due prove dirette: 4 minuti l'una, ancora non
   valide.
2. **Senza ragionamento** una risposta arriva in 15–50 s. Ma il 9b sbaglia il formato quasi sempre: `geo` e `tag`
   dentro `corpo`, `op` dentro `geo`, tipi che non esistono (`tronchetto_v`), materiali e veli inventati
   (`gray`, `dark-r`), JSON con chiavi senza virgolette. Su nove richieste alla rotta: **due proposte valide** (una modifica
   al secondo tentativo, un disegno da una foto al primo), sette respinte dopo tre tentativi (da 30 s a 3 minuti e
   mezzo l'una). Le due
   valide sono brutte: la modifica ha rimpicciolito e ingrigito il corpo invece di aggiungere la targa; dalla foto di
   un serbatoio sono uscite solo tre flange sparse.
3. **Quattro aiuti** messi lungo la strada, che servono a ogni modello: la descrizione avvolta come nel formato
   (`{"descrizione": …}`) si legge; l'errore di lettura dice l'operazione (`ops[5]: missing field h`, prima diceva
   solo `missing field h` e il modello rimandava la stessa risposta tre volte); il simbolo aperto si mostra con `geo`
   come oggetto, come nello schema, e non a coppie come lo scrive la libreria; il log dell'IDE scrive cosa ha risposto
   il modello quando il disegno è respinto (`symbol drawing rejected`).
4. **La modalità JSON** di Ollama (`response_format: json_object`), provata a parte: toglie gli errori di sintassi
   ma non quelli di formato. Non è stata messa.

**Conclusione per il collaudo**: il flusso funziona (proposta, accetta, Ctrl+Z, scarta, ritocco, foto, errori), ma
per disegnare davvero serve un modello più grande di un 9b: in locale almeno un 27–32b, oppure un modello in cloud
sullo scopo «Disegno dei simboli». Con il 9b la scheda serve a provare i percorsi, non i disegni.

### Rimasto aperto

- Un modello locale piccolo disegnerebbe meglio con l'uscita **vincolata a uno schema JSON** (Ollama e vLLM lo
  sanno fare, `response_format: json_schema`): lo schema della descrizione andrebbe generato dai tipi di `sws-core`.
  È lavoro, non un punto breve: se serve, diventa un seme.
- CasaDomotica con un simbolo disegnato dall'IA, al merge, con un modello che sappia disegnare.
