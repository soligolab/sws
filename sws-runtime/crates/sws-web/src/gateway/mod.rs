//! Il gateway: una porta sola davanti a tutti i progetti.
//!
//! Fase 4 del tronco cloud. Il piano sta in
//! `docs/plans/2026-10-09-fase-4-gateway.md`, con le specifiche decise dal
//! maintainer il 09-10-2026.

pub mod inoltro;
pub mod podman;
pub mod progetti;
pub mod rotte;
pub mod ritorno;

/// Il segreto con cui il gateway si fa riconoscere dai container dei progetti.
///
/// Si genera una volta e si tiene su disco accanto alla configurazione. Non si
/// rigenera a ogni avvio **perché i container sopravvivono al gateway**: dopo
/// un riavvio `Regia::riadotta` riprende in carico quelli accesi, e quelli
/// conoscono il segreto vecchio. Rigenerarlo vorrebbe dire che ogni richiesta
/// a un progetto riadottato viene rifiutata, in un modo che dall'esterno
/// sembra un guasto di autenticazione a caso.
///
/// Niente ripiego sull'orologio se `/dev/urandom` non c'è, al contrario di
/// `instance_id`: un identificativo prevedibile è un fastidio, un **segreto**
/// prevedibile è una porta aperta. Meglio non partire.
pub fn segreto_persistente(config_dir: &std::path::Path) -> anyhow::Result<String> {
    use std::io::Read as _;

    let percorso = config_dir.join("segreto_gateway");
    if let Ok(gia) = std::fs::read_to_string(&percorso) {
        let g = gia.trim();
        // La soglia è la stessa che il figlio pretende (`--auth-delegata`):
        // un file troncato a metà da un disco pieno non deve passare.
        if g.len() >= 16 {
            return Ok(g.to_string());
        }
    }

    let mut buf = [0u8; 24];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| anyhow::anyhow!("nessuna sorgente casuale per il segreto del gateway: {e}"))?;
    let segreto: String = buf.iter().map(|b| format!("{b:02x}")).collect();

    std::fs::create_dir_all(config_dir)?;
    std::fs::write(&percorso, &segreto)?;
    // Lo legge chi può leggere la cartella di configurazione, e basta.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(&percorso, std::fs::Permissions::from_mode(0o600));
    }
    Ok(segreto)
}

#[cfg(test)]
mod tests {
    #[test]
    fn il_segreto_resta_lo_stesso_fra_due_avvii() {
        let d = tempfile::tempdir().unwrap();
        let a = super::segreto_persistente(d.path()).unwrap();
        let b = super::segreto_persistente(d.path()).unwrap();
        assert_eq!(a, b, "un segreto nuovo a ogni avvio scollega i container riadottati");
        assert!(a.len() >= 16);
    }

    #[test]
    fn un_file_troncato_non_diventa_un_segreto_corto() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("segreto_gateway"), "abc").unwrap();
        let s = super::segreto_persistente(d.path()).unwrap();
        assert!(s.len() >= 16, "{s}");
    }
}
