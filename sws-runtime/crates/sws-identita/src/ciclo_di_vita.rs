//! Il ciclo di vita degli account che si registrano da sé (30-10-2026, ramo C di
//! `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
//!
//! L'informativa promette tre cose, e questo modulo le rende vere
//! (`docs/legale/LEGGIMI.md`, punto 4):
//!
//! - **dopo 12 mesi senza accessi parte un avviso**, e 30 giorni dopo, se nessuno
//!   è rientrato, l'account si cancella;
//! - **chi chiude l'account** è fuori subito, e 30 giorni dopo si cancella;
//! - una registrazione **mai confermata** non resta per sempre: dopo 30 giorni
//!   sparisce. Non c'è un'azienda da togliere, l'indirizzo non ha mai provato di
//!   essere di chi l'ha scritto.
//!
//! **Solo per chi si è registrato da sé** (`da_se`), decisione del maintainer: gli
//! utenti creati da un amministratore d'azienda li gestisce l'azienda. E mai un
//! amministratore di piattaforma, qualunque sia la sua storia.
//!
//! **Chi manda la posta e chi cancella le cartelle non è qui**: come per i codici,
//! questo modulo dice *chi* e il chiamante (`sws-web`) fa il resto. Il tempo
//! entra come argomento, così i test non aspettano un anno.

use super::*;

/// Senza accessi per tanto, parte l'avviso.
pub const INATTIVITA: Duration = Duration::from_secs(365 * 24 * 3600);
/// Dall'avviso, o dalla chiusura, alla cancellazione.
pub const PREAVVISO: Duration = Duration::from_secs(30 * 24 * 3600);

/// Chi ricevere l'avviso dei 12 mesi.
#[derive(Debug, Clone, PartialEq)]
pub struct DaAvvisare {
    pub id: i64,
    pub email: String,
    /// L'ultimo accesso, o la registrazione se non è mai entrato.
    pub ultimo_accesso_ms: u64,
}

/// Perché un account è stato cancellato.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Motivo {
    Inattivo,
    Chiuso,
    NonConfermato,
}

/// Un account cancellato, con le cartelle delle sue aziende personali: le toglie
/// il chiamante, che conosce la radice dei progetti.
#[derive(Debug, Clone, PartialEq)]
pub struct Cancellato {
    pub id: i64,
    pub email: String,
    pub motivo: Motivo,
    pub cartelle: Vec<String>,
    /// I nomi delle stesse aziende: il gateway indirizza i progetti aperti per nome.
    pub aziende: Vec<String>,
}

impl Identita {
    /// Gli account da avvisare oggi. Non segna niente: lo fa
    /// [`Identita::segna_avvisato`], **dopo** che la posta è partita, così un
    /// avviso non spedito non fa partire il conto alla rovescia.
    pub async fn da_avvisare(&self, adesso_ms: u64) -> anyhow::Result<Vec<DaAvvisare>> {
        let soglia = adesso_ms.saturating_sub(INATTIVITA.as_millis() as u64) as i64;
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<DaAvvisare>> {
            let c = conn.lock().unwrap();
            let mut q = c.prepare(
                "SELECT id, email, COALESCE(ultimo_accesso_ms, creato_ms) FROM utenti
                 WHERE da_se = 1 AND attivo = 1 AND da_confermare = 0
                   AND amministratore_piattaforma = 0 AND chiuso_ms IS NULL
                   AND avviso_inattivita_ms IS NULL
                   AND COALESCE(ultimo_accesso_ms, creato_ms) < ?1
                 ORDER BY id",
            )?;
            let righe = q.query_map(params![soglia], |r| {
                Ok(DaAvvisare { id: r.get(0)?, email: r.get(1)?, ultimo_accesso_ms: r.get::<_, i64>(2)? as u64 })
            })?;
            Ok(righe.collect::<Result<_, _>>()?)
        })
        .await?
    }

    /// L'avviso è partito: da qui contano i 30 giorni.
    pub async fn segna_avvisato(&self, utente_id: i64, adesso_ms: u64) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE utenti SET avviso_inattivita_ms = ?1 WHERE id = ?2",
                params![adesso_ms as i64, utente_id],
            )?;
            Ok(())
        })
        .await?
    }

    /// Chiude l'account di chi lo chiede, con la sua password: da subito non
    /// entra più e le sessioni cadono; fra 30 giorni [`Identita::cancella_scaduti`]
    /// lo toglie. Solo per chi si è registrato da sé.
    pub async fn chiudi_account(&self, email: &str, password: &str, adesso_ms: u64) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        let chiave = email.trim().to_lowercase();
        let trovato: Option<(i64, String)> = {
            let conn = conn.clone();
            task::spawn_blocking(move || {
                let c = conn.lock().unwrap();
                c.query_row(
                    "SELECT id, hash_password FROM utenti
                     WHERE email = ?1 AND attivo = 1 AND da_se = 1 AND amministratore_piattaforma = 0",
                    params![chiave],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
            })
            .await??
        };
        let Some((utente_id, hash)) = trovato else {
            anyhow::bail!("questo account non si chiude da qui: lo gestisce chi l'ha creato");
        };
        if !verifica_password(password, &hash) {
            anyhow::bail!("la password non è corretta");
        }
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE utenti SET attivo = 0, chiuso_ms = ?1, aggiornato_ms = ?1 WHERE id = ?2",
                params![adesso_ms as i64, utente_id],
            )?;
            c.execute("DELETE FROM sessioni WHERE utente_id = ?1", params![utente_id])?;
            Ok(())
        })
        .await?
    }

    /// Questo account si è registrato da sé, e quindi lo può chiudere da sé.
    pub async fn chiudibile(&self, email: &str) -> bool {
        let conn = self.conn.clone();
        let chiave = email.trim().to_lowercase();
        task::spawn_blocking(move || {
            let c = conn.lock().unwrap();
            c.query_row(
                "SELECT COUNT(*) FROM utenti
                 WHERE email = ?1 AND attivo = 1 AND da_se = 1 AND amministratore_piattaforma = 0",
                params![chiave],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
                > 0
        })
        .await
        .unwrap_or(false)
    }

    /// Cancella gli account il cui tempo è finito, con le loro aziende personali,
    /// e dice quali erano. Tutto in una transazione: o sparisce l'account con le
    /// sue aziende, o niente.
    pub async fn cancella_scaduti(&self, adesso_ms: u64) -> anyhow::Result<Vec<Cancellato>> {
        let soglia = adesso_ms.saturating_sub(PREAVVISO.as_millis() as u64) as i64;
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<Cancellato>> {
            let mut c = conn.lock().unwrap();
            let tx = c.transaction()?;
            let scelti: Vec<(i64, String, Motivo)> = {
                let mut q = tx.prepare(
                    "SELECT id, email,
                            CASE WHEN da_confermare = 1 THEN 'non_confermato'
                                 WHEN chiuso_ms IS NOT NULL THEN 'chiuso'
                                 ELSE 'inattivo' END
                     FROM utenti
                     WHERE da_se = 1 AND amministratore_piattaforma = 0 AND (
                           (da_confermare = 1 AND aggiornato_ms < ?1)
                        OR (chiuso_ms IS NOT NULL AND chiuso_ms < ?1)
                        OR (avviso_inattivita_ms IS NOT NULL AND avviso_inattivita_ms < ?1
                            AND COALESCE(ultimo_accesso_ms, 0) < avviso_inattivita_ms))
                     ORDER BY id",
                )?;
                let righe = q.query_map(params![soglia], |r| {
                    let motivo = match r.get::<_, String>(2)?.as_str() {
                        "non_confermato" => Motivo::NonConfermato,
                        "chiuso" => Motivo::Chiuso,
                        _ => Motivo::Inattivo,
                    };
                    Ok((r.get(0)?, r.get(1)?, motivo))
                })?;
                righe.collect::<Result<_, _>>()?
            };
            let mut fatti = Vec::new();
            for (id, email, motivo) in scelti {
                // Le aziende personali di cui è l'unico membro: con lui se ne vanno.
                // Un'azienda personale con altri dentro non si tocca — oggi non
                // succede, ma cancellare il lavoro di qualcun altro è il guasto
                // da non poter fare nemmeno per sbaglio.
                let aziende: Vec<(i64, String, String)> = {
                    let mut q = tx.prepare(
                        "SELECT a.id, a.cartella, a.nome FROM aziende a JOIN membri m ON m.azienda_id = a.id
                         WHERE m.utente_id = ?1 AND a.personale = 1 AND a.implicita = 0
                           AND (SELECT COUNT(*) FROM membri n WHERE n.azienda_id = a.id) = 1",
                    )?;
                    let righe = q.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                    righe.collect::<Result<_, _>>()?
                };
                for (azienda, _, _) in &aziende {
                    tx.execute("DELETE FROM aziende WHERE id = ?1", params![azienda])?;
                }
                tx.execute("DELETE FROM utenti WHERE id = ?1", params![id])?;
                fatti.push(Cancellato {
                    id,
                    email,
                    motivo,
                    cartelle: aziende.iter().map(|(_, c, _)| c.clone()).filter(|c| !c.is_empty()).collect(),
                    aziende: aziende.into_iter().map(|(_, _, n)| n).collect(),
                });
            }
            tx.commit()?;
            Ok(fatti)
        })
        .await?
    }
}

#[cfg(test)]
mod test {
    use super::*;

    const GIORNO: u64 = 24 * 3600 * 1000;

    async fn archivio() -> (Identita, std::path::PathBuf) {
        // Un contatore e non solo l'ora: i test girano insieme, e due nello
        // stesso millisecondo si sarebbero presi lo stesso archivio.
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("sws-ciclo-{}-{}-{n}", std::process::id(), ora_ms()));
        let id = Identita::apri(dir.join("identita.db")).await.unwrap();
        (id, dir)
    }

    /// Un account registrato e confermato, con la sua azienda personale.
    async fn registrato(id: &Identita, email: &str) -> i64 {
        let Registrato::Codice(codice) = id.registra(email, "password-lunga").await.unwrap() else {
            panic!("registrazione rifiutata")
        };
        let (accesso, _) = id.conferma_registrazione(email, &codice).await.unwrap();
        accesso.utente.id
    }

    /// Sposta indietro nel tempo le date di un account, come se fosse passato
    /// tanto tempo.
    async fn invecchia(id: &Identita, utente: i64, colonna: &str, ms: u64) {
        let sql = format!("UPDATE utenti SET {colonna} = ?1 WHERE id = ?2");
        let c = id.conn.lock().unwrap();
        c.execute(&sql, params![ms as i64, utente]).unwrap();
    }

    #[tokio::test]
    async fn dodici_mesi_senza_accessi_avviso_poi_cancellazione() {
        let (id, dir) = archivio().await;
        let u = registrato(&id, "mario@tizio.it").await;
        let adesso = ora_ms();
        invecchia(&id, u, "ultimo_accesso_ms", adesso - 366 * GIORNO).await;

        let avvisi = id.da_avvisare(adesso).await.unwrap();
        assert_eq!(avvisi.iter().map(|a| a.id).collect::<Vec<_>>(), vec![u]);
        id.segna_avvisato(u, adesso - 31 * GIORNO).await.unwrap();
        assert!(id.da_avvisare(adesso).await.unwrap().is_empty(), "un avviso solo");

        let via = id.cancella_scaduti(adesso).await.unwrap();
        assert_eq!(via.len(), 1);
        assert_eq!(via[0].motivo, Motivo::Inattivo);
        assert_eq!(via[0].cartelle.len(), 1);
        assert!(via[0].cartelle[0].starts_with('u'), "{:?}", via[0].cartelle);
        assert!(id.elenca_aziende().await.unwrap().iter().all(|a| !a.personale), "l'azienda personale se ne va");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn chi_rientra_dopo_l_avviso_resta() {
        let (id, dir) = archivio().await;
        let u = registrato(&id, "mario@tizio.it").await;
        let adesso = ora_ms();
        id.segna_avvisato(u, adesso - 31 * GIORNO).await.unwrap();
        // Rientra: l'accesso azzera l'avviso.
        id.accedi("mario@tizio.it", "password-lunga").await.unwrap();
        assert!(id.cancella_scaduti(adesso).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn la_chiusura_e_subito_fuori_e_dopo_trenta_giorni_via() {
        let (id, dir) = archivio().await;
        registrato(&id, "mario@tizio.it").await;
        assert!(id.chiudibile("Mario@Tizio.it").await);
        assert!(id.chiudi_account("mario@tizio.it", "sbagliata", ora_ms()).await.is_err());
        id.chiudi_account("mario@tizio.it", "password-lunga", ora_ms()).await.unwrap();
        assert!(!id.chiudibile("mario@tizio.it").await);
        assert!(id.accedi("mario@tizio.it", "password-lunga").await.is_err(), "fuori da subito");
        assert!(id.cancella_scaduti(ora_ms()).await.unwrap().is_empty(), "non prima dei 30 giorni");
        let via = id.cancella_scaduti(ora_ms() + 31 * GIORNO).await.unwrap();
        assert_eq!(via.iter().map(|c| c.motivo).collect::<Vec<_>>(), vec![Motivo::Chiuso]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn riattivare_entro_trenta_giorni_annulla_la_chiusura() {
        let (id, dir) = archivio().await;
        let u = registrato(&id, "mario@tizio.it").await;
        id.chiudi_account("mario@tizio.it", "password-lunga", ora_ms()).await.unwrap();
        id.riattiva(u).await.unwrap();
        assert!(id.cancella_scaduti(ora_ms() + 31 * GIORNO).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn gli_utenti_creati_dall_azienda_non_si_toccano() {
        let (id, dir) = archivio().await;
        let u = id.crea_utente("anna@azienda.it", "Anna", "password-lunga", Ruolo::Sviluppatore, false).await.unwrap().id;
        invecchia(&id, u, "creato_ms", 1).await;
        assert!(id.da_avvisare(ora_ms()).await.unwrap().is_empty());
        assert!(!id.chiudibile("anna@azienda.it").await);
        assert!(id.chiudi_account("anna@azienda.it", "password-lunga", ora_ms()).await.is_err());
        invecchia(&id, u, "avviso_inattivita_ms", 1).await;
        assert!(id.cancella_scaduti(ora_ms()).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn una_registrazione_mai_confermata_sparisce_dopo_trenta_giorni() {
        let (id, dir) = archivio().await;
        id.registra("ombra@tizio.it", "password-lunga").await.unwrap();
        assert!(id.cancella_scaduti(ora_ms()).await.unwrap().is_empty());
        let via = id.cancella_scaduti(ora_ms() + 31 * GIORNO).await.unwrap();
        assert_eq!(via.len(), 1);
        assert_eq!((via[0].motivo, via[0].cartelle.len()), (Motivo::NonConfermato, 0));
        let _ = std::fs::remove_dir_all(dir);
    }
}
