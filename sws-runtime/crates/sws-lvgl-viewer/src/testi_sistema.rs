//! Il testo di sistema del viewer vive in `sws-core` dal 18-09-2026: è la
//! stessa tabella che usano le notifiche e il viewer web, letta dalla fixture
//! condivisa `tests/fixtures/testi-sistema.json`. Qui resta solo il nome, così
//! `crate::testi_sistema::{testo, Testo}` continua a valere in `lvgl_render.rs`.
pub use sws_core::testi_sistema::*;
