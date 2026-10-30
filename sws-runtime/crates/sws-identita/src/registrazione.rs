//! Registrazione da sé e accesso con un PIN per posta (30-10-2026, ramo C di
//! `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
//!
//! Qui sta tutto quello che riguarda i **codici monouso**: quello che conferma
//! l'indirizzo di chi si registra e il PIN che sostituisce la password per un
//! accesso. Le due cose sono la stessa meccanica con due scopi, e tenerle
//! insieme vuol dire un solo posto in cui il codice si genera, scade, si
//! consuma e si sbaglia.
//!
//! **Chi manda la posta non e qui**: questo modulo restituisce il codice al
//! chiamante (`sws-web`), che sa come si scrive un'e-mail. Cosi i test di
//! questo crate provano la meccanica senza un server SMTP.
//!
//! Le scelte, misurate sul piano:
//!
//! - **8 simboli Crockford, 40 bit**, mostrati in due gruppi di quattro. Con
//!   dieci minuti di vita e cinque tentativi per indirizzo bastano; 80 bit da
//!   ribattere a mano non li vuole nessuno.
//! - **I tentativi sbagliati contano insieme a quelli della password**: stessa
//!   chiave nello stesso contatore. Altrimenti chi e bloccato sulla password
//!   passerebbe al PIN e ricomincerebbe da capo.
//! - **Al blocco il codice in volo si butta**: chi ha sbagliato cinque volte ne
//!   chiede uno nuovo, e un tentativo indovinato dopo il blocco non vale.
//! - **Un codice al minuto per indirizzo**: chiedere un PIN manda una e-mail a
//!   una persona, e senza un freno chiunque potrebbe riempirle la casella.

use super::*;
use argon2::password_hash::rand_core::RngCore;

/// La versione delle condizioni d'uso che chi si registra accetta oggi
/// (`docs/legale/condizioni-d-uso.md`). Si salva nell'account insieme alla
/// data: quando il testo cambia, cambia questa e si sa chi ha accettato cosa.
pub const VERSIONE_CONDIZIONI: &str = "2026-10-29";

/// Quanto vive un codice.
const VITA_CODICE: Duration = Duration::from_secs(600);
/// Quanto aspettare prima di mandarne un altro allo stesso indirizzo.
const INTERVALLO_INVII: Duration = Duration::from_secs(60);
/// Il tetto ai progetti di un'azienda personale.
pub const PROGETTI_PERSONALI: i64 = 3;

const ALFABETO: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SIMBOLI: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scopo {
    /// Conferma l'indirizzo di chi si e appena registrato.
    Registrazione,
    /// Un accesso senza password.
    Accesso,
}

#[derive(Debug, Clone)]
pub(crate) struct InVolo {
    codice: String,
    nato: Instant,
}

/// Com'e andata una registrazione. **Il chiamante risponde allo stesso modo in
/// tutti e due i casi**: cambia solo l'e-mail che parte. Dire «questo indirizzo
/// e gia iscritto» a chi compila il modulo regalerebbe l'elenco degli iscritti.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Registrato {
    /// Utente nuovo, o registrazione ripetuta prima della conferma: ecco il
    /// codice da mandare.
    Codice(String),
    /// L'indirizzo ha gia un account confermato: al suo proprietario si scrive
    /// che qualcuno ha provato a registrarlo, senza nessun codice.
    GiaIscritto,
    /// Un codice e partito meno di un minuto fa: non se ne manda un altro.
    TroppoPresto,
}

fn chiave(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Un codice nuovo, `XXXX-XXXX`.
fn genera() -> String {
    let mut buf = [0u8; SIMBOLI];
    OsRng.fill_bytes(&mut buf);
    // 256 e multiplo di 32: il modulo non pende verso nessun simbolo.
    let grezzo: String = buf.iter().map(|b| ALFABETO[(*b % 32) as usize] as char).collect();
    format!("{}-{}", &grezzo[..4], &grezzo[4..])
}

/// Il codice come l'ha scritto una persona → la forma canonica, o `None`.
/// Minuscole, spazi e trattini vanno bene; `O` vale `0`, `I` e `L` valgono `1`
/// (Crockford) — la stessa regola dei codici di abbinamento dei pannelli.
pub fn normalizza(scritto: &str) -> Option<String> {
    let mut out = String::with_capacity(SIMBOLI);
    for c in scritto.chars() {
        let c = match c.to_ascii_uppercase() {
            ' ' | '-' | '\t' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        if !c.is_ascii() || !ALFABETO.contains(&(c as u8)) {
            return None;
        }
        out.push(c);
    }
    (out.len() == SIMBOLI).then(|| format!("{}-{}", &out[..4], &out[4..]))
}

/// Confronto a tempo costante: quanto ci mette non dice quanti simboli sono
/// giusti.
fn uguali(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Identita {
    /// Mette in volo un codice per `email` e lo restituisce, o `None` se ne e
    /// partito uno meno di un minuto fa.
    fn metti_in_volo(&self, email: &str, scopo: Scopo) -> Option<String> {
        let mut mappa = self.codici.lock().unwrap();
        let adesso = Instant::now();
        mappa.retain(|_, v| adesso.duration_since(v.nato) < VITA_CODICE);
        let k = (chiave(email), scopo);
        if mappa.get(&k).is_some_and(|v| adesso.duration_since(v.nato) < INTERVALLO_INVII) {
            return None;
        }
        let codice = genera();
        mappa.insert(k, InVolo { codice: codice.clone(), nato: adesso });
        Some(codice)
    }

    /// Verifica e **consuma** il codice. Uno sbagliato conta come una password
    /// sbagliata; al blocco il codice in volo si butta.
    fn consuma(&self, email: &str, scopo: Scopo, scritto: &str) -> Result<(), Rifiuto> {
        let k = chiave(email);
        if let Some(attesa) = self.blocco_residuo(&k) {
            return Err(Rifiuto::Bloccato { riprova_fra: attesa });
        }
        let mut mappa = self.codici.lock().unwrap();
        let chiave_mappa = (k.clone(), scopo);
        let buono = match (mappa.get(&chiave_mappa), normalizza(scritto)) {
            (Some(v), Some(s)) => {
                Instant::now().duration_since(v.nato) < VITA_CODICE
                    && uguali(v.codice.as_bytes(), s.as_bytes())
            }
            _ => false,
        };
        if buono {
            mappa.remove(&chiave_mappa);
            drop(mappa);
            self.fallimenti.lock().unwrap().remove(&k);
            return Ok(());
        }
        drop(mappa);
        self.segna_fallimento(&k);
        if self.blocco_residuo(&k).is_some() {
            self.codici.lock().unwrap().remove(&chiave_mappa);
        }
        Err(Rifiuto::CredenzialiErrate)
    }

    /// **Registra** un indirizzo: utente non attivo e da confermare, con la
    /// versione delle condizioni accettate. L'azienda personale nasce alla
    /// conferma, non qui — chi non conferma non lascia aziende vuote in giro.
    ///
    /// Ripetere la registrazione prima di confermare va bene: si aggiorna la
    /// password (e l'ultima scritta quella che vale) e parte un codice nuovo.
    pub async fn registra(&self, email: &str, password: &str) -> anyhow::Result<Registrato> {
        let email = email.trim().to_string();
        if email.is_empty() || !email.contains('@') || email.contains(char::is_whitespace) {
            anyhow::bail!("email non valida: «{email}»");
        }
        if password.len() < 8 {
            anyhow::bail!("la password deve essere di almeno 8 caratteri");
        }
        let hash = cifra_password(password)?;
        let conn = self.conn.clone();
        let e = email.clone();
        let gia_confermato = task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms() as i64;
            let esistente: Option<bool> = c
                .query_row(
                    "SELECT da_confermare FROM utenti WHERE email = ?1",
                    params![e],
                    |r| Ok(r.get::<_, i64>(0)? != 0),
                )
                .optional()?;
            match esistente {
                Some(false) => Ok(true),
                Some(true) => {
                    c.execute(
                        "UPDATE utenti SET hash_password = ?1, condizioni_versione = ?2,
                                           condizioni_ms = ?3, aggiornato_ms = ?3
                         WHERE email = ?4 AND da_confermare = 1",
                        params![hash, VERSIONE_CONDIZIONI, adesso, e],
                    )?;
                    Ok(false)
                }
                None => {
                    c.execute(
                        "INSERT INTO utenti (email, nome, hash_password, ruolo, attivo,
                                             da_confermare, condizioni_versione, condizioni_ms,
                                             creato_ms, aggiornato_ms)
                         VALUES (?1, '', ?2, ?3, 0, 1, ?4, ?5, ?5, ?5)",
                        params![
                            e,
                            hash,
                            Ruolo::Sviluppatore.come_testo(),
                            VERSIONE_CONDIZIONI,
                            adesso
                        ],
                    )?;
                    Ok(false)
                }
            }
        })
        .await??;
        if gia_confermato {
            // Anche qui un freno: senza, il modulo diventerebbe un modo di
            // mandare e-mail a ripetizione a un iscritto.
            return Ok(match self.metti_in_volo(&email, Scopo::Registrazione) {
                Some(_) => {
                    // Il posto resta occupato per l'intervallo, ma senza un
                    // codice valido: `normalizza` non produce mai la stringa vuota.
                    self.codici.lock().unwrap().insert(
                        (chiave(&email), Scopo::Registrazione),
                        InVolo { codice: String::new(), nato: Instant::now() },
                    );
                    Registrato::GiaIscritto
                }
                None => Registrato::TroppoPresto,
            });
        }
        info!(email = %email, "registrazione in attesa di conferma");
        Ok(match self.metti_in_volo(&email, Scopo::Registrazione) {
            Some(c) => Registrato::Codice(c),
            None => Registrato::TroppoPresto,
        })
    }

    /// Il codice ricevuto per posta conferma l'indirizzo: l'utente diventa
    /// attivo, nasce la sua azienda personale (tre progetti) e si entra.
    pub async fn conferma_registrazione(
        &self,
        email: &str,
        codice: &str,
    ) -> Result<(Accesso, Azienda), Rifiuto> {
        self.consuma(email, Scopo::Registrazione, codice)?;
        let conn = self.conn.clone();
        let e = chiave(email);
        let id = task::spawn_blocking(move || -> anyhow::Result<Option<i64>> {
            let c = conn.lock().unwrap();
            let id: Option<i64> = c
                .query_row(
                    "SELECT id FROM utenti WHERE email = ?1 AND da_confermare = 1",
                    params![e],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = id {
                c.execute(
                    "UPDATE utenti SET attivo = 1, da_confermare = 0, aggiornato_ms = ?1
                     WHERE id = ?2",
                    params![ora_ms() as i64, id],
                )?;
            }
            Ok(id)
        })
        .await
        .map_err(|_| Rifiuto::CredenzialiErrate)?
        .map_err(|_| Rifiuto::CredenzialiErrate)?
        .ok_or(Rifiuto::CredenzialiErrate)?;

        let email_pulita = email.trim();
        // Il nome dell'azienda e l'indirizzo, che e unico fra gli utenti ma non
        // per forza fra le aziende: una creata a mano dalla console puo
        // chiamarsi cosi. In quel caso si aggiunge l'id, che non collide mai.
        let azienda = match self.crea_azienda_personale(email_pulita, id, Some(PROGETTI_PERSONALI)).await {
            Ok(a) => a,
            Err(_) => self
                .crea_azienda_personale(&format!("{email_pulita} ({id})"), id, Some(PROGETTI_PERSONALI))
                .await
                .map_err(|e| {
                    warn!(email = %email_pulita, "azienda personale non creata: {e:#}");
                    Rifiuto::CredenzialiErrate
                })?,
        };
        info!(email = %email_pulita, azienda = %azienda.cartella, "registrazione confermata");
        let accesso = self
            .emetti_accesso(id, None)
            .await
            .map_err(|_| Rifiuto::CredenzialiErrate)?;
        Ok((accesso, azienda))
    }

    /// «Mandami un PIN»: il codice da spedire, solo se l'indirizzo e di un
    /// utente attivo e confermato. **Il chiamante risponde uguale anche con
    /// `None`**, altrimenti questa rotta direbbe a chiunque chi e iscritto.
    pub async fn chiedi_pin(&self, email: &str) -> Option<String> {
        let conn = self.conn.clone();
        let e = chiave(email);
        let esiste = task::spawn_blocking(move || -> bool {
            let c = conn.lock().unwrap();
            c.query_row(
                "SELECT COUNT(*) FROM utenti WHERE email = ?1 AND attivo = 1 AND da_confermare = 0",
                params![e],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        if !esiste || self.blocco_residuo(&chiave(email)).is_some() {
            return None;
        }
        self.metti_in_volo(email, Scopo::Accesso)
    }

    /// Entra con il PIN ricevuto per posta.
    pub async fn accedi_con_pin(
        &self,
        email: &str,
        pin: &str,
        durata: Option<Duration>,
    ) -> Result<Accesso, Rifiuto> {
        self.consuma(email, Scopo::Accesso, pin)?;
        let conn = self.conn.clone();
        let e = chiave(email);
        let id = task::spawn_blocking(move || -> Option<i64> {
            let c = conn.lock().unwrap();
            c.query_row(
                "SELECT id FROM utenti WHERE email = ?1 AND attivo = 1 AND da_confermare = 0",
                params![e],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
        })
        .await
        .ok()
        .flatten()
        // Un utente disattivato fra la richiesta e l'uso del PIN non entra.
        .ok_or(Rifiuto::UtenteDisattivato)?;
        self.emetti_accesso(id, durata)
            .await
            .map_err(|_| Rifiuto::CredenzialiErrate)
    }

    /// Solo per i test: il codice in volo, come se lo si leggesse dalla posta.
    #[cfg(test)]
    pub(crate) fn codice_in_volo(&self, email: &str, scopo: Scopo) -> Option<String> {
        self.codici
            .lock()
            .unwrap()
            .get(&(chiave(email), scopo))
            .map(|v| v.codice.clone())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    async fn archivio() -> (Identita, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let id = Identita::apri(dir.path().join("identita.db")).await.unwrap();
        // Il primo utente e il maintainer: la registrazione arriva dopo.
        id.crea_utente("admin@sws.it", "Admin", "password-lunga", Ruolo::Amministratore, false)
            .await
            .unwrap();
        (id, dir)
    }

    #[test]
    fn il_codice_si_scrive_come_si_vuole() {
        assert_eq!(normalizza("abcd efgh").as_deref(), Some("ABCD-EFGH"));
        assert_eq!(normalizza("0ilo-1234").as_deref(), Some("0110-1234"));
        assert_eq!(normalizza("ABCD-EFG"), None);
        assert_eq!(normalizza("ABCD-EFGU"), None, "U non e nell'alfabeto Crockford");
        let c = genera();
        assert_eq!(normalizza(&c).as_deref(), Some(c.as_str()));
    }

    #[tokio::test]
    async fn registrazione_conferma_e_azienda_personale() {
        let (id, _d) = archivio().await;
        let Registrato::Codice(codice) = id.registra("Mario@Tizio.it", "password-lunga").await.unwrap()
        else {
            panic!("serviva un codice");
        };
        // Prima della conferma non si entra, e lo si dice solo a password giusta.
        assert_eq!(id.accedi("mario@tizio.it", "sbagliata!").await.unwrap_err(), Rifiuto::CredenzialiErrate);
        assert_eq!(id.accedi("mario@tizio.it", "password-lunga").await.unwrap_err(), Rifiuto::DaConfermare);
        assert!(id.chiedi_pin("mario@tizio.it").await.is_none(), "niente PIN a chi non ha confermato");

        let (accesso, azienda) = id
            .conferma_registrazione("mario@tizio.it", &codice.to_lowercase())
            .await
            .unwrap();
        assert!(accesso.utente.attivo);
        assert!(azienda.personale);
        assert_eq!(azienda.max_progetti_totali, Some(PROGETTI_PERSONALI));
        assert_eq!(azienda.cartella, format!("u{}", azienda.id));
        assert_eq!(id.valida(&accesso.token).await.unwrap().email, "Mario@Tizio.it");
        // Il codice e monouso.
        assert!(id.conferma_registrazione("mario@tizio.it", &codice).await.is_err());
        assert!(id.accedi("mario@tizio.it", "password-lunga").await.is_ok());
    }

    #[tokio::test]
    async fn un_iscritto_non_si_riregistra_e_non_si_capisce_da_fuori() {
        let (id, _d) = archivio().await;
        assert_eq!(id.registra("admin@sws.it", "altra-password").await.unwrap(), Registrato::GiaIscritto);
        // La password dell'iscritto non e cambiata.
        assert!(id.accedi("admin@sws.it", "password-lunga").await.is_ok());
        // E una seconda prova subito dopo non manda un'altra e-mail.
        assert_eq!(id.registra("admin@sws.it", "altra-password").await.unwrap(), Registrato::TroppoPresto);
    }

    #[tokio::test]
    async fn il_pin_apre_una_sessione_e_si_usa_una_volta() {
        let (id, _d) = archivio().await;
        assert!(id.chiedi_pin("nessuno@sws.it").await.is_none());
        let pin = id.chiedi_pin("ADMIN@sws.it").await.unwrap();
        assert!(id.chiedi_pin("admin@sws.it").await.is_none(), "uno al minuto");
        let a = id.accedi_con_pin("admin@sws.it", &pin, Some(DURATA_RICORDAMI)).await.unwrap();
        // «Ricordami» dura 30 giorni e resta 30 giorni anche dopo il rinnovo.
        let trenta = DURATA_RICORDAMI.as_millis() as u64;
        assert!(a.scade_ms > ora_ms() + trenta - 60_000);
        id.valida(&a.token).await.unwrap();
        let c = id.conn.lock().unwrap();
        let scade: i64 = c
            .query_row("SELECT scade_ms FROM sessioni WHERE impronta_token = ?1", params![impronta(&a.token)], |r| r.get(0))
            .unwrap();
        assert!(scade as u64 > ora_ms() + trenta - 60_000, "il rinnovo non deve tornare a 8 ore");
        drop(c);
        assert!(id.accedi_con_pin("admin@sws.it", &pin, None).await.is_err(), "monouso");
    }

    #[tokio::test]
    async fn pin_e_password_sbagliati_contano_insieme_e_il_blocco_butta_il_pin() {
        let (id, _d) = archivio().await;
        let pin = id.chiedi_pin("admin@sws.it").await.unwrap();
        for _ in 0..3 {
            let _ = id.accedi("admin@sws.it", "sbagliata!").await;
        }
        let _ = id.accedi_con_pin("admin@sws.it", "AAAA-AAAA", None).await;
        let _ = id.accedi_con_pin("admin@sws.it", "BBBB-BBBB", None).await;
        assert!(matches!(
            id.accedi_con_pin("admin@sws.it", &pin, None).await,
            Err(Rifiuto::Bloccato { .. })
        ));
        assert!(id.codice_in_volo("admin@sws.it", Scopo::Accesso).is_none(), "il PIN e stato buttato");
        assert!(id.chiedi_pin("admin@sws.it").await.is_none(), "niente PIN nuovi mentre si e bloccati");
    }
}
