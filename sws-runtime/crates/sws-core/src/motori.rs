//! Un thread con un nome, e un runtime tokio sopra (27-10-2026, piano
//! `docs/plans/2026-10-27-thread-con-un-nome-e-una-priorita.md`).
//!
//! # Perché non basta dare un nome ai task
//!
//! Un task tokio **cambia thread a ogni `await`**: lo scheduler lo sposta fra i
//! worker. Quindi nessun nome di thread potrà mai voler dire «questo è il task
//! Modbus» finché quel task vive sul runtime condiviso — in `htop` si vedevano
//! ventun righe `tokio-rt-worker` su sei CPU, e non si sapeva chi mangiasse
//! cosa. E `nice`, su Linux, si applica a **un thread**: senza il thread, la
//! priorità non ha dove attaccarsi.
//!
//! Qui un lavoro prende un thread suo, con sopra un runtime a thread singolo.
//! Da quel momento `htop`, `top` e `/proc` lo chiamano col suo nome, e la sua
//! CPU è la sua.
//!
//! # Il limite dei 15 caratteri
//!
//! `TASK_COMM_LEN` è 16 col terminatore: **quindici caratteri utili**, e il
//! kernel tronca in silenzio. `sws-modbus` ci sta; un nome che ci infili anche
//! l'id della sorgente no, e due sorgenti con lo stesso prefisso diventerebbero
//! indistinguibili. Per questo il nome dice il **tipo** e la pagina
//! Prestazioni dice la sorgente, una per una (`sorgente.<id>`).
//!
//! # Le priorità si abbassano, non si alzano
//!
//! Abbassare la priorità non chiede privilegi; alzarla sì — serve `RLIMIT_NICE`
//! o `CAP_SYS_NICE`, e sul pannello il runtime gira come utente normale in un
//! container rootless. Quindi qui si scende e basta, sui lavori che possono
//! aspettare. E vale la pena ricordarlo: `nice` sposta la CPU, non il disco.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tracing::warn;

/// Quanti caratteri di un nome di thread Linux mostra davvero.
pub const MASSIMO_NOME: usize = 15;

/// Di quanto si abbassa la priorità di un lavoro di fondo. Dieci è il passo
/// usuale: resta ben sopra `SCHED_IDLE` (che su una macchina carica rischia di
/// non far scrivere mai lo storico) e sotto a tutto ciò che deve rispondere.
pub const GENTILEZZA_FONDO: i32 = 10;

static MOTORI: OnceLock<Mutex<HashMap<String, tokio::runtime::Handle>>> = OnceLock::new();

/// Il motore di `nome`, creandolo la prima volta. Chiamate successive con lo
/// stesso nome tornano **lo stesso** motore: è così che tutte le sorgenti di un
/// protocollo finiscono sullo stesso thread.
///
/// `gentilezza` a 0 lascia la priorità normale; sopra zero la abbassa (vedi
/// [`GENTILEZZA_FONDO`]). Vale solo alla creazione: il secondo chiamante trova
/// il motore già fatto e la sua gentilezza non conta.
///
/// Se il thread o il runtime non si possono creare, torna il runtime da cui si
/// chiama: il lavoro parte lo stesso, solo senza un nome suo. Perdere una
/// sorgente perché non si è potuto dare un nome a un thread sarebbe assurdo.
pub fn motore(nome: &str, gentilezza: i32) -> tokio::runtime::Handle {
    debug_assert!(
        nome.len() <= MASSIMO_NOME,
        "«{nome}» supera i {MASSIMO_NOME} caratteri: Linux lo troncherebbe"
    );
    let registro = MOTORI.get_or_init(Default::default);
    let mut g = registro.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(h) = g.get(nome) {
        return h.clone();
    }
    match crea(nome, gentilezza) {
        Some(h) => {
            g.insert(nome.to_string(), h.clone());
            h
        }
        None => {
            warn!(nome, "motore non creato: il lavoro resta sul runtime condiviso");
            tokio::runtime::Handle::current()
        }
    }
}

/// I nomi dei motori accesi, in ordine. Per la diagnosi e per le prove.
pub fn motori_accesi() -> Vec<String> {
    let registro = MOTORI.get_or_init(Default::default);
    let g = registro.lock().unwrap_or_else(|e| e.into_inner());
    let mut v: Vec<String> = g.keys().cloned().collect();
    v.sort();
    v
}

fn crea(nome: &str, gentilezza: i32) -> Option<tokio::runtime::Handle> {
    let (tx, rx) = std::sync::mpsc::channel();
    let nome_rt = nome.to_string();
    std::thread::Builder::new()
        .name(nome.to_string())
        .spawn(move || {
            abbassa_priorita(gentilezza);
            // `thread_name` qui vale per i thread bloccanti che questo runtime
            // creerà: una `spawn_blocking` di una sorgente Modbus si vedrà
            // anche lei come `sws-modbus`, non come un `tokio-rt-worker` in
            // mezzo agli altri.
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .thread_name(&nome_rt)
                // Anche i thread bloccanti di questo runtime: senza,
                // `spawn_blocking` di un lavoro di fondo tornerebbe a priorità
                // normale, ed è proprio lì che sta il lavoro pesante (lo
                // storico scrive da un thread bloccante).
                .on_thread_start(move || abbassa_priorita(gentilezza))
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    warn!(nome = %nome_rt, "runtime del motore non costruito: {e}");
                    let _ = tx.send(None);
                    return;
                }
            };
            let _ = tx.send(Some(rt.handle().clone()));
            // Il runtime a thread singolo muove i task spawnati solo mentre
            // qualcuno lo sta guidando: questo `block_on` è il motore vero.
            rt.block_on(std::future::pending::<()>());
        })
        .ok()?;
    rx.recv().ok().flatten()
}

/// Abbassa la priorità del **thread che chiama**.
///
/// Su Linux `nice` è per thread, e `setpriority(PRIO_PROCESS, 0, n)` con `who`
/// a zero vuol dire «io» — cioè questo thread, non il processo, nonostante il
/// nome della costante (POSIX dice processo, Linux fa thread).
#[cfg(target_os = "linux")]
fn abbassa_priorita(gentilezza: i32) {
    if gentilezza <= 0 {
        return;
    }
    // SAFETY: chiamata di sistema senza puntatori; fallisce al più tornando -1,
    // e un fallimento qui significa solo «priorità invariata».
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, gentilezza);
    }
}

#[cfg(not(target_os = "linux"))]
fn abbassa_priorita(_gentilezza: i32) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lo_stesso_nome_e_lo_stesso_motore() {
        let a = motore("sws-prova", 0);
        let b = motore("sws-prova", 0);
        assert_eq!(a.id(), b.id(), "due chiamate, un motore solo");
        assert!(motori_accesi().contains(&"sws-prova".to_string()));
    }

    #[tokio::test]
    async fn il_motore_esegue_e_non_e_quello_di_chi_chiama() {
        let m = motore("sws-prova2", GENTILEZZA_FONDO);
        let qui = tokio::runtime::Handle::current().id();
        let la = m.spawn(async { tokio::runtime::Handle::current().id() }).await.unwrap();
        assert_ne!(qui, la, "il task gira sul motore, non qui");
    }

    /// I nomi che il runtime usa davvero devono entrare nei 15 caratteri di
    /// Linux, altrimenti in `htop` si vedono troncati e due si confondono.
    #[test]
    fn i_nomi_stanno_nei_quindici_caratteri() {
        for n in [
            "sws-modbus", "sws-mqtt", "sws-opcua", "sws-s7", "sws-enip", "sws-host",
            "sws-ha", "sws-storico", "sws-log", "sws-backup", "sws-ritenzione",
        ] {
            assert!(n.len() <= MASSIMO_NOME, "«{n}» è lungo {}", n.len());
        }
    }
}
