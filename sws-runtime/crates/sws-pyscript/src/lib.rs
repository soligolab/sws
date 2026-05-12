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
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::Duration,
};
use pyo3::prelude::*;
use pyo3::types::PyDict;
use serde::Serialize;
use sws_core::{TagDb, TagQuality, TagValue, TagWriteBus};
use tokio::runtime::Handle;
use tracing::{info, warn};

const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Wraps the user source in stdout/stderr capture + restricted compile.
/// The user source is injected as `__sws_user_source__` (a Python str)
/// alongside `__sws_sandbox__` (a bool flag) and `tags` (the API).
///
/// We compile-then-exec here (instead of letting PyO3 `py.run` the user
/// source directly) for two reasons:
///   1. The wrapper can isolate stdout/stderr per call without leaking
///      Python state across threads.
///   2. When RestrictedPython is available we route compilation through
///      `compile_restricted`, which rejects unsafe AST nodes (import,
///      attribute access on dunders, exec/eval, …).
const HARNESS: &str = r#"
import io, sys, traceback
__sws_out__ = io.StringIO()
__sws_err__ = io.StringIO()
__sws_error__ = None
__sws_compiled__ = None

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

if __sws_compiled__ is not None:
    _orig_out, _orig_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = __sws_out__, __sws_err__
    try:
        exec(__sws_compiled__, __sws_globals__, {})
    except BaseException:
        __sws_error__ = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = _orig_out, _orig_err

__sws_stdout_capture__ = __sws_out__.getvalue()
__sws_stderr_capture__ = __sws_err__.getvalue()
"#;

#[pyclass]
struct TagApi {
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    handle: Handle,
}

#[pymethods]
impl TagApi {
    /// Read the current value of `id`. Returns the Python-native type
    /// matching the tag's `TagValue` variant, or None if the tag is unknown.
    // TODO(pyo3-0.24): migrate `into_py` → `into_pyobject` API.
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
        }
    }

    /// True if scripts are compiled+exec'd through RestrictedPython.
    pub fn is_sandboxed(&self) -> bool { self.sandbox.load(Ordering::Relaxed) }

    /// Execute `code` and return its captured stdout/stderr.
    /// On a Python error, returns Err(msg) with the formatted traceback.
    /// On a wall-clock timeout (`SWS_SCRIPT_TIMEOUT_MS`), returns Err(...).
    pub async fn execute(&self, code: String) -> Result<ExecOutput, String> {
        let handle  = Handle::current();
        let db      = self.db.clone();
        let bus     = self.bus.clone();
        let sandbox = self.is_sandboxed();
        let timeout = self.timeout;

        let work = tokio::task::spawn_blocking(move || {
            run_in_python(db, bus, handle, sandbox, code)
        });

        match tokio::time::timeout(timeout, work).await {
            Ok(Ok(Ok(out)))  => {
                info!(stdout_bytes = out.stdout.len(), "python script ran cleanly");
                Ok(out)
            }
            Ok(Ok(Err(msg))) => {
                warn!("python script failed: {msg}");
                Err(msg)
            }
            Ok(Err(e))       => Err(format!("python task panicked: {e}")),
            Err(_)           => Err(format!("script timed out after {} ms", timeout.as_millis())),
        }
    }
}

fn probe_restricted_python() -> bool {
    Python::with_gil(|py| py.import("RestrictedPython").is_ok())
}

fn run_in_python(
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    handle: Handle,
    sandbox: bool,
    user_source: String,
) -> Result<ExecOutput, String> {
    Python::with_gil(|py| -> PyResult<ExecOutput> {
        let api = Py::new(py, TagApi { db, bus, handle })?;
        let globals = PyDict::new(py);
        globals.set_item("tags", api)?;
        globals.set_item("__sws_user_source__", user_source)?;
        globals.set_item("__sws_sandbox__", sandbox)?;

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
