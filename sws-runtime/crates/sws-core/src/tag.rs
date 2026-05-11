//! TODO: Tag type definitions, tag DB (RwLock<HashMap>), subscription channels.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub description: String,
}
