//! Le fasi del fotogramma, misurate sempre (piano
//! `docs/plans/2026-10-26-dove-se-ne-va-il-tempo.md`).
//!
//! Il giro di disegno registra qui quanto dura ogni fase; il thread di rete
//! (`net_worker`) prende il riassunto e lo manda al runtime **solo se qualcuno
//! lo sta guardando**. Il disegno non tocca mai la rete, e non alloca: un lock
//! senza contesa e quattro somme per fase.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use sws_core::prestazioni::{Accumulatore, Riassunto};

static TEMPI: Mutex<Option<Accumulatore>> = Mutex::new(None);

pub fn registra(nome: &'static str, d: Duration) {
    let mut g = TEMPI.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(Accumulatore::default).registra(nome, d);
}

/// Misura `f` sotto il nome `nome`.
pub fn misura<T>(nome: &'static str, f: impl FnOnce() -> T) -> T {
    let t = Instant::now();
    let r = f();
    registra(nome, t.elapsed());
    r
}

/// Ogni quanto si chiede se qualcuno guarda, e ogni quanto si manda quando sì.
const CHIEDI: Duration = Duration::from_secs(10);
const MANDA: Duration = Duration::from_secs(2);

/// Il thread che parla col runtime: chiede ogni [`CHIEDI`] se qualcuno guarda
/// e, finché sì, manda il riassunto ogni [`MANDA`]. Un thread suo, con un
/// runtime tokio suo: non deve poter ritardare né le scritture di
/// `net_worker` né il disegno. Quando nessuno guarda i contatori si svuotano
/// lo stesso, così il primo riassunto mandato parla degli ultimi secondi.
pub fn avvia(base_url: String) {
    let _ = std::thread::Builder::new().name("sws-tempi".into()).spawn(move || {
        let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
            eprintln!("[tempi] runtime non avviabile: le prestazioni non escono");
            return;
        };
        loop {
            let attiva = rt
                .block_on(async {
                    tokio::time::timeout(Duration::from_secs(5), crate::client::prestazioni_richiesta(&base_url)).await
                })
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or(false);
            if !attiva {
                riassunto_e_azzera();
                std::thread::sleep(CHIEDI);
                continue;
            }
            let fine = Instant::now() + CHIEDI;
            while Instant::now() < fine {
                std::thread::sleep(MANDA);
                let r = riassunto_e_azzera();
                let _ = rt.block_on(async {
                    tokio::time::timeout(Duration::from_secs(5), crate::client::invia_prestazioni(&base_url, &r)).await
                });
            }
        }
    });
}

/// Il riassunto da quando si è cominciato, e si riparte da zero.
pub fn riassunto_e_azzera() -> Riassunto {
    TEMPI
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(Accumulatore::default)
        .riassunto_e_azzera()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn misura_registra_e_restituisce() {
        riassunto_e_azzera();
        let x = misura("prova.tempi", || 7);
        assert_eq!(x, 7);
        let r = riassunto_e_azzera();
        assert_eq!(r.voce("prova.tempi").map(|v| v.n), Some(1));
    }
}
