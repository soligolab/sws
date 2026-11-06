//! PyO3 bridge for user scripts attached to synoptic objects.
//!
//! Execution model:
//! - User source runs on `tokio::task::spawn_blocking`, wrapped in a
//!   `tokio::time::timeout` (default 5 s, override via `SWS_SCRIPT_TIMEOUT_MS`).
//! - A Python harness wraps the user source: it compiles it (restricted
//!   if RestrictedPython is importable, plain `compile` otherwise),
//!   redirects `sys.stdout` / `sys.stderr` into in-memory `StringIO`s,
//!   execs in a fresh globals dict with `tags` injected, then hands the
//!   captures back to Rust through globals.
//! - The result includes `stdout`, `stderr`, and an `error` traceback if
//!   any. A timeout returns `Err(...)` with a clear message.
//!
//! Sandboxing:
//! - If `RestrictedPython` is installed in the Python environment used by
//!   PyO3 at startup, scripts are compiled with `compile_restricted` and
//!   exec'd against `safe_builtins`. This blocks `import`, attribute
//!   access on `_`-prefixed names, exec/eval, file I/O via builtins.
//! - If it is not installed, the engine logs a warning at startup and
//!   falls back to unrestricted `compile`. Same API surface, no safety.
//! - Install: `pip install RestrictedPython` (also documented in the
//!   project README / OPEN_QUESTIONS Q1).

use pyo3::prelude::*;
use pyo3::types::PyDict;
use serde::Serialize;
use std::{
    ffi::CString,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sws_core::{FunctionDef, TagDb, TagQuality, TagValue, TagWriteBus};
use tokio::runtime::Handle;
use tokio::sync::mpsc;

/// T-69 fase C: stesso tipo concreto di `FunctionsRegistry` in
/// `sws-web/src/router.rs` (`Arc<tokio::sync::RwLock<HashMap<String,
/// FunctionDef>>>`) — un alias qui, non un tipo nuovo, così `sws-web` passa
/// `s.functions.clone()` senza conversioni. Non è una dipendenza all'indietro
/// da `sws-web`: `FunctionDef` vive già in `sws-core`, di cui questo crate è
/// già cliente per `TagDb`/`TagValue`.
pub type FunctionsRegistry =
    Arc<tokio::sync::RwLock<std::collections::HashMap<String, FunctionDef>>>;

/// Un nome che uno script o una funzione trova già pronto, senza `import`.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct NomeFornito {
    pub nome: &'static str,
    /// Come si scrive: la firma, non una spiegazione. È quello che l'IDE mostra
    /// accanto al nome (la spiegazione, nella sua lingua, la mette l'IDE).
    pub uso: &'static str,
    /// La spiegazione per l'assistente (`schema_python`), in italiano come il
    /// resto dei suoi strumenti.
    #[serde(skip)]
    pub cosa: &'static str,
}

/// **L'elenco unico** dei nomi forniti (L0, 05-11-2026). Prima erano quattro
/// elenchi che non coincidevano: l'harness, il controllo (che aveva `print` in
/// più), `schema_python` (senza `functions` e `tr`) e il testo dell'editor.
/// Ora l'harness costruisce i suoi globali scorrendo questo elenco
/// (`run_in_python`), il controllo lo riceve, `schema_python` lo legge e la
/// rotta `GET /api/script/nomi` lo dà all'IDE.
pub const NOMI_FORNITI: &[NomeFornito] = &[
    NomeFornito {
        nome: "tags",
        uso: "tags.read(id) · tags.write(id, valore)",
        cosa: "I tag del progetto. `tags.read('id')` legge (None se il tag non esiste), \
               `tags.write('id', valore)` scrive. NON è indicizzabile: `tags['id']` solleva \
               TypeError, non è mai stato il modo giusto. Un tag con `expression` o con \
               `generator` attivo è calcolato: scriverlo viene rifiutato.",
    },
    NomeFornito {
        nome: "print",
        uso: "print(...)",
        cosa: "Il testo va nel log del runtime, col nome dello script o della funzione, e \
               per una funzione anche nella risposta (la vede «Prova»). Serve per la \
               diagnosi, non per comunicare con l'operatore.",
    },
    NomeFornito {
        nome: "send_telegram",
        uso: "send_telegram(testo)",
        cosa: "`send_telegram('testo')`. Funziona solo se il canale Telegram è configurato \
               nelle notifiche del progetto.",
    },
    NomeFornito {
        nome: "now_ms",
        uso: "now_ms()",
        cosa: "`now_ms()` — millisecondi dall'epoch Unix (T-69). Congelato all'inizio di \
               questa esecuzione, non cambia se chiamato più volte nello stesso giro.",
    },
    NomeFornito {
        nome: "uptime_ms",
        uso: "uptime_ms()",
        cosa: "`uptime_ms()` — millisecondi dalla PRIMA volta che questo script/funzione è \
               girato in questo processo (T-69), non dall'avvio del runtime.",
    },
    NomeFornito {
        nome: "delta_ms",
        uso: "delta_ms()",
        cosa: "`delta_ms()` — millisecondi dall'ULTIMA invocazione di questo script/funzione \
               (T-69). Vale 0 al primo giro: una rampa scritta come `pos += delta_ms() / \
               periodo` resta ferma al primo giro invece di saltare, e si muove a cadenza \
               reale indipendente da quanto spesso il trigger la richiama.",
    },
    NomeFornito {
        nome: "state",
        uso: "state.get(chiave, default=None) · state.set(chiave, valore)",
        cosa: "`state.get('chiave', default=None)` / `state.set('chiave', valore)` (T-69) — \
               memoria persistente fra un giro e l'altro dello STESSO script/funzione (es. la \
               direzione di una rampa), senza bisogno di un tag di servizio. Solo \
               bool/int/float/str. Si perde al riavvio del runtime: un contatore che deve \
               sopravvivere va in un tag.",
    },
    NomeFornito {
        nome: "functions",
        uso: "functions.run(nome, **parametri)",
        cosa: "`functions.run('nome', parametro=valore)` — esegue una funzione di progetto \
               dentro lo stesso processo, coi default per i parametri non passati. Solo dagli \
               script globali: da dentro un'altra funzione solleva un errore esplicito.",
    },
    NomeFornito {
        nome: "tr",
        uso: "tr(chiave)",
        cosa: "`tr('chiave')` — il segnaposto `{{chiave}}` della tabella lingue: scritto in un \
               tag di testo, il pannello lo mostra nella lingua di chi guarda. Non traduce \
               qui: restituisce il segnaposto.",
    },
];

/// I builtin che la sandbox aggiunge a `safe_builtins` di RestrictedPython
/// (L0, decisione del 04-11-2026). `safe_builtins` non ha `min`, `max`, `sum`,
/// `list`, `enumerate`…, e la gente li scrive senza pensarci; nessuno di questi
/// tocca file, rete o interprete. `abs`, `round`, `len` e `range` ci sono già:
/// stanno qui lo stesso perché questo è l'elenco promesso, non la differenza.
pub const BUILTIN_AGGIUNTI: &[&str] = &[
    "min",
    "max",
    "sum",
    "abs",
    "round",
    "len",
    "list",
    "dict",
    "enumerate",
    "range",
    "any",
    "all",
    "sorted",
];

/// I nomi di `NOMI_FORNITI`, per i due harness.
fn nomi_forniti() -> Vec<&'static str> {
    NOMI_FORNITI.iter().map(|n| n.nome).collect()
}

/// `TagValue` → oggetto Python. Una sola conversione per i quattro tipi: prima
/// la stessa `match` viveva in due punti del file, e ogni cambio di API pyo3
/// andava fatto due volte (pyo3 0.25: `into_py` è sparito a favore di
/// `IntoPyObject`, che può fallire — qui non fallisce mai per scalari, e
/// l'`expect` lo dichiara invece di nasconderlo in un `unwrap`).
fn tag_value_to_py(py: Python<'_>, v: &TagValue) -> Py<PyAny> {
    use pyo3::IntoPyObject;
    match v {
        TagValue::Bool(b) => b
            .into_pyobject(py)
            .expect("bool → Python non fallisce")
            .to_owned()
            .into_any()
            .unbind(),
        TagValue::Int(i) => i
            .into_pyobject(py)
            .expect("i64 → Python non fallisce")
            .into_any()
            .unbind(),
        TagValue::Float(f) => f
            .into_pyobject(py)
            .expect("f64 → Python non fallisce")
            .into_any()
            .unbind(),
        TagValue::Str(s) => s
            .as_str()
            .into_pyobject(py)
            .expect("str → Python non fallisce")
            .into_any()
            .unbind(),
        // Fase 1b: un array diventa una `list`, una struttura un `dict` —
        // ricorsivamente. Uno script legge `tags["motore1"]["velocita"]` o,
        // se preferisce, la foglia `tags["motore1.velocita"]`: lo snapshot
        // porta entrambe.
        TagValue::Array(a) => {
            let lista = pyo3::types::PyList::empty(py);
            for x in a {
                lista
                    .append(tag_value_to_py(py, x))
                    .expect("list.append non fallisce");
            }
            lista.into_any().unbind()
        }
        TagValue::Struct(m) => {
            let d = pyo3::types::PyDict::new(py);
            for (k, v) in m {
                d.set_item(k.as_str(), tag_value_to_py(py, v))
                    .expect("dict.set_item non fallisce");
            }
            d.into_any().unbind()
        }
    }
}

/// `serde_json::Value` → oggetto Python, scalari soli: array/oggetti/null
/// diventano la loro resa testuale, così lo script vede *qualcosa* (il contratto
/// dei parametri delle funzioni è già validato lato server come scalari).
fn json_to_py(py: Python<'_>, v: &serde_json::Value) -> Py<PyAny> {
    use pyo3::IntoPyObject;
    let s: String = match v {
        serde_json::Value::Bool(b) => {
            return b
                .into_pyobject(py)
                .expect("bool")
                .to_owned()
                .into_any()
                .unbind()
        }
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                return i.into_pyobject(py).expect("i64").into_any().unbind();
            }
            if let Some(f) = n.as_f64() {
                return f.into_pyobject(py).expect("f64").into_any().unbind();
            }
            n.to_string()
        }
        serde_json::Value::String(t) => t.clone(),
        other => other.to_string(),
    };
    s.as_str()
        .into_pyobject(py)
        .expect("str")
        .into_any()
        .unbind()
}
use tracing::{debug, info, warn};

const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Wraps the user source in stdout/stderr capture + restricted compile.
/// The user source is injected as `__sws_user_source__` (a Python str)
/// alongside `__sws_sandbox__` (a bool flag), `__sws_api__` (the objects of
/// `NOMI_FORNITI`, by name), `__sws_builtin_aggiunti__` (`BUILTIN_AGGIUNTI`)
/// and `__sws_kill_switch__` (a Rust-backed object polled by the trace fn).
///
/// In the sandbox branch the globals also carry the guards RestrictedPython
/// rewrites code into: `_print_`, `_getiter_` (`for`, comprehensions),
/// `_iter_unpack_sequence_` / `_unpack_sequence_` (`for a, b in …`,
/// `a, b = …`) and `_inplacevar_` (`+=`). Until L0 (05-11-2026) only
/// `_getattr_`, `_getitem_` and `_write_` were there, so `print`, `for` and
/// `+=` failed with `NameError` on every panel — and passed on a development
/// PC, where RestrictedPython is usually missing.
///
/// Top-level assignments land in the throw-away locals dict of
/// `exec(code, globals, {})`, so a `def` in the script does not see them:
/// `schema_python` says so, and `demo-sim` keeps its table inside the `def`.
///
/// Preemption: `sys.settrace` installs a per-bytecode-boundary trace function
/// that checks `__sws_kill_switch__.is_set()`.  A Rust timer thread sets the
/// switch after `SWS_SCRIPT_TIMEOUT_MS`.  On detection, `KeyboardInterrupt`
/// is raised and caught by the inner `except KeyboardInterrupt` clause, which
/// sets a clean timeout error string.  The outer `finally` always clears the
/// trace so the `spawn_blocking` thread is left in a sane state.
///
/// Limitation: the trace fires at Python-bytecode boundaries only.  Blocking
/// C extensions (e.g., a `time.sleep(100)`) are not interrupted; the Tokio-
/// level timeout is the hard backstop for those cases (it drops the future
/// and the thread is eventually reclaimed by the `spawn_blocking` pool).
const HARNESS: &str = r#"
import io, sys, traceback

# ── Soft preemption ───────────────────────────────────────────────────────────
# Fires at every Python call/line/return event.  Cost is one `is_set()` call
# (an atomic load) per bytecode boundary — negligible for SCADA scripts.
def __sws_trace__(frame, event, arg):
    if __sws_kill_switch__.is_set():
        raise KeyboardInterrupt("SWS script timeout")
    return __sws_trace__
sys.settrace(__sws_trace__)

# ── I/O capture and execution ────────────────────────────────────────────────
__sws_out__ = io.StringIO()
__sws_err__ = io.StringIO()
__sws_error__ = None
__sws_compiled__ = None

try:
    if __sws_sandbox__:
        import builtins as __sws_b__, operator as __sws_op__, warnings as __sws_w__
        from RestrictedPython import compile_restricted, safe_builtins
        from RestrictedPython.Eval import default_guarded_getiter
        from RestrictedPython.Guards import guarded_iter_unpack_sequence, guarded_unpack_sequence
        from RestrictedPython.PrintCollector import PrintCollector

        # `print` riscritto da RestrictedPython: raccoglie in `printed` come
        # vuole lei, e scrive anche nello stdout catturato **di questa
        # esecuzione**, dove lo legge Rust (il log, e la risposta di una
        # funzione). Senza `_print_` il primo `print` dava NameError (L0,
        # 05-11-2026). `__sws_out__` e non `sys.stdout`: quello è del processo,
        # e due script che girano insieme (`tags.read` rilascia il GIL) si
        # mescolavano i testi. `flush` perché `print(..., flush=True)` lo chiede.
        class __SwsPrint__(PrintCollector):
            def write(self, text):
                PrintCollector.write(self, text)
                __sws_out__.write(text)
            def flush(self):
                pass

        # `x += 1` diventa `x = _inplacevar_('+=', x, 1)`. RestrictedPython lo
        # chiede solo per i nomi: `a.b += 1` e `a[k] += 1` li rifiuta già in
        # compilazione, quindi qui non passa mai un attributo.
        __sws_inplace__ = {
            '+=': __sws_op__.iadd, '-=': __sws_op__.isub, '*=': __sws_op__.imul,
            '/=': __sws_op__.itruediv, '//=': __sws_op__.ifloordiv, '%=': __sws_op__.imod,
            '**=': __sws_op__.ipow, '<<=': __sws_op__.ilshift, '>>=': __sws_op__.irshift,
            '&=': __sws_op__.iand, '|=': __sws_op__.ior, '^=': __sws_op__.ixor,
        }
        def __sws_inplacevar__(op, x, y):
            f = __sws_inplace__.get(op)
            if f is None:
                raise SyntaxError(f'operatore {op} non disponibile nella sandbox')
            return f(x, y)

        __sws_builtins__ = dict(safe_builtins)
        for __sws_n__ in __sws_builtin_aggiunti__:
            __sws_builtins__[__sws_n__] = getattr(__sws_b__, __sws_n__)

        __sws_globals__ = {
            '__builtins__': __sws_builtins__,
            '_getattr_':   getattr,
            '_getitem_':   lambda o, k: o[k],
            '_write_':     lambda x: x,
            '_print_':     __SwsPrint__,
            '_getiter_':   default_guarded_getiter,
            '_iter_unpack_sequence_': guarded_iter_unpack_sequence,
            '_unpack_sequence_':      guarded_unpack_sequence,
            '_inplacevar_': __sws_inplacevar__,
        }
        __sws_globals__.update(__sws_api__)
        try:
            # Gli avvisi di RestrictedPython («Prints, but never reads
            # 'printed'») sono benigni e finirebbero sullo stderr del processo
            # a ogni giro: lo stesso filtro del controllo.
            with __sws_w__.catch_warnings():
                __sws_w__.simplefilter('ignore')
                __sws_compiled__ = compile_restricted(__sws_user_source__, '<inline>', 'exec')
        except SyntaxError as _e:
            __sws_error__ = f'SyntaxError: {_e}'
    else:
        # Lo stesso `print` della sandbox: nello stdout di questa esecuzione,
        # non in `sys.stdout`, che è del processo.
        def __sws_print__(*a, **k):
            if k.get('file') is None:
                k['file'] = __sws_out__
            print(*a, **k)
        __sws_globals__ = {'__builtins__': __builtins__}
        __sws_globals__.update(__sws_api__)
        __sws_globals__['print'] = __sws_print__
        try:
            __sws_compiled__ = compile(__sws_user_source__, '<inline>', 'exec')
        except SyntaxError as _e:
            __sws_error__ = f'SyntaxError: {_e}'

    # Inject per-call arguments as plain globals.  `__sws_args__` is always a
    # dict (possibly empty).  Param-name safety is enforced server-side at PUT
    # /api/project/functions so we don't have to filter keywords here.
    if isinstance(__sws_args__, dict):
        __sws_globals__.update(__sws_args__)

    if __sws_compiled__ is not None:
        _orig_out, _orig_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = __sws_out__, __sws_err__
        try:
            exec(__sws_compiled__, __sws_globals__, {})
        except KeyboardInterrupt:
            __sws_error__ = 'TimeoutError: script exceeded the configured timeout (SWS_SCRIPT_TIMEOUT_MS)'
        except BaseException:
            __sws_error__ = traceback.format_exc()
        finally:
            sys.stdout, sys.stderr = _orig_out, _orig_err
finally:
    sys.settrace(None)

__sws_stdout_capture__ = __sws_out__.getvalue()
__sws_stderr_capture__ = __sws_err__.getvalue()
"#;

#[pyclass]
struct TagApi {
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    handle: Handle,
}

/// Injected into script globals as the callable `send_telegram(text)`. Pushes
/// the text onto the shared Telegram channel owned by `sws-web` (which does the
/// actual HTTP). `sws-pyscript` stays HTTP-free — it only holds the sender.
/// `tr("chiave")` — **non traduce**: restituisce `{{chiave}}`, cioè un
/// riferimento alla tabella lingue del progetto.
///
/// Sembra un cavillo ed è la scelta che fa funzionare la cosa. Uno script non
/// sa **chi leggerà** ciò che scrive: lo stesso valore finisce sul pannello di
/// un operatore italiano e su quello di un collega spagnolo, e la lingua giusta
/// la sa solo chi disegna, nel momento in cui disegna. Se `tr` traducesse qui,
/// sceglierebbe una lingua sola per tutti — e sarebbe quella di chi ha scritto
/// il progetto, non quella di chi guarda.
///
/// Il valore torna quindi come token, e lo risolvono i due viewer (e il canale
/// Telegram, che una lingua ce l'ha: quella delle notifiche).
///
/// Una chiave che non esiste **non** è un errore che ferma lo script: sarebbe
/// sproporzionato fermare una logica d'impianto per un'etichetta. Si scrive nel
/// registro e si restituisce il token lo stesso, che sul pannello si vede come
/// `{{chiave}}` — cioè si dichiara.
#[pyclass]
struct Traduttore {
    chiavi: Arc<Mutex<Vec<String>>>,
}

#[pymethods]
impl Traduttore {
    fn __call__(&self, chiave: String) -> String {
        let nota = self
            .chiavi
            .lock()
            .map(|c| c.contains(&chiave))
            .unwrap_or(false);
        if !nota {
            eprintln!(
                "[script] tr(\"{chiave}\"): questa chiave non è nella tabella lingue del progetto"
            );
        }
        format!("{{{{{chiave}}}}}")
    }
}

#[pyclass]
struct Notifier {
    tx: Option<mpsc::UnboundedSender<String>>,
}

#[pymethods]
impl Notifier {
    fn __call__(&self, text: String) -> PyResult<()> {
        match &self.tx {
            Some(tx) => tx.send(text).map_err(|_| {
                PyErr::new::<pyo3::exceptions::PyRuntimeError, _>("canale Telegram non disponibile")
            }),
            None => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(
                "Telegram non configurato (Configurazione → Progetto → Notifiche)",
            )),
        }
    }
}

/// T-69: backs the bare callables `now_ms()`, `uptime_ms()`, `delta_ms()`.
/// All three values are computed once in `execute_with_args` before the
/// script starts (see there for why) and just handed back verbatim on call —
/// same `__call__`-as-bare-name trick already used for `send_telegram`.
#[pyclass]
struct FrozenClock(i64);

#[pymethods]
impl FrozenClock {
    fn __call__(&self) -> i64 {
        self.0
    }
}

/// T-69: backs `state.get(key, default=None)` / `state.set(key, value)` — the
/// per-script/per-function scratch a script uses to remember small things
/// (e.g. a ramp's direction) across invocations without a dedicated impianto
/// tag. Shares the same `Arc<Mutex<...>>` as the caller's `ScriptState.scratch`
/// (see `Engine::execute_with_args`), so writes here are visible on the next
/// invocation with the same `identity` — and only that one.
#[pyclass]
struct StateApi {
    scratch: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
}

#[pymethods]
impl StateApi {
    #[pyo3(signature = (key, default=None))]
    fn get(&self, py: Python<'_>, key: &str, default: Option<&Bound<'_, PyAny>>) -> Py<PyAny> {
        let guard = self.scratch.lock().unwrap_or_else(|e| e.into_inner());
        match guard.get(key) {
            Some(v) => json_to_py(py, v),
            None => match default {
                Some(d) => d.clone().unbind(),
                None => py.None(),
            },
        }
    }

    fn set(&self, key: &str, value: &Bound<'_, PyAny>) -> PyResult<()> {
        let v = py_to_json(value)?;
        let mut guard = self.scratch.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(key.to_string(), v);
        Ok(())
    }
}

/// T-69 fase C: backs `functions.run(name, **kwargs)` — lets a global script
/// invoke a project function **in-process**, instead of duplicating its logic
/// or needing `POST /api/script/run/:name` from outside. `registry` is `None`
/// on the shared engine behind `AppState.py` (press-handlers/HTTP): calling a
/// function from another function isn't wired up (see the field doc on
/// `Engine::functions`), and `.run()` raises a clear error there rather than
/// silently doing nothing.
#[pyclass]
struct FunctionsApi {
    registry: Option<FunctionsRegistry>,
    engine: Engine,
    handle: Handle,
}

#[pymethods]
impl FunctionsApi {
    #[pyo3(signature = (name, **kwargs))]
    fn run(&self, py: Python<'_>, name: &str, kwargs: Option<&Bound<'_, PyDict>>) -> PyResult<()> {
        let registry = self.registry.clone().ok_or_else(|| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(
                "functions.run: non disponibile in questo contesto \
                 (solo dagli script globali, non da un'altra funzione)",
            )
        })?;
        let args = pydict_to_json_map(kwargs)?;

        let name_owned = name.to_string();
        let trovata = py.detach(|| {
            self.handle.block_on(async move {
                let map = registry.read().await;
                map.get(&name_owned).cloned()
            })
        });
        let funzione = trovata.ok_or_else(|| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
                "functions.run: nessuna funzione '{name}'"
            ))
        })?;
        // I default dei parametri non passati, come per un pulsante
        // (`FunctionDef::argomenti`, L0).
        let args = funzione.argomenti(args);
        let code = funzione.code;

        // Identità = il nome nudo della funzione, non quello dello script
        // chiamante: la funzione tiene il proprio delta_ms()/state a
        // prescindere da chi la invoca — lo STESSO nome usato da
        // `POST /api/script/run/:name` (router.rs::run_function, `&name`).
        // Prima di questa correzione qui c'era un prefisso `fn:` che rendeva
        // le due chiavi diverse nonostante il commento (e l'intento)
        // dicessero il contrario: un pulsante e uno script che richiamano la
        // STESSA funzione finivano su due contatori di stato indipendenti,
        // scoperto costruendo il template di collaudo di T-69.
        let identity = name.to_string();
        let engine = self.engine.clone();
        let result = py.detach(|| {
            self.handle
                .block_on(async move { engine.execute_with_args(code, args, &identity).await })
        });
        result
            .map(|_| ())
            .map_err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>)
    }
}

/// `functions.run`'s `**kwargs` → `serde_json::Map`, l'inverso di
/// `json_map_to_pydict`. Stesso contratto scalari-soli: i parametri di una
/// funzione sono già validati come tali server-side.
fn pydict_to_json_map(
    dict: Option<&Bound<'_, PyDict>>,
) -> PyResult<serde_json::Map<String, serde_json::Value>> {
    let mut out = serde_json::Map::new();
    if let Some(d) = dict {
        for (k, v) in d.iter() {
            let key: String = k.extract()?;
            out.insert(key, py_to_json(&v)?);
        }
    }
    Ok(out)
}

#[pymethods]
impl TagApi {
    /// Read the current value of `id`. Returns the Python-native type
    /// matching the tag's `TagValue` variant, or None if the tag is unknown.
    fn read(&self, py: Python<'_>, id: &str) -> Option<Py<PyAny>> {
        let db = self.db.clone();
        let id_owned = id.to_string();
        let state = py.detach(|| self.handle.block_on(async move { db.get(&id_owned).await }))?;
        Some(tag_value_to_py(py, &state.value))
    }

    /// Write `value` into the tag. Routes through `TagWriteBus` if a plugin
    /// owns the tag, otherwise falls back to a direct `TagDb` set (same
    /// semantics as `PUT /api/tags/:id`, scaling inverso compreso — Q42).
    ///
    /// Lo script vive interamente nel mondo INGEGNERISTICO: `tags.read`
    /// restituisce eng, e qui si scrive eng; la conversione in raw verso il
    /// device è mestiere di questo metodo, come negli altri tre percorsi
    /// (API, WebSocket, ricette). Fino al 2026-09-06 mancava: uno script che
    /// scriveva un tag scalato posseduto da un plugin consegnava al PLC il
    /// valore ingegneristico come se fosse raw.
    fn write(&self, py: Python<'_>, id: &str, value: &Bound<'_, PyAny>) -> PyResult<()> {
        let v = py_to_tagvalue(value)?;
        let db = self.db.clone();
        let bus = self.bus.clone();
        let id_owned = id.to_string();
        py.detach(|| {
            self.handle.block_on(async move {
                // Q27: stesso contratto del PUT — allo script arriva un
                // ValueError col motivo, non una scrittura del tipo sbagliato.
                let v = match db.coerce_for_write(&id_owned, v).await {
                    Ok(v) => v,
                    Err(msg) => {
                        return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                            "tags.write: {msg}"
                        )))
                    }
                };
                // Verso il device viaggia il RAW; il fallback TagDb (tag
                // virtuali) resta in unità ingegneristiche — nessuno lo
                // ri-scala in lettura. Speculare a write_tag in sws-web.
                let raw = db.scale_to_raw(&id_owned, v.clone()).await;
                match bus.write(&id_owned, raw).await {
                    Ok(()) => Ok(()),
                    Err(sws_core::WriteError::NoWriter(_)) => {
                        db.set(id_owned, v, TagQuality::Good).await;
                        Ok(())
                    }
                    Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
                        "tags.write: {e}"
                    ))),
                }
            })
        })
    }
}

/// Python-visible object whose `is_set()` method polls the Rust-owned kill flag.
/// Injected as `__sws_kill_switch__` into every script run; the trace function
/// calls it at each bytecode boundary to implement soft preemption.
#[pyclass]
struct KillSwitch {
    flag: Arc<AtomicBool>,
}

#[pymethods]
impl KillSwitch {
    fn is_set(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

fn py_to_tagvalue(any: &Bound<'_, PyAny>) -> PyResult<TagValue> {
    // Order matters: bool extracts as int in Python (True == 1), so check it first.
    if let Ok(b) = any.extract::<bool>() {
        return Ok(TagValue::Bool(b));
    }
    if let Ok(i) = any.extract::<i64>() {
        return Ok(TagValue::Int(i));
    }
    if let Ok(f) = any.extract::<f64>() {
        return Ok(TagValue::Float(f));
    }
    if let Ok(s) = any.extract::<String>() {
        return Ok(TagValue::Str(s));
    }
    Err(PyErr::new::<pyo3::exceptions::PyTypeError, _>(
        "tags.write: value must be bool, int, float or str",
    ))
}

/// Same scalars-only contract as `py_to_tagvalue`, for `state.set`. A
/// separate function (not a `TagValue` reuse) because the scratch map is
/// `serde_json::Value` — it doesn't need `TagQuality`/scaling, just something
/// that survives a round trip through `json_to_py`.
fn py_to_json(any: &Bound<'_, PyAny>) -> PyResult<serde_json::Value> {
    if let Ok(b) = any.extract::<bool>() {
        return Ok(serde_json::Value::Bool(b));
    }
    if let Ok(i) = any.extract::<i64>() {
        return Ok(serde_json::Value::Number(i.into()));
    }
    if let Ok(f) = any.extract::<f64>() {
        return Ok(serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null));
    }
    if let Ok(s) = any.extract::<String>() {
        return Ok(serde_json::Value::String(s));
    }
    Err(PyErr::new::<pyo3::exceptions::PyTypeError, _>(
        "state.set: value must be bool, int, float or str",
    ))
}

/// Owns the bindings the runtime exposes to scripts. Cloneable cheaply
/// (two Arcs + a bool flag); each `execute` call runs in its own GIL session.
#[derive(Clone)]
pub struct Engine {
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    sandbox: Arc<AtomicBool>,
    timeout: Duration,
    /// Backs the `send_telegram(text)` binding. Interior-mutable + shared across
    /// clones so the sink can be (re)set at runtime on the shared engine used by
    /// functions. `None` inside = Telegram not configured.
    telegram_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    /// Le chiavi della tabella lingue del progetto aperto, per `tr(chiave)`.
    ///
    /// Solo le **chiavi**, non le traduzioni: `tr` non traduce, restituisce un
    /// riferimento (vedi `Traduttore`). Servono a dire subito «questa chiave non
    /// esiste» invece di lasciare che il token compaia su un pannello.
    ///
    /// Interior-mutable come `telegram_tx`, e per lo stesso motivo: il motore
    /// condiviso dietro `AppState.py` sopravvive al cambio progetto.
    chiavi_lingua: Arc<Mutex<Vec<String>>>,
    /// T-69: backs `uptime_ms()`/`delta_ms()`/`state.get`/`state.set`, keyed by
    /// the caller-supplied `identity` (a global script's own id, or a
    /// function's name — see `execute_with_args`). One entry per identity, not
    /// one per `Engine`: the shared engine behind `AppState.py` serves *every*
    /// project function through the same instance (`sws-web/src/router.rs`,
    /// `run_function`), so without a key `delta_ms()` from one function would
    /// reflect the last call to *any* function. Global scripts get their own
    /// `Engine` each (`GlobalScriptSupervisor::start`) — `functions_engine`
    /// below is what keeps a FUNCTION's own state out of this map.
    states: Arc<Mutex<std::collections::HashMap<String, ScriptState>>>,
    /// T-69 fase C: backs the `functions.run(name, **kwargs)` binding.
    /// Interior-mutable like `telegram_tx` — `None` means "not wired up in
    /// this context" (the shared engine behind `AppState.py`, used by
    /// press-handlers/`POST /api/script/run`, never gets one: a function
    /// calling another function isn't today's ask, and leaving it unset
    /// is what makes the guard in `FunctionsApi::run` fire for real — see
    /// `functions_engine` below for why it fires reliably now).
    /// `GlobalScriptSupervisor::start` sets this on each script's own engine.
    functions: Arc<Mutex<Option<FunctionsRegistry>>>,
    /// T-69 fase C, corretto in questa sessione: l'Engine su cui gira
    /// DAVVERO il codice della funzione chiamata da `functions.run(...)`.
    /// `None` (il caso di `AppState.py`) significa "sono io stesso il
    /// canonico" — `execute_with_args` ricade su `self.clone()`.
    ///
    /// Prima di questo campo, `functions.run` eseguiva SEMPRE sul motore
    /// CHIAMANTE (`self.clone()`, non un secondo motore nonostante il
    /// commento dicesse il contrario). Per uno script globale questo è il
    /// suo Engine PRIVATO (`GlobalScriptSupervisor::start` ne crea uno per
    /// script) — diverso sia dall'Engine di un altro script sia da
    /// `AppState.py` usato da un pulsante/`POST /api/script/run/:name`. Tre
    /// mappe `states` distinte per la stessa identità "nome_funzione":
    /// nessuna condivisione reale, contro quanto promesso. Scoperto
    /// costruendo il template di collaudo di T-69: un contatore alimentato
    /// sia da un pulsante sia da `functions.run` non tornava mai lo stesso
    /// numero.
    ///
    /// `GlobalScriptSupervisor::start` imposta questo campo sull'Engine
    /// PRIVATO di ogni script puntandolo al motore CANONICO (`AppState.py`,
    /// che qui resta `None`): `functions.run` esegue quindi sempre sullo
    /// stesso Engine che un pulsante/l'HTTP userebbero, `states` condivisa
    /// per davvero. Effetto collaterale voluto: il motore canonico non ha
    /// mai un registro (`functions` resta `None` lì), quindi una funzione
    /// invocata così non può a sua volta chiamare `functions.run` — lo
    /// stesso guardrail di prima, ma che ora scatta sul serio anche quando
    /// il chiamante è uno script con un registro configurato (prima
    /// ereditava il registro del chiamante ed eludeva il divieto).
    functions_engine: Arc<Mutex<Option<Engine>>>,
}

/// Per-identity bookkeeping for the T-69 clock/state bindings.
struct ScriptState {
    /// Set the first time this identity is seen — backs `uptime_ms()`. Not the
    /// process start time: an `Engine` doesn't know when the whole runtime
    /// started, and threading that through would be more plumbing for a
    /// number that's already useful defined as "since this script/function
    /// first ran".
    first_seen: Instant,
    /// `None` on the very first invocation — `delta_ms()` returns 0 in that
    /// case (decided 2026-09-14): a ramp written as `pos += delta_ms/period`
    /// stays put on the first tick instead of jumping, no script-side check
    /// needed.
    last_invocation: Option<Instant>,
    /// Backs `state.get`/`state.set`. A separate `Arc<Mutex<...>>` (not just a
    /// plain field on `ScriptState`) so it can be handed into `run_in_python`
    /// — which runs on a different thread via `spawn_blocking` — without
    /// holding the outer `states` lock for the whole script execution.
    scratch: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    /// Sandboxing flag for this run — informational, mostly for the UI.
    pub sandboxed: bool,
}

/// La sandbox è obbligatoria? (CRA, onda 1, 15-10-2026.) La imposta il binario
/// `sws-runtime` all'avvio: vero, salvo la deroga esplicita di sviluppo
/// `SWS_SCRIPT_SENZA_SANDBOX=1`. I test delle librerie non la toccano e restano
/// come prima. Un interruttore di processo e non un campo dell'`Engine` perché
/// i motori nascono in più punti (runtime, script globali), e la regola è una.
static SANDBOX_OBBLIGATORIA: AtomicBool = AtomicBool::new(false);

pub fn imposta_sandbox_obbligatoria(si: bool) {
    SANDBOX_OBBLIGATORIA.store(si, Ordering::Relaxed);
}

pub fn sandbox_obbligatoria() -> bool {
    SANDBOX_OBBLIGATORIA.load(Ordering::Relaxed)
}

/// Il messaggio quando uno script non parte perché la sandbox manca.
pub const MOTIVO_SENZA_SANDBOX: &str =
    "script non eseguito: RestrictedPython non è installato, e senza sandbox \
uno script avrebbe pieni privilegi sul dispositivo. L'immagine ufficiale lo contiene; \
per lo sviluppo si può derogare con SWS_SCRIPT_SENZA_SANDBOX=1";

impl Engine {
    pub fn new(db: Arc<TagDb>, bus: Arc<TagWriteBus>) -> Self {
        let timeout_ms = std::env::var("SWS_SCRIPT_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let sandbox = probe_restricted_python();
        if sandbox {
            info!(
                timeout_ms,
                "pyscript: RestrictedPython available — scripts will run sandboxed"
            );
        } else {
            warn!(
                timeout_ms,
                "pyscript: RestrictedPython NOT available — scripts run with full \
                privileges (install with `pip install RestrictedPython` to enable sandboxing)"
            );
        }
        Self {
            db,
            bus,
            sandbox: Arc::new(AtomicBool::new(sandbox)),
            timeout: Duration::from_millis(timeout_ms),
            telegram_tx: Arc::new(Mutex::new(None)),
            chiavi_lingua: Arc::new(Mutex::new(Vec::new())),
            states: Arc::new(Mutex::new(std::collections::HashMap::new())),
            functions: Arc::new(Mutex::new(None)),
            functions_engine: Arc::new(Mutex::new(None)),
        }
    }

    /// Set (or clear) the Telegram sink backing the `send_telegram(text)`
    /// binding. Interior-mutable: takes `&self` so the shared engine (functions)
    /// can be updated at project open / notifications save.
    pub fn set_telegram_sink(&self, tx: Option<mpsc::UnboundedSender<String>>) {
        if let Ok(mut guard) = self.telegram_tx.lock() {
            *guard = tx;
        }
    }

    /// Le chiavi della tabella lingue del progetto aperto. Si richiama
    /// all'apertura, come `set_telegram_sink`.
    pub fn set_chiavi_lingua(&self, chiavi: Vec<String>) {
        if let Ok(mut guard) = self.chiavi_lingua.lock() {
            *guard = chiavi;
        }
    }

    /// Set (or clear) the registry backing `functions.run(name, **kwargs)`
    /// (T-69 fase C). Interior-mutable for the same reason as
    /// `set_telegram_sink` — `GlobalScriptSupervisor::start` calls this right
    /// after building each script's own `Engine`.
    pub fn set_functions_registry(&self, registry: Option<FunctionsRegistry>) {
        if let Ok(mut guard) = self.functions.lock() {
            *guard = registry;
        }
    }

    /// Set (or clear) l'Engine canonico su cui `functions.run(...)` esegue
    /// davvero il codice della funzione chiamata — vedi il commento sul campo
    /// `functions_engine`. `GlobalScriptSupervisor::start` lo imposta su ogni
    /// Engine privato di script puntandolo ad `AppState.py`; `AppState.py`
    /// stesso lo lascia `None` (è già il canonico).
    pub fn set_functions_engine(&self, engine: Option<Engine>) {
        if let Ok(mut guard) = self.functions_engine.lock() {
            *guard = engine;
        }
    }

    /// True if scripts are compiled+exec'd through RestrictedPython.
    pub fn is_sandboxed(&self) -> bool {
        self.sandbox.load(Ordering::Relaxed)
    }

    /// Execute `code` and return its captured stdout/stderr.
    /// On a Python error, returns Err(msg) with the formatted traceback.
    /// On a wall-clock timeout (`SWS_SCRIPT_TIMEOUT_MS`), returns Err(...).
    ///
    /// `identity` keys the T-69 clock/state bindings (`uptime_ms()`,
    /// `delta_ms()`, `state.get`/`state.set`) — a global script's own id, or a
    /// function's name. Callers that don't care about those bindings (none
    /// today) can pass any stable string; it never affects tags/output.
    pub async fn execute(&self, code: String, identity: &str) -> Result<ExecOutput, String> {
        self.execute_with_args(code, serde_json::Map::new(), identity)
            .await
    }

    /// Same as `execute` but additionally injects `args` as Python globals
    /// before running the body. Each value is converted to its natural
    /// Python type (bool / int / float / str); other JSON shapes are
    /// coerced to their string form.
    pub async fn execute_with_args(
        &self,
        code: String,
        args: serde_json::Map<String, serde_json::Value>,
        identity: &str,
    ) -> Result<ExecOutput, String> {
        let handle = Handle::current();
        let db = self.db.clone();
        let bus = self.bus.clone();
        let sandbox = self.is_sandboxed();
        if !sandbox && sandbox_obbligatoria() {
            return Err(MOTIVO_SENZA_SANDBOX.to_string());
        }
        let timeout = self.timeout;
        let telegram = self.telegram_tx.lock().ok().and_then(|g| g.clone());
        // L'`Arc` e non una copia: il progetto può cambiare mentre uno script
        // gira, e `tr()` deve vedere le chiavi di adesso.
        let chiavi_lingua = self.chiavi_lingua.clone();
        let functions = self.functions.lock().ok().and_then(|g| g.clone());
        // T-69 fase C, corretto in questa sessione: `functions.run(...)`
        // esegue il codice della funzione chiamata sul motore CANONICO
        // (`functions_engine`, impostato da `GlobalScriptSupervisor::start`
        // su `AppState.py`), non su questo Engine — altrimenti ogni script
        // globale (con un Engine privato tutto suo) avrebbe una propria copia
        // isolata dello stato della funzione, mai condivisa né con un
        // pulsante/HTTP né con un altro script. `unwrap_or_else(self.clone)`
        // è il caso di `AppState.py` stesso: lì `functions_engine` resta
        // `None` perché è già il canonico.
        let engine_for_functions = self
            .functions_engine
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_else(|| self.clone());

        // T-69: snapshot this invocation's clock values and hand out the
        // scratch map for `identity` *before* spawning — recording "now" here
        // (not after the script finishes) is what makes `delta_ms()` measure
        // time between invocations rather than time between an invocation's
        // start and the previous one's end.
        let now = Instant::now();
        let (uptime_ms, delta_ms, scratch) = {
            let mut states = self.states.lock().unwrap_or_else(|e| e.into_inner());
            let entry = states
                .entry(identity.to_string())
                .or_insert_with(|| ScriptState {
                    first_seen: now,
                    last_invocation: None,
                    scratch: Arc::new(Mutex::new(std::collections::HashMap::new())),
                });
            let uptime_ms = now.duration_since(entry.first_seen).as_millis() as i64;
            let delta_ms = entry
                .last_invocation
                .map(|t| now.duration_since(t).as_millis() as i64)
                .unwrap_or(0);
            entry.last_invocation = Some(now);
            (uptime_ms, delta_ms, entry.scratch.clone())
        };
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let work = tokio::task::spawn_blocking(move || {
            run_in_python(
                db,
                bus,
                handle,
                sandbox,
                code,
                args,
                timeout,
                telegram,
                chiavi_lingua,
                now_ms,
                uptime_ms,
                delta_ms,
                scratch,
                functions,
                engine_for_functions,
            )
        });

        match tokio::time::timeout(timeout, work).await {
            Ok(Ok(Ok(out))) => {
                // Un'esecuzione riuscita e muta non è una notizia: uno script
                // globale a intervallo di 1 s ne produrrebbe **86.400 al
                // giorno**, tutte identiche, e sommergerebbe qualunque altra
                // riga. È successo davvero: il log di un'installazione sul
                // dispositivo risultava illeggibile, interlacciato una riga sì
                // e una no con questa (2026-08-28) — la stessa famiglia del
                // difetto Q24, dove un avviso ripetuto cancellava le righe
                // d'avvio del viewer.
                //
                // Resta a `info` quando lo script ha **stampato qualcosa**:
                // lì c'è del contenuto che qualcuno ha voluto mettere, e
                // tacerlo sarebbe perdere l'unica traccia di un `print` di
                // diagnosi. Il fallimento resta `warn` qui sotto, sempre.
                //
                // Dal 05-11-2026 (L0) la riga porta il testo stampato e il nome
                // di chi l'ha stampato: prima diceva solo quanti byte, e il
                // `print` di una funzione non arrivava da nessuna parte se non
                // nella risposta HTTP. Il testo si tronca: un `for` che stampa a
                // ogni giro non deve diventare una riga di megabyte.
                if out.stdout.is_empty() {
                    debug!(nome = %identity, "python script ran cleanly");
                } else {
                    info!(nome = %identity, testo = %testo_per_il_log(&out.stdout), "print");
                }
                Ok(out)
            }
            Ok(Ok(Err(msg))) => {
                // `debug` e non `warn`: l'errore torna comunque al chiamante, e
                // **tutti e due** i chiamanti lo mostrano già.
                // `global_scripts::exec_once` lo registra a ERROR (strozzato per
                // ripetizione), e `POST /api/script/run/:name` lo restituisce nella
                // risposta HTTP, dove l'IDE lo mette sotto gli occhi di chi ha
                // premuto il pulsante.
                //
                // Qui era una terza copia, e su uno script a intervallo di 1 s
                // raddoppiava l'inondazione: due righe al secondo per lo stesso
                // guasto, per sempre (visto sul WP630 il 2026-08-28, con un
                // progetto il cui `import` la sandbox blocca).
                debug!("python script failed: {msg}");
                Err(msg)
            }
            Ok(Err(e)) => Err(format!("python task panicked: {e}")),
            Err(_) => Err(format!("script timed out after {} ms", timeout.as_millis())),
        }
    }
}

/// Quanto di un `print` finisce in una riga di log.
const LOG_PRINT_MAX: usize = 2_000;

fn testo_per_il_log(stdout: &str) -> String {
    let t = stdout.trim_end();
    if t.len() <= LOG_PRINT_MAX {
        return t.to_string();
    }
    let mut fine = LOG_PRINT_MAX;
    while !t.is_char_boundary(fine) {
        fine -= 1;
    }
    format!("{}… (altri {} byte)", &t[..fine], t.len() - fine)
}

/// Python harness used by `eval_expression`.
///
/// Uses the `ast` module to inject `__sws_result__ = <expr>` on the correct
/// node so that:
///  - single-line expressions → assigned directly
///  - multi-line blocks ending with an expression → that expression is captured
///  - multi-line blocks ending with `if/else` → the last Expr in each branch
///    is captured (handles `if cond: val_a else: val_b` patterns)
///
/// Without this, naïvely prepending `__sws_result__ = ` to a multi-line block
/// would capture only the first assignment (e.g. a list literal), not the
/// intended result.
const EVAL_HARNESS: &str = r#"
import ast as __ast
__tree = __ast.parse(__sws_expr_code__, mode='exec')
def __inject(stmts):
    if not stmts:
        return
    last = stmts[-1]
    if isinstance(last, __ast.Expr):
        stmts[-1] = __ast.Assign(
            targets=[__ast.Name(id='__sws_result__', ctx=__ast.Store())],
            value=last.value,
            lineno=last.lineno, col_offset=0,
            end_lineno=getattr(last, 'end_lineno', last.lineno),
            end_col_offset=getattr(last, 'end_col_offset', 0))
    elif isinstance(last, __ast.If):
        __inject(last.body)
        __inject(last.orelse)
__inject(__tree.body)
__ast.fix_missing_locations(__tree)
exec(compile(__tree, '<expr>', 'exec'), globals())
"#;

/// Evaluate a Python expression `expr` with `tags` bound to a dict snapshot
/// of current tag values.  Returns the expression result coerced to a
/// `TagValue`, or an error string on Python failure.
///
/// Supports both single-line expressions and multi-line code blocks (see
/// `EVAL_HARNESS`). The last expression or if/else branch value is used as
/// the result. Runs in a `spawn_blocking` thread.
pub async fn eval_expression(
    expr: String,
    snapshot: std::collections::HashMap<String, TagValue>,
) -> Result<TagValue, String> {
    let work = tokio::task::spawn_blocking(move || {
        Python::attach(|py| -> Result<TagValue, String> {
            let tags_dict = PyDict::new(py);
            for (k, v) in &snapshot {
                let py_v: Py<PyAny> = tag_value_to_py(py, v);
                tags_dict.set_item(k, py_v).map_err(|e| e.to_string())?;
            }
            let globals = PyDict::new(py);
            globals
                .set_item("tags", &tags_dict)
                .map_err(|e| e.to_string())?;
            globals
                .set_item("__sws_expr_code__", &expr)
                .map_err(|e| e.to_string())?;

            let c_harness = std::ffi::CString::new(EVAL_HARNESS)
                .map_err(|e| format!("invalid harness bytes: {e}"))?;
            py.run(c_harness.as_c_str(), Some(&globals), None)
                .map_err(|e| e.to_string())?;

            let result = globals
                .get_item("__sws_result__")
                .map_err(|e| e.to_string())?
                .ok_or_else(|| {
                    "expression returned no value — last statement must be an expression"
                        .to_string()
                })?;

            // bool must be checked before i64 (Python bool is a subclass of int)
            if let Ok(b) = result.extract::<bool>() {
                Ok(TagValue::Bool(b))
            } else if let Ok(i) = result.extract::<i64>() {
                Ok(TagValue::Int(i))
            } else if let Ok(f) = result.extract::<f64>() {
                Ok(TagValue::Float(f))
            } else if let Ok(s) = result.extract::<String>() {
                Ok(TagValue::Str(s))
            } else {
                Err(format!(
                    "expression result has unsupported Python type: {}",
                    result
                        .get_type()
                        .name()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|_| "?".into())
                ))
            }
        })
    });
    match work.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("eval task panicked: {e}")),
    }
}

fn probe_restricted_python() -> bool {
    Python::attach(|py| py.import("RestrictedPython").is_ok())
}

#[allow(clippy::too_many_arguments)]
fn run_in_python(
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    handle: Handle,
    sandbox: bool,
    user_source: String,
    args: serde_json::Map<String, serde_json::Value>,
    timeout: Duration,
    telegram_tx: Option<mpsc::UnboundedSender<String>>,
    // Le chiavi della tabella lingue, per `tr()`. Condivise con l'Engine e non
    // copiate: il progetto può cambiare mentre uno script gira.
    chiavi_lingua: Arc<Mutex<Vec<String>>>,
    now_ms: i64,
    uptime_ms: i64,
    delta_ms: i64,
    scratch: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
    functions_registry: Option<FunctionsRegistry>,
    engine_for_functions: Engine,
) -> Result<ExecOutput, String> {
    // Arm the kill switch.  A timer thread flips `kill_flag` after `timeout`;
    // the Python trace function detects it and raises KeyboardInterrupt.
    // The timer thread itself is cheap (just sleeping) and terminates naturally.
    let kill_flag = Arc::new(AtomicBool::new(false));
    let kf = kill_flag.clone();
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        kf.store(true, Ordering::Relaxed);
    });

    Python::attach(|py| -> PyResult<ExecOutput> {
        let handle_for_functions = handle.clone();
        let api = Py::new(py, TagApi { db, bus, handle })?;
        let notifier = Py::new(py, Notifier { tx: telegram_tx })?;
        let kill_switch = Py::new(py, KillSwitch { flag: kill_flag })?;
        // T-69: `now_ms`/`uptime_ms`/`delta_ms` are frozen at the values
        // computed once in `execute_with_args` before this call — see the
        // comment there for why. `state` shares the caller's `scratch` Arc,
        // so writes made during this run are visible next time this same
        // `identity` runs.
        let now_ms_obj = Py::new(py, FrozenClock(now_ms))?;
        let uptime_ms_obj = Py::new(py, FrozenClock(uptime_ms))?;
        let delta_ms_obj = Py::new(py, FrozenClock(delta_ms))?;
        let state_obj = Py::new(py, StateApi { scratch })?;
        let functions_obj = Py::new(
            py,
            FunctionsApi {
                registry: functions_registry,
                engine: engine_for_functions,
                handle: handle_for_functions,
            },
        )?;
        let tr = Py::new(
            py,
            Traduttore {
                chiavi: chiavi_lingua.clone(),
            },
        )?;
        // I globali forniti si costruiscono scorrendo `NOMI_FORNITI`, non a
        // mano: un nome aggiunto all'elenco senza il suo oggetto si ferma qui
        // al primo script (e al primo test), invece di finire in un elenco che
        // promette quello che l'harness non dà.
        let forniti = PyDict::new(py);
        for n in NOMI_FORNITI {
            let oggetto: Py<PyAny> = match n.nome {
                "tags" => api.clone_ref(py).into_any(),
                "send_telegram" => notifier.clone_ref(py).into_any(),
                "now_ms" => now_ms_obj.clone_ref(py).into_any(),
                "uptime_ms" => uptime_ms_obj.clone_ref(py).into_any(),
                "delta_ms" => delta_ms_obj.clone_ref(py).into_any(),
                "state" => state_obj.clone_ref(py).into_any(),
                "functions" => functions_obj.clone_ref(py).into_any(),
                "tr" => tr.clone_ref(py).into_any(),
                // Lo fornisce la sandbox (`_print_` nell'harness), o Python
                // stesso quando la sandbox manca.
                "print" => continue,
                altro => unreachable!("NOMI_FORNITI: `{altro}` non ha un oggetto in run_in_python"),
            };
            forniti.set_item(n.nome, oggetto)?;
        }
        let globals = PyDict::new(py);
        globals.set_item("__sws_api__", forniti)?;
        globals.set_item("__sws_builtin_aggiunti__", BUILTIN_AGGIUNTI.to_vec())?;
        globals.set_item("__sws_kill_switch__", kill_switch)?;
        globals.set_item("__sws_user_source__", user_source)?;
        globals.set_item("__sws_sandbox__", sandbox)?;
        globals.set_item("__sws_args__", json_map_to_pydict(py, &args)?)?;

        let c_code =
            CString::new(HARNESS).expect("HARNESS contains a NUL byte — should not happen");
        py.run(c_code.as_c_str(), Some(&globals), None)?;

        let stdout = globals
            .get_item("__sws_stdout_capture__")?
            .map(|v| v.extract::<String>().unwrap_or_default())
            .unwrap_or_default();
        let stderr = globals
            .get_item("__sws_stderr_capture__")?
            .map(|v| v.extract::<String>().unwrap_or_default())
            .unwrap_or_default();
        let error: Option<String> = globals.get_item("__sws_error__")?.and_then(|v| {
            if v.is_none() {
                None
            } else {
                v.extract::<String>().ok()
            }
        });

        if let Some(err) = error {
            return Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(err));
        }

        Ok(ExecOutput {
            stdout,
            stderr,
            sandboxed: sandbox,
        })
    })
    .map_err(|e| Python::attach(|py| e.value(py).to_string()))
}

/// Convert a `serde_json::Map` into a Python dict whose values use the
/// natural Python type for each scalar (bool / int / float / str). Lists,
/// nested objects and null all collapse to their string form — we expect
/// the function param contract to be scalars-only (validated server-side).
fn json_map_to_pydict<'py>(
    py: Python<'py>,
    map: &serde_json::Map<String, serde_json::Value>,
) -> PyResult<Bound<'py, PyDict>> {
    let out = PyDict::new(py);
    for (k, v) in map {
        let py_v: Py<PyAny> = json_to_py(py, v);
        out.set_item(k, py_v)?;
    }
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Compilare senza eseguire
// ─────────────────────────────────────────────────────────────────────────────

/// L'harness del solo controllo: **compila e non esegue**.
///
/// Tre passi, in quest'ordine, e ognuno coglie una cosa che gli altri non vedono:
///
///  1. `compile()` normale. Se fallisce, il codice **non è Python valido**: è un
///     errore di sintassi, con riga e colonna.
///  2. `compile_restricted()`, se la sandbox c'è: i costrutti che rifiuta a
///     compilazione (dunder, `exec`, `eval`).
///  3. una passata sull'**AST**, sempre.
///
/// # Perché il passo 3 non è ridondante
///
/// Misurato con RestrictedPython 8.5: `compile_restricted` rifiuta i dunder,
/// `exec` ed `eval` — e **compila senza dire niente** `import os` e `open(...)`.
/// Non è un difetto suo: quei due non sono costrutti proibiti, sono **nomi che a
/// esecuzione non esistono**, perché `safe_builtins` non fornisce né
/// `__import__` né `open`. Il guasto arriva quindi come `NameError` a runtime,
/// che è precisamente ciò che questo controllo esiste per non dover provocare.
///
/// La prima stesura si fermava al passo 2 e affermava di cogliere gli import.
/// Non era vero, e il test scritto per quel ramo l'ha dimostrato **appena
/// RestrictedPython è stata installata**: prima si saltava, quindi quel ramo non
/// l'aveva mai eseguito nessuno.
///
/// Il passo 3 resta **stretto di proposito**: gli `import`, e un elenco di nomi
/// verificato contro `safe_builtins` invece di essere cablato. Non è un controllo
/// generale dei nomi non definiti, e la ragione è concreta: i `params` di una
/// funzione di progetto vengono iniettati come globali a esecuzione, quindi un
/// controllo largo segnalerebbe come inesistente ogni parametro — e i falsi
/// allarmi insegnano a ignorare lo strumento.
///
/// # Perché la distinzione fra i due guasti conta
///
/// Un errore di sintassi si corregge rileggendo la riga; un divieto no — quel
/// codice è Python valido e va cambiato approccio. Per un assistente che deve
/// correggersi da sé è la differenza fra cercare una virgola e cambiare strada.
const CHECK_HARNESS: &str = r#"
import ast, warnings

__sws_syntax__ = None
__sws_vietato__ = None
__sws_riga__ = None
__sws_colonna__ = None
__sws_albero__ = None
__sws_safe__ = None

try:
    __sws_albero__ = ast.parse(__sws_user_source__, '<check>', 'exec')
    compile(__sws_user_source__, '<check>', 'exec')
except SyntaxError as _e:
    __sws_syntax__ = f'{type(_e).__name__}: {_e.msg}'
    __sws_riga__ = _e.lineno
    __sws_colonna__ = _e.offset
except BaseException as _e:
    __sws_syntax__ = f'{type(_e).__name__}: {_e}'

if __sws_syntax__ is None and __sws_sandbox__:
    try:
        from RestrictedPython import compile_restricted, safe_builtins
        # Gli stessi builtin dell'esecuzione: `safe_builtins` più quelli che
        # l'harness aggiunge (`BUILTIN_AGGIUNTI`, da Rust).
        __sws_safe__ = set(safe_builtins) | set(__sws_builtin_aggiunti__)
        with warnings.catch_warnings():
            # RestrictedPython avvisa di cose benigne (per esempio «Prints, but
            # never reads 'printed' variable»): non sono divieti, e riportarli
            # come tali finirebbe addosso a codice corretto.
            warnings.simplefilter('ignore')
            compile_restricted(__sws_user_source__, '<check>', 'exec')
    except SyntaxError as _e:
        # RestrictedPython impacchetta i suoi divieti come SyntaxError, con i
        # messaggi già in forma «Line N: ...». Si passa il testo così com'è:
        # riscriverlo perderebbe il numero di riga che ci mette dentro.
        __sws_vietato__ = str(_e.msg if _e.msg else _e)
        __sws_riga__ = _e.lineno
    except ImportError:
        # La sandbox è stata rilevata all'avvio ma il modulo ora non c'è: non si
        # afferma niente sul divieto, invece di dire che il codice va bene.
        __sws_vietato__ = None
    except BaseException as _e:
        __sws_vietato__ = f'{type(_e).__name__}: {_e}'

# ── 3. Nomi che a esecuzione non esisteranno ─────────────────────────────────
if __sws_syntax__ is None and __sws_vietato__ is None and __sws_albero__ is not None:
    __sws_candidati__ = ['open', '__import__', 'compile', 'input', 'globals',
                         'locals', 'vars', 'dir', 'eval', 'exec', 'breakpoint',
                         'memoryview', 'help', 'exit', 'quit']
    # `__sws_forniti__` arriva da Rust: è `NOMI_FORNITI`, lo stesso elenco da
    # cui l'harness di esecuzione costruisce i suoi globali.
    for _n in ast.walk(__sws_albero__):
        if isinstance(_n, (ast.Import, ast.ImportFrom)):
            _quali = ', '.join(a.name for a in _n.names) if _n.names else '?'
            __sws_vietato__ = (f'Line {_n.lineno}: gli import non sono disponibili '
                               f'nella sandbox (`{_quali}`). Niente `os`, `time`, '
                               f'`math`, `requests`: usa `tags` per i dati e le '
                               f'funzioni di progetto per il resto.')
            __sws_riga__ = _n.lineno
            break
        if isinstance(_n, ast.Name) and isinstance(_n.ctx, ast.Load):
            if _n.id in __sws_forniti__:
                continue
            if _n.id in __sws_candidati__:
                if __sws_safe__ is not None and _n.id in __sws_safe__:
                    continue
                __sws_vietato__ = (f'Line {_n.lineno}: `{_n.id}` non esiste nella '
                                   f'sandbox: a esecuzione darebbe NameError.')
                __sws_riga__ = _n.lineno
                break
"#;

/// Un rilievo del solo controllo di compilazione.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CheckRilievo {
    /// Riga 1-based, quando Python la fornisce.
    pub riga: Option<u32>,
    pub colonna: Option<u32>,
    pub messaggio: String,
    /// `true` = Python valido, ma vietato dalla sandbox. `false` = sintassi.
    ///
    /// È la distinzione che rende il rilievo azionabile: per un errore di
    /// sintassi si rilegge la riga, per un divieto si cambia strada.
    pub vietato: bool,
}

/// Esito di `Engine::check`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CheckOutput {
    pub ok: bool,
    /// Il controllo del divieto è stato fatto? `false` = RestrictedPython non
    /// c'è (tipico del PC di sviluppo), quindi un `import` passerebbe qui e
    /// verrebbe rifiutato **sul dispositivo**. Va detto, non taciuto.
    pub sandbox_verificata: bool,
    pub rilievi: Vec<CheckRilievo>,
}

impl Engine {
    /// Compila `code` e **non lo esegue**: nessun tag letto o scritto, nessun
    /// `print`, nessun `send_telegram`, nessun timeout da armare.
    ///
    /// Esiste perché l'unico modo di sapere se uno script sta in piedi era
    /// **eseguirlo** — cioè accettare che una prova avesse effetti sull'impianto.
    /// Serve all'assistente per correggersi da sé, come già fa `valida` per la
    /// struttura, e serve al maintainer anche senza assistente.
    pub async fn check(&self, code: String) -> CheckOutput {
        let sandbox = self.is_sandboxed();
        let esito = tokio::task::spawn_blocking(move || check_in_python(sandbox, code)).await;
        match esito {
            Ok(v) => v,
            Err(e) => CheckOutput {
                ok: false,
                sandbox_verificata: false,
                rilievi: vec![CheckRilievo {
                    riga: None,
                    colonna: None,
                    vietato: false,
                    messaggio: format!("il controllo non è potuto girare: {e}"),
                }],
            },
        }
    }
}

fn check_in_python(sandbox: bool, code: String) -> CheckOutput {
    let vuoto = code.trim().is_empty();
    if vuoto {
        // Un corpo vuoto compila e non fa niente. Dirlo è più utile di un `ok`
        // silenzioso: chi ha chiesto il controllo si aspettava del codice.
        return CheckOutput {
            ok: true,
            sandbox_verificata: sandbox,
            rilievi: vec![CheckRilievo {
                riga: None,
                colonna: None,
                vietato: false,
                messaggio: "il codice è vuoto: compila, ma non fa niente.".into(),
            }],
        };
    }

    let r = Python::attach(|py| -> PyResult<CheckOutput> {
        let globals = PyDict::new(py);
        globals.set_item("__sws_user_source__", &code)?;
        globals.set_item("__sws_sandbox__", sandbox)?;
        globals.set_item("__sws_forniti__", nomi_forniti())?;
        globals.set_item("__sws_builtin_aggiunti__", BUILTIN_AGGIUNTI.to_vec())?;

        let c = CString::new(CHECK_HARNESS)
            .expect("CHECK_HARNESS contains a NUL byte — should not happen");
        py.run(c.as_c_str(), Some(&globals), None)?;

        let leggi_str = |k: &str| -> Option<String> {
            globals.get_item(k).ok().flatten().and_then(|v| {
                if v.is_none() {
                    None
                } else {
                    v.extract::<String>().ok()
                }
            })
        };
        let leggi_u32 = |k: &str| -> Option<u32> {
            globals.get_item(k).ok().flatten().and_then(|v| {
                if v.is_none() {
                    None
                } else {
                    v.extract::<u32>().ok()
                }
            })
        };

        let riga = leggi_u32("__sws_riga__");
        let colonna = leggi_u32("__sws_colonna__");

        let mut rilievi = Vec::new();
        if let Some(m) = leggi_str("__sws_syntax__") {
            rilievi.push(CheckRilievo {
                riga,
                colonna,
                messaggio: m,
                vietato: false,
            });
        } else if let Some(m) = leggi_str("__sws_vietato__") {
            rilievi.push(CheckRilievo {
                riga,
                colonna: None,
                messaggio: m,
                vietato: true,
            });
        }

        Ok(CheckOutput {
            ok: rilievi.is_empty(),
            sandbox_verificata: sandbox,
            rilievi,
        })
    });

    r.unwrap_or_else(|e| {
        let msg = Python::attach(|py| e.value(py).to_string());
        CheckOutput {
            ok: false,
            sandbox_verificata: false,
            rilievi: vec![CheckRilievo {
                riga: None,
                colonna: None,
                vietato: false,
                messaggio: format!("il controllo non è potuto girare: {msg}"),
            }],
        }
    })
}

#[cfg(test)]
mod tests_check {
    use super::*;
    use sws_core::{TagDb, TagWriteBus};

    fn motore() -> Engine {
        Engine::new(Arc::new(TagDb::new(16)), Arc::new(TagWriteBus::new()))
    }

    #[tokio::test]
    async fn codice_valido_passa() {
        let e = motore();
        let out = e.check("x = 1 + 1\nprint(x)\n".into()).await;
        assert!(out.ok, "rilievi inattesi: {:?}", out.rilievi);
        assert!(out.rilievi.is_empty());
    }

    #[tokio::test]
    async fn errore_di_sintassi_porta_la_riga_e_non_e_un_divieto() {
        let e = motore();
        // `if` senza `:` — sbagliato alla terza riga, non alla prima: senza il
        // numero di riga un rilievo su uno script di cinquanta righe è inutile.
        let out = e.check("a = 1\nb = 2\nif a > b\n    pass\n".into()).await;
        assert!(!out.ok);
        assert_eq!(out.rilievi.len(), 1);
        let r = &out.rilievi[0];
        assert_eq!(r.riga, Some(3), "riga sbagliata in {r:?}");
        assert!(
            !r.vietato,
            "un errore di sintassi non è un divieto della sandbox"
        );
        assert!(r.messaggio.contains("SyntaxError"), "{}", r.messaggio);
    }

    #[tokio::test]
    async fn il_codice_vuoto_lo_dice_invece_di_tacere() {
        let e = motore();
        let out = e.check("   \n\n".into()).await;
        assert!(out.ok, "un corpo vuoto compila");
        assert_eq!(out.rilievi.len(), 1, "ma va detto che non fa niente");
        assert!(!out.rilievi[0].vietato);
    }

    /// Il caso che dà valore alla separazione: Python valido, vietato qui.
    ///
    /// # Perché non si salta in silenzio
    ///
    /// La prima stesura faceva `return` quando RestrictedPython mancava — e
    /// sul PC di sviluppo manca, quindi il test **passava senza provare
    /// niente**: verde, e cieco esattamente sul comportamento per cui esiste.
    /// È la stessa trappola dei `check_*.sh` che nessuno lanciava.
    ///
    /// Ora asserisce in **entrambi** i rami, e ciascuno dice una cosa vera:
    /// con la sandbox, un `import` è vietato; senza, passa **e** il campo
    /// `sandbox_verificata` lo dichiara. Il secondo ramo non è un ripiego: è la
    /// garanzia che l'istanza non finga di aver controllato.
    #[tokio::test]
    async fn un_import_e_sempre_vietato_e_lo_dice_come_divieto() {
        let e = motore();
        let out = e.check("import os\nos.system('ls')\n".into()).await;

        // Vietato **in ogni caso**, con o senza RestrictedPython installata: il
        // passo sull'AST gira sempre, e deve girare sempre, perché sul
        // dispositivo la sandbox c'è. Dire «va bene» su una macchina di sviluppo
        // insegnerebbe a scrivere import che in campo non partono.
        assert!(!out.ok, "un import va rifiutato: {:?}", out.rilievi);
        assert_eq!(out.rilievi.len(), 1);
        let r = &out.rilievi[0];
        assert!(
            r.vietato,
            "deve risultare **vietato**, non un errore di sintassi: {r:?}"
        );
        assert_eq!(r.riga, Some(1), "e portare la riga: {r:?}");
        // Il messaggio deve dire cosa fare invece, non solo che è proibito.
        assert!(r.messaggio.contains("tags"), "{}", r.messaggio);

        // L'unica cosa che cambia fra le due macchine è se il **passo 2** è
        // stato fatto, e l'esito lo dichiara invece di lasciarlo indovinare.
        assert_eq!(out.sandbox_verificata, e.is_sandboxed());
    }

    /// `open` è l'altro caso che `compile_restricted` lascia passare: non è un
    /// costrutto proibito, è un nome che `safe_builtins` non fornisce, quindi il
    /// guasto arriverebbe come `NameError` a esecuzione.
    #[tokio::test]
    async fn un_nome_che_la_sandbox_non_fornisce_e_un_divieto() {
        let e = motore();
        let out = e.check("d = open('/etc/passwd')\n".into()).await;
        assert!(
            !out.ok,
            "`open` non esiste nella sandbox: {:?}",
            out.rilievi
        );
        assert!(out.rilievi[0].vietato);
        assert!(
            out.rilievi[0].messaggio.contains("open"),
            "{}",
            out.rilievi[0].messaggio
        );
    }

    /// E il verso che protegge dai falsi allarmi: i nomi che **ci sono** devono
    /// passare. Un controllo che si lamenta di `tags` o di `print` sarebbe
    /// peggio di nessun controllo, perché insegnerebbe a ignorarlo.
    #[tokio::test]
    async fn i_nomi_forniti_non_sono_divieti() {
        let e = motore();
        let out = e
            .check("print('ciao')\nx = tags['t']\ntags['t'] = x + 1\ny = len('abc')\n".into())
            .await;
        assert!(out.ok, "nessun rilievo atteso: {:?}", out.rilievi);
    }

    #[tokio::test]
    async fn senza_sandbox_lo_dichiara_invece_di_far_credere_di_aver_controllato() {
        let e = motore();
        let out = e.check("x = 1\n".into()).await;
        // Qualunque sia la macchina, il campo deve *dire* com'è andata: è la
        // differenza fra «controllato» e «non controllabile qui», e su un
        // dispositivo con la sandbox lo stesso codice può essere rifiutato.
        assert_eq!(out.sandbox_verificata, e.is_sandboxed());
    }

    #[tokio::test]
    async fn il_controllo_non_esegue() {
        // La prova che conta: se `check` eseguisse, questo scriverebbe il tag.
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        db.set(
            "t".into(),
            sws_core::TagValue::Int(0),
            sws_core::TagQuality::Good,
        )
        .await;
        let e = Engine::new(db.clone(), bus);

        let out = e
            .check("tags['t'] = 42\nprint('sono girato')\n".into())
            .await;
        assert!(out.ok, "il codice è valido: {:?}", out.rilievi);

        let dopo = db.snapshot().await;
        let v = dopo.get("t").map(|s| s.value.clone());
        assert_ne!(
            v,
            Some(sws_core::TagValue::Int(42)),
            "check ha ESEGUITO il codice: ha scritto il tag"
        );
    }

    /// Q42 — lo script scrive in unità INGEGNERISTICHE e al device arriva il
    /// RAW, come negli altri tre percorsi (API, WS, ricette). Fino al
    /// 2026-09-06 il raw non veniva calcolato: al plugin arrivava l'eng.
    #[tokio::test]
    async fn la_scrittura_dello_script_scala_verso_il_device() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        // 4-20 mA scalati 0-100: eng 50 → raw 12. Stessa scala su un tag
        // posseduto da un finto plugin («s») e su uno virtuale («v»).
        let scala = sws_core::LinearScale {
            raw_min: 4.0,
            raw_max: 20.0,
            eng_min: 0.0,
            eng_max: 100.0,
        };
        db.set_scales([("s".to_string(), scala), ("v".to_string(), scala)].into())
            .await;
        let (tx, mut rx) = mpsc::channel(4);
        bus.register("s".to_string(), tx).await;
        let e = Engine::new(db.clone(), bus);

        e.execute(
            "tags.write('s', 50.0)\ntags.write('v', 50.0)\n".into(),
            "test",
        )
        .await
        .expect("script fallito");

        let (id, percorso, valore) = rx.recv().await.expect("nessuna scrittura sul bus");
        assert_eq!(percorso, None, "un tag piatto non ha percorso");
        assert_eq!(id, "s");
        assert_eq!(
            valore,
            sws_core::TagValue::Float(12.0),
            "al device deve arrivare il raw"
        );

        // Il fallback dei tag virtuali resta ingegneristico: nessuno lo
        // ri-scala in lettura, e scalarlo qui sarebbe il bug opposto.
        let dopo = db.snapshot().await;
        assert_eq!(
            dopo.get("v").map(|s| s.value.clone()),
            Some(sws_core::TagValue::Float(50.0))
        );
    }

    /// T-69 — `delta_ms()` alla prima invocazione di una identità è 0 (nessun
    /// "prima" con cui confrontare, deciso dal maintainer), e su un secondo
    /// giro riflette il tempo davvero trascorso. Lo stato ritenuto
    /// (`state.get`/`state.set`) sopravvive fra le due chiamate.
    #[tokio::test]
    async fn orologio_e_stato_persistono_per_la_stessa_identita() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let e = Engine::new(db.clone(), bus);
        let code = "
n = state.get('n', 0) + 1
state.set('n', n)
tags.write('n', n)
tags.write('delta', delta_ms())
";

        e.execute(code.into(), "script-x")
            .await
            .expect("primo giro fallito");
        let dopo1 = db.snapshot().await;
        assert_eq!(
            dopo1.get("delta").map(|s| s.value.clone()),
            Some(TagValue::Int(0)),
            "primo giro: nessun \"prima\" con cui confrontare"
        );
        assert_eq!(
            dopo1.get("n").map(|s| s.value.clone()),
            Some(TagValue::Int(1))
        );

        tokio::time::sleep(Duration::from_millis(30)).await;

        e.execute(code.into(), "script-x")
            .await
            .expect("secondo giro fallito");
        let dopo2 = db.snapshot().await;
        let delta2 = match dopo2.get("delta").map(|s| s.value.clone()) {
            Some(TagValue::Int(v)) => v,
            other => panic!("delta_ms non è un Int: {other:?}"),
        };
        assert!(
            delta2 >= 25,
            "delta_ms al secondo giro dovrebbe riflettere l'attesa di 30ms: {delta2}"
        );
        assert_eq!(
            dopo2.get("n").map(|s| s.value.clone()),
            Some(TagValue::Int(2)),
            "lo stato ritenuto persiste fra le invocazioni della stessa identità"
        );
    }

    /// T-69 — identità diverse (script/funzioni diversi) non condividono lo
    /// stato ritenuto: è quello che rende `state`/`delta_ms()` corretti anche
    /// sull'`Engine` condiviso da tutte le funzioni di progetto.
    #[tokio::test]
    async fn stato_ritenuto_non_si_mischia_fra_identita_diverse() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let e = Engine::new(db.clone(), bus);
        let code = "n = state.get('n', 0) + 1\nstate.set('n', n)\ntags.write('n', n)";

        e.execute(code.into(), "a").await.expect("giro 'a' fallito");
        e.execute(code.into(), "a").await.expect("giro 'a' fallito");
        let dopo = db.snapshot().await;
        assert_eq!(
            dopo.get("n").map(|s| s.value.clone()),
            Some(TagValue::Int(2))
        );

        e.execute(code.into(), "b").await.expect("giro 'b' fallito");
        let dopo = db.snapshot().await;
        assert_eq!(
            dopo.get("n").map(|s| s.value.clone()),
            Some(TagValue::Int(1)),
            "identità diversa, contatore proprio"
        );
    }

    /// T-69 — difetto pre-esistente scoperto durante l'esplorazione:
    /// `send_telegram` era registrato nei globals esterni di `run_in_python`
    /// ma non copiato dentro `__sws_globals__`, il dizionario contro cui gira
    /// davvero il codice utente — uno script che lo chiamava otteneva sempre
    /// `NameError`. La prova che conta è negativa: l'errore atteso è quello
    /// esplicito di `Notifier` (nessun sink configurato), non un `NameError`.
    #[tokio::test]
    async fn send_telegram_e_raggiungibile_dal_codice_utente() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let e = Engine::new(db, bus);

        let err = e
            .execute("send_telegram('ciao')".into(), "test")
            .await
            .expect_err("senza sink configurato deve fallire, ma non di NameError");
        assert!(
            err.contains("Telegram non configurato"),
            "errore inatteso: {err}"
        );
        assert!(
            !err.contains("NameError"),
            "send_telegram non raggiunge il codice dello script: {err}"
        );
    }

    /// T-69 fase C: senza registro configurato (`Engine::new` di base, come
    /// l'`Engine` condiviso di `AppState.py`), `functions.run` fallisce con
    /// un errore esplicito — non un `NameError`, il binding è raggiungibile.
    #[tokio::test]
    async fn functions_run_senza_registro_da_un_errore_chiaro() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let e = Engine::new(db, bus);

        let err = e
            .execute("functions.run('qualunque')".into(), "test")
            .await
            .expect_err("senza registro deve fallire, ma non di NameError");
        assert!(
            err.contains("non disponibile in questo contesto"),
            "errore inatteso: {err}"
        );
        assert!(!err.contains("NameError"), "{err}");
    }

    /// T-69 fase C: con un registro configurato (come fa
    /// `GlobalScriptSupervisor::start` su ogni script), uno script globale
    /// può richiamare una funzione di progetto in-process, passandole
    /// argomenti per nome — e la funzione chiamata ha una propria identità
    /// (il proprio nome), non quella dello script chiamante.
    #[tokio::test]
    async fn functions_run_esegue_la_funzione_con_gli_argomenti() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let e = Engine::new(db.clone(), bus);

        let registry: FunctionsRegistry =
            Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::from([
                (
                    "saluta".to_string(),
                    sws_core::FunctionDef {
                        id: "f1".into(),
                        name: "saluta".into(),
                        description: None,
                        code: "tags.write('chi', chi)\n".into(),
                        params: vec![],
                    },
                ),
            ])));
        e.set_functions_registry(Some(registry));

        e.execute("functions.run('saluta', chi='mondo')".into(), "script-a")
            .await
            .expect("functions.run fallita");

        let dopo = db.snapshot().await;
        assert_eq!(
            dopo.get("chi").map(|s| s.value.clone()),
            Some(TagValue::Str("mondo".into())),
            "gli argomenti nominali arrivano alla funzione chiamata"
        );
    }

    /// Corretto in questa sessione: `functions.run` usava l'identità
    /// `fn:<nome>`, diversa dal nome nudo che `POST /api/script/run/:name`
    /// (il percorso di un pulsante) passa a `execute_with_args` — due chiavi
    /// diverse nella stessa mappa `states`, quindi `state`/`delta_ms()` NON
    /// erano condivisi fra i due percorsi nonostante il commento del codice
    /// lo promettesse. Qui si simula il secondo percorso chiamando
    /// `execute_with_args` direttamente col nome nudo, come fa
    /// `router::run_function`.
    ///
    /// USA DUE ENGINE, non uno: uno script globale ha un Engine privato tutto
    /// suo (`GlobalScriptSupervisor::start`), diverso dal motore CANONICO che
    /// un pulsante/`POST /api/script/run/:name` usa (`AppState.py`). Un test
    /// con un solo `Engine` per entrambi i ruoli passerebbe anche col difetto
    /// più profondo trovato subito dopo questo fix (`functions.run` eseguiva
    /// sul motore CHIAMANTE, non su quello canonico) — motivo per cui quel
    /// difetto è sfuggito al primo giro di test.
    #[tokio::test]
    async fn functions_run_condivide_lo_stato_con_la_chiamata_diretta_per_nome() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let canonico = Engine::new(db.clone(), bus.clone()); // sta per AppState.py
        let script_engine = Engine::new(db.clone(), bus); // sta per l'Engine privato di uno script
        script_engine.set_functions_engine(Some(canonico.clone()));

        let registry: FunctionsRegistry =
            Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::from([
                (
                    "conta".to_string(),
                    sws_core::FunctionDef {
                        id: "f1".into(),
                        name: "conta".into(),
                        description: None,
                        code: "n = state.get('n', 0) + 1\nstate.set('n', n)\ntags.write('n', n)\n"
                            .into(),
                        params: vec![],
                    },
                ),
            ])));
        script_engine.set_functions_registry(Some(registry));

        // Primo giro: via functions.run, come da uno script globale — sul suo
        // Engine privato, ma deve eseguire sul canonico.
        script_engine
            .execute("functions.run('conta')".into(), "script-a")
            .await
            .expect("functions.run fallita");
        assert_eq!(db.get("n").await.map(|s| s.value), Some(TagValue::Int(1)));

        // Secondo giro: chiamata diretta sul motore CANONICO col nome nudo,
        // come farebbe `POST /api/script/run/:name` per un pulsante. Deve
        // vedere lo stesso stato, non ripartire da zero.
        canonico
            .execute_with_args(
                "n = state.get('n', 0) + 1\nstate.set('n', n)\ntags.write('n', n)\n".into(),
                serde_json::Map::new(),
                "conta",
            )
            .await
            .expect("chiamata diretta fallita");
        assert_eq!(
            db.get("n").await.map(|s| s.value),
            Some(TagValue::Int(2)),
            "functions.run (via uno script) e la chiamata diretta per nome (via un pulsante) \
             devono condividere lo stato — stesso Engine canonico dietro entrambe"
        );
    }

    /// Il guardrail "functions.run da dentro una funzione è vietato" deve
    /// scattare per davvero anche quando il CHIAMANTE (lo script che ha
    /// invocato la funzione) aveva un registro configurato — prima del fix a
    /// `functions_engine`, la funzione ereditava quel registro tramite
    /// `self.clone()` ed eludeva il divieto. Qui la funzione chiamata
    /// (`ricorsiva`) prova a sua volta `functions.run(...)`: deve fallire con
    /// l'errore esplicito, mai con un `NameError` né una ricorsione infinita.
    #[tokio::test]
    async fn functions_run_da_dentro_una_funzione_e_vietato_anche_se_il_chiamante_ha_un_registro() {
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let canonico = Engine::new(db.clone(), bus.clone());
        let script_engine = Engine::new(db.clone(), bus);
        script_engine.set_functions_engine(Some(canonico));

        let registry: FunctionsRegistry =
            Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::from([
                (
                    "ricorsiva".to_string(),
                    sws_core::FunctionDef {
                        id: "f1".into(),
                        name: "ricorsiva".into(),
                        description: None,
                        code: "functions.run('ricorsiva')".into(),
                        params: vec![],
                    },
                ),
            ])));
        script_engine.set_functions_registry(Some(registry));

        let err = script_engine
            .execute("functions.run('ricorsiva')".into(), "script-a")
            .await
            .expect_err("una funzione non deve poter richiamare functions.run");
        assert!(
            err.contains("non disponibile in questo contesto"),
            "errore inatteso: {err}"
        );
        assert!(!err.contains("NameError"), "{err}");
    }
}

/// `tr(chiave)` — il riferimento alla tabella lingue esposto agli script.
#[cfg(test)]
mod tr_tests {
    use super::*;
    use sws_core::{TagDb, TagWriteBus};

    fn motore() -> Engine {
        Engine::new(Arc::new(TagDb::new(16)), Arc::new(TagWriteBus::new()))
    }

    #[tokio::test]
    async fn tr_restituisce_un_token_non_una_traduzione() {
        // È la scelta di disegno che fa funzionare tutto il resto: uno script
        // non sa CHI leggerà ciò che scrive. Lo stesso valore finisce sul
        // pannello di un operatore italiano e su quello di un collega spagnolo,
        // e la lingua giusta la sa solo chi disegna, nel momento in cui disegna.
        // Se `tr` traducesse qui, sceglierebbe una lingua sola per tutti —
        // quella di chi ha scritto il progetto, non quella di chi guarda.
        let e = motore();
        e.set_chiavi_lingua(vec!["t0001".into()]);
        let out = e
            .execute("print(tr('t0001'))".into(), "prova")
            .await
            .expect("script");
        assert_eq!(out.stdout.trim(), "{{t0001}}");
    }

    #[tokio::test]
    async fn una_chiave_ignota_non_ferma_lo_script() {
        // Fermare una logica d'impianto per un'etichetta sarebbe
        // sproporzionato: si scrive nel registro e si restituisce il token, che
        // sul pannello si vede come `{{...}}` — cioè si dichiara.
        let e = motore();
        e.set_chiavi_lingua(vec!["t0001".into()]);
        let out = e
            .execute("print(tr('inesistente'))".into(), "prova")
            .await
            .expect("script");
        assert_eq!(out.stdout.trim(), "{{inesistente}}");
    }
}

#[cfg(test)]
mod tests_sandbox_obbligatoria {
    use super::*;

    #[tokio::test]
    async fn senza_sandbox_e_con_la_regola_accesa_lo_script_non_parte() {
        let e = Engine::new(Arc::new(TagDb::new(16)), Arc::new(TagWriteBus::new()));
        if e.is_sandboxed() {
            return; // su una macchina con RestrictedPython la regola non scatta
        }
        imposta_sandbox_obbligatoria(true);
        let r = e
            .execute_with_args("print(1)".into(), Default::default(), "test")
            .await;
        imposta_sandbox_obbligatoria(false);
        assert_eq!(r.unwrap_err(), MOTIVO_SENZA_SANDBOX);
    }
}

/// L0 (05-11-2026): la sandbox dà quello che RestrictedPython riscrive, e i
/// default dei parametri arrivano alla funzione.
///
/// Girano con e senza RestrictedPython, e asseriscono la stessa cosa nei due
/// rami: senza, `print`, `for` e `+=` sono Python normale e passano comunque;
/// con, passano solo se le guardie ci sono. È il secondo ramo quello che conta,
/// e sul PC di sviluppo va acceso a mano:
/// `PYTHONPATH=<venv>/lib/python3.11/site-packages cargo test -p sws-pyscript`
/// (un venv con `pip install RestrictedPython`, per esempio in `sws/tmp/`).
#[cfg(test)]
mod tests_sandbox_l0 {
    use super::*;

    fn motore() -> (Engine, Arc<TagDb>) {
        let db = Arc::new(TagDb::new(16));
        (Engine::new(db.clone(), Arc::new(TagWriteBus::new())), db)
    }

    async fn valore(db: &TagDb, id: &str) -> Option<TagValue> {
        db.snapshot().await.get(id).map(|s| s.value.clone())
    }

    #[tokio::test]
    async fn print_arriva_nello_stdout() {
        let (e, _) = motore();
        let out = e
            .execute(
                "print('ciao', 1 + 1)\ndef f():\n    print('dentro')\nf()\n".into(),
                "s",
            )
            .await
            .expect("print non deve dare NameError");
        assert_eq!(out.stdout, "ciao 2\ndentro\n");
    }

    #[tokio::test]
    async fn print_con_flush_come_in_python() {
        let (e, _) = motore();
        let out = e
            .execute("print('ciao', flush=True)\n".into(), "s")
            .await
            .expect("flush=True non deve fallire nella sandbox");
        assert_eq!(out.stdout, "ciao\n");
    }

    /// Due esecuzioni insieme non si mescolano i `print`: ognuna scrive nel
    /// suo stdout, non in `sys.stdout` del processo (dalla revisione di L0:
    /// `tags.read` rilascia il GIL, e i testi finivano nell'altra).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn i_print_di_due_esecuzioni_non_si_mescolano() {
        let (e, _) = motore();
        let codice =
            |nome: &str| format!("for i in range(200):\n    tags.read('x')\n    print('{nome}')\n");
        let (a, b) = tokio::join!(e.execute(codice("a"), "a"), e.execute(codice("b"), "b"));
        let (a, b) = (a.expect("a"), b.expect("b"));
        assert_eq!(a.stdout, "a\n".repeat(200));
        assert_eq!(b.stdout, "b\n".repeat(200));
    }

    #[tokio::test]
    async fn for_piu_uguale_e_spacchettamento() {
        let (e, db) = motore();
        let codice = "\
tot = 0
for i in range(4):
    tot += i
for a, b in [(1, 2), (3, 4)]:
    tot += a * b
x, y = 10, 20
tot -= x
tot *= 2
quadrati = [k * k for k in range(3)]
tags.write('tot', tot + sum(quadrati) + y)
";
        e.execute(codice.into(), "s")
            .await
            .expect("lo script deve girare");
        // (0+1+2+3 + 1*2 + 3*4 - 10) * 2 + (0+1+4) + 20 = 20 + 5 + 20
        assert_eq!(valore(&db, "tot").await, Some(TagValue::Int(45)));
    }

    #[tokio::test]
    async fn i_builtin_aggiunti_ci_sono() {
        let (e, db) = motore();
        let codice = "\
v = [3, 1, 2]
ok = (min(v) == 1 and max(v) == 3 and sum(v) == 6 and sorted(v) == [1, 2, 3]
      and list(enumerate('ab')) == [(0, 'a'), (1, 'b')] and any(v) and all(v)
      and dict(a=1)['a'] == 1 and len(v) == 3 and abs(-2) == 2 and round(2.6) == 3)
tags.write('ok', ok)
";
        e.execute(codice.into(), "s")
            .await
            .expect("lo script deve girare");
        assert_eq!(valore(&db, "ok").await, Some(TagValue::Bool(true)));
    }

    /// Le guardie non aprono quello che la sandbox chiude: un attributo privato
    /// resta rifiutato in compilazione, anche dentro un `+=`.
    #[tokio::test]
    async fn la_sandbox_resta_chiusa() {
        let (e, _) = motore();
        if !e.is_sandboxed() {
            return; // senza RestrictedPython non c'è niente da chiudere
        }
        let r = e.execute("x = 1\nx += (1).__class__\n".into(), "s").await;
        assert!(
            r.unwrap_err().contains("SyntaxError"),
            "un dunder va rifiutato"
        );
        let r = e.execute("import os\n".into(), "s").await;
        assert!(r.is_err(), "un import resta vietato");
    }

    /// Ogni nome dell'elenco unico esiste davvero a esecuzione: l'harness li
    /// costruisce da `NOMI_FORNITI`, e un nome senza oggetto si fermerebbe qui.
    #[tokio::test]
    async fn ogni_nome_fornito_esiste_a_esecuzione() {
        let (e, db) = motore();
        let nomi = NOMI_FORNITI
            .iter()
            .map(|n| n.nome)
            .collect::<Vec<_>>()
            .join(", ");
        e.execute(format!("n = len([{nomi}])\ntags.write('n', n)\n"), "s")
            .await
            .expect("tutti i nomi forniti devono esistere");
        assert_eq!(
            valore(&db, "n").await,
            Some(TagValue::Int(NOMI_FORNITI.len() as i64))
        );
    }

    /// Un pulsante passa `{}`: il default del parametro deve arrivare lo
    /// stesso. Qui per `functions.run`; per la rotta HTTP vale lo stesso
    /// `FunctionDef::argomenti`.
    #[tokio::test]
    async fn functions_run_applica_il_default_dei_parametri() {
        let (e, db) = motore();
        let registry: FunctionsRegistry =
            Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::from([
                (
                    "saluta".to_string(),
                    sws_core::FunctionDef {
                        id: "f1".into(),
                        name: "saluta".into(),
                        description: None,
                        code: "tags.write('chi', chi)\ntags.write('volte', volte)\n".into(),
                        params: vec![
                            sws_core::FunctionParam {
                                name: "chi".into(),
                                default: Some("operatore".into()),
                            },
                            sws_core::FunctionParam {
                                name: "volte".into(),
                                default: Some(2.into()),
                            },
                        ],
                    },
                ),
            ])));
        e.set_functions_registry(Some(registry));

        e.execute("functions.run('saluta', volte=5)".into(), "script-a")
            .await
            .expect("il parametro non passato deve avere il suo default");
        assert_eq!(
            valore(&db, "chi").await,
            Some(TagValue::Str("operatore".into()))
        );
        assert_eq!(
            valore(&db, "volte").await,
            Some(TagValue::Int(5)),
            "il passato vince"
        );
    }

    #[tokio::test]
    async fn il_controllo_non_segnala_i_builtin_aggiunti() {
        let (e, _) = motore();
        let out = e
            .check("v = [1, 2]\nfor i, x in enumerate(v):\n    print(i, min(v), sum(v))\n".into())
            .await;
        assert!(out.ok, "rilievi inattesi: {:?}", out.rilievi);
    }

    #[test]
    fn il_testo_di_un_print_lungo_si_tronca_nel_log() {
        let corto = testo_per_il_log("ciao\n");
        assert_eq!(corto, "ciao");
        let lungo = testo_per_il_log(&"è".repeat(LOG_PRINT_MAX));
        assert!(lungo.len() < LOG_PRINT_MAX + 40, "{}", lungo.len());
        assert!(lungo.ends_with("byte)"), "{lungo}");
    }
}
