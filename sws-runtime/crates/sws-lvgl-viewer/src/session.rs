//! Sessione utente del pannello LVGL (Q36): fino a oggi questo client era
//! anonimo per costruzione — nessuna scrittura portava un token, quindi con
//! utenti definiti sul runtime ogni tocco falliva in silenzio (Viewer
//! anonimo, tutto rifiutato). Il maintainer ha deciso: una sessione vera,
//! login su richiesta (non all'avvio), token persistito su disco (sopravvive
//! al riavvio del processo), logout esplicito.
//!
//! Tipi minimi locali invece di dipendere da `sws-auth`: quel crate porta
//! `argon2`/`uuid`/`serde_yaml`, pensati per la verifica delle credenziali
//! **lato server** — inutili qui, dove questo client si limita a CHIAMARE
//! `/api/auth/login`, non a implementarlo. Stesso principio già seguito
//! altrove in questo crate per non appesantire un binario cross-compilato
//! per un pannello embedded (es. l'istantanea in PPM invece che PNG, per non
//! aggiungere un encoder).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// Porta `sws_auth::Role` — stesso ordine (`Viewer < Operator < Supervisor <
/// Admin`), stesso derive `PartialOrd`/`Ord`: il gate `min_role` (prossimo
/// passo di Q36) confronterà con `role >= min_role`, non con un elenco a
/// mano. I nomi delle varianti devono restare identici a quelli del server
/// (la risposta di login li manda come stringhe JSON, es. `"Admin"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Role {
    Viewer,
    Operator,
    Supervisor,
    Admin,
}

impl Role {
    /// Il nome esatto con cui il server lo scrive (`min_role` nel synottico è
    /// una stringa libera, non un campo tipato — arriva così com'è scritta
    /// nel progetto, non necessariamente valida).
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "Viewer" => Some(Role::Viewer),
            "Operator" => Some(Role::Operator),
            "Supervisor" => Some(Role::Supervisor),
            "Admin" => Some(Role::Admin),
            _ => None,
        }
    }
}

/// Porta `isRoleAllowed` da `SvgCanvas.tsx` (Q36 parte 2): assente = nessun
/// vincolo; una stringa non riconosciuta vale "Viewer" (stesso `?? 0` del
/// web, non un rifiuto silenzioso di tutto); anonimo (nessuna sessione) sta
/// **sotto** Viewer — capita solo su un runtime con utenti dove nessuno ha
/// ancora fatto login, e in quel caso ogni `min_role` dichiarato blocca,
/// esattamente come whoami() che torna `null` sul web.
pub fn role_allowed(min_role: Option<&str>, viewer_role: Option<Role>) -> bool {
    let Some(min_role) = min_role.filter(|s| !s.is_empty()) else {
        return true;
    };
    let required = Role::parse(min_role).unwrap_or(Role::Viewer);
    match viewer_role {
        Some(have) => have >= required,
        None => false,
    }
}

/// Porta (parzialmente) `sws_auth::LoginOk` — solo i campi che questo client
/// usa davvero.
#[derive(Debug, Clone, Deserialize)]
pub struct LoginOk {
    pub token: String,
    pub username: String,
    pub role: Role,
    pub expires_at_ms: Option<u64>,
}

/// Stato della sessione, condiviso fra il thread di rendering LVGL (che lo
/// legge/scrive dai callback di click) e i task async che chiamano
/// `client::login`/`put_tag`/… — stesso principio di `SharedAlarms`/
/// `SharedTagSnapshot`, un `Arc<Mutex<_>>` aggiornato da un lato e letto
/// dall'altro a ogni frame.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionState {
    pub token: Option<String>,
    pub username: Option<String>,
    pub role: Option<Role>,
    pub expires_at_ms: Option<u64>,
    /// Il runtime ha utenti definiti? Deciso una volta all'avvio
    /// (`client::fetch_system`, `GET /api/system`), non persistito: un
    /// pannello senza utenti non ha nulla da autenticare, il controllo
    /// login/logout non ha motivo di esistere (`render_auth_widget` lo
    /// nasconde quando è `false`). Default `true`: finché non è stata
    /// fatta la verifica all'avvio, meglio mostrarlo che nasconderlo —
    /// nasconderlo su un runtime che invece ha utenti è il problema che
    /// Q36 risolve.
    #[serde(skip)]
    #[serde(default = "default_true")]
    pub auth_required: bool,
}

fn default_true() -> bool {
    true
}

pub type SharedSession = Arc<Mutex<SessionState>>;

/// `~/.config/sws/lvgl_session.json` — stessa cartella già in uso per la
/// chiave dei fornitori IA (`percorsi_chiave_di` in `sws-web/src/ai/client.rs`),
/// un file in più nella stessa convenzione, non un percorso nuovo inventato.
fn session_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/sws/lvgl_session.json"))
}

impl SessionState {
    pub fn is_logged_in(&self) -> bool {
        self.token.is_some()
    }

    /// Stesso controllo di `store/index.ts` lato editor (riga ~98): assente
    /// = non scade mai (override per-utente lato server), altrimenti confronto
    /// diretto con l'orologio di sistema.
    pub fn is_expired(&self) -> bool {
        match self.expires_at_ms {
            Some(exp) => sws_core::now_ms() >= exp,
            None => false,
        }
    }

    /// Carica la sessione salvata, scartandola se scaduta o illeggibile — mai
    /// un errore fatale: un pannello appena acceso, o con un file corrotto/
    /// un token vecchio, riparte semplicemente anonimo, come faceva sempre.
    pub fn load() -> SessionState {
        let Some(path) = session_path() else {
            return SessionState::default();
        };
        let Ok(bytes) = std::fs::read(&path) else {
            return SessionState::default();
        };
        let Ok(s) = serde_json::from_slice::<SessionState>(&bytes) else {
            return SessionState::default();
        };
        if s.is_expired() {
            SessionState::default()
        } else {
            s
        }
    }

    /// Scrittura su disco best-effort: un fallimento (permessi, disco pieno,
    /// `$HOME` assente) non deve impedire il login di funzionare per la
    /// sessione corrente in memoria — solo la persistenza fra un riavvio e
    /// l'altro, che è un miglioramento, non la funzione base.
    pub fn save(&self) {
        let Some(path) = session_path() else {
            return;
        };
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("[sessione] impossibile creare {}: {e}", parent.display());
                return;
            }
        }
        match serde_json::to_vec_pretty(self) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&path, json) {
                    eprintln!("[sessione] impossibile salvare {}: {e}", path.display());
                }
            }
            Err(e) => eprintln!("[sessione] impossibile serializzare la sessione: {e}"),
        }
    }

    pub fn set_logged_in(&mut self, ok: LoginOk) {
        self.token = Some(ok.token);
        self.username = Some(ok.username);
        self.role = Some(ok.role);
        self.expires_at_ms = ok.expires_at_ms;
        self.save();
    }

    /// Solo l'identità va via: `auth_required` è un fatto sul runtime, non
    /// su chi era loggato, e un logout non deve farlo tornare al default
    /// (`*self = SessionState::default()` lo farebbe, silenziosamente —
    /// nascondendo il controllo login/logout su un runtime che invece ha
    /// utenti, proprio il difetto che questo campo esiste per evitare).
    pub fn clear(&mut self) {
        self.token = None;
        self.username = None;
        self.role = None;
        self.expires_at_ms = None;
        self.save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_sessione_scaduta_conta_come_scaduta() {
        let s = SessionState {
            token: Some("t".into()),
            username: Some("u".into()),
            role: Some(Role::Admin),
            expires_at_ms: Some(1),
            ..Default::default()
        };
        assert!(s.is_expired());
    }

    #[test]
    fn nessuna_scadenza_dichiarata_non_scade_mai() {
        let s = SessionState {
            token: Some("t".into()),
            ..Default::default()
        };
        assert!(!s.is_expired());
    }

    #[test]
    fn ruoli_ordinati_come_sul_server() {
        assert!(Role::Admin > Role::Supervisor);
        assert!(Role::Supervisor > Role::Operator);
        assert!(Role::Operator > Role::Viewer);
    }

    #[test]
    fn login_ok_deserializza_dalla_forma_del_server() {
        let json = r#"{"token":"abc","username":"mauro","role":"Admin","expires_at_ms":null}"#;
        let ok: LoginOk = serde_json::from_str(json).unwrap();
        assert_eq!(ok.role, Role::Admin);
        assert_eq!(ok.token, "abc");
    }

    #[test]
    fn nessun_min_role_non_vincola_nessuno() {
        assert!(role_allowed(None, None));
        assert!(role_allowed(Some(""), None));
        assert!(role_allowed(None, Some(Role::Viewer)));
    }

    #[test]
    fn anonimo_sta_sotto_viewer() {
        assert!(!role_allowed(Some("Viewer"), None));
        assert!(!role_allowed(Some("Admin"), None));
    }

    #[test]
    fn un_ruolo_pari_o_superiore_passa() {
        assert!(role_allowed(Some("Operator"), Some(Role::Operator)));
        assert!(role_allowed(Some("Operator"), Some(Role::Admin)));
        assert!(!role_allowed(Some("Operator"), Some(Role::Viewer)));
    }

    #[test]
    fn una_stringa_non_riconosciuta_vale_viewer_come_sul_web() {
        // `ROLE_RANK[minRole] ?? 0` in SvgCanvas.tsx: un min_role scritto a
        // mano male non blocca tutto, si comporta come "Viewer".
        assert!(role_allowed(Some("boh"), Some(Role::Viewer)));
        assert!(!role_allowed(Some("boh"), None));
    }

    #[test]
    fn role_parse_riconosce_solo_i_quattro_nomi_del_server() {
        assert_eq!(Role::parse("Admin"), Some(Role::Admin));
        assert_eq!(Role::parse("admin"), None);
        assert_eq!(Role::parse(""), None);
    }
}
