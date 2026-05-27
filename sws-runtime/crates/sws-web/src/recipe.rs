use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeSetpoint {
    pub tag: String,
    /// Flexible value: bool, number, or string.
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub setpoints: Vec<RecipeSetpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeApplyEvent {
    pub recipe_id: String,
    pub recipe_name: String,
    pub ts_ms: u64,
    pub applied_by: String,
    pub setpoints_count: usize,
}
