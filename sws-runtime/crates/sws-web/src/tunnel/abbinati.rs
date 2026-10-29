//! I pannelli abbinati al gateway col codice (11-10-2026, fetta D del piano
//! `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`).
//!
//! Un pannello è un'**entità del server**, riconosciuta dall'hardware: una
//! scatola riformattata è la stessa scatola, e rientra sulla stessa riga
//! (seme `2026-10-10-identita-del-pannello-e-token-ripetibile.md`).
//!
//! - **Il token non si memorizza**: è `HMAC(segreto del gateway, "pannello:" +
//!   hw)`, ripetibile e non indovinabile dal seriale. Cambiare il segreto
//!   cambia i token di tutti i pannelli insieme.
//! - **Lo stato vince sul token**: un pannello sospeso o bandito è rifiutato
//!   prima ancora di guardare le credenziali, e il ban sta sull'hardware, quindi
//!   sopravvive a una riformattazione.
//!
//! L'archivio è `<config del gateway>/pannelli_abbinati.json`, scritto in modo
//! atomico. Il seme pensava a una tabella in `identita.db`: per il PoC basta un
//! file, e la forma delle righe è già quella della tabella.
//!
//! Accanto, [`InAttesa`]: i pannelli collegati che **non** sono ancora
//! abbinati, tenuti in memoria per codice e mai mostrati a nessuno.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::multiplex::Maniglia;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatoPannello {
    Attivo,
    Sospeso,
    Bandito,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pannello {
    /// `seriale:…`, `mac:…` o `casuale:…`: la chiave, quella che un reset non cambia.
    pub hw: String,
    /// Il nome nel tunnel, `/dev/<nome>`.
    pub nome: String,
    /// La cartella dell'azienda, `-` per la radice.
    pub azienda: String,
    pub stato: StatoPannello,
    pub abbinato_ms: u64,
    #[serde(default)]
    pub ultimo_ms: u64,
    /// Lo schermo remoto spento per questo pannello (29-10-2026,
    /// `crate::schermo`). Acceso di default: il campo dice l'eccezione, così
    /// i pannelli abbinati prima nascono accesi.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub schermo_spento: bool,
}

/// Il token di un pannello: ripetibile, mai memorizzato.
pub fn token_per(segreto: &str, hw: &str) -> String {
    crate::gateway::ritorno::hmac_sha256_hex(segreto.as_bytes(), format!("pannello:{hw}").as_bytes())
}

#[derive(Debug, PartialEq)]
pub enum Rifiuto {
    /// Sconosciuto o credenziali sbagliate: non si dice quale delle due.
    NonRiconosciuto,
    /// Sospeso o bandito: vince sul token.
    NonAmmesso,
}

#[derive(Debug, PartialEq)]
pub enum ErroreAbbina {
    Bandito,
    /// Attivo e di un'altra azienda: lo può spostare solo la piattaforma.
    DiUnAltraAzienda,
    NomeNonValido,
}

pub struct Abbinati {
    percorso: PathBuf,
    righe: Mutex<Vec<Pannello>>,
}

impl Abbinati {
    pub fn apri(config_dir: &Path) -> Self {
        let percorso = config_dir.join("pannelli_abbinati.json");
        let righe = std::fs::read_to_string(&percorso)
            .ok()
            .and_then(|t| match serde_json::from_str::<Vec<Pannello>>(&t) {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::error!(?percorso, "pannelli_abbinati.json illeggibile: {e}");
                    None
                }
            })
            .unwrap_or_default();
        Self { percorso, righe: Mutex::new(righe) }
    }

    fn scrivi(&self, righe: &[Pannello]) -> anyhow::Result<()> {
        if let Some(d) = self.percorso.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = self.percorso.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(righe)?)?;
        std::fs::rename(&tmp, &self.percorso)?;
        Ok(())
    }

    fn g(&self) -> std::sync::MutexGuard<'_, Vec<Pannello>> {
        self.righe.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn elenco(&self) -> Vec<Pannello> {
        self.g().clone()
    }

    pub fn per_hw(&self, hw: &str) -> Option<Pannello> {
        self.g().iter().find(|p| p.hw == hw).cloned()
    }

    pub fn per_nome(&self, nome: &str) -> Option<Pannello> {
        self.g().iter().find(|p| p.nome == nome).cloned()
    }

    /// Cambia il nome di una riga. `false` se `vecchio` non c'è.
    pub fn rinomina(&self, vecchio: &str, nuovo: &str) -> anyhow::Result<bool> {
        let mut righe = self.g();
        let Some(p) = righe.iter_mut().find(|p| p.nome == vecchio) else { return Ok(false) };
        p.nome = nuovo.to_string();
        righe.sort_by(|a, b| a.nome.cmp(&b.nome));
        self.scrivi(&righe)?;
        Ok(true)
    }

    pub fn azienda_di(&self, nome: &str) -> Option<String> {
        self.g()
            .iter()
            .find(|p| p.nome == nome && p.stato == StatoPannello::Attivo)
            .map(|p| p.azienda.clone())
    }

    /// Chi è il pannello che si presenta con `nome` e `token`. Lo stato prima
    /// del token.
    pub fn riconosci(&self, segreto: &str, nome: &str, token: &str) -> Result<Pannello, Rifiuto> {
        let p = self.g().iter().find(|p| p.nome == nome).cloned().ok_or(Rifiuto::NonRiconosciuto)?;
        if p.stato != StatoPannello::Attivo {
            return Err(Rifiuto::NonAmmesso);
        }
        let atteso = token_per(segreto, &p.hw);
        if crate::router::confronto_costante(token.as_bytes(), atteso.as_bytes()) {
            Ok(p)
        } else {
            Err(Rifiuto::NonRiconosciuto)
        }
    }

    /// La scatola `hw` è bandita? Vale anche per chi si presenta in attesa.
    pub fn bandito(&self, hw: &str) -> bool {
        self.g().iter().any(|p| p.hw == hw && p.stato == StatoPannello::Bandito)
    }

    /// Prepara l'abbinamento di `hw` all'azienda: la riga com'è dopo, e il
    /// token. **Non scrive niente**: si salva con [`Abbinati::salva`] solo dopo
    /// che il pannello ha accettato.
    ///
    /// Stessa scatola già abbinata alla stessa azienda → stessa riga e stesso
    /// nome (riconosciuta dopo un reset). Nome nuovo: quello chiesto, o quello
    /// proposto dal pannello, reso unico con un suffisso.
    pub fn prepara(
        &self,
        segreto: &str,
        hw: &str,
        azienda: &str,
        nome_voluto: Option<&str>,
        nome_proposto: &str,
        occupati: &[String],
    ) -> Result<(Pannello, String), ErroreAbbina> {
        let righe = self.g();
        let esistente = righe.iter().find(|p| p.hw == hw).cloned();
        if let Some(p) = &esistente {
            match p.stato {
                StatoPannello::Bandito => return Err(ErroreAbbina::Bandito),
                // Di un'altra azienda: non si prende rivendicandolo, **in
                // qualunque stato sia**. Fino al 21-10-2026 questo controllo
                // guardava solo `Attivo`, quindi un pannello **sospeso** lo
                // abbinava chiunque avesse il codice e se lo portava via:
                // sospendere un pannello per manutenzione voleva dire lasciarlo
                // prendere. Lo spostamento ora è un atto esplicito della
                // piattaforma (`Abbinati::sposta`), non l'effetto collaterale di
                // uno stato.
                _ if p.azienda != azienda => return Err(ErroreAbbina::DiUnAltraAzienda),
                _ => {}
            }
        }
        let base = match nome_voluto.map(str::trim).filter(|n| !n.is_empty()) {
            Some(n) => n.to_string(),
            None => esistente.as_ref().map(|p| p.nome.clone()).unwrap_or_else(|| nome_proposto.to_string()),
        };
        let base = normalizza_nome(&base).ok_or(ErroreAbbina::NomeNonValido)?;
        let occupato = |n: &str| {
            occupati.iter().any(|o| o == n) || righe.iter().any(|p| p.nome == n && p.hw != hw)
        };
        let mut nome = base.clone();
        let mut i = 2;
        while occupato(&nome) {
            nome = format!("{base}-{i}");
            i += 1;
        }
        let ora = ora_ms();
        let p = Pannello {
            hw: hw.to_string(),
            nome,
            azienda: azienda.to_string(),
            stato: StatoPannello::Attivo,
            abbinato_ms: ora,
            ultimo_ms: ora,
            schermo_spento: false,
        };
        let token = token_per(segreto, hw);
        Ok((p, token))
    }

    /// Scrive (o sostituisce, per hardware) la riga.
    pub fn salva(&self, p: Pannello) -> anyhow::Result<()> {
        let mut righe = self.g();
        righe.retain(|x| x.hw != p.hw);
        righe.push(p);
        righe.sort_by(|a, b| a.nome.cmp(&b.nome));
        self.scrivi(&righe)
    }

    /// Sposta una riga a un'altra azienda. `false` se `nome` non c'è.
    ///
    /// È l'unica strada perché un pannello cambi azienda, e la può percorrere
    /// solo chi amministra la piattaforma: è la cosa che il messaggio d'errore
    /// di `prepara` prometteva dall'11-10-2026 senza che esistesse.
    pub fn sposta(&self, nome: &str, azienda: &str) -> anyhow::Result<bool> {
        let mut righe = self.g();
        let Some(p) = righe.iter_mut().find(|p| p.nome == nome) else { return Ok(false) };
        p.azienda = azienda.to_string();
        self.scrivi(&righe)?;
        Ok(true)
    }

    /// Quanti pannelli ha un'azienda, e quanti di quelli sono collegati adesso.
    /// Il segmento è quello dell'URL del gateway (`-` per l'implicita), lo
    /// stesso che la riga tiene in `azienda`.
    pub fn conta_di(&self, segmento: &str, collegati: &[String]) -> (usize, usize) {
        let righe = self.g();
        let suoi: Vec<&Pannello> = righe.iter().filter(|p| p.azienda == segmento).collect();
        let accesi = suoi.iter().filter(|p| collegati.iter().any(|c| c == &p.nome)).count();
        (suoi.len(), accesi)
    }

    pub fn imposta_stato(&self, nome: &str, stato: StatoPannello) -> anyhow::Result<bool> {
        let mut righe = self.g();
        let Some(p) = righe.iter_mut().find(|p| p.nome == nome) else { return Ok(false) };
        p.stato = stato;
        self.scrivi(&righe)?;
        Ok(true)
    }

    /// Accende o spegne lo schermo remoto di un pannello.
    pub fn imposta_schermo(&self, nome: &str, acceso: bool) -> anyhow::Result<bool> {
        let mut righe = self.g();
        let Some(p) = righe.iter_mut().find(|p| p.nome == nome) else { return Ok(false) };
        p.schermo_spento = !acceso;
        self.scrivi(&righe)?;
        Ok(true)
    }

    /// Lo schermo remoto di questo pannello è acceso? Un pannello che il
    /// registro non conosce non ha uno schermo da aprire.
    pub fn schermo_acceso(&self, nome: &str) -> bool {
        self.per_nome(nome).is_some_and(|p| !p.schermo_spento)
    }

    /// Annota l'ultima connessione (in memoria; finisce su disco alla
    /// prossima scrittura: è un'informazione, non un dato da non perdere).
    pub fn visto(&self, nome: &str) {
        if let Some(p) = self.g().iter_mut().find(|p| p.nome == nome) {
            p.ultimo_ms = ora_ms();
        }
    }
}

/// Un nome da usare in `/dev/<nome>`: minuscole, cifre, `-`, al massimo 48.
pub fn normalizza_nome(n: &str) -> Option<String> {
    let s: String = n
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    (!s.is_empty() && s.len() <= 48).then_some(s)
}

pub(crate) fn ora_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Un pannello collegato in attesa di abbinamento.
#[derive(Clone)]
pub struct Attesa {
    pub maniglia: Maniglia,
    pub hw: String,
    pub nome_proposto: String,
}

/// I pannelli in attesa, per codice. Solo in memoria: un riavvio del gateway
/// li dimentica, e loro richiamano.
#[derive(Default)]
pub struct InAttesa {
    per_codice: tokio::sync::RwLock<HashMap<String, Attesa>>,
}

/// Quanti pannelli in attesa si tengono al massimo: chi apre connessioni a
/// raffica non deve poter riempire la memoria del gateway.
const TETTO_ATTESA: usize = 2000;

impl InAttesa {
    pub async fn entra(&self, codice: &str, a: Attesa) -> bool {
        let mut m = self.per_codice.write().await;
        m.retain(|_, x| x.maniglia.vivo());
        if m.len() >= TETTO_ATTESA && !m.contains_key(codice) {
            return false;
        }
        m.insert(codice.to_string(), a);
        true
    }

    pub async fn esce(&self, codice: &str, hw: &str) {
        let mut m = self.per_codice.write().await;
        if m.get(codice).is_some_and(|a| a.hw == hw) {
            m.remove(codice);
        }
    }

    pub async fn di(&self, codice: &str) -> Option<Attesa> {
        let m = self.per_codice.read().await;
        m.get(codice).filter(|a| a.maniglia.vivo()).cloned()
    }

    pub async fn quanti(&self) -> usize {
        self.per_codice.read().await.values().filter(|a| a.maniglia.vivo()).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_token_si_ripete_e_dipende_dal_segreto() {
        assert_eq!(token_per("s", "seriale:X"), token_per("s", "seriale:X"));
        assert_ne!(token_per("s", "seriale:X"), token_per("s", "seriale:Y"));
        assert_ne!(token_per("s", "seriale:X"), token_per("t", "seriale:X"));
    }

    #[test]
    fn abbinare_riconoscere_e_ritrovare_dopo_un_reset() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        let (p, token) = a.prepara("seg", "seriale:P05", "acme", None, "TC620-A-P3", &[]).unwrap();
        assert_eq!(p.nome, "tc620-a-p3");
        a.salva(p).unwrap();
        assert_eq!(a.riconosci("seg", "tc620-a-p3", &token).unwrap().azienda, "acme");
        assert_eq!(a.riconosci("seg", "tc620-a-p3", "sbagliato").unwrap_err(), Rifiuto::NonRiconosciuto);
        // Riaperto da disco, e dopo un reset la stessa scatola torna sulla stessa riga.
        let b = Abbinati::apri(d.path());
        let (p2, token2) = b.prepara("seg", "seriale:P05", "acme", None, "altro-nome", &[]).unwrap();
        assert_eq!(p2.nome, "tc620-a-p3", "riconosciuto: stesso nome");
        assert_eq!(token2, token);
        // Un'altra azienda non se lo prende.
        assert_eq!(b.prepara("seg", "seriale:P05", "rossi", None, "x", &[]).unwrap_err(), ErroreAbbina::DiUnAltraAzienda);
    }

    #[test]
    fn il_ban_vince_sul_token_e_sul_reset() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        let (p, token) = a.prepara("seg", "mac:aa", "acme", Some("linea 1"), "x", &[]).unwrap();
        assert_eq!(p.nome, "linea-1");
        a.salva(p).unwrap();
        a.imposta_stato("linea-1", StatoPannello::Bandito).unwrap();
        assert_eq!(a.riconosci("seg", "linea-1", &token).unwrap_err(), Rifiuto::NonAmmesso);
        assert!(a.bandito("mac:aa"));
        assert_eq!(a.prepara("seg", "mac:aa", "acme", None, "x", &[]).unwrap_err(), ErroreAbbina::Bandito);
        assert_eq!(a.azienda_di("linea-1"), None, "un bandito non si raggiunge");
    }

    #[test]
    fn rinominare_cambia_la_riga_e_il_token_resta() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        let (p, token) = a.prepara("s", "seriale:X", "-", Some("tc620-casa-2"), "x", &[]).unwrap();
        a.salva(p).unwrap();
        assert!(a.rinomina("tc620-casa-2", "tc620-casa").unwrap());
        assert!(a.per_nome("tc620-casa-2").is_none());
        assert_eq!(a.riconosci("s", "tc620-casa", &token).unwrap().hw, "seriale:X");
        assert!(!a.rinomina("non-c-e", "x").unwrap());
        assert_eq!(Abbinati::apri(d.path()).per_nome("tc620-casa").unwrap().hw, "seriale:X", "su disco");
    }

    #[test]
    fn un_pannello_sospeso_non_se_lo_prende_un_altra_azienda() {
        // Il buco trovato il 21-10-2026: `prepara` guardava solo lo stato
        // `Attivo`, quindi bastava che un pannello fosse sospeso perché
        // chiunque avesse il codice se lo portasse via.
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        let (p, _) = a.prepara("s", "seriale:P05", "acme", None, "tc620", &[]).unwrap();
        a.salva(p).unwrap();
        a.imposta_stato("tc620", StatoPannello::Sospeso).unwrap();
        assert_eq!(
            a.prepara("s", "seriale:P05", "rossi", None, "x", &[]).unwrap_err(),
            ErroreAbbina::DiUnAltraAzienda,
        );
        // La **sua** azienda invece lo ritrova: un pannello sospeso che si
        // riabbina torna attivo, ed è il modo di rimetterlo in servizio.
        assert!(a.prepara("s", "seriale:P05", "acme", None, "x", &[]).is_ok());
    }

    #[test]
    fn spostare_e_contare_per_azienda() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        for (hw, nome) in [("hw1", "uno"), ("hw2", "due")] {
            let (p, _) = a.prepara("s", hw, "acme", Some(nome), "x", &[]).unwrap();
            a.salva(p).unwrap();
        }
        assert_eq!(a.conta_di("acme", &["uno".into()]), (2, 1), "due abbinati, uno collegato");
        assert_eq!(a.conta_di("rossi", &[]), (0, 0));

        assert!(a.sposta("due", "rossi").unwrap());
        assert_eq!(a.conta_di("acme", &[]), (1, 0));
        assert_eq!(a.conta_di("rossi", &[]), (1, 0));
        assert!(!a.sposta("non-c-e", "rossi").unwrap());
        // E dopo lo spostamento se lo prende davvero la nuova azienda.
        assert!(a.prepara("s", "hw2", "rossi", None, "x", &[]).is_ok());
        assert_eq!(
            a.prepara("s", "hw2", "acme", None, "x", &[]).unwrap_err(),
            ErroreAbbina::DiUnAltraAzienda,
        );
        assert_eq!(Abbinati::apri(d.path()).per_nome("due").unwrap().azienda, "rossi", "su disco");
    }

    #[test]
    fn i_nomi_occupati_prendono_un_suffisso() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinati::apri(d.path());
        let (p, _) = a.prepara("s", "hw1", "acme", None, "tc620", &["tc620".into()]).unwrap();
        assert_eq!(p.nome, "tc620-2");
        a.salva(p).unwrap();
        let (q, _) = a.prepara("s", "hw2", "acme", None, "tc620", &["tc620".into()]).unwrap();
        assert_eq!(q.nome, "tc620-3");
        assert_eq!(normalizza_nome("  "), None);
        assert_eq!(normalizza_nome("Linea Nord/2").as_deref(), Some("linea-nord-2"));
    }
}
