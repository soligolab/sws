# La logica in un posto solo: funzioni, script e ricette — piano d'esecuzione

> **Chiuso e archiviato il 10-11-2026**: L0–L3 fatte (L2 e L3 nella 2.26.0-rc.12). Il cron in UTC è il seme [cron in ora locale](../plans/semi/2026-11-10-cron-in-ora-locale.md); il viewer LVGL che esegue `on_press_fn` è nel piano [oggetti e template](../plans/2026-11-10-oggetti-e-template-parita-lvgl.md); il capitolo del manuale lo scrive M5.
>
> **Stato: piano d'esecuzione, sessioni L0–L3 della [serie coordinata](../plans/README.md#-la-serie-coordinata-del-04-11-2026--lordine-delle-sessioni).**
> Nato come seme il 04-11-2026 da una richiesta del maintainer: «La sezione LOGIC è un po' confusa, ci sono le funzioni
> che sono python e poi un sotto menù "Python" in cui ci sono delle funzioni… unificherei script e funzioni in un
> contesto unico nel ramo principale assieme alle Ricette. Rivedrei meglio i suggerimenti di codice e i template per
> renderli più utili». Diventato piano lo stesso giorno, con la misura del codice (`tmp/piani-misure/logica.md`, solo su
> theobroma). **L1 e L3 dipendono da** [la Finestra di avviso](2026-11-04-finestra-di-avviso.md) (le conferme sulle
> cancellazioni e il `modulo` per «Nuovo da modello»); L0 non dipende da niente.

## Decisioni del maintainer (04-11-2026)

- **Si unisce solo l'interfaccia.** `functions[]`, `global_scripts[]` e `recipes/` restano com'erano nel modello: le
  differenze sono reali (chi li avvia, argomenti contro trigger, l'identità di `state`), e unirle nel modello toccherebbe
  ~14 file Rust, ~21 file TS e il contratto dell'assistente e di MCP, senza niente di visibile in più.

## La misura (04-11-2026)

**Cinque fatti che cambiano il lavoro:**
1. **I default dei parametri non li applica nessuno.** `run_function` usa solo `body.args` (`router.rs:7492-7520`),
   l'harness inietta solo gli argomenti (`sws-pyscript/src/lib.rs:214`), `functions.run` solo i kwargs (`lib.rs:374`);
   la tela passa `on_press_args ?? {}` (`SvgCanvas.tsx:2057-2076`), le celle `{}` (`:6539`). Li riempie solo il
   pannellino di prova (`RuntimeView.tsx:591-633`). In `grid-playground` `fnc_Inc` e `fnc_Toggle` erano su celle: con
   ogni probabilità `NameError: tag`. HOWTO §15 (`:1134`) dice il contrario. (Dal 04-11, sessione T1, le celle usano i
   modi del bottone e il template non ha più funzioni: la prova di L0 va fatta su un progetto di prova.)
2. **La sandbox fornisce solo `_getattr_`, `_getitem_`, `_write_`** (`lib.rs:177-179`). RestrictedPython riscrive
   `print`, `for` e `+=` in `_print_`, `_getiter_`, `_inplacevar_`, che mancano. `NameError: _print_` è già comparso sul
   pannello (`STATUS.md:1758`). Colpisce il corpo predefinito di ogni script nuovo (`print('Hello…')`), 3 frammenti su 6
   e l'esempio di `schema_python`; il controllo dice «ok» su `print` perché lo dichiara fornito (`lib.rs:1193`).
3. **La rotta che compila senza eseguire c'è** (`POST /api/script/check`, `router.rs:717`), e l'editor non la chiama.
4. **LVGL non esegue `on_press_fn`** (`lvgl_render.rs:12676-12679`): un bottone che chiama una funzione funziona solo nel
   viewer web.
5. **I nomi forniti agli script sono scritti in quattro elenchi** che non coincidono: harness (`lib.rs:174-187`),
   controllo (`:1193-1194`, più `print`), `schema_python` (`ai/tools.rs:1115-1146`, senza `functions` e `tr`), il testo di
   `FunctionEditor.tsx:259-262` (senza `tr`).

**L'interfaccia di oggi:**
- Albero classico: **ƒ Funzioni** in cima (`LeftPanel.tsx:2284-2292`); **Python** e **Ricette** foglie di Configurazione →
  Progetto (`config/schede.ts:78`, `:83`). Stile VS Code: la voce **Logica** (`LeftPanel.tsx:2319`) mette già insieme
  Funzioni, `scripts` e `recipes`.
- Le funzioni compaiono in tre elenchi: `FunctionsSection`, `FunctionsInventory` dentro la scheda Python
  (`GlobalScriptsTab.tsx:41-87`), il menu di `EventFunctionPicker` (`EditorShell.tsx:6495-6566`).
- Tre editor diversi: `FunctionEditor.tsx` (344 righe, al posto della tela, senza «prova» né «controlla»),
  `GlobalScriptsTab.tsx` (337), `RecipesTab.tsx` (220). Funzione e ricetta si cancellano senza conferma, e subito su
  disco (`LeftPanel.tsx:2081-2084`, `RecipesTab.tsx:70-75`).
- `PythonEditor.tsx` (125 righe): CodeMirror 6 con `lang-python`, **senza `autocompletion()` né `linter()`**.
  `@codemirror/autocomplete` e `@codemirror/lint` sono nel lockfile ma non in `package.json`.
- Modelli: sei `SNIPPETS` in `FunctionEditor.tsx:308-344`, in inglese, coi tag inventati (`counter`, `light`,
  `input_a`); gli script non ne hanno. Nessun template fa logica d'impianto vera.
- Altri difetti: ricerca degli usi e rinomina dei tag non leggono il codice delle funzioni (`tagUsage.ts:134-140`,
  `rinominaTag.ts:285-300`); rinominare una funzione non aggiorna `on_press_fn`/`on_release_fn`; i rilievi su
  `project.functions[...]` non sono cliccabili (`rilievoDestinazione.ts:15-26`); il commento su `log(msg)`
  (`project.rs:1835`), «undici» strumenti in `mcp.rs:6` (sono 13), un componente morto citato in `PythonEditor.tsx:27`.
- Fuori piano ma trovato: le espressioni dei tag (`eval_expression`, `lib.rs:918-975`) girano **senza sandbox e senza
  timeout**.

## Le sessioni

**L0 — `fix/sandbox-python`: la sandbox e i default (Rust, piccola).** — *fatta il 05-11-2026 sul ramo; la revisione ha trovato il `print` che si mescolava fra due script insieme e `flush=True`, corretti. Collaudo sull'immagine.*
- L'harness fornisce `_print_` (PrintCollector), `_getiter_`, `_iter_unpack_sequence_`, `_inplacevar_`; i builtin sicuri
  che mancano (vedi decisioni).
- **Una costante Rust sola** coi nomi forniti, usata dall'harness, dal controllo e da `schema_python`; una rotta GET che
  la espone all'IDE (serve a L2).
- I default dei parametri applicati lato server, in `run_function` e in `functions.run`.
- `schema_python` corretto (`functions`, `tr`, i parametri come globali, le costanti fuori dai `def`); HOWTO §15.
- Test in `sws-pyscript`: `print`, `for`, `+=`, una funzione chiamata senza argomenti che usa il default.
- Prova del maintainer: su un pannello, uno script col `print` e un `for`; un bottone che chiama una funzione con un
  parametro lasciato al predefinito (in un progetto di prova: `grid-playground` non ha più funzioni dal 04-11).
- **Immagine** (cambia il runtime).

**L1 — `feat/logica-un-ramo`: un ramo solo.**
- Un ramo **Logica** con tre gruppi (Funzioni, Script, Ricette) nei due stili dell'IDE; nell'albero classico al posto di
  «ƒ Funzioni», e Python e Ricette escono da Configurazione → Progetto.
- Un editor solo per funzioni e script: a destra il codice, a sinistra nome, descrizione e parametri (funzione) o nome,
  abilitato e trigger (script). Bottoni **Controlla** (`POST /api/script/check`) e **Prova** (per le funzioni, come il
  pannellino del viewer).
- Via `FunctionsInventory`, i rimandi a «Configurazione → Python» (`it.json:2173`, i commenti di `demo-items-*`).
- Le cancellazioni con `conferma` (dalla Finestra di avviso); `description?` su `GlobalScriptDef` (campo nuovo e
  facoltativo: il formato vecchio si legge uguale).
- I difetti piccoli del §misura: rinomina di una funzione che aggiorna le pagine, ricerca e rinomina dei tag nel codice
  delle funzioni, rilievi cliccabili, i commenti sbagliati.
- Test: `pannelloSinistro.test.tsx` (ordine e foglie), uno nuovo sulla rinomina di una funzione.

*Fatta l'08-11-2026 sul ramo `feat/logica-un-ramo`, annidato su I2.* Decisioni del maintainer quel giorno: **l'editor
si apre al centro** (come le funzioni), quindi anche gli script escono dalla Configurazione; **l'avviso LVGL** sul
bottone, e il viewer LVGL che esegue `on_press_fn` nel piano [oggetti e template](../plans/2026-11-10-oggetti-e-template-parita-lvgl.md) (dal 10-11-2026). Fatto: `editor/LogicaEditor.tsx` (funzioni e
script, Controlla, Prova con conferma, i rilievi cliccabili portano alla riga), la sezione Logica nei due stili
(Funzioni, Script, Ricette; cancellazioni con conferma), gli script nello store (`selectedScriptId`, scritti dal Salva
unico solo se cambiati: `scriptCambiati`), `description?` su `GlobalScriptDef`, la rinomina di una funzione che
aggiorna le chiamate (`logica/rinominaFunzione.ts`), il codice delle funzioni nella ricerca degli usi e nella rinomina
dei tag, i rilievi su `functions`/`global_scripts` che aprono l'editor, la scheda `scripts` ridotta a un rimando (gli
id restano, decisione L1.1), i commenti sbagliati. `FunctionEditor.tsx` e `FunctionsInventory` non ci sono più.

**L2 — `feat/logica-completamento`: i suggerimenti mentre si scrive.**
- `@codemirror/autocomplete` e `@codemirror/lint` in `package.json`.
- In quest'ordine: `tags.read("`/`tags.write("` propongono i tag di `tagCatalog` (foglie comprese, tipo, unità,
  descrizione; per `write` niente tag calcolati né non scrivibili); i nomi forniti dalla rotta di L0 coi parametri della
  funzione aperta, al posto di `globalCompletion` (che propone `import` e `class`); `functions.run("` coi nomi e poi i
  parametri, solo negli script; `tr("` con le chiavi lingua.
- Gli avvisi della sandbox mentre si scrive (chiamata ritardata a `/api/script/check`), più un avviso lato client sui tag
  non dichiarati (la regex `EXPR_RE` c'è già).
- Test vitest sulle sorgenti di completamento.

*Fatta il 10-11-2026 sul ramo `feat/logica-l2-l3` (insieme a L3, 8e3380cd).* Decisioni del maintainer quel giorno
(«ok» alle proposte): il valore live **sì**, nel riquadro della voce («ora: 21.5»; `TagInput` in realtà non lo mostra,
l'ha preso da `tagValues`); gli avvisi **600 ms** dopo l'ultima battuta. Fatto: `logica/completamento.ts` (tre
sorgenti più `localCompletionSource` di `lang-python`, in `autocompletion({ override })`, quindi niente più
`globalCompletion`), `logica/avvisi.ts` (un linter solo: i rilievi di `/api/script/check` come errori sulla riga, e
gli avvisi dell'IDE sui tag che il progetto non ha o calcolati e scritti, con `EXPR_RE` esportata da `tagUsage.ts`),
`PythonEditor` con `estensioni`, `api.nomiScript()` (chiesta una volta per sessione; anche l'aiuto «Nomi già pronti»
ora la legge, invece del suo elenco a mano). «Non scrivibili» per `tags.write` vuol dire: `expression`, `generator`
attivo, registri Modbus `input`/`discrete`, tag S7/EtherNet-IP e metriche Sparkplug con `writable: false`. Dopo
`tags.`, `state.`, `functions.` si propongono i metodi; le parole di Python proposte sono quelle utili (niente
`import`, `class`, `try`, `with`). Test: `tests/logicaCompletamento.test.ts`.

**L3 — `feat/logica-modelli`: «Nuovo da modello».**
- «Nuovo da modello» con un `modulo` della Finestra di avviso: si sceglie il modello, poi i tag del progetto con
  `TagInput`; il codice nasce coi tag veri. Nella lingua dell'IDE.
- I modelli, dai dieci della misura: contaore di marcia, contapezzi, uscita con isteresi, filtro, ritardo all'inserzione
  (TON), comando a orario, azzeramento a mezzanotte (script che chiama una funzione usata anche da un pulsante),
  alternanza pompe, valore con limiti, avviso Telegram con antirimbalzo. Al posto dei sei `SNIPPETS`.
- **CasaDomotica**: contaore, comando a orario e avviso Telegram (regola di `CLAUDE.md`). Il contapezzi, il TON e
  l'alternanza pompe non hanno un posto in un impianto domestico: si annota.
- Il piano si archivia; il capitolo del manuale sulla Logica lo scrive M5.
- **Immagine.**

*Fatta il 10-11-2026 sul ramo `feat/logica-l2-l3` (8e3380cd).* Decisioni: **tutti e dieci** i modelli;
`recipes.apply(id)` da Python **no**; un file per modello. Fatto: `sws-editor/src/logica/modelli/*.py` (Python che
compila già così, con quattro segnaposto: `{{tag:x}}` il tag scelto, `{{nome:k}}` il nome di funzione o script reso
unico nel progetto, `{{id:k}}` i nomi Python e `{{t:k}}` i commenti nella lingua dell'IDE, da
`logicaModelli.<modello>` di it/en.json; le righe `#@` dicono cosa nasce: `tag`, `funzione`, `script`, `parametro`,
`trigger`), `modelli/index.ts` (lettura e `istanzia`), `logica/NuovoDaModello.tsx` (il `modulo` in due passi: il
modello, poi i tag con `TagInput`), «+ Nuovo da modello…» in fondo ai gruppi della sezione Logica,
`aggiungiDaModello` nello store (le funzioni si scrivono subito come con «+ Nuova funzione», gli script col Salva). Un
modello può far nascere più pezzi: il comando a orario è due script (accensione e spegnimento), l'azzeramento a
mezzanotte una funzione e lo script cron che la chiama. Tolti i sei `SNIPPETS` e le loro chiavi.
**La prova che girano** non chiede uno stack acceso: `i_modelli_dell_ide_girano` in `sws-pyscript` legge i file,
li passa a `Engine::check` (lo stesso di `/api/script/check`) e li **esegue** due volte ciascuno, coi tag letti a 1 e
le funzioni nel registro; verde anche con RestrictedPython vero (`PYTHONPATH` su un venv, come dice
`tests_sandbox_l0`). **Trovato**: il cron degli script è in **UTC** (`cron.rs:300`), e niente nell'IDE lo dice; i
modelli col cron lo scrivono in un commento. Non corretto qui: se va detto nel campo del trigger, o se il cron deve
passare all'ora locale, è una scelta del maintainer.

**CasaDomotica** (la fa il maintainer, sul VPS): ci vanno il **contaore** (una pompa o la caldaia), il **comando a
orario** (una luce o l'irrigazione) e l'**avviso Telegram con antirimbalzo** (un allarme vero). Il **contapezzi**, il
**ritardo all'inserzione (TON)** e l'**alternanza pompe** non hanno un posto in un impianto domestico: sono logica da
macchina e da centrale di pompaggio, che dice per chi sono davvero.

## Da decidere all'inizio di ogni sessione

La proposta vale se il maintainer non dice altro.

**L0**
1. Quali builtin: *proposta: `min`, `max`, `sum`, `abs`, `round`, `len`, `list`, `dict`, `enumerate`, `range`, `any`,
   `all`, `sorted`* (nessuno tocca file, rete o interprete).
2. Dove va il testo di `print`: *proposta: nel log del runtime col nome della funzione o dello script, e per una funzione
   anche nella risposta HTTP (la vede «Prova»).*
3. Le espressioni dei tag senza sandbox: *proposta: nel seme [la sandbox, secondo giro](../plans/semi/2026-11-10-sandbox-degli-script-secondo-giro.md),
   con la misura; non è logica che si scrive nell'editor del codice.*

**L1**
1. Gli id delle schede `scripts` e `recipes`: *proposta: restano* (deep link, test, l'aiuto per schermata di M4).
2. LVGL che non esegue `on_press_fn`: *proposta: un avviso nell'editor sul bottone, quando il progetto è LVGL; il viewer
   LVGL nel piano [oggetti e template](../plans/2026-11-10-oggetti-e-template-parita-lvgl.md).*

**L2**
1. Il completamento mostra il valore live del tag? *Proposta: sì, se c'è, come `TagInput`.*
2. Ogni quanto gli avvisi: *proposta: 600 ms dopo l'ultima battuta.*

**L3**
1. Quali modelli: *proposta: tutti e dieci.*
2. `recipes.apply(id)` da Python (oggi non esiste): *proposta: no in questa serie; se servirà, diventa un seme in `semi/`.*
3. Dove stanno i modelli: *proposta: un file per modello in `sws-editor/src/logica/modelli/`, con i segnaposto dei tag
   dichiarati; un test che li compila tutti con `/api/script/check` a stack acceso.*

## Rischi

- La sandbox allargata (L0) è codice di sicurezza: le guardie sono quelle standard di RestrictedPython
  (`Guards.guarded_iter_unpack_sequence`, `PrintCollector`); `_inplacevar_` non deve aprire attributi privati.
- L'assistente legge le funzioni e gli script (`leggi_script`, `schema_python`): L0 cambia quello che gli si dice, e il
  contratto degli strumenti resta uguale.
- Manuale: 04:40, 04:141, 04:223-226, 04:250-260, 04:315, 04:756-769, 05:164, 05:882, 05:898, 07:369-373, 09:219-230,
  15:191-193, la schermata `03_left_panel.png` (M5).
