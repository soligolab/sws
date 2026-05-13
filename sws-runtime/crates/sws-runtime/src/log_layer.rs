//! Custom `tracing_subscriber::Layer` that forwards every observed
//! `tracing::Event` into the shared `LogBus`. The fmt layer keeps
//! writing JSON to stdout in parallel; this layer is purely additive.

use std::{sync::Arc, time::{SystemTime, UNIX_EPOCH}};

use sws_core::{LogBus, LogEvent};
use tracing::{
    field::{Field, Visit},
    Event, Subscriber,
};
use tracing_subscriber::layer::{Context, Layer};

pub struct LogBusLayer {
    bus: Arc<LogBus>,
}

impl LogBusLayer {
    pub fn new(bus: Arc<LogBus>) -> Self {
        Self { bus }
    }
}

impl<S> Layer<S> for LogBusLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let meta = event.metadata();

        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        self.bus.record(LogEvent {
            ts_ms,
            level:   meta.level().to_string(),
            target:  meta.target().to_string(),
            message: visitor.message.unwrap_or_default(),
            fields:  visitor.fields,
        });
    }
}

/// Collect `message` separately (tracing's primary field) and stash
/// everything else as JSON. Numeric and boolean fields are preserved as
/// native JSON types so they sort/filter cleanly in the UI.
#[derive(Default)]
struct FieldVisitor {
    message: Option<String>,
    fields:  serde_json::Map<String, serde_json::Value>,
}

impl Visit for FieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else {
            self.fields.insert(field.name().to_string(), serde_json::Value::String(value.to_string()));
        }
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.insert(field.name().to_string(), serde_json::Value::Bool(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.insert(field.name().to_string(), serde_json::Value::Number(value.into()));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.insert(field.name().to_string(), serde_json::Value::Number(value.into()));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        if let Some(n) = serde_json::Number::from_f64(value) {
            self.fields.insert(field.name().to_string(), serde_json::Value::Number(n));
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let rendered = format!("{value:?}");
        if field.name() == "message" {
            self.message = Some(rendered);
        } else {
            self.fields.insert(field.name().to_string(), serde_json::Value::String(rendered));
        }
    }
}
