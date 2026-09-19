// Una chiave, un file, permessi stretti — la parte comune fra i fornitori che
// ne hanno bisogno (l'assistente IA in `ai/client.rs`, il traduttore in
// `traduttore.rs`, F5 del piano multilingua-chiusura, 18/19-09-2026).
//
// Cosa NON sta qui: la scelta di QUALE file/percorso usare per un fornitore
// dato, e l'eventuale scavalco da variabile d'ambiente — quello resta a chi
// chiama, perché è specifico del fornitore (l'IA guarda `ANTHROPIC_API_KEY` e
// simili, la traduzione oggi non ha un equivalente). Qui c'è solo «leggi un
// file, scrivilo con permessi stretti, cancellalo senza spaventarsi se non
// c'era» — la parte davvero identica, prima duplicata in `ai/client.rs` e
// prossima a duplicarsi una seconda volta.

use std::path::{Path, PathBuf};

/// Legge una chiave da un file, se c'è. Una chiave vuota (solo spazi) conta
/// come assente: un file lasciato lì per sbaglio non deve sembrare configurato.
pub fn leggi_chiave(percorso: &Path) -> Option<String> {
    let testo = std::fs::read_to_string(percorso).ok()?;
    let k = testo.trim().to_string();
    if k.is_empty() {
        None
    } else {
        Some(k)
    }
}

/// Scrive la chiave in `config_dir/nome_file`, con permessi **0600**.
///
/// I permessi espliciti non sono un vezzo: una chiave API leggibile da tutti
/// gli utenti della macchina è un difetto che non costa niente evitare (stessa
/// nota di `ai/client.rs`, che l'ha introdotto per primo). Su piattaforme
/// senza permessi POSIX il file si scrive comunque: meglio senza permessi che
/// senza chiave.
pub fn scrivi_chiave(config_dir: &Path, nome_file: &str, chiave: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(config_dir)?;
    let p = config_dir.join(nome_file);
    std::fs::write(&p, chiave.trim())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(p)
}

/// Cancella `config_dir/nome_file`. `Ok(false)` = non c'era, che non è un
/// errore: cancellare due volte deve poter succedere senza spaventare nessuno.
pub fn cancella_chiave(config_dir: &Path, nome_file: &str) -> std::io::Result<bool> {
    let p = config_dir.join(nome_file);
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_chiave_scritta_si_rilegge_uguale() {
        let dir = tempfile::tempdir().unwrap();
        scrivi_chiave(dir.path(), "prova.key", "  segreta-123  ").unwrap();
        assert_eq!(
            leggi_chiave(&dir.path().join("prova.key")),
            Some("segreta-123".to_string())
        );
    }

    #[test]
    fn un_file_assente_non_e_un_errore() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(leggi_chiave(&dir.path().join("mai-scritto.key")), None);
    }

    #[test]
    fn un_file_di_soli_spazi_conta_come_assente() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("vuoto.key"), "   \n").unwrap();
        assert_eq!(leggi_chiave(&dir.path().join("vuoto.key")), None);
    }

    #[test]
    #[cfg(unix)]
    fn la_chiave_si_scrive_con_permessi_stretti() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = scrivi_chiave(dir.path(), "prova.key", "x").unwrap();
        let modo = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(modo, 0o600);
    }

    #[test]
    fn cancellare_una_chiave_che_non_c_e_non_e_un_errore() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!cancella_chiave(dir.path(), "mai-esistita.key").unwrap());
    }

    #[test]
    fn cancellare_una_chiave_che_c_e_la_toglie() {
        let dir = tempfile::tempdir().unwrap();
        scrivi_chiave(dir.path(), "prova.key", "x").unwrap();
        assert!(cancella_chiave(dir.path(), "prova.key").unwrap());
        assert_eq!(leggi_chiave(&dir.path().join("prova.key")), None);
    }
}
