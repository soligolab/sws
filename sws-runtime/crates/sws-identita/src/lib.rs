//! Identity of an **installation**: who may open the IDE, independently of any project.
//!
//! # Perché questo crate esiste, e perché non è `sws-auth`
//!
//! `sws-auth` tiene gli utenti **del progetto**: vivono in `users.yaml` dentro la cartella del
//! progetto, viaggiano con il deploy e proteggono l'impianto. Sono gli operatori di reparto.
//!
//! Qui stanno gli utenti **dell'installazione**: chi apre l'editor. Sono due cose diverse e
//! mescolarle è già costato caro — il 14-09-2026 definire il primo utente di un progetto
//! (un Operator, pensato per il pannello) ha chiuso il maintainer fuori dal proprio editor,
//! perché scrivere `users.yaml` accendeva l'autenticazione **nello stesso runtime** che serviva
//! l'IDE. La correzione di allora spense l'autenticazione sull'IDE del tutto, con un prezzo
//! dichiarato: «un IDE raggiungibile in rete non ha più password» (Q56). Questo crate è il modo
//! di pagare quel debito senza rifare la confusione: due archivi, due scopi.
//!
//! Lo dice anche la decisione 22 del piano identità: account cloud e account d'impianto separati.
//!
//! # Scelte, con il loro motivo
//!
//! - **SQLite e non YAML.** Gli utenti del progetto sono pochi e si leggono tutti insieme; qui
//!   servono ricerche per email, conteggi per le quote (decisione 23) e — soprattutto — scritture
//!   da **più processi**: il gateway e i container dei progetti condividono lo stesso archivio.
//!   Un file YAML riscritto per intero da due processi si perde pezzi. `rusqlite` è già una
//!   dipendenza del workspace (lo usa lo storico), quindi non se ne aggiungono.
//! - **Le sessioni sono persistite**, al contrario di `sws-auth` che le tiene in RAM. Dietro un
//!   gateway che avvia e ferma container, una sessione che muore al riavvio del processo
//!   significa buttare fuori l'utente ogni volta che la piattaforma si muove.
//! - **Il token non è salvato in chiaro**: nel database va il suo SHA-256. Se il file finisce
//!   nelle mani sbagliate — una copia di sicurezza, un disco dismesso — non contiene sessioni
//!   utilizzabili. È la stessa ragione per cui le password non si salvano in chiaro, applicata a
//!   una credenziale che vale quanto una password finché non scade.
//! - **L'identità è l'email** (decisione 19): serve per la verifica dell'indirizzo, il recupero
//!   password e gli inviti, che arrivano in Fase 5.
//! - **Il limite ai tentativi resta in memoria.** È per sua natura effimero: un riavvio azzera il
//!   blocco, come in `sws-auth`. Persisterlo darebbe a chi prova password un modo di bloccare un
//!   utente vero in modo duraturo.
//!
//! # Fuori perimetro, per ora
//!
//! Aziende, appartenenze e quote (Fase 3), TOTP e verifica dell'indirizzo (Fase 5). Lo schema
//! lascia il posto a `totp_segreto` perché aggiungere una colonna a una tabella già popolata è
//! più scomodo che prevederla, ma qui nessuno la legge.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::task;
use tracing::{info, warn};

/// Ruolo di un utente dell'installazione.
///
/// Ordinato dal più debole al più forte, così `>=` confronta correttamente — stessa convenzione
/// di `sws_auth::Role`, e per la stessa ragione: i controlli di permesso si scrivono una volta.
///
/// Sono **due** e non quattro perché la decisione 18 ne prevede due per l'azienda
/// (amministratore e sviluppatore). Il terzo, l'amministratore di piattaforma che approva le
/// aziende (decisione 17), arriva con le aziende stesse in Fase 3: aggiungerlo ora vorrebbe dire
/// inventare adesso cosa può fare, e si deciderebbe per inerzia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Ruolo {
    Sviluppatore,
    Amministratore,
}

impl Ruolo {
    pub fn come_testo(self) -> &'static str {
        match self {
            Ruolo::Sviluppatore => "sviluppatore",
            Ruolo::Amministratore => "amministratore",
        }
    }

    fn da_testo(s: &str) -> anyhow::Result<Self> {
        match s {
            "sviluppatore" => Ok(Ruolo::Sviluppatore),
            "amministratore" => Ok(Ruolo::Amministratore),
            altro => Err(anyhow::anyhow!("ruolo sconosciuto nel database: {altro}")),
        }
    }
}

/// Un utente, senza la sua password. Il tipo pubblico non porta l'hash: così non può finire in
/// una risposta HTTP per distrazione.
#[derive(Debug, Clone, Serialize)]
pub struct Utente {
    pub id: i64,
    pub email: String,
    pub nome: String,
    pub ruolo: Ruolo,
    pub attivo: bool,
    pub deve_cambiare_password: bool,
    pub creato_ms: u64,
}

/// Esito di un accesso riuscito.
#[derive(Debug, Clone, Serialize)]
pub struct Accesso {
    pub token: String,
    pub utente: Utente,
    pub scade_ms: u64,
}

/// Perché un accesso è stato rifiutato.
///
/// `Bloccato` è distinto da `CredenzialiErrate` perché il chiamante deve rispondere 429 con
/// `Retry-After` e non 401: un client che riprova a oltranza contro un 401 peggiora il blocco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rifiuto {
    CredenzialiErrate,
    Bloccato { riprova_fra: Duration },
    UtenteDisattivato,
}

impl std::fmt::Display for Rifiuto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Rifiuto::CredenzialiErrate => write!(f, "credenziali errate"),
            Rifiuto::Bloccato { riprova_fra } => {
                write!(f, "troppi tentativi, riprova fra {}s", riprova_fra.as_secs())
            }
            Rifiuto::UtenteDisattivato => write!(f, "utente disattivato"),
        }
    }
}

/// Quante volte si può sbagliare, e per quanto si resta fuori.
const TENTATIVI_MAX: u32 = 5;
const FINESTRA: Duration = Duration::from_secs(300);
/// Durata di una sessione. Scorre a ogni uso (vedi [`Identita::valida`]).
const DURATA_SESSIONE: Duration = Duration::from_secs(8 * 3600);

#[derive(Debug, Clone, Copy)]
struct Fallimenti {
    inizio: Instant,
    quanti: u32,
    bloccato_fino: Option<Instant>,
}

/// L'archivio delle identità dell'installazione.
///
/// Si clona a buon mercato (`Arc` dentro) e si condivide fra i gestori delle rotte.
#[derive(Clone)]
pub struct Identita {
    conn: Arc<Mutex<Connection>>,
    /// Effimero di proposito: vedi la nota in testa al modulo.
    fallimenti: Arc<Mutex<HashMap<String, Fallimenti>>>,
    percorso: PathBuf,
}

fn ora_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// L'impronta di un token. Nel database non finisce mai il token in chiaro.
fn impronta(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    format!("{:x}", h.finalize())
}

pub fn cifra_password(password: &str) -> anyhow::Result<String> {
    let sale = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &sale)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash password: {e}"))
}

/// Un hash malformato vale «non combacia», non un errore: un record corrotto non deve far
/// passare nessuno, ma nemmeno rompere l'accesso di tutti gli altri.
pub fn verifica_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(h) => Argon2::default()
            .verify_password(password.as_bytes(), &h)
            .is_ok(),
        Err(_) => false,
    }
}

/// Lo schema. `user_version` di SQLite fa da numero di revisione: una migrazione futura guarda
/// quello e sa da dove partire, senza doverlo indovinare dalle tabelle presenti.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS utenti (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    email                  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nome                   TEXT    NOT NULL DEFAULT '',
    hash_password          TEXT    NOT NULL,
    ruolo                  TEXT    NOT NULL,
    attivo                 INTEGER NOT NULL DEFAULT 1,
    deve_cambiare_password INTEGER NOT NULL DEFAULT 0,
    totp_segreto           TEXT,
    totp_attivo            INTEGER NOT NULL DEFAULT 0,
    creato_ms              INTEGER NOT NULL,
    aggiornato_ms          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessioni (
    impronta_token TEXT    PRIMARY KEY,
    utente_id      INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
    creata_ms      INTEGER NOT NULL,
    scade_ms       INTEGER NOT NULL,
    ultimo_uso_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessioni_utente ON sessioni(utente_id);
"#;

impl Identita {
    /// Apre (o crea) l'archivio in `percorso`, di solito `<config_dir>/identita.db`.
    pub async fn apri(percorso: impl AsRef<Path>) -> anyhow::Result<Self> {
        let percorso = percorso.as_ref().to_path_buf();
        let p = percorso.clone();
        let conn = task::spawn_blocking(move || -> anyhow::Result<Connection> {
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let conn = Connection::open(&p)?;
            // WAL: il gateway e i container dei progetti leggono lo stesso file insieme, e senza
            // questo un lettore blocca uno scrittore.
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            conn.execute_batch(SCHEMA)?;
            conn.pragma_update(None, "user_version", 1)?;
            // Il file contiene hash di password e sessioni: non deve essere leggibile da altri.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
            }
            Ok(conn)
        })
        .await??;
        info!(percorso = %percorso.display(), "archivio identità aperto");
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            fallimenti: Arc::new(Mutex::new(HashMap::new())),
            percorso,
        })
    }

    pub fn percorso(&self) -> &Path {
        &self.percorso
    }

    /// Vero se esiste almeno un utente. È la domanda su cui si decide se mostrare la schermata
    /// del **primo accesso** invece di quella di login.
    pub async fn ha_utenti(&self) -> anyhow::Result<bool> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap();
            let n: i64 = c.query_row("SELECT COUNT(*) FROM utenti", [], |r| r.get(0))?;
            Ok(n > 0)
        })
        .await?
    }

    pub async fn crea_utente(
        &self,
        email: &str,
        nome: &str,
        password: &str,
        ruolo: Ruolo,
        deve_cambiare_password: bool,
    ) -> anyhow::Result<Utente> {
        let email_pulita = email.trim().to_string();
        if email_pulita.is_empty() || !email_pulita.contains('@') {
            anyhow::bail!("email non valida: «{email}»");
        }
        if password.len() < 8 {
            anyhow::bail!("la password deve essere di almeno 8 caratteri");
        }
        let hash = cifra_password(password)?;
        let nome = nome.trim().to_string();
        let conn = self.conn.clone();
        let utente = task::spawn_blocking(move || -> anyhow::Result<Utente> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            c.execute(
                "INSERT INTO utenti (email, nome, hash_password, ruolo, attivo,
                                     deve_cambiare_password, creato_ms, aggiornato_ms)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
                params![
                    email_pulita,
                    nome,
                    hash,
                    ruolo.come_testo(),
                    deve_cambiare_password as i64,
                    adesso as i64
                ],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(f, _)
                    if f.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    anyhow::anyhow!("esiste già un utente con l'indirizzo «{email_pulita}»")
                }
                altro => anyhow::anyhow!("creazione utente: {altro}"),
            })?;
            Ok(Utente {
                id: c.last_insert_rowid(),
                email: email_pulita,
                nome,
                ruolo,
                attivo: true,
                deve_cambiare_password,
                creato_ms: adesso,
            })
        })
        .await??;
        info!(email = %utente.email, ruolo = utente.ruolo.come_testo(), "utente creato");
        Ok(utente)
    }

    /// Verifica le credenziali e apre una sessione.
    ///
    /// Il limite ai tentativi è **per email**, non per indirizzo IP: dietro un gateway tutti gli
    /// utenti condividono l'indirizzo, e bloccare quello chiuderebbe fuori anche gli innocenti.
    pub async fn accedi(&self, email: &str, password: &str) -> Result<Accesso, Rifiuto> {
        let chiave = email.trim().to_lowercase();

        if let Some(attesa) = self.blocco_residuo(&chiave) {
            return Err(Rifiuto::Bloccato { riprova_fra: attesa });
        }

        let conn = self.conn.clone();
        let chiave_sql = chiave.clone();
        let trovato = task::spawn_blocking(move || -> Option<(i64, String, String, String, bool, bool, u64)> {
            let c = conn.lock().unwrap();
            c.query_row(
                "SELECT id, email, nome, hash_password, ruolo, attivo, deve_cambiare_password, creato_ms
                 FROM utenti WHERE email = ?1",
                params![chiave_sql],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(5)? != 0,
                        r.get::<_, i64>(6)? != 0,
                        r.get::<_, i64>(7)? as u64,
                    ))
                    .map(|t| (t.0, t.1, t.2, t.3, t.4, t.5, t.6))
                },
            )
            .optional()
            .ok()
            .flatten()
            .map(|t| t)
        })
        .await
        .ok()
        .flatten();

        // Un utente inesistente e una password sbagliata danno la stessa risposta: dire «questo
        // indirizzo non esiste» regalerebbe a chi prova l'elenco degli iscritti.
        let Some((id, email_vera, nome, hash, attivo, deve_cambiare, creato_ms)) = trovato else {
            self.segna_fallimento(&chiave);
            return Err(Rifiuto::CredenzialiErrate);
        };
        let ruolo = self.ruolo_di(id).await.unwrap_or(Ruolo::Sviluppatore);

        if !verifica_password(password, &hash) {
            self.segna_fallimento(&chiave);
            return Err(Rifiuto::CredenzialiErrate);
        }
        if !attivo {
            return Err(Rifiuto::UtenteDisattivato);
        }

        self.fallimenti.lock().unwrap().remove(&chiave);

        let token = uuid::Uuid::new_v4().to_string();
        let scade_ms = ora_ms() + DURATA_SESSIONE.as_millis() as u64;
        let imp = impronta(&token);
        let conn = self.conn.clone();
        let _ = task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            c.execute(
                "INSERT INTO sessioni (impronta_token, utente_id, creata_ms, scade_ms, ultimo_uso_ms)
                 VALUES (?1, ?2, ?3, ?4, ?3)",
                params![imp, id, adesso as i64, scade_ms as i64],
            )?;
            // Pulizia opportunistica: le sessioni scadute non servono a nessuno e il momento in
            // cui se ne crea una è quello giusto per toglierle, senza un lavoro periodico in più.
            let _ = c.execute("DELETE FROM sessioni WHERE scade_ms < ?1", params![adesso as i64]);
            Ok(())
        })
        .await;

        info!(email = %email_vera, "accesso riuscito");
        Ok(Accesso {
            token,
            utente: Utente {
                id,
                email: email_vera,
                nome,
                ruolo,
                attivo,
                deve_cambiare_password: deve_cambiare,
                creato_ms,
            },
            scade_ms,
        })
    }

    async fn ruolo_di(&self, id: i64) -> anyhow::Result<Ruolo> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Ruolo> {
            let c = conn.lock().unwrap();
            let s: String =
                c.query_row("SELECT ruolo FROM utenti WHERE id = ?1", params![id], |r| r.get(0))?;
            Ruolo::da_testo(&s)
        })
        .await?
    }

    /// Valida un token e **fa scorrere** la scadenza.
    ///
    /// Lo scorrimento è deliberato: chi sta lavorando non deve essere buttato fuori a metà di una
    /// modifica solo perché sono passate otto ore dall'accesso. Chi ha smesso, invece, scade.
    pub async fn valida(&self, token: &str) -> Option<Utente> {
        let imp = impronta(token);
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> Option<Utente> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            let riga = c
                .query_row(
                    "SELECT u.id, u.email, u.nome, u.ruolo, u.attivo, u.deve_cambiare_password,
                            u.creato_ms, s.scade_ms
                     FROM sessioni s JOIN utenti u ON u.id = s.utente_id
                     WHERE s.impronta_token = ?1",
                    params![imp],
                    |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)? != 0,
                            r.get::<_, i64>(5)? != 0,
                            r.get::<_, i64>(6)? as u64,
                            r.get::<_, i64>(7)? as u64,
                        ))
                    },
                )
                .optional()
                .ok()
                .flatten()?;

            let (id, email, nome, ruolo, attivo, deve_cambiare, creato_ms, scade_ms) = riga;
            if scade_ms <= adesso {
                let _ = c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp]);
                return None;
            }
            // Un utente disattivato perde la sessione subito, senza aspettarne la scadenza:
            // altrimenti una revoca non arriverebbe a destinazione per ore.
            if !attivo {
                let _ = c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp]);
                return None;
            }
            let nuova_scadenza = adesso + DURATA_SESSIONE.as_millis() as u64;
            let _ = c.execute(
                "UPDATE sessioni SET ultimo_uso_ms = ?1, scade_ms = ?2 WHERE impronta_token = ?3",
                params![adesso as i64, nuova_scadenza as i64, imp],
            );
            Some(Utente {
                id,
                email,
                nome,
                ruolo: Ruolo::da_testo(&ruolo).unwrap_or(Ruolo::Sviluppatore),
                attivo,
                deve_cambiare_password: deve_cambiare,
                creato_ms,
            })
        })
        .await
        .ok()
        .flatten()
    }

    pub async fn esci(&self, token: &str) -> anyhow::Result<()> {
        let imp = impronta(token);
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp])?;
            Ok(())
        })
        .await?
    }

    pub async fn elenca(&self) -> anyhow::Result<Vec<Utente>> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<Utente>> {
            let c = conn.lock().unwrap();
            let mut q = c.prepare(
                "SELECT id, email, nome, ruolo, attivo, deve_cambiare_password, creato_ms
                 FROM utenti ORDER BY email",
            )?;
            let righe = q
                .query_map([], |r| {
                    Ok(Utente {
                        id: r.get(0)?,
                        email: r.get(1)?,
                        nome: r.get(2)?,
                        ruolo: Ruolo::da_testo(&r.get::<_, String>(3)?)
                            .unwrap_or(Ruolo::Sviluppatore),
                        attivo: r.get::<_, i64>(4)? != 0,
                        deve_cambiare_password: r.get::<_, i64>(5)? != 0,
                        creato_ms: r.get::<_, i64>(6)? as u64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(righe)
        })
        .await?
    }

    /// Cambia la password e **chiude tutte le sessioni** di quell'utente.
    ///
    /// Non è zelo: se la password è stata cambiata perché si temeva fosse nota a qualcun altro,
    /// lasciare vive le sessioni aperte rende il cambio inutile — chi era dentro resta dentro.
    pub async fn cambia_password(&self, utente_id: i64, nuova: &str) -> anyhow::Result<()> {
        if nuova.len() < 8 {
            anyhow::bail!("la password deve essere di almeno 8 caratteri");
        }
        let hash = cifra_password(nuova)?;
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            let n = c.execute(
                "UPDATE utenti SET hash_password = ?1, deve_cambiare_password = 0,
                                   aggiornato_ms = ?2 WHERE id = ?3",
                params![hash, ora_ms() as i64, utente_id],
            )?;
            if n == 0 {
                anyhow::bail!("nessun utente con id {utente_id}");
            }
            c.execute("DELETE FROM sessioni WHERE utente_id = ?1", params![utente_id])?;
            Ok(())
        })
        .await?
    }

    /// Disattiva un utente: non può più accedere e le sue sessioni cadono subito.
    ///
    /// Si disattiva invece di cancellare perché l'identità è citata dal registro di audit: un id
    /// che sparisce rende illeggibile la storia di chi ha fatto cosa.
    pub async fn disattiva(&self, utente_id: i64) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE utenti SET attivo = 0, aggiornato_ms = ?1 WHERE id = ?2",
                params![ora_ms() as i64, utente_id],
            )?;
            c.execute("DELETE FROM sessioni WHERE utente_id = ?1", params![utente_id])?;
            Ok(())
        })
        .await?
    }

    // ── limite ai tentativi ──────────────────────────────────────────────────

    fn blocco_residuo(&self, chiave: &str) -> Option<Duration> {
        let mappa = self.fallimenti.lock().unwrap();
        let f = mappa.get(chiave)?;
        let fino = f.bloccato_fino?;
        let adesso = Instant::now();
        (fino > adesso).then(|| fino - adesso)
    }

    fn segna_fallimento(&self, chiave: &str) {
        let mut mappa = self.fallimenti.lock().unwrap();
        let adesso = Instant::now();
        let f = mappa.entry(chiave.to_string()).or_insert(Fallimenti {
            inizio: adesso,
            quanti: 0,
            bloccato_fino: None,
        });
        if adesso.duration_since(f.inizio) > FINESTRA {
            f.inizio = adesso;
            f.quanti = 0;
            f.bloccato_fino = None;
        }
        f.quanti += 1;
        if f.quanti >= TENTATIVI_MAX {
            f.bloccato_fino = Some(adesso + FINESTRA);
            warn!(utente = %chiave, "troppi tentativi di accesso: bloccato");
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    async fn archivio() -> (Identita, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let id = Identita::apri(dir.path().join("identita.db")).await.unwrap();
        (id, dir)
    }

    #[tokio::test]
    async fn archivio_nuovo_non_ha_utenti() {
        let (id, _d) = archivio().await;
        assert!(!id.ha_utenti().await.unwrap());
    }

    #[tokio::test]
    async fn crea_e_accede() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(id.ha_utenti().await.unwrap());
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        assert_eq!(a.utente.id, u.id);
        assert_eq!(a.utente.ruolo, Ruolo::Amministratore);
        assert!(id.valida(&a.token).await.is_some());
    }

    #[tokio::test]
    async fn email_non_distingue_maiuscole() {
        let (id, _d) = archivio().await;
        id.crea_utente("M@Soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        // Chi si registra con la maiuscola e accede con la minuscola è la stessa persona.
        assert!(id.accedi("m@soligo.net", "unapassword").await.is_ok());
        // E non deve poterne nascere un secondo che sembra diverso.
        let doppio = id
            .crea_utente("m@SOLIGO.NET", "Altro", "unapassword", Ruolo::Sviluppatore, false)
            .await;
        assert!(doppio.is_err(), "due utenti con lo stesso indirizzo");
    }

    #[tokio::test]
    async fn password_sbagliata_e_utente_inesistente_danno_lo_stesso_esito() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        assert_eq!(
            id.accedi("m@soligo.net", "sbagliata").await.unwrap_err(),
            Rifiuto::CredenzialiErrate
        );
        assert_eq!(
            id.accedi("nessuno@soligo.net", "unapassword").await.unwrap_err(),
            Rifiuto::CredenzialiErrate
        );
    }

    #[tokio::test]
    async fn il_token_non_e_in_chiaro_nel_database() {
        // Questo test è stato riscritto il 06-10-2026 perché la prima versione non provava
        // nulla: leggeva il solo `identita.db` e, in modalità WAL, la scrittura stava ancora nel
        // registro `-wal`. Il file principale era vuoto, quindi «il token non c'è» passava anche
        // se il token fosse stato salvato in chiaro. Ora si guardano TUTTI i file del database, e
        // si verifica anche il verso positivo: che l'impronta ci sia davvero.
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();

        let base = id.percorso().to_path_buf();
        let mut grezzo = Vec::new();
        for suffisso in ["", "-wal", "-shm"] {
            let p = base.with_file_name(format!(
                "{}{suffisso}",
                base.file_name().unwrap().to_string_lossy()
            ));
            if let Ok(mut b) = std::fs::read(&p) {
                grezzo.append(&mut b);
            }
        }
        let testo = String::from_utf8_lossy(&grezzo);
        assert!(
            !testo.contains(&a.token),
            "il token è finito in chiaro nei file del database"
        );
        assert!(
            testo.contains(&impronta(&a.token)),
            "l'impronta non si trova: il test non sta guardando dove scrive il database"
        );
    }

    #[tokio::test]
    async fn la_sessione_sopravvive_alla_riapertura() {
        // È metà del motivo per cui questo crate non tiene le sessioni in RAM: dietro un gateway
        // che riavvia i container, una sessione in memoria butta fuori l'utente a ogni riavvio.
        let dir = tempfile::tempdir().unwrap();
        let percorso = dir.path().join("identita.db");
        let token = {
            let id = Identita::apri(&percorso).await.unwrap();
            id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
                .await
                .unwrap();
            id.accedi("m@soligo.net", "unapassword").await.unwrap().token
        };
        let id2 = Identita::apri(&percorso).await.unwrap();
        assert!(
            id2.valida(&token).await.is_some(),
            "la sessione non è sopravvissuta alla riapertura dell'archivio"
        );
    }

    #[tokio::test]
    async fn uscire_invalida_il_token() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.esci(&a.token).await.unwrap();
        assert!(id.valida(&a.token).await.is_none());
    }

    #[tokio::test]
    async fn cambiare_password_chiude_le_sessioni() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.cambia_password(u.id, "nuovapassword").await.unwrap();
        assert!(
            id.valida(&a.token).await.is_none(),
            "la sessione aperta con la vecchia password è sopravvissuta al cambio"
        );
        assert!(id.accedi("m@soligo.net", "nuovapassword").await.is_ok());
    }

    #[tokio::test]
    async fn disattivare_butta_fuori_subito() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.disattiva(u.id).await.unwrap();
        assert!(id.valida(&a.token).await.is_none(), "revoca non arrivata");
        assert_eq!(
            id.accedi("m@soligo.net", "unapassword").await.unwrap_err(),
            Rifiuto::UtenteDisattivato
        );
    }

    #[tokio::test]
    async fn troppi_tentativi_bloccano() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        for _ in 0..TENTATIVI_MAX {
            let _ = id.accedi("m@soligo.net", "sbagliata").await;
        }
        // Anche con la password GIUSTA: altrimenti il blocco non bloccherebbe nulla.
        match id.accedi("m@soligo.net", "unapassword").await.unwrap_err() {
            Rifiuto::Bloccato { .. } => {}
            altro => panic!("atteso blocco, ottenuto {altro:?}"),
        }
    }

    #[tokio::test]
    async fn password_corta_rifiutata() {
        let (id, _d) = archivio().await;
        assert!(id
            .crea_utente("m@soligo.net", "Mauro", "corta", Ruolo::Sviluppatore, false)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn email_senza_chiocciola_rifiutata() {
        let (id, _d) = archivio().await;
        assert!(id
            .crea_utente("mauro", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .is_err());
    }
}
