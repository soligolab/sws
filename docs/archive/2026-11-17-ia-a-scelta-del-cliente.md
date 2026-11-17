# L'IA a scelta del cliente: modello in casa, preferenza nell'account, listino della piattaforma

> **FATTO, archiviato il 17-11-2026.** Il giro col modello in casa l'ha validato il maintainer lo stesso giorno, in
> ufficio (Ollama sul suo PC, `qwen3.5:9b`): i tag e la pagina degli 8 LED fatti dall'assistente, poi portati sul TY570
> dal cloud. Le prove nel cloud (Prezzi IA, preferenza, indirizzo privato) restano in `docs/COLLAUDI_IN_SOSPESO.md`.
> CasaDomotica: è una funzione dell'istanza, non del progetto, quindi non c'è un oggetto da aggiungere.
>
> Piano del 17-11-2026, da chiudere in **una sessione**. Primo passo dell'esecuzione: copiarlo in
> `docs/archive/2026-11-17-ia-a-scelta-del-cliente.md`, con una riga in `docs/plans/README.md`, sul ramo
> `feat/ai-free-choice` (da `main`). Codice nuovo in inglese, testi in it/en.

## Contesto

Oggi il cliente sceglie già l'IA per ogni operazione (assistente, simboli, traduzione, sfondi), ma con tre limiti:

1. **L'elenco dei fornitori è chiuso.** Non c'è un modello in casa (Ollama, vLLM, LM Studio, llama.cpp).
2. **La persona non sceglie.** Nel cloud l'account tiene le chiavi e il modello preferito, ma non il fornitore. Senza
   una scelta del progetto vale l'ordine fisso Anthropic → Kimi → Mistral.
3. **I prezzi sono nel codice** (`client::prezzi`, `immagini::costo_stimato`, `bfl::prices`). Non si modificano, non si
   aggiornano, e due righe sono sbagliate.

Il maintainer vuole libertà di scelta, non Mistral predefinito («mistral è solo una opzione»). Le misure comparate fra
modelli si fanno più avanti (micro-seme in F0).

**Decisioni del maintainer (17-11-2026):**
- **Precedenza:** vince la scelta del progetto; la preferenza dell'account vale solo se il progetto non ha scelto.
- **Indirizzo del modello in casa:** pannello e IDE locale accettano qualunque indirizzo; il cloud solo indirizzi
  pubblici.
- **Listino su pannello e IDE locale:** si aggiorna da solo e non si modifica. Si modifica solo nella console della
  piattaforma, nel cloud.
- **Foto della pagina col modello in casa:** una casella «il modello vede le immagini», spenta di default.
- **Il modello in casa nel cloud non è gratis** (decisione presa durante il lavoro, dopo la revisione di sicurezza):
  nel cloud passano solo indirizzi pubblici, quindi il «modello in casa» può essere un servizio a pagamento compatibile
  OpenAI (OpenRouter, Together…). Lì si conta come prezzo non noto, con «≈» e il tetto di spesa attivo; gratis resta
  solo su pannello e IDE locale.

**Ordine di lavoro.** Prima le basi comuni, poi i tre pezzi di backend, poi tutta l'IDE in un solo passaggio, poi i
documenti. Così `client.rs`, `IaTab.tsx` e i file i18n si toccano una volta sola, e servono solo due giri completi di
build e test.

**Se la giornata si allunga, si taglia in quest'ordine:**
1. la scheda della console diventa di sola lettura (il listino si aggiorna lo stesso);
2. il modello in casa nel cloud resta nascosto, e va solo su pannello e IDE locale. Questo taglio va contro una
   decisione, quindi si chiede al maintainer.

---

## F0. Documenti di partenza

- Copiare il piano in `docs/plans/`, con la riga nel README.
- **Micro-seme** `docs/plans/semi/2026-11-17-prova-comparata-dei-modelli.md`, poche righe:
  - l'idea: una sessione di prove fra Claude, Kimi, Mistral e un modello in casa, con `bench_house.sh --real` e il banco
    dei tubi;
  - lì si adatta anche `bench_house.sh`, che oggi esce se non trova un file `*.key`;
  - perché aspetta: il cliente sceglie per fiducia più che per misure;
  - la frase di rito: quando si comincia, prima una sessione di plan.
  - Una riga in `docs/plans/semi/README.md`.
- **Seme dei residui** `docs/plans/semi/2026-11-16-assistente-residui-secondo-giro.md`, e la sua riga nel README dei
  semi (`:32`):
  - «Mistral predefinito nel cloud?» diventa un rimando a questo piano;
  - il punto «Prezzi Mistral» diventa «coperto dal listino aggiornato».

## F1. Basi comuni (Rust, `ai/client.rs` e dintorni)

Tutto il resto dipende da queste modifiche.

- **`Fornitore::Local`** (nome `local`), con tutti i `match` di `client.rs`:
  - `nome`, `da_nome`, `endpoint`, `env_chiave` (`&[]`);
  - `protocol` = `ChatCompletions(&LOCAL)`;
  - `modello_default` = `""`;
  - `file_chiave` = `local.key`;
  - `url_saldo` = None, `bearer` = true, `pensiero_anthropic` = false.
  - Nessun altro file fa `match` su questo enum: `traduttore.rs:212` ne ha uno suo, diverso.
- **`Scelta`** riceve due campi:
  - `endpoint: Option<String>`;
  - `sees_images: bool` (true per i fornitori del cloud).
  - Vanno aggiornati i letterali completi a `client.rs:594`, `:1402` e `scopi.rs:154`.
  - Helper `chat_url(scelta, d)`: se c'è, usa `scelta.endpoint`, altrimenti `d.endpoint` (i test `fake_provider` passano
    ancora il loro dialetto). Si usa a `client.rs:419`, `:851` e `:857`.
- **`chat_completions.rs`:**
  - `pub const LOCAL: Dialect`: `endpoint ""`, `image_url_as_string false`, `tool_ids_alnum9 false`,
    `ask_stream_usage true`, `max_output_tokens 8192`, `assistant_after_tool true`;
  - leggere `delta.reasoning_content` e `delta.reasoning` come `Evento::Pensiero` (vicino a `:417`);
  - se `!scelta.sees_images`, i blocchi immagine della storia diventano il testo «(immagine omessa: il modello non vede
    le immagini)». Serve per una conversazione ripresa dopo il cambio di modello.
- **Un solo client HTTP per gli indirizzi scelti dal cliente:** nuovo `ai/local_http.rs`, `client_for(&Scelta,
  in_cloud)`.
  - Nel cloud:
    - un `dns_resolver` di reqwest che scarta loopback, reti private, link-local, CGNAT e ULA (anche IPv6 con dentro un
      IPv4);
    - rifiuta gli host scritti come IP privati;
    - `redirect(Policy::none())`, come `bfl.rs:196-200`.
  - La logica degli indirizzi parte dall'helper di `limiti.rs:195-199`.
  - Fuori dal cloud è un client normale.
  - **Lo usano tutti e quattro i chiamanti:** la chat (`client.rs:774`), i simboli (`strumenti_scopi.rs:39`), la
    traduzione (`traduttore.rs:544`) e la prova (`scopi.rs:404`).
  - «Nel cloud» si riconosce da `s.segreto_gateway.is_some()` (`router.rs:399-413`), **non** da
    `origine_se_dietro_al_gateway()`, che resta `None` finché non arriva la prima richiesta inoltrata.
- **Il costo dipende dal fornitore:** `costo_usd(provider, model, usage)` e `prezzi_per(provider, model)`.
  - Per `local`: 0 e prezzo noto.
  - Chiamanti:
    - `ai/mod.rs:368` (`resoconto`), `:551` e `:570`;
    - `strumenti_scopi.rs:154`;
    - `traduttore.rs:327`;
    - il test a `chat_completions.rs:834`.
  - In F1 si legge ancora la sola tabella interna; il listino entra in F2.

## F2. Il listino dei prezzi

### Le fonti

Verificato il 17-11-2026: nessun fornitore dà i prezzi via API.

- **Fonte: models.dev** (`https://models.dev/api.json`).
  - Pubblico, licenza MIT, aggiornato ogni giorno.
  - Usa gli id nativi: `anthropic.models["claude-opus-5-5"].cost = {input, output, cache_read, cache_write}` in $/Mtok,
    più `tiers`.
  - Corrisponde al listino di oggi per Opus, Kimi e Mistral.
  - Si leggono solo `anthropic`, `moonshotai` (che diventa `kimi`) e `mistral`.
- **Scartate:**
  - OpenRouter, perché per Kimi dà prezzi di rivendita;
  - LiteLLM, perché per Mistral Large ha il prezzo vecchio;
  - Helicone e llm-prices, perché non sono aggiornati.
- **Immagini:** nessuna fonte le copre, restano a mano.

### Il file e chi lo scrive

- **Nuovo `ai/price_list.rs`.** Il file `config_dir/ai-prices.json` contiene i **prezzi già risolti**:
  `{ version, at_ms, source, last_error, models: provider→model→{input, output, cache_read, cache_write, tier?,
  origin}, images: {openai: quality→usd, bfl: model→{first, next, input}} }`.
  - `origin` vale `manual`, `models.dev` o `builtin`.
- **Chi decide l'ordine dei livelli:** solo chi scrive il file.
  - Nel cloud è il gateway: le righe a mano, poi models.dev, poi la tabella interna.
  - Il container legge il file e, se un modello manca, la sua tabella interna.
  - Così console e container non possono mostrare prezzi diversi.
- **`load(config_dir)` legge il file a ogni calcolo di costo**, senza cache. Una volta per turno costa poco, e un file
  spinto dal gateway vale subito. Un file rotto o assente vuol dire tabella interna.
- **`parse_models_dev`:** una struttura tipizzata con i soli tre provider (serde salta gli altri senza costruirli, niente
  `serde_json::Value` su 6,7 MB).
  - Prezzi mancanti, con le regole di oggi:
    - `cache_write` di Anthropic e Mistral = input × 1,25;
    - Kimi = input;
    - `cache_read` mancante = input / 10.
  - Download limitato a 20 MB, timeout 60 s (reqwest non ha `gzip`).
- **Buon senso, una volta sola, all'aggiornamento:** un prezzo scaricato più di ×5 lontano dalla tabella interna si
  scarta con un `warn`, ma **solo se la tabella interna conosce quel modello** (`known == true`). Un modello nuovo entra
  senza confronto.
- **Fasce** (Haiku 5.5 sopra i 100k token):
  - la soglia si misura su `input + cache_read + cache_creation` della richiesta;
  - sopra la soglia la fascia vale per tutte e quattro le voci, uscita compresa;
  - i numeri si prendono da models.dev, non a memoria.
- **Tabella interna corretta:**
  - la cache in lettura di Sonnet 5.5 costa 0,10, non 0,20;
  - Haiku 5.5 riceve la sua fascia.
  - `prezzi(model)` resta com'è per i test esistenti.
- **Immagini:** `immagini::estimated_usd` (`:51`) legge `images` dal file, poi `costo_stimato`. `bfl::prices` diventa
  `pub(crate)` e fa da ultimo livello.

### Chi aggiorna, e quando

- **Il ciclo** è `price_list::avvia` (modello `ciclo_account.rs:39`), con uno spawn suo in
  `crates/sws-runtime/src/main.rs`, vicino a quello di trash (`:1503-1510`).
  - Gira **sul gateway** e **sulle istanze senza gateway che hanno l'IDE**.
  - **Mai in un container** del cloud (`segreto_gateway.is_some()`).
  - Primo giro dopo 5 minuti, poi ogni 24 ore. Si salta se il file ha meno di 20 ore, così un riavvio non riscarica.
  - Un errore lascia i prezzi com'erano e scrive `last_error`.
- **Spinta nei container**, come la posta in `gateway/progetti.rs`:
  - `write_prices_to_container` all'apertura (vicino a `:582`);
  - `update_prices` sui container già aperti, di tutte le aziende (modello `aggiorna_posta`, `:403`), dopo ogni
    aggiornamento e ogni salvataggio a mano.

### Modifica dalla console della piattaforma

- **API in `amministrazione.rs::rotte_di_piattaforma()`.** Le regole di `check_amministrazione.sh`: solo letterali
  `/api/amministrazione/…`, nessun doppione in `router.rs`.
  - `GET /api/amministrazione/ai-prices`: il file risolto, più le righe a mano così come sono state scritte.
  - `PUT /api/amministrazione/ai-prices`: le righe a mano, in JSON.
    - Validazione: numeri finiti; **niente 0 per un fornitore a pagamento** (uno zero per errore spegnerebbe il tetto di
      spesa).
    - Le righe a mano stanno in `config_dir/ai-prices-manual.json` sul gateway. Dopo il salvataggio si rifà il file
      risolto e lo si spinge.
    - Audit `amministrazione.ai_prices_saved` con l'attore (`Extension<AuthUser>`: lo vuole `check_audit_attore.sh`).
  - `POST /api/amministrazione/ai-prices/refresh`: «Aggiorna ora».
- **Console:** scheda `prezzi-ia` in `console/Console.tsx`, che si tocca in quattro punti:
  - il tipo `Scheda` (`:31`);
  - l'elenco delle schede (`:141`);
  - lo switch (`:160-168`);
  - `SOLO_PIATTAFORMA`, più il filtro `gateway` come `pannelli` (`:143`).
- **Componente `console/AiPrices.tsx`:**
  - una tabella **di sola lettura** dei prezzi in vigore (fornitore, modello, ingresso, uscita, cache in lettura e in
    scrittura, origine) e delle immagini;
  - in testa la data, l'errore e il bottone «Aggiorna ora»;
  - sotto, **un'area di testo JSON con le righe a mano**, salvata da un bottone (lo vuole `check_console_salva.sh`).
    L'errore del server compare sotto.
  - È un terzo del lavoro di un editor a tabella, e i prezzi restano modificabili.
- **i18n:** `console.scheda.prezzi-ia` e il blocco `console.aiPrices`, senza italiano scritto nel codice
  (`check_i18n_ui.sh`).

## F3. Il modello in casa

- **`ai.yaml`:** un campo nuovo al livello più alto di `Impostazioni`, `local: Option<LocalCfg { url, model,
  sees_images }>`. Non va in `ScopoCfg`, che ha `deny_unknown_fields`.
  - La chiave è facoltativa, nel file `local.key`.
  - Niente variabili d'ambiente in questo giro.
- **`resolve_key(Local)`:** c'è solo se ci sono **URL e modello**. Usa la chiave, o `"local"` (Ollama vuole un Bearer
  qualsiasi).
  - `carica_con` e `carica_per_con` riempiono `endpoint` (`<url>/chat/completions`), `modello` (quello dello scopo, poi
    `local.model`) e `sees_images`.
  - **Le correzioni valgono anche per simboli e traduzione, non solo per l'assistente.**
- **Ordine fisso:** Anthropic, Kimi, Mistral, Local. Si aggiornano anche `percorsi_chiave`, il messaggio dei valori
  validi di `SWS_AI_FORNITORE` (`client.rs:570`) e quello «nessuna chiave» (`ai/mod.rs:199-204`), che parla dell'URL e
  non della chiave.
- **`scopi.rs`:**
  - `FORNITORI` passa a 6, con `("local", …, ["assistente","simboli","traduzione"])`;
  - `ha_chiave("local")` vuol dire URL e modello;
  - `prova_chiave` manda `local` a `prova_locale(url, key)` **prima** del controllo della chiave (`:370`).
    `prova_locale` chiama `GET <base>/models` col client di F1 e riusa `model_ids`.
- **Fuori dall'account:**
  - `user_keys::PROVIDERS` resta a 5; il test di `:157` diventa «`FORNITORI` meno `local`»;
  - `ai_keys::provider_known` (`:78`) esclude `local`, per tutte le sue sei rotte;
  - `AI_PROVIDERS` dell'IDE resta senza `local`.
- **Nuova API:** `PUT /api/ai/local` in `config_api.rs` (Admin, solo IDE), con corpo `{url, model, key?, sees_images}`.
  - Valida con `reqwest::Url::parse`: solo http o https.
  - Nel cloud rifiuta subito gli indirizzi privati (stessa logica di `local_http`).
  - La chiave si salva con `segreti::scrivi_chiave`, senza il minimo di 16 caratteri.
  - `GET /api/ai/config` riceve `local: {url, model, sees_images, has_key}`.
- **La foto della pagina:**
  - `tools::Opzioni.no_snapshot`, da aggiungere nei sei letterali (`tools.rs:1607`, `:2048`; `strumenti_scopi.rs:33`,
    `:601`, `:694`; `chat_completions.rs:1207`);
  - `definizioni_per` toglie `istantanea_pagina`;
  - `Contesto::da_con` riceve la `Scelta` dell'assistente (c'è già a `ai/mod.rs:130`);
  - **la guardia** accanto a quella che c'è già a `ai/mod.rs:618`: risponde «questo modello non vede le immagini: usa
    `valida`»;
  - una riga nel prompt quando la foto non c'è.
- **Il contesto troppo piccolo**, nel livello client, perché valga per chat, simboli e traduzione:
  - Ollama sotto i 24 GiB di VRAM carica 4k di contesto e **taglia in silenzio** l'inizio del prompt di sistema. Contare
    i token d'uso non basta: con la cache del prefisso Ollama dà numeri piccoli anche senza taglio.
  - Quindi: `local_http::loaded_context(base, model)` chiede `GET <radice>/api/ps` (Ollama) e
    `GET <radice>/api/v0/models` (LM Studio). Il risultato si tiene in memoria per 60 s.
  - Se il contesto caricato è **più piccolo della stima della richiesta** (caratteri senza le immagini / 4), la
    richiesta **non parte** ed esce un errore chiaro: «contesto del modello N token, la richiesta ne chiede circa M:
    alzalo ad almeno 64k, vedi HOWTO».
  - Un modello non ancora caricato si scopre dopo la prima richiesta: la sua risposta si scarta e si mostra lo stesso
    errore.
  - vLLM e llama.cpp rispondono già 400 da soli: il loro messaggio passa così com'è. Un server che non dice niente non
    viene controllato.
- **Costo nell'IDE:** il messaggio `risorse` porta `fornitore`. Per `local`, `ChatPanel.tsx:355` nasconde «$ / tetto» e
  mostra solo i token.
  - Il limite dei giri resta quello di oggi (`MAX_GIRI_CON_BOZZE = 40`), con il tasto Stop: è una scelta voluta.

## F4. Il fornitore preferito nell'account (backend)

- **`sws-identita`:** tabella `ai_preferences(user_id REFERENCES utenti(id) ON DELETE CASCADE, kind TEXT CHECK(kind IN
  ('text','images')), provider TEXT, PRIMARY KEY(user_id, kind))`.
  - Va in `SCHEMA` con `CREATE TABLE IF NOT EXISTS`, senza migrazione (come `ai_models`).
  - Funzioni `set_ai_preference` e `ai_preferences`.
- **`ai_keys.rs`:**
  - `GET` e `PUT /api/identity/ai-preferences` `{text?, images?}`;
  - validazione: per il testo i fornitori di `assistente` meno `local`; per le immagini quelli di `sfondi`;
  - interna: `GET /api/internal/ai-preferences?user=`, nel gruppo `tunnel_protetto` accanto a `ai-key`
    (`router.rs:1638`). Risponde **sempre 200**, anche coi null, con la stessa finestra di 5 minuti dall'inoltro;
  - **`gateway/ritorno.rs::va_aggiunta`** riceve il percorso nuovo, con il suo test.
- **Container:**
  - `UserKeys` riceve `preferred_text` e `preferred_images`; `fetch_all` fa una GET in più.
  - `client::carica_con`, ramo `None` (`:582`): prima la preferenza, poi l'ordine fisso senza doppioni. Il risultato è
    ambiente > `ai.yaml` > account > ordine fisso. Se la preferenza non ha una chiave, il ciclo passa al fornitore
    successivo.
  - **Un modello salvato senza fornitore** vale solo per il fornitore salvato, come fanno gli sfondi a `scopi.rs:296`.
    Così una preferenza non riceve il modello di un altro fornitore.
  - `scopi::carica_sfondi_con` (`:282-284`): scelta salvata, poi preferenza, poi gli altri.
  - `GET /api/ai/config` riceve `preferito_account: {testo, immagini}`.
- **Due correzioni trovate nel giro:**
  - `config_api.rs:169`: `ha_scelta_propria_con(..., &user_keys)`, altrimenti «eredita» sbaglia nel cloud;
  - la traduzione con l'IA ignora le chiavi e la preferenza dell'account. `traduci_progetto` riceve
    `Extension<AuthUser>` (è nelle rotte admin, `router.rs:467`) e chiama `fetch_all`; `traduci(...)` (`:198`, chiamata
    a `:580`) riceve `UserKeys`; `ia()` usa `carica_per_con`.

## F5. L'IDE, in un solo passaggio

- **`IaTab.tsx`:**
  - scheda `local`:
    - URL (`ia-url-local`, segnaposto `http://localhost:11434/v1`);
    - chiave facoltativa con `CampoPassword` (lo vuole `check_campi_password.sh`);
    - «Prova», che riempie il menu dei modelli;
    - modello;
    - casella «Il modello vede le immagini»;
    - Salva.
  - Righe dell'assistente e degli sfondi: se il progetto non ha scelto, dicono «vale la preferenza del tuo account (X)»,
    oppure «la preferenza X non ha chiave: si usa Y», ricavato da `effettivo`.
- **`MyAiKeys.tsx`:** due menu in testa, «Fornitore preferito per il testo» e «per le immagini», con una voce vuota
  (`my-ai-pref-text`, `my-ai-pref-images`).
- **`api/client.ts`:**
  - `putAiLocal`, `getMyAiPreferences`, `putMyAiPreferences`, `getAiPrices`, `putAiPrices`, `refreshAiPrices`;
  - `/api/identity/ai-preferences` va aggiunto a `sulGateway` (`:827`).
- **`types/index.ts`:** campi nuovi **facoltativi** (`AiConfig.local?`, `preferito_account?`). Il type-check copre
  anche `tests/`.
- **`ChatPanel.tsx`:** il costo nascosto per `local` (vedi F3).
- **Console:** `AiPrices.tsx` (vedi F2).
- **i18n:** `aiProviders.local`, le etichette nuove e `console.aiPrices`, in it ed en, in un colpo solo.

## F6. Documenti e chiusura

- **`docs/HOWTO.md`:**
  - capitolo dei fornitori: quattro per il testo, la precedenza, il listino;
  - nuovo capitolo «Un modello in casa»:
    - Ollama con `OLLAMA_CONTEXT_LENGTH=65536`;
    - vLLM con `--max-model-len 65536 --enable-auto-tool-choice --tool-call-parser <famiglia>`;
    - LM Studio, con il contesto da impostare al caricamento;
    - llama-server con `-c 65536 --jinja --host 0.0.0.0`;
    - la casella delle immagini;
    - nel cloud solo indirizzi pubblici.
- **Testi legali** (`condizioni-d-uso.md:117-118`, `informativa-privacy.md:77-78`, `LEGGIMI.md`): si **cambia l'elenco**
  dei fornitori. Con il modello in casa i testi non escono verso terzi.
- **Altri file:**
  - `CHANGELOG.md`;
  - `NOVITA.yaml` (it/en: modello in casa, preferenza nell'account, listino aggiornato);
  - `STATUS.md`;
  - `docs/COLLAUDI_IN_SOSPESO.md`, una sezione nuova con le voci della Verifica.
- **CasaDomotica:** è una funzione dell'istanza, non del progetto, quindi non c'è un oggetto da aggiungere. Lo si scrive
  nel piano archiviato, come chiede la regola.
- **Fine lavoro:**
  - definition of done completa;
  - i controlli della CI;
  - IDE 8460 ricompilato e riavviato;
  - dopo il collaudo, il piano va in archivio, oppure i suoi residui brevi vanno in un seme.

## Test (da scrivere col codice)

- **Rust:**
  - `price_list`:
    - parse di un estratto vero di models.dev salvato come fixture;
    - regole dei prezzi mancanti;
    - il ×5 solo sui modelli noti;
    - la fascia sul totale dell'ingresso;
    - file rotto → tabella interna;
    - `local` = 0 e noto.
  - La spinta scrive il file nel config del container.
  - Le rotte della piattaforma rifiutano un amministratore d'azienda; lo 0 viene rifiutato.
  - `local`:
    - un turno con strumenti su un fornitore finto con l'URL in `Scelta.endpoint`;
    - Bearer `local` senza chiave;
    - `carica_per_con(Traduzione)` con `local`;
    - contesto piccolo → la richiesta non parte (con un `/api/ps` finto);
    - `no_snapshot` più la guardia;
    - immagini tolte dalla storia.
  - `local_http`: indirizzo privato e redirect rifiutati nel cloud, ammessi fuori.
  - `local` assente da `provider_known` e da `PROVIDERS`.
  - Preferenza:
    - `sws-identita`: salva, toglie, valori strani, cancellazione a cascata;
    - la rotta interna risponde 200 e solo a chi è stato inoltrato;
    - `carica_con`: la preferenza batte l'ordine fisso e perde con `ai.yaml`; preferenza senza chiave → il successivo;
    - lo stesso per gli sfondi;
    - `va_aggiunta`;
    - la traduzione usa la chiave dell'account.
- **Vitest:**
  - `iaTab.test.tsx`: una riga `local` nel `CFG` finto, URL, Prova, casella, la nota della preferenza;
  - `myAiKeys.test.tsx`: finti `getMyAiPreferences` e `putMyAiPreferences`, i due menu salvano, `sulGateway` per il
    percorso nuovo;
  - `aiPrices.test.tsx`: elenca, salva il JSON, mostra l'errore, «Aggiorna ora»;
  - ChatPanel senza costo per `local`.
- **e2e:** la regex di `sws-editor/e2e/fixtures.ts:148` riceve `local|ollama|qwen|llama`.

## Verifica

1. **Automatica:**
   - `cargo check`, `cargo test` (con il viewer LVGL), `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`;
   - quelli della CI: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo audit`, `pnpm lint`,
     `pnpm type-check`.
2. **Modello in casa su theobroma** (niente GPU, 62 GB di RAM): Ollama in un container podman con un modello piccolo
   (per esempio `qwen3:1.7b`, circa 1,4 GB).
   - IDE 8460 → menu IA → Modello in casa: URL e Prova devono elencare il modello.
   - Col contesto di default (4k): **deve comparire l'errore «contesto troppo piccolo»**.
   - Con `OLLAMA_CONTEXT_LENGTH=65536`: **un solo turno di prova**, spesa non mostrata e foto non offerta. Non è un
     criterio di uscita: su CPU può durare minuti, e un modello da 1,7B può sbagliare le chiamate.
   - Container e modello si tolgono a fine prova.
3. **Listino sull'IDE 8460:** `ai-prices.json` si crea al primo giro, con origine models.dev, e la console non mostra la
   scheda.
4. **Dopo il rilascio, nel cloud, con `/test-changes`:**
   - console → Prezzi IA: una riga a mano arriva in un container aperto;
   - un account con le chiavi Anthropic e Mistral e la preferenza Mistral: in un progetto senza scelta la chat usa
     Mistral; con una scelta nel progetto vince il progetto;
   - un URL privato viene rifiutato.
5. **Nessuna chiamata a pagamento** in questa sessione: Mistral, Kimi e FLUX solo con i finti.
