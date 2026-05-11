//! Stable C ABI for SWS communication and storage plugins.
//!
//! Plugin shared libraries must export these three symbols:
//!
//! ```c
//! const SwsPluginManifest* plugin_describe(void);
//! int plugin_init(const SwsPluginConfig* cfg);
//! void plugin_shutdown(void);
//! ```
//!
//! TODO: finalize ABI, write dlopen-based loader, add example plugin crate.

use std::os::raw::c_char;

/// Plugin metadata returned by `plugin_describe`.
#[repr(C)]
pub struct SwsPluginManifest {
    pub name:    *const c_char,
    pub version: *const c_char,
    pub kind:    PluginKind,
}

/// Discriminates comm plugins from storage plugins.
#[repr(C)]
pub enum PluginKind {
    Comm    = 0,
    Storage = 1,
}

/// Quality flag attached to every tag value.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagQuality {
    Good    = 0,
    Bad     = 1,
    Uncertain = 2,
}

/// A single tag value as exchanged across the plugin ABI.
#[repr(C)]
pub struct TagValue {
    pub quality:    TagQuality,
    pub timestamp_ms: u64,
    pub value_f64:  f64,
}
