//! La riconnessione delle sorgenti, una volta per tutti i protocolli (04-10-2026,
//! Fase 3 del piano tag).
//!
//! Fino a oggi Modbus, S7, EtherNet/IP, OPC-UA e HomeAssistant chiudevano il loro
//! task al primo errore di sessione, con un log — «stopped (save config to
//! retry)» — che non era vero: li riavviava il watchdog del supervisore, ogni 30
//! s, senza attesa crescente. HomeAssistant diceva in testa «Reconnects with 5 s
//! backoff» e non lo faceva.
//!
//! [`con_attesa`] esegue la sessione e, se cade, la riapre: 1 → 2 → 4 … 30 s,
//! interrompibile, con l'attesa che torna a 1 s dopo una sessione durata
//! abbastanza. Il log lo dice una volta per caduta, non a ogni secondo.

use std::future::Future;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// La prima attesa dopo una caduta.
pub const ATTESA_MIN: Duration = Duration::from_secs(1);
/// Il tetto delle attese.
pub const ATTESA_MAX: Duration = Duration::from_secs(30);
/// Una sessione durata almeno così era sana: la caduta successiva riparte da
/// [`ATTESA_MIN`] invece di continuare a raddoppiare.
pub const SESSIONE_SANA: Duration = Duration::from_secs(60);

/// L'attesa dopo una caduta, data quella di prima e quanto è durata la
/// sessione appena caduta. Pura.
pub fn prossima_attesa(prima: Option<Duration>, durata_sessione: Duration) -> Duration {
    match prima {
        _ if durata_sessione >= SESSIONE_SANA => ATTESA_MIN,
        None => ATTESA_MIN,
        Some(p) => (p * 2).min(ATTESA_MAX),
    }
}

/// Esegue `sessione` finché `cancel` non scatta. Ogni volta che torna con un
/// errore chiama `alla_caduta` (chi chiama marca Bad i suoi tag), aspetta e la
/// riapre. Una sessione che torna `Ok` è finita per volere suo (cancellata):
/// si esce.
pub async fn con_attesa<S, Fut, C, FutC>(
    sorgente: &str,
    cancel: CancellationToken,
    mut sessione: S,
    mut alla_caduta: C,
) where
    S: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
    C: FnMut() -> FutC,
    FutC: Future<Output = ()>,
{
    let mut attesa: Option<Duration> = None;
    loop {
        let inizio = Instant::now();
        let esito = tokio::select! {
            _ = cancel.cancelled() => return,
            r = sessione() => r,
        };
        match esito {
            Ok(()) => return,
            Err(e) => {
                alla_caduta().await;
                let a = prossima_attesa(attesa, inizio.elapsed());
                attesa = Some(a);
                tracing::warn!(source = %sorgente, "sessione caduta: {e:#} — riprovo fra {} s", a.as_secs());
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(a) => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[test]
    fn le_attese_crescono_fino_al_tetto_e_ripartono_dopo_una_sessione_sana() {
        let breve = Duration::from_millis(10);
        let mut a = prossima_attesa(None, breve);
        let mut viste = vec![a.as_secs()];
        for _ in 0..7 {
            a = prossima_attesa(Some(a), breve);
            viste.push(a.as_secs());
        }
        assert_eq!(viste, vec![1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(prossima_attesa(Some(ATTESA_MAX), SESSIONE_SANA), ATTESA_MIN);
    }

    #[tokio::test(start_paused = true)]
    async fn riapre_la_sessione_e_si_ferma_col_cancel() {
        let tentativi = Arc::new(AtomicU32::new(0));
        let cadute = Arc::new(AtomicU32::new(0));
        let cancel = CancellationToken::new();
        let (t, c, k) = (tentativi.clone(), cadute.clone(), cancel.clone());
        let h = tokio::spawn(async move {
            con_attesa(
                "prova",
                k,
                || {
                    let t = t.clone();
                    async move {
                        t.fetch_add(1, Ordering::SeqCst);
                        anyhow::bail!("connessione rifiutata")
                    }
                },
                || {
                    let c = c.clone();
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                    }
                },
            )
            .await
        });
        // 1 + 2 + 4 s di attese: al quarto tentativo.
        tokio::time::sleep(Duration::from_millis(7_500)).await;
        assert_eq!(tentativi.load(Ordering::SeqCst), 4);
        assert_eq!(cadute.load(Ordering::SeqCst), 4);
        cancel.cancel();
        h.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn una_sessione_che_finisce_bene_non_si_riapre() {
        let tentativi = Arc::new(AtomicU32::new(0));
        let t = tentativi.clone();
        con_attesa(
            "prova",
            CancellationToken::new(),
            || {
                let t = t.clone();
                async move {
                    t.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }
            },
            || async {},
        )
        .await;
        assert_eq!(tentativi.load(Ordering::SeqCst), 1);
    }
}
