// Hot-reload (notify crate) deferred — not needed for PoC happy path.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::tag::{TagDb, TagQuality, TagValue};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub version: String,
}

/// One tag definition as written in project.yaml.
#[derive(Debug, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub meta: ProjectMeta,
    #[serde(default)]
    pub tags: Vec<TagDef>,
}

impl Project {
    /// Parse `<project_dir>/project.yaml`. Returns an error if the file is
    /// missing or malformed; the caller decides whether to abort or continue.
    pub fn load(project_dir: &Path) -> anyhow::Result<Self> {
        let path = project_dir.join("project.yaml");
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        serde_yaml::from_str(&text)
            .with_context(|| format!("parsing {}", path.display()))
    }

    /// Register every tag from the definition list in `db` with an initial
    /// value of `Float(0.0) / Uncertain`. Plugins will overwrite this as soon
    /// as they get a real reading.
    pub async fn populate_tags(&self, db: &TagDb) {
        for tag in &self.tags {
            db.set(tag.id.clone(), TagValue::Float(0.0), TagQuality::Uncertain).await;
        }
    }
}
