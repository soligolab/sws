# La sandbox degli script, secondo giro: espressioni, `_getattr_`, memoria, costi per giro (seme)

> Nato il 10-11-2026 da `Appunti.txt` (punti del 05-11-2026: la revisione della sessione L0 e le misure dei
> valori sul codice), quando il maintainer ha chiesto di trasformare gli appunti in semi e piani e di eliminare
> il file.

> **Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan
> approfondita e dedicata, per sviscerarne tutti i dettagli. Qui ci sono i fatti trovati il 05-11-2026, le
> misure e le opzioni già visibili, non un progetto d'esecuzione.

## Da dove nasce

La sessione L0 del piano [Logica unificata](../../archive/2026-11-04-logica-unificata.md) (ramo `fix/sandbox-python`,
05-11-2026) ha dato alla sandbox Python quello che RestrictedPython riscrive: `print`, `for`, `+=`,
`a, b = …`, le comprensioni, e i builtin `min`, `max`, `sum`, `abs`, `round`, `len`, `list`, `dict`,
`enumerate`, `range`, `any`, `all`, `sorted` (`BUILTIN_AGGIUNTI` in `sws-runtime/crates/sws-pyscript/src/lib.rs`).
È in `main` dal 06-11-2026 (`630a0f30`), nella 2.26.0-rc.2.

Facendo L0 sono saltate fuori cose che L0 **non ha toccato**, di proposito: la revisione del codice ha
trovato buchi nella sandbox, e le misure fatte lo stesso giorno per il seme
[I valori delle variabili sul codice Python](2026-11-05-valori-sul-codice-python.md) hanno dato un costo per
giro e due dettagli di `run_in_python`. Il 04-11-2026 il piano aveva già deciso di lasciare fuori da L0 le
espressioni dei tag: «non è logica che si scrive nell'editor del codice». Tutto questo stava in
`Appunti.txt`; qui è diviso in tre gruppi: **sicurezza**, **costo**, **piccolo e pronto**.

## Com'è fatta oggi la sandbox (per leggere il resto)

Tutto sta in `sws-runtime/crates/sws-pyscript/src/lib.rs`:

- `run_in_python` arma il kill switch (un thread Rust che dorme per il timeout e poi alza un `AtomicBool`),
  costruisce i globali (`NOMI_FORNITI`: `tags`, `print`, `send_telegram`, `now_ms`, `uptime_ms`, `delta_ms`,
  `state`…) e lancia il testo Python `HARNESS` con `py.run`.
- L'harness installa `sys.settrace(__sws_trace__)` (il trace controlla `__sws_kill_switch__.is_set()` a ogni
  evento e alza `KeyboardInterrupt`), poi compila lo script con `compile_restricted`, poi lo esegue con
  `exec(__sws_compiled__, __sws_globals__, {})` dopo aver scambiato `sys.stdout`/`sys.stderr` **del processo**
  con due `StringIO`.
- Il timeout è `DEFAULT_TIMEOUT_MS` = 5 000 ms, modificabile con `SWS_SCRIPT_TIMEOUT_MS`; fuori, `execute_with_args`
  mette anche un `tokio::time::timeout` come rete di sicurezza.
- `eval_expression`, poco sotto, è un'altra strada: valuta il campo `expression` di un tag con `EVAL_HARNESS`
  (un `ast.parse` che assegna l'ultima espressione a `__sws_result__`, poi `exec(compile(...))`).

## A. Sicurezza — quello che la sandbox non chiude

### A1. Le espressioni dei tag girano senza sandbox e senza timeout

`eval_expression` (`sws-runtime/crates/sws-pyscript/src/lib.rs`, la funzione e il suo harness `EVAL_HARNESS`
poco sopra) valuta il campo `expression` di un tag con `eval`/`exec` normale: niente RestrictedPython, niente
`__sws_kill_switch__`, nessun trace. La chiama il ciclo dei tag derivati in
`sws-runtime/crates/sws-runtime/src/main.rs` (dentro `spawn_blocking`, con uno snapshot dei tag).

Un'espressione la scrive chi progetta, come uno script, ma non passa dall'editor del codice: per questo è
rimasta fuori da L0 (decisione del 04-11-2026, nel piano Logica unificata: «Le espressioni dei tag senza
sandbox: proposta: in `Appunti.txt`, con la misura»).

**Da decidere**: la stessa sandbox degli script, o un sottoinsieme ancora più stretto (solo aritmetica e i
tag). Un'espressione gira a ogni cambio dei tag che legge, quindi il costo per giro (gruppo B) qui pesa di più.

### A2. `_getattr_` è `getattr` normale: uno script legge `os.environ`

Nei globali dell'harness c'è `'_getattr_': getattr`, non `safer_getattr` di RestrictedPython. Quindi
`"{0.__class__}".format(x)` arriva agli attributi privati dentro una stringa (si legge, non si chiama). La
revisione di L0 ci è arrivata fino a `os.environ`:
`'{0.__globals__[__loader__]…environ[HOME]}'.format(setattr)` stampa la HOME. C'era già prima di L0: uno
script può leggere le variabili d'ambiente del runtime (fra cui, per esempio, `SWS_ADMIN_PASSWORD`, quando il
runtime parte con quella).

`safer_getattr` lo chiude, ma vieta anche `"...".format(...)`, che negli script esistenti si usa: **va misurato
prima** quanti script e template lo usano, e con che cosa sostituirlo (f-string, `%`).

### A3. Un parametro può coprire una guardia o un nome fornito

Un parametro di funzione può chiamarsi `_print_`, `__builtins__` o `state` e coprire la guardia o il nome
fornito. Rompe solo quella funzione (i parametri entrano nei globali con `__sws_globals__.update(__sws_args__)`
dopo le guardie). `is_valid_python_identifier` in `sws-runtime/crates/sws-web/src/router.rs` (usata al
`PUT /api/project/functions` per `FunctionParam.name`) oggi rifiuta solo le parole chiave di Python: potrebbe
rifiutare anche i nomi che cominciano con `_` e i `NOMI_FORNITI`.

### A4. `sys.stdout`/`sys.stderr` del processo sono condivisi fra due giri

L'harness redirige `sys.stdout`/`sys.stderr` **del processo**, non di quell'esecuzione. Dal 05-11 (L0) il
`print` scrive nello `StringIO` della propria esecuzione (`__sws_out__`) e non si mescola più (test
`i_print_di_due_esecuzioni_non_si_mescolano`), ma:

- due script insieme si scambiano ancora lo **stderr**;
- uno può lasciare `sys.stdout` su un buffer morto, e da lì il `print` non ci passa più. Misurato il 05-11:
  `tags.read` rilascia il GIL, e con due giri sovrapposti il secondo ripristina come «originale» lo `StringIO`
  del primo, così il processo resta con quello. La prova è `tmp/debug-inline/critico_stdout_due_script.py`
  (solo su theobroma), esito: «sys.stdout del processo e' quello vero: False | tipo: StringIO».

### A5. Nessun limite di memoria

`sum(range(10**12))` o `list(range(10**9))` girano in C e non sentono il timeout, come già `pow` e
`'x' * 10**10`: il trace del kill switch vede solo i confini di bytecode Python, e il `tokio::time::timeout`
esterno abbandona il future ma non ferma il thread. Un limite di memoria per gli script non c'è: uno script
sbagliato può portare il runtime del pannello fuori memoria.

## B. Costo per giro

### B1. Il trace del kill switch costa ~6 ms per giro

Il trace è installato **prima** di `compile_restricted`, quindi traccia anche la compilazione: circa 19 000
eventi per giro (14 896 in `ast.py`, 3 974 in `RestrictedPython/transformer.py`), contro i 25 dello script
utente. Sullo script «giornata» di Montagna: **8,7 ms per giro col trace di oggi, 2,9 ms col trace messo subito
prima di `exec`** (misure su x86 nell'immagine 2.25.1: Python 3.12.3, RestrictedPython 8.5, N = 1 000; media
8,704 ms contro 2,875 ms, senza trace 2,830 ms). `compile_restricted` da solo passa da 1,78 ms a 7,35 ms col
trace acceso.

Spostare il trace dopo la compilazione lascia la compilazione senza kill switch: **da decidere** se la
compilazione di uno script può essere lunga abbastanza da servire (è codice nostro e di RestrictedPython, non
dell'utente).

Anche il testo dell'`HARNESS` e `compile_restricted` si ricompilano a ogni giro: `compile(HARNESS)` costa
0,83 ms per giro (`py.run` lo rifà ogni volta), e il bytecode dello script non si tiene fra un giro e l'altro.

Misure in `tmp/debug-inline/esito-py312-container.txt` (solo su theobroma; la stessa prova su Python 3.11.2 e
RestrictedPython 9.0 in `esito-py311.txt`: 5,9 ms contro 2,4 ms). Il seme dei valori sul codice vuole mettere
un raccoglitore sullo stesso trace: le due cose si decidono insieme.

### B2. Ogni giro avvia un thread che dorme per tutto il timeout

`run_in_python` arma il timer del kill switch con `std::thread::spawn` + `std::thread::sleep(timeout)`; il
thread non viene annullato quando lo script finisce prima, e dorme tutti i 5 s. Con `interval_ms` a 50
(campo degli script globali, T-69 fase B) sono circa 100 thread vivi per script. Il commento nel codice li
chiama «cheap (just sleeping)»: è vero per uno script, non per dieci a 50 ms.

## C. Piccolo e pronto

### C1. Lo stdout di un giro fallito si perde

`run_in_python` restituisce solo `Err(String)` quando lo script va in errore o in timeout: lo stdout raccolto
fino a lì non torna a Rust, quindi il `print` di diagnosi non arriva proprio nei giri che vanno male, cioè
quelli in cui serve. Cambio piccolo: restituire stdout e stderr anche con l'errore (`ExecOutput` con l'errore
dentro, o un `Err` strutturato) e scriverli nel log accanto al messaggio.

### C2. Manca `_apply_`

RestrictedPython riscrive `f(*lista)` e `f(**diz)` in `_apply_(f, *lista, **diz)`, e l'harness non lo
fornisce: danno `NameError` sul pannello (sul PC di sviluppo, senza RestrictedPython, funzionano).
RestrictedPython non ha una guardia pronta per `_apply_`: il suo `Guards.py` elenca `apply` fra i wrapper
«provided by ZopeGuards», cioè di Zope, non suoi. Basta `lambda f, *a, **k: f(*a, **k)`, come già `_write_`.
Va aggiunto anche all'elenco del controllo (`/api/script/check`) e coperto da un test con la sandbox vera
(`PYTHONPATH=tmp/venv-rp/lib/python3.11/site-packages`, vedi `STATUS.md`).

### C3. Le costanti di primo livello non si vedono dentro un `def`

Per via di `exec(codice, globali, {})` le assegnazioni di primo livello finiscono nel dizionario locale, e una
funzione definita nello script non le vede. Con un dizionario solo (`exec(codice, globali)`) si vedrebbero,
come in Python normale. Oggi il limite è **documentato** in `schema_python`
(`sws-runtime/crates/sws-web/src/ai/tools.rs`) e in `docs/HOWTO.md` §15 («la tabella di `demo-sim` sta
dentro `wave`» per questo motivo). Cambiarlo è una riga, ma cambia il comportamento degli script che già
girano e i due testi vanno aggiornati: da decidere con A3, perché con un dizionario solo i parametri e le
costanti dell'utente stanno nello stesso posto delle guardie.

## Le opzioni già visibili

1. **Un ramo di sicurezza** (A2, A3, A4, A5): `safer_getattr` dopo aver misurato chi usa `.format`; i nomi
   vietati per i parametri; stdout/stderr per esecuzione invece che per processo (o nessun redirect, visto che
   `print` è già catturato); un tetto di memoria o almeno un avviso. È codice di sicurezza: le guardie restano
   quelle standard di RestrictedPython.
2. **Le espressioni dei tag** (A1): stessa sandbox o sottoinsieme; va misurato prima quante espressioni ci
   sono nei template e in CasaDomotica e cosa usano.
3. **Il costo per giro** (B1, B2): trace dopo la compilazione, bytecode dello script e dell'harness tenuti in
   cache, timer unico invece di un thread per giro. Da misurare sul WP630, non solo su x86.
4. **Le cose piccole** (C1, C2, C3) possono entrare nel primo ramo che tocca `lib.rs`, anche prima della
   sessione di plan, se il maintainer è d'accordo.

## Collaudo (quello che si vedrà)

- Uno script con `'{0.__globals__[__loader__]…environ[HOME]}'.format(setattr)` non stampa la HOME.
- Due script a 50 ms che stampano insieme: nel registro ogni riga ha il nome giusto e nessuno dei due smette
  di stampare dopo minuti.
- `sum(range(10**12))` si ferma col timeout, o il runtime dice che lo script è stato fermato per memoria.
- Il registro mostra il `print` anche quando il giro finisce in errore.
- Il tempo per giro di «giornata» sul WP630, prima e dopo.
