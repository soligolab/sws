//! I dispositivi registrati (Q50, 2026-09-10): `GET`/`PUT /api/devices`.
//!
//! La scheda Configurazione → Dispositivi teneva la lista dei pannelli in
//! `localStorage`: del browser, non dell'installazione. Su un altro PC, o dopo
//! aver svuotato il profilo, la lista era vuota. Ora vive sul server, in
//! **`<cartella progetti>/.ambiente/dispositivi.yaml`** — scelta del maintainer:
//! «in sws_projects prevederei una cartella di configurazione dove tenere questo
//! file e i file di setup dell'ambiente». La cartella dei progetti è quella
//! che l'utente conosce e salva; `.ambiente` è il suo angolo per ciò che non è
//! un progetto ma descrive l'ambiente di lavoro (questa lista oggi, altro
//! domani). Il punto davanti la tiene fuori dall'elenco dei progetti
//! (`list_projects` salta le cartelle nascoste) e dai nomi che si possono dare
//! a un progetto (`safe_project_name` li rifiuta).
//!
//! Il file porta etichetta, URL e utente. **Mai la password**: la regola del
//! 2026-09-09 («nessuna password nel browser») vale uguale sul disco del
//! server, e `deny_unknown_fields` rende un client che la manda un errore 422
//! invece di un segreto salvato per sbaglio. La password si chiede nella riga
//! e resta in memoria finché la pagina è aperta.
//!
//! Il PUT sostituisce la lista intera: è piccola, la scrive un solo editor alla
//! volta, e «l'ultimo che salva vince» è il comportamento che la scheda aveva
//! già con `localStorage`. Scrittura atomica (file temporaneo e `rename`), così
//! un crash a metà non lascia uno YAML troncato.

use axum::{
    extract::{Json as EJson, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::router::AppState;

/// La cartella, dentro la radice dei progetti, per ciò che descrive l'ambiente
/// e non è un progetto. Nascosta apposta: vedi il commento del modulo.
pub const CARTELLA_AMBIENTE: &str = ".ambiente";
pub const FILE_DISPOSITIVI: &str = "dispositivi.yaml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DispositivoRegistrato {
    pub label: String,
    pub url: String,
    pub user: String,
}

/// Il file su disco: versionato, così un formato futuro si riconosce.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileDispositivi {
    #[serde(default = "versione_corrente")]
    versione: u32,
    #[serde(default)]
    dispositivi: Vec<DispositivoRegistrato>,
}

fn versione_corrente() -> u32 {
    1
}

pub fn percorso(projects_root: &Path) -> PathBuf {
    projects_root.join(CARTELLA_AMBIENTE).join(FILE_DISPOSITIVI)
}

/// Legge la lista; un file assente è una lista vuota, non un errore — è lo
/// stato di ogni installazione nuova.
pub(crate) fn leggi(path: &Path) -> Result<Vec<DispositivoRegistrato>, String> {
    let testo = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("lettura di {}: {e}", path.display())),
    };
    let f: FileDispositivi = serde_yaml::from_str(&testo)
        .map_err(|e| format!("{} non è valido: {e}", path.display()))?;
    Ok(f.dispositivi)
}

/// Scrive la lista, atomicamente: file accanto e `rename`, che su Linux
/// sostituisce in un colpo solo. La cartella si crea al primo salvataggio.
pub(crate) fn scrivi(path: &Path, lista: &[DispositivoRegistrato]) -> Result<(), String> {
    let cartella = path
        .parent()
        .ok_or_else(|| format!("{} non ha una cartella", path.display()))?;
    std::fs::create_dir_all(cartella)
        .map_err(|e| format!("creazione di {}: {e}", cartella.display()))?;
    let f = FileDispositivi {
        versione: versione_corrente(),
        dispositivi: lista.to_vec(),
    };
    let testo = serde_yaml::to_string(&f).map_err(|e| format!("serializzazione: {e}"))?;
    let intestazione = "# Dispositivi registrati nell'editor SWS (Configurazione → Dispositivi).\n\
                        # Etichetta, URL della porta di gestione e utente: MAI la password.\n";
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, format!("{intestazione}{testo}"))
        .map_err(|e| format!("scrittura di {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename su {}: {e}", path.display()))
}

/// Un URL «http(s)://host[:porta][/…]», con un host non vuoto. Niente crate
/// `url`: bastano le due cose che contano per collegarsi e per non salvare
/// spazzatura.
fn url_valido(u: &str) -> bool {
    let resto = if let Some(r) = u.strip_prefix("https://") {
        r
    } else if let Some(r) = u.strip_prefix("http://") {
        r
    } else {
        return false;
    };
    let host_porta = resto.split('/').next().unwrap_or("");
    let host = host_porta
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(host_porta);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
        && !u.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Cosa deve valere perché la lista si salvi: etichette e URL non vuoti e
/// sensati, nessun URL ripetuto (la scheda usa l'URL come chiave), campi corti.
pub(crate) fn valida(lista: &[DispositivoRegistrato]) -> Result<(), String> {
    let mut visti = std::collections::HashSet::new();
    for (i, d) in lista.iter().enumerate() {
        let n = i + 1;
        if d.label.trim().is_empty() || d.label.chars().count() > 64 {
            return Err(format!(
                "dispositivo {n}: etichetta vuota o più lunga di 64 caratteri"
            ));
        }
        if !url_valido(d.url.trim()) {
            return Err(format!(
                "dispositivo {n} («{}»): URL non valido, serve http(s)://host[:porta]",
                d.label
            ));
        }
        if d.user.chars().count() > 64 || d.user.chars().any(|c| c.is_control()) {
            return Err(format!(
                "dispositivo {n} («{}»): utente non valido",
                d.label
            ));
        }
        if !visti.insert(d.url.trim().trim_end_matches('/').to_lowercase()) {
            return Err(format!(
                "dispositivo {n} («{}»): URL già presente nella lista",
                d.label
            ));
        }
    }
    Ok(())
}

/// `GET /api/devices` — la lista, vuota se il file non c'è. Admin per posizione
/// nel router.
pub async fn elenca_dispositivi(State(s): State<AppState>) -> Response {
    let path = percorso(&s.projects_root);
    match tokio::task::spawn_blocking(move || leggi(&path)).await {
        Ok(Ok(lista)) => axum::Json(lista).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}\n")).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}\n")).into_response(),
    }
}

/// `PUT /api/devices` — sostituisce la lista. Risponde con ciò che ha scritto,
/// normalizzato (spazi tolti), così il client mostra quel che c'è su disco.
pub async fn salva_dispositivi(
    State(s): State<AppState>,
    axum::Extension(user): axum::Extension<crate::router::AuthUser>,
    EJson(lista): EJson<Vec<DispositivoRegistrato>>,
) -> Response {
    let lista: Vec<DispositivoRegistrato> = lista
        .into_iter()
        .map(|d| DispositivoRegistrato {
            label: d.label.trim().to_string(),
            url: d.url.trim().trim_end_matches('/').to_string(),
            user: d.user.trim().to_string(),
        })
        .collect();
    if let Err(m) = valida(&lista) {
        return (StatusCode::BAD_REQUEST, format!("{m}\n")).into_response();
    }
    let path = percorso(&s.projects_root);
    let da_scrivere = lista.clone();
    match tokio::task::spawn_blocking(move || scrivi(&path, &da_scrivere)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}\n")).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}\n")).into_response(),
    }
    s.audit.log(
        "devices.save",
        Some(user.username),
        serde_json::json!({ "n": lista.len(), "url": lista.iter().map(|d| d.url.as_str()).collect::<Vec<_>>() }),
    );
    axum::Json(lista).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(label: &str, url: &str, user: &str) -> DispositivoRegistrato {
        DispositivoRegistrato {
            label: label.into(),
            url: url.into(),
            user: user.into(),
        }
    }

    #[test]
    fn il_file_sta_nella_cartella_ambiente_dentro_la_radice_dei_progetti() {
        let p = percorso(Path::new("/home/x/sws_projects"));
        assert_eq!(
            p,
            PathBuf::from("/home/x/sws_projects/.ambiente/dispositivi.yaml")
        );
        // Nascosta: list_projects salta i nomi che cominciano per punto.
        assert!(CARTELLA_AMBIENTE.starts_with('.'));
    }

    #[test]
    fn file_assente_e_lista_vuota_non_errore() {
        let t = tempfile::tempdir().unwrap();
        assert_eq!(
            leggi(&percorso(t.path())).unwrap(),
            Vec::<DispositivoRegistrato>::new()
        );
    }

    #[test]
    fn scrive_e_rilegge_creando_la_cartella() {
        let t = tempfile::tempdir().unwrap();
        let p = percorso(t.path());
        let lista = vec![
            d("WP630 banco", "https://wp630.local:8444", "user"),
            d("TC620", "http://192.168.0.20:8444", ""),
        ];
        scrivi(&p, &lista).unwrap();
        assert!(t.path().join(".ambiente").is_dir());
        assert_eq!(leggi(&p).unwrap(), lista);
        // Nessun file temporaneo rimasto.
        assert!(!p.with_extension("yaml.tmp").exists());
        let testo = std::fs::read_to_string(&p).unwrap();
        assert!(testo.contains("MAI la password"));
        assert!(testo.contains("versione: 1"));
    }

    /// La regola «nessuna password»: un client che la manda non salva un
    /// segreto per sbaglio, riceve un errore.
    #[test]
    fn un_campo_password_e_rifiutato_dal_formato() {
        let con_pass = r#"[{"label":"a","url":"https://h:8444","user":"u","pass":"segreta"}]"#;
        assert!(serde_json::from_str::<Vec<DispositivoRegistrato>>(con_pass).is_err());
        let senza = r#"[{"label":"a","url":"https://h:8444","user":"u"}]"#;
        assert!(serde_json::from_str::<Vec<DispositivoRegistrato>>(senza).is_ok());
    }

    #[test]
    fn la_validazione_ferma_url_rotti_etichette_vuote_e_doppioni() {
        assert!(valida(&[d("ok", "https://wp630.local:8444", "user")]).is_ok());
        assert!(valida(&[d("ok", "http://192.168.1.10:8444/", "")]).is_ok());
        assert!(valida(&[d("", "https://h:8444", "u")]).is_err());
        assert!(
            valida(&[d("x", "wp630.local:8444", "u")]).is_err(),
            "manca lo schema"
        );
        assert!(valida(&[d("x", "https://", "u")]).is_err(), "host vuoto");
        assert!(valida(&[d("x", "https://h:8444 spazio", "u")]).is_err());
        assert!(
            valida(&[
                d("a", "https://h:8444", "u"),
                d("b", "https://H:8444/", "u")
            ])
            .is_err(),
            "stesso URL, maiuscole e slash finale a parte"
        );
    }

    #[test]
    fn un_file_scritto_a_mano_con_un_campo_sconosciuto_viene_rifiutato() {
        let t = tempfile::tempdir().unwrap();
        let p = percorso(t.path());
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(
            &p,
            "versione: 1\ndispositivi:\n  - label: a\n    url: https://h:8444\n    user: u\n    pass: x\n",
        )
        .unwrap();
        let e = leggi(&p).unwrap_err();
        assert!(e.contains("non è valido"), "{e}");
    }
}
