//! PyO3 bridge for user scripts attached to synoptic objects.
//!
//! PoC scope:
//! - Synchronous Python execution via `Python::with_gil` on a
//!   `spawn_blocking` worker, so the async runtime stays unblocked.
//! - Exposes a single object `tags` with `read(id)` and `write(id, value)`.
//! - `print(...)` falls through to the runtime stdout (visible in
//!   `.run/logs/runtime.log` when launched via scripts/dev.sh).
//!
//! Out of scope for the PoC (Q1 in docs/OPEN_QUESTIONS.md):
//! - Sandboxing via RestrictedPython — scripts run with full Python
//!   privileges. Projects must come from trusted sources until this lands.
//! - Per-script timeouts.
//! - Capturing stdout/stderr back to the API caller.

use std::{ffi::CString, sync::Arc};
use pyo3::prelude::*;
use pyo3::types::PyDict;
use sws_core::{TagDb, TagQuality, TagValue, TagWriteBus};
use tokio::runtime::Handle;
use tracing::{info, warn};

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
/// (just two Arcs); each `execute` call runs in its own GIL session.
#[derive(Clone)]
pub struct Engine {
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
}

impl Engine {
    pub fn new(db: Arc<TagDb>, bus: Arc<TagWriteBus>) -> Self {
        Self { db, bus }
    }

    /// Execute a snippet of Python in a fresh global dict with `tags` injected.
    /// Returns `Ok(())` on success or `Err(...)` with the Python error as a
    /// string. Runs on a blocking worker so the async runtime keeps moving.
    pub async fn execute(&self, code: String) -> Result<(), String> {
        let handle = Handle::current();
        let db = self.db.clone();
        let bus = self.bus.clone();

        let result = tokio::task::spawn_blocking(move || {
            Python::with_gil(|py| -> PyResult<()> {
                let api = Py::new(py, TagApi { db, bus, handle })?;
                let globals = PyDict::new(py);
                globals.set_item("tags", api)?;
                let c_code = CString::new(code).map_err(|_| {
                    PyErr::new::<pyo3::exceptions::PyValueError, _>("script contains NUL byte")
                })?;
                py.run(c_code.as_c_str(), Some(&globals), None)?;
                Ok(())
            })
        })
        .await
        .map_err(|e| format!("python task panicked: {e}"))?;

        match result {
            Ok(()) => {
                info!("python script ran cleanly");
                Ok(())
            }
            Err(e) => {
                let msg = Python::with_gil(|py| e.value(py).to_string());
                warn!("python script failed: {msg}");
                Err(msg)
            }
        }
    }
}
