//! TODO: Load and validate project.yaml; watch filesystem for hot-reload events.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub version: String,
}
