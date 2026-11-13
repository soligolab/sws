//! Quante volte al secondo il viewer ridisegna (12-11-2026, piano
//! `docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md`).
//!
//! Il valore viene dal progetto (`pannello.fps`, predefinito 20). Fino a oggi il
//! ciclo era fisso a 16 ms, circa 60 fotogrammi: sul Tiny TY, un core, un
//! grafico trascinato col dito portava il viewer al 93 % della CPU. Il
//! maintainer: «60 fotogrammi al secondo sono sicuramente eccessivi».
//!
//! Il tempo di LVGL (`tick_inc`) segue l'orologio vero, non il passo del
//! ciclo: con un ciclo più lento un lampeggio o un'animazione durano quanto
//! devono, invece di rallentare.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

static FPS: AtomicU32 = AtomicU32::new(sws_core::project::PannelloConfig::FPS_PREDEFINITI);

/// Fissa i fotogrammi al secondo (già riportati nei limiti dal chiamante).
pub fn imposta(fps: u32) {
    FPS.store(fps.max(1), Ordering::Relaxed);
}

/// La durata di un giro del ciclo.
pub fn periodo() -> Duration {
    periodo_per(FPS.load(Ordering::Relaxed))
}

fn periodo_per(fps: u32) -> Duration {
    Duration::from_micros(1_000_000 / fps.max(1) as u64)
}

/// Il tempo passato dall'ultima chiamata, per `lvgl::tick_inc`.
pub struct Orologio(Instant);

impl Orologio {
    pub fn nuovo() -> Self {
        Self(Instant::now())
    }

    pub fn passo(&mut self) -> Duration {
        let ora = Instant::now();
        let d = ora - self.0;
        self.0 = ora;
        d
    }
}

#[cfg(test)]
mod tests {
    use super::periodo_per;
    use std::time::Duration;

    #[test]
    fn il_periodo_segue_i_fotogrammi() {
        assert_eq!(periodo_per(20), Duration::from_millis(50));
        assert_eq!(periodo_per(10), Duration::from_millis(100));
        assert_eq!(periodo_per(0), Duration::from_secs(1));
    }
}
