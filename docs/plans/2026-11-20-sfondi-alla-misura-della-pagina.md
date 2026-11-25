# Sfondi generati alla misura della pagina, con l'intervista; il pulsante «Assistente IA» nella barra

> Piano del 20-11-2026, sessione di plan col maintainer, approvato lo stesso giorno. Nasce dal seme dello stesso giorno
> («il generatore di sfondi deve considerare l'orientamento della pagina e le proporzioni perché ora genera una
> immagine landscape e poi la taglia ma il risultato è parziale»), poi la richiesta: «L'ideale è generarlo
> direttamente dalla dimensione della pagina del progetto, inserendo una intervista iniziale che chiede alcune
> informazioni per la generazione, tipo se farlo a risoluzione esatta, o generarlo ad una risoluzione maggiore
> mantenendo le proporzioni e se l'immagine potrà essere usata sia in verticale che orizzontale (ci sono casi in cui
> il progetto viene riadattato)». A metà sessione: «aggiungi anche alla barra degli strumenti il pulsante "Assistente
> IA" che apre direttamente la chat staccata». Ramo `feat/backgrounds-page-size` da `main`. Codice nuovo in inglese.

## Contesto
L'assistente genera gli sfondi sempre a 1536×1024. Su una pagina verticale (TY570, 600×1024) il taglio `cover` ne
lascia circa il 40 %. Il maintainer vuole tre cose:
- lo sfondo generato dalla misura della pagina;
- un'intervista prima di generare: misura esatta, o più grande con le stesse proporzioni;
- uno sfondo che serva anche quando il progetto viene girato da orizzontale a verticale, o al contrario.

In più (messaggio a metà sessione): un pulsante **«Assistente IA»** nella barra degli strumenti che apre subito la
chat staccata. Oggi bisogna passare dai menù.

## Decisioni del maintainer (20-11-2026)
1. **«Più grande» = una volta e mezza** l'area della pagina (600×930 → 900×1395).
2. **Due versi = due immagini**: la seconda è una modifica della prima, ricomposta nell'altro verso. Costa il doppio.
3. **L'intervista sta nella chat**, con la scheda delle domande (`fai_domande`). Lo strumento `genera_sfondo` vuole le
   due scelte, così il modello non può saltarle. Valgono per la conversazione.

## Cosa dicono i fornitori (verificato il 20-11-2026)
- **OpenAI gpt-image-2** (e successivi): misure libere `LxA`, lati multipli di 16, proporzioni fra 1:3 e 3:1, al
  massimo 3840×2160; oltre 2560×1440 è sperimentale. Vale anche per le modifiche (`images/edits`). I modelli
  precedenti (`gpt-image-1*`) accettano solo 1024×1024, 1536×1024 e 1024×1536.
- **FLUX.2 (BFL)**: lati multipli di 16, al massimo 4 MP, nessun limite di proporzioni. Il prezzo va a megapixel.

## Parte 1 — il pulsante «Assistente IA» (primo commit, piccolo)
- `sws-editor/src/editor/EditorToolbar.tsx`: un pulsante in fondo alla barra, con l'icona della scintilla
  dell'assistente (`ICONE_ATTIVITA.ia` in `editor/iconeAttivita.ts`) e la scritta «Assistente IA».
- Al clic chiama `staccaChat()` (`ai/comandiChat.ts`). Se la chat è già staccata porta in primo piano la sua finestra,
  con `apriChat()`, che fa già `finestraChat.current?.focus()` (`App.tsx`). Lo stato viene da `useComandiChat()`.
- Si vede solo con ruolo Admin, come la scheda «Assistente» (`config/schede.ts`, `soloAdmin`).
- Se il browser blocca la finestra resta l'errore che `staccaChatQui` già mostra.
- i18n `toolbar.assistant`, `toolbar.assistantTitle` (it/en).

## Parte 2 — gli sfondi alla misura della pagina

### Le misure (`sws-web/src/ai/`, funzioni pure con test)
- **L'area**: si riusa `floor_plan_tool::page_area`. Diventa `pub(super)` e restituisce anche la misura della pagina,
  per calcolare l'altro verso. Fra testata e piede della cornice, oppure la pagina intera. Per una pagina che non
  esiste ancora: la cornice predefinita e la misura del progetto.
- **L'altro verso**: la pagina girata (H×W) meno le stesse fasce della cornice. 600×1024 con fasce 30+64 → area
  600×930, girata 1024×506.
- **La misura finale**: «esatta» = l'area; «maggiore» = l'area × 1,5, arrotondata, al massimo 4096 per lato
  (`sized_image::MAX_SIDE`).
- **La misura chiesta al fornitore** (`request_size(provider, model, w, h)`):
  - stesse proporzioni, ristrette a 1:3…3:1;
  - lati multipli di 16;
  - almeno ~1 MP, per la qualità: con FLUX si paga comunque 1 MP;
  - FLUX al massimo 4 MP; OpenAI al massimo 2560 di lato e 2560×1440 di pixel;
  - per `gpt-image-1*` il formato fisso più vicino. Un 400 di OpenAI sulla misura riprova una volta col formato
    fisso più vicino (come il ripiego su `response_format`).
- **Dopo il download**: `sized_image::make(jpg, w, h)` (taglio `cover`, JPEG q85) porta l'immagine alla misura finale
  esatta. Non si ingrandisce mai: se il fornitore ha dato meno, la misura finale scende con le stesse proporzioni.
  Lo strumento dice quale misura si è ottenuta.

### La generazione (`immagini.rs`, `strumenti_scopi.rs`, `bfl.rs`)
- Via `DIMENSIONE`, `WIDTH`, `HEIGHT`. `genera(…, w, h)` e `varia(…, w, h)` ricevono la misura. Per OpenAI va nel campo
  `size`, sia nella creazione sia nella modifica multipart.
- `Sfondo` guadagna `w`, `h` e `twin: Option<String>`, cioè l'id della stessa base nell'altro verso.
- **`genera_sfondo`**, parametri nuovi:
  - `pagina` (facoltativo);
  - `misura`: `"esatta" | "maggiore"`, obbligatorio;
  - `due_versi`: booleano, obbligatorio.
- **Con `due_versi`**, per ogni candidata due immagini:
  - prima quella nel verso della pagina;
  - poi la gemella, generata come **modifica** della prima alla misura dell'altro verso, con un testo fisso: stessa
    scena, stessi oggetti e stessa luce, ricomposta per l'inquadratura verticale/orizzontale, si allarga senza
    deformare.
  - Gli id sono `sfondo-xxxxxx-landscape` e `sfondo-xxxxxx-portrait` (file `ai-sfondo-xxxxxx-portrait.jpg`). Le
    varianti di luce tengono il suffisso nel nome (`…-portrait-tramonto`).
  - Il tetto si controlla prima di ogni immagine, come oggi.
- **Approvazione**: «Usa come base» su una base approva anche la gemella (`strumenti_scopi::approva`).
- **`varia_sfondo`**: ogni luce si fa per la base e, se c'è, per la gemella, ognuna alla misura della sua base.
- **Risultato dello strumento**: per ogni immagine `{id, src, w, h, verso, gemella}`. La nota dice come metterle in
  pagina.
- **Costi**: `estimated_usd(config_dir, s, edit, w, h)`.
  - FLUX: `bfl::estimate_with` con la misura chiesta.
  - OpenAI: il prezzo per qualità × max(1, pixel / 1536×1024), sempre per eccesso.

### L'intervista e il testo per il modello
- **`tools.rs`**, `genera_sfondo` / `varia_sfondo`: la descrizione non dice più «1536×1024». Dice:
  - che la misura la calcola il server dalla pagina;
  - che `misura` e `due_versi` li sceglie la persona: se non li ha detti, si chiedono con `fai_domande` prima di
    generare.
- **`prompt.rs`**, una sezione corta «# Sfondi generati»:
  - prima della prima base della conversazione, se la persona non l'ha già detto, `fai_domande` con due domande:
    - «Misura dello sfondo?»: «Esatta, 600×930 (pesa meno)» / «Una volta e mezza, 900×1395 (più nitida)», con le
      misure lette da `elenca_pagine` (`area_libera`);
    - «Servirà anche col progetto girato?»: «No» / «Sì, due immagini (costa il doppio)»;
  - poi `genera_sfondo`;
  - dove va lo sfondo: `sfondo_immagine` per uno fisso; oggetti `image` grandi come l'area per le luci in dissolvenza.

### La proposta e l'IDE
- **`strumenti_scopi::sfondi_della_proposta`**: un'immagine usata dalla proposta si porta dietro la sua gemella. Così
  entrambe arrivano in `images/` del progetto al salvataggio, anche quella che nessuna pagina usa ancora.
- **La scheda nella chat** (`ChatPanel.tsx`, `types/ai.ts`, i18n `chat.sfondo*`):
  - il frame `sfondo` porta `w`, `h`, `verso` e `twin_of`;
  - la miniatura dice «600×930 · verticale»;
  - la gemella compare accanto alla sua base, senza pulsante: si approva con la base.
- **Girare il progetto** (`formatoProgetto.ts::cambioOrientamento` + `formatoProgettoAzioni.ts::cambiaOrientamento`),
  sulle pagine a misura di schermo:
  - `sfondo_immagine` che finisce in `-landscape.jpg` / `-portrait.jpg` passa alla gemella, se il file c'è fra le
    immagini del progetto (l'elenco della libreria immagini);
  - gli oggetti `image` con un `src` così passano alla gemella. Se coprivano esattamente l'area di prima
    (`oggettoSfondoArea`), prendono l'area nuova.
  - Resta una funzione pura, coi test; tutto in un passo della cronologia, come oggi.

## Test
- **Rust**:
  - le misure (area, altro verso, «maggiore», multipli di 16, minimo 1 MP, tetti di FLUX e OpenAI, formati fissi di
    `gpt-image-1`);
  - `genera` con FLUX finto e OpenAI finto (`fake_provider` / il BFL finto di `bfl.rs`): la misura mandata, il JPEG
    finale decodificato alla misura giusta;
  - due versi: la seconda è una modifica con l'immagine della prima;
  - approvare una base approva la gemella; `varia` raddoppia; la proposta porta le gemelle;
  - le stime per misura; il 400 di OpenAI riprova col formato fisso.
  - Si aggiornano i test che oggi presuppongono 1536×1024: `bfl.rs` (`new_image`, `the_estimate_follows_the_megapixels`),
    `immagini.rs` (`the_estimate_follows_the_provider`), `strumenti_scopi.rs`
    (`a_background_enters_both_caps_and_the_history`, `a_flux_task_that_never_ends_is_counted_and_trips_the_cap`).
- **Vitest**:
  - la scheda dello sfondo con misura e gemella (`chatSfondi.test.tsx`);
  - `cambioOrientamento` che scambia `sfondo_immagine` e gli oggetti `image` (`formatoProgetto` test);
  - il pulsante della barra: chiama `staccaChat`, porta in primo piano se già staccata, non c'è senza Admin.

## Documenti
- Il seme diventa piano (`git mv`), con questo testo.
- Manuale, la parte sugli sfondi dell'assistente.
- CHANGELOG `[Unreleased]`; `NOVITA.yaml` (it/en) al rilascio.
- Voci in `COLLAUDI_IN_SOSPESO.md`.
- Da proporre al maintainer per CasaDomotica: uno sfondo rigenerato col flusso nuovo. La chiamata a pagamento la fa
  lui (regola di `CLAUDE.md`, rivista il 25-11-2026).

## Verifica
1. Definition of done: `cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, `pnpm exec vitest run`; e i
   controlli della CI (`cargo fmt --check`, `clippy -D warnings`, `pnpm lint`, `type-check`).
2. Il pulsante sull'IDE 8464: apre la finestra della chat; un secondo clic la porta davanti.
3. Gli sfondi senza spese: con il fornitore finto dei test e sull'IDE 8464, il percorso intero (domande → due
   immagini → «Usa come base» → luci → Applica → Salva → girare il progetto). Niente chiamate a pagamento mie.
4. Collaudo del maintainer sull'IDE 8462 col suo fornitore, sul progetto TY570 verticale. Le due immagini si vedono
   per intero, e dopo «Orientamento» lo sfondo segue.

## Dopo, chiesto dal maintainer: la pulizia dei piani
Finito questo lavoro, un riepilogo di `docs/plans/` (solo lettura, nessuna modifica senza il suo sì):
- per ogni piano vivo, cosa dice la tabella e cosa c'è davvero su `main`;
- quali si possono **chiudere e archiviare** subito: tutto fatto, o restano uno o due punti brevi da spostare in un
  seme, per la regola del 22-10;
- quali si potrebbero **finire in una sessione coordinata**, e con che ordine.

Per esempio galleria, setpoint e navigatore risultano «in corso» con rami già mergiati; animazioni, libreria immagini,
assistente IA e importa SVG sono appena entrati con la catena.

## Fuori da questo piano
- Le due correzioni proposte prima, che aspettano la risposta del maintainer: la selezione gialla sul bordo vero
  nell'IDE, e lo schermo della pagina LVGL che non scorre (la riga grigia).
- La rc.22: dopo il collaudo di questo ramo, salvo che il maintainer la voglia prima.
