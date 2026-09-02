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

use std::{
    ffi::CString,
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    time::Duration,
};
use pyo3::prelude::*;
use pyo3::types::PyDict;
use serde::Serialize;
use sws_core::{TagDb, TagQuality, TagValue, TagWriteBus};
use tokio::runtime::Handle;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Wraps the user source in stdout/stderr capture + restricted compile.
/// The user source is injected as `__sws_user_source__` (a Python str)
/// alongside `__sws_sandbox__` (a bool flag), `tags` (the API), and
/// `__sws_kill_switch__` (a Rust-backed object polled by the trace fn).
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
        from RestrictedPython import compile_restricted, safe_builtins
        __sws_globals__ = {
            '__builtins__': safe_builtins,
            '_getattr_':   getattr,
            '_getitem_':   lambda o, k: o[k],
            '_write_':     lambda x: x,
            'tags':        tags,
        }
        try:
            __sws_compiled__ = compile_restricted(__sws_user_source__, '<inline>', 'exec')
        except SyntaxError as _e:
            __sws_error__ = f'SyntaxError: {_e}'
    else:
        __sws_globals__ = {'__builtins__': __builtins__, 'tags': tags}
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
                "Telegram non configurato (Configurazione → Notifiche)",
            )),
        }
    }
}

#[pymethods]
impl TagApi {
    /// Read the current value of `id`. Returns the Python-native type
    /// matching the tag's `TagValue` variant, or None if the tag is unknown.
    // `into_py` è deprecata da pyo3 0.23 in favore di `into_pyobject`.
    //
    // Deciso il 2026-08-25: **si migra quando si aggiorna pyo3**, non prima.
    // Oggi è solo un avviso di deprecazione su una API che funziona; migrare
    // adesso significherebbe toccare ogni conversione di questo file senza
    // ottenere niente, e rifarlo comunque all'aggiornamento. `#[allow]` qui
    // sotto tiene il rumore fuori dalla build nel frattempo.
    #[allow(deprecated)]
    fn read(&self, py: Python<'_>, id: &str) -> Option<PyObject> {
        let db = self.db.clone();
        let id_owned = id.to_string();
        let state = py.allow_threads(|| self.handle.block_on(async move { db.get(&id_owned).await }))?;
        Some(match state.value {
            TagValue::Bool(b)  => b.into_py(py),
            TagValue::Int(i)   => i.into_py(py),
            TagValue::Float(f) => f.into_py(py),
            TagValue::Str(s)   => s.into_py(py),
        })
    }

    /// Write `value` into the tag. Routes through `TagWriteBus` if a plugin
    /// owns the tag, otherwise falls back to a direct `TagDb` set (same
    /// semantics as `PUT /api/tags/:id`).
    fn write(&self, py: Python<'_>, id: &str, value: &Bound<'_, PyAny>) -> PyResult<()> {
        let v = py_to_tagvalue(value)?;
        let db = self.db.clone();
        let bus = self.bus.clone();
        let id_owned = id.to_string();
        py.allow_threads(|| {
            self.handle.block_on(async move {
                match bus.write(&id_owned, v.clone()).await {
                    Ok(()) => Ok(()),
                    Err(sws_core::WriteError::NoWriter(_)) => {
                        db.set(id_owned, v, TagQuality::Good).await;
                        Ok(())
                    }
                    Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(
                        format!("tags.write: {e}"),
                    )),
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
    if let Ok(b) = any.extract::<bool>()   { return Ok(TagValue::Bool(b)); }
    if let Ok(i) = any.extract::<i64>()    { return Ok(TagValue::Int(i)); }
    if let Ok(f) = any.extract::<f64>()    { return Ok(TagValue::Float(f)); }
    if let Ok(s) = any.extract::<String>() { return Ok(TagValue::Str(s)); }
    Err(PyErr::new::<pyo3::exceptions::PyTypeError, _>(
        "tags.write: value must be bool, int, float or str",
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
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    /// Sandboxing flag for this run — informational, mostly for the UI.
    pub sandboxed: bool,
}

impl Engine {
    pub fn new(db: Arc<TagDb>, bus: Arc<TagWriteBus>) -> Self {
        let timeout_ms = std::env::var("SWS_SCRIPT_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let sandbox = probe_restricted_python();
        if sandbox {
            info!(timeout_ms, "pyscript: RestrictedPython available — scripts will run sandboxed");
        } else {
            warn!(timeout_ms, "pyscript: RestrictedPython NOT available — scripts run with full \
                privileges (install with `pip install RestrictedPython` to enable sandboxing)");
        }
        Self {
            db,
            bus,
            sandbox: Arc::new(AtomicBool::new(sandbox)),
            timeout: Duration::from_millis(timeout_ms),
            telegram_tx: Arc::new(Mutex::new(None)),
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

    /// True if scripts are compiled+exec'd through RestrictedPython.
    pub fn is_sandboxed(&self) -> bool { self.sandbox.load(Ordering::Relaxed) }

    /// Execute `code` and return its captured stdout/stderr.
    /// On a Python error, returns Err(msg) with the formatted traceback.
    /// On a wall-clock timeout (`SWS_SCRIPT_TIMEOUT_MS`), returns Err(...).
    pub async fn execute(&self, code: String) -> Result<ExecOutput, String> {
        self.execute_with_args(code, serde_json::Map::new()).await
    }

    /// Same as `execute` but additionally injects `args` as Python globals
    /// before running the body. Each value is converted to its natural
    /// Python type (bool / int / float / str); other JSON shapes are
    /// coerced to their string form.
    pub async fn execute_with_args(
        &self,
        code: String,
        args: serde_json::Map<String, serde_json::Value>,
    ) -> Result<ExecOutput, String> {
        let handle  = Handle::current();
        let db      = self.db.clone();
        let bus     = self.bus.clone();
        let sandbox = self.is_sandboxed();
        let timeout = self.timeout;
        let telegram = self.telegram_tx.lock().ok().and_then(|g| g.clone());

        let work = tokio::task::spawn_blocking(move || {
            run_in_python(db, bus, handle, sandbox, code, args, timeout, telegram)
        });

        match tokio::time::timeout(timeout, work).await {
            Ok(Ok(Ok(out)))  => {
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
                if out.stdout.is_empty() {
                    debug!("python script ran cleanly");
                } else {
                    info!(stdout_bytes = out.stdout.len(), "python script ran cleanly");
                }
                Ok(out)
            }
            Ok(Ok(Err(msg))) => {
                // `debug` e non `warn`: l'errore torna comunque al chiamante, e
                // **tutti e due** i chiamanti lo mostrano già.
                // `global_scripts::exec_once` lo registra a ERROR (strozzato per
                // ripetizione), e `POST /api/script/exec` lo restituisce nella
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
            Ok(Err(e))       => Err(format!("python task panicked: {e}")),
            Err(_)           => Err(format!("script timed out after {} ms", timeout.as_millis())),
        }
    }
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
#[allow(deprecated)]
pub async fn eval_expression(
    expr: String,
    snapshot: std::collections::HashMap<String, TagValue>,
) -> Result<TagValue, String> {
    let work = tokio::task::spawn_blocking(move || {
        Python::with_gil(|py| -> Result<TagValue, String> {
            let tags_dict = PyDict::new(py);
            for (k, v) in &snapshot {
                let py_v: PyObject = match v {
                    TagValue::Bool(b)  => b.into_py(py),
                    TagValue::Int(i)   => i.into_py(py),
                    TagValue::Float(f) => f.into_py(py),
                    TagValue::Str(s)   => s.clone().into_py(py),
                };
                tags_dict.set_item(k, py_v).map_err(|e| e.to_string())?;
            }
            let globals = PyDict::new(py);
            globals.set_item("tags", &tags_dict).map_err(|e| e.to_string())?;
            globals.set_item("__sws_expr_code__", &expr).map_err(|e| e.to_string())?;

            let c_harness = std::ffi::CString::new(EVAL_HARNESS)
                .map_err(|e| format!("invalid harness bytes: {e}"))?;
            py.run(c_harness.as_c_str(), Some(&globals), None)
                .map_err(|e| e.to_string())?;

            let result = globals
                .get_item("__sws_result__")
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "expression returned no value — last statement must be an expression".to_string())?;

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
                Err(format!("expression result has unsupported Python type: {}",
                    result.get_type().name().map(|s| s.to_string()).unwrap_or_else(|_| "?".into())))
            }
        })
    });
    match work.await {
        Ok(Ok(v))  => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(e)     => Err(format!("eval task panicked: {e}")),
    }
}

fn probe_restricted_python() -> bool {
    Python::with_gil(|py| py.import("RestrictedPython").is_ok())
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

    Python::with_gil(|py| -> PyResult<ExecOutput> {
        let api          = Py::new(py, TagApi { db, bus, handle })?;
        let notifier     = Py::new(py, Notifier { tx: telegram_tx })?;
        let kill_switch  = Py::new(py, KillSwitch { flag: kill_flag })?;
        let globals = PyDict::new(py);
        globals.set_item("tags", api)?;
        globals.set_item("send_telegram", notifier)?;
        globals.set_item("__sws_kill_switch__", kill_switch)?;
        globals.set_item("__sws_user_source__", user_source)?;
        globals.set_item("__sws_sandbox__", sandbox)?;
        globals.set_item("__sws_args__", json_map_to_pydict(py, &args)?)?;

        let c_code = CString::new(HARNESS)
            .expect("HARNESS contains a NUL byte — should not happen");
        py.run(c_code.as_c_str(), Some(&globals), None)?;

        let stdout = globals.get_item("__sws_stdout_capture__")?
            .map(|v| v.extract::<String>().unwrap_or_default())
            .unwrap_or_default();
        let stderr = globals.get_item("__sws_stderr_capture__")?
            .map(|v| v.extract::<String>().unwrap_or_default())
            .unwrap_or_default();
        let error: Option<String> = globals.get_item("__sws_error__")?
            .and_then(|v| if v.is_none() { None } else { v.extract::<String>().ok() });

        if let Some(err) = error {
            return Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(err));
        }

        Ok(ExecOutput { stdout, stderr, sandboxed: sandbox })
    })
    .map_err(|e| Python::with_gil(|py| e.value(py).to_string()))
}

/// Convert a `serde_json::Map` into a Python dict whose values use the
/// natural Python type for each scalar (bool / int / float / str). Lists,
/// nested objects and null all collapse to their string form — we expect
/// the function param contract to be scalars-only (validated server-side).
#[allow(deprecated)]
fn json_map_to_pydict<'py>(
    py: Python<'py>,
    map: &serde_json::Map<String, serde_json::Value>,
) -> PyResult<Bound<'py, PyDict>> {
    let out = PyDict::new(py);
    for (k, v) in map {
        let py_v: PyObject = match v {
            serde_json::Value::Bool(b)   => b.into_py(py),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() { i.into_py(py) }
                else if let Some(f) = n.as_f64() { f.into_py(py) }
                else { n.to_string().into_py(py) }
            }
            serde_json::Value::String(s) => s.clone().into_py(py),
            // Null / array / object — fall back to a string rendering so the
            // function script can still see *something*.
            other => other.to_string().into_py(py),
        };
        out.set_item(k, py_v)?;
    }
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Compilare senza eseguire
// ─────────────────────────────────────────────────────────────────────────────

/// L'harness del solo controllo: **compila e non esegue**.
///
/// Due compilazioni, in quest'ordine, e la ragione è che l'ordine è l'unica cosa
/// che permette di distinguere i due guasti:
///
///  1. `compile()` normale. Se fallisce, il codice **non è Python valido**: è un
///     errore di sintassi, con riga e colonna.
///  2. solo se la prima è passata e la sandbox c'è, `compile_restricted()`. Se
///     fallisce **qui**, il codice è Python valido ma usa qualcosa che
///     RestrictedPython vieta (un `import`, un dunder, un `exec`).
///
/// Senza la separazione, `compile_restricted` da sola solleva `SyntaxError` per
/// entrambi i casi, e chi legge il messaggio non sa se ha scritto male una riga
/// o se ha chiesto una cosa che qui non si può fare. Per un assistente che deve
/// correggersi da sé è la differenza fra «rileggi la sintassi» e «cambia
/// approccio».
const CHECK_HARNESS: &str = r#"
__sws_syntax__ = None
__sws_vietato__ = None
__sws_riga__ = None
__sws_colonna__ = None

try:
    compile(__sws_user_source__, '<check>', 'exec')
except SyntaxError as _e:
    __sws_syntax__ = f'{type(_e).__name__}: {_e.msg}'
    __sws_riga__ = _e.lineno
    __sws_colonna__ = _e.offset
except BaseException as _e:
    __sws_syntax__ = f'{type(_e).__name__}: {_e}'

if __sws_syntax__ is None and __sws_sandbox__:
    try:
        from RestrictedPython import compile_restricted
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
                    riga: None, colonna: None, vietato: false,
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
            ok: true, sandbox_verificata: sandbox,
            rilievi: vec![CheckRilievo {
                riga: None, colonna: None, vietato: false,
                messaggio: "il codice è vuoto: compila, ma non fa niente.".into(),
            }],
        };
    }

    let r = Python::with_gil(|py| -> PyResult<CheckOutput> {
        let globals = PyDict::new(py);
        globals.set_item("__sws_user_source__", &code)?;
        globals.set_item("__sws_sandbox__", sandbox)?;

        let c = CString::new(CHECK_HARNESS)
            .expect("CHECK_HARNESS contains a NUL byte — should not happen");
        py.run(c.as_c_str(), Some(&globals), None)?;

        let leggi_str = |k: &str| -> Option<String> {
            globals.get_item(k).ok().flatten()
                .and_then(|v| if v.is_none() { None } else { v.extract::<String>().ok() })
        };
        let leggi_u32 = |k: &str| -> Option<u32> {
            globals.get_item(k).ok().flatten()
                .and_then(|v| if v.is_none() { None } else { v.extract::<u32>().ok() })
        };

        let riga = leggi_u32("__sws_riga__");
        let colonna = leggi_u32("__sws_colonna__");

        let mut rilievi = Vec::new();
        if let Some(m) = leggi_str("__sws_syntax__") {
            rilievi.push(CheckRilievo { riga, colonna, messaggio: m, vietato: false });
        } else if let Some(m) = leggi_str("__sws_vietato__") {
            rilievi.push(CheckRilievo { riga, colonna: None, messaggio: m, vietato: true });
        }

        Ok(CheckOutput { ok: rilievi.is_empty(), sandbox_verificata: sandbox, rilievi })
    });

    r.unwrap_or_else(|e| {
        let msg = Python::with_gil(|py| e.value(py).to_string());
        CheckOutput {
            ok: false, sandbox_verificata: false,
            rilievi: vec![CheckRilievo {
                riga: None, colonna: None, vietato: false,
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
        assert!(!r.vietato, "un errore di sintassi non è un divieto della sandbox");
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
    async fn un_import_e_vietato_dalla_sandbox_e_senza_sandbox_lo_si_dichiara() {
        let e = motore();
        let out = e.check("import os\nos.system('ls')\n".into()).await;

        if e.is_sandboxed() {
            assert!(!out.ok, "con la sandbox un import va rifiutato");
            assert_eq!(out.rilievi.len(), 1);
            assert!(out.rilievi[0].vietato,
                    "deve risultare **vietato**, non un errore di sintassi: {:?}",
                    out.rilievi[0]);
            assert!(out.sandbox_verificata);
        } else {
            // Senza RestrictedPython l'import è Python valido e passa. Il punto
            // non è che passi — è che l'esito **dica** di non aver controllato,
            // perché sul dispositivo lo stesso codice viene rifiutato.
            assert!(out.ok, "senza sandbox `import os` è Python valido: {:?}", out.rilievi);
            assert!(!out.sandbox_verificata,
                    "senza sandbox l'esito non deve far credere di aver verificato i divieti");
        }
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
        db.set("t".into(), sws_core::TagValue::Int(0), sws_core::TagQuality::Good).await;
        let e = Engine::new(db.clone(), bus);

        let out = e.check("tags['t'] = 42\nprint('sono girato')\n".into()).await;
        assert!(out.ok, "il codice è valido: {:?}", out.rilievi);

        let dopo = db.snapshot().await;
        let v = dopo.get("t").map(|s| s.value.clone());
        assert_ne!(v, Some(sws_core::TagValue::Int(42)),
                   "check ha ESEGUITO il codice: ha scritto il tag");
    }
}
