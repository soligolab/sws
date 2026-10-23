//! La logica PLC del progetto: `<progetto>/openplc/`.
//!
//! # Perché una cartella, e non dentro `project.yaml`
//!
//! Il Python delle funzioni e degli script globali vive **in linea** nello
//! YAML, e quella sarebbe stata la strada che costa meno: ciò che sta in
//! `project.yaml` viaggia da sé nel backup, nell'istantanea, nel deploy,
//! nell'export e nel git di progetto, senza che nessuno aggiunga una riga da
//! nessuna parte.
//!
//! Il maintainer ha scelto diversamente, il 23-10-2026, e con una ragione
//! precisa: **l'IDE di OpenPLC è un'applicazione desktop**, e apre una
//! cartella. Un albero di file in `~/sws_projects/<nome>/openplc/` lo apre con
//! un «File → Apri»; un pezzo di testo dentro uno YAML no.
//!
//! # Cosa costa, e perché il git non costa niente
//!
//! Il git di progetto fa `git add -A`: prende **tutto** quello che c'è nella
//! cartella, tranne ciò che il `.gitignore` esclude. Quindi questa cartella è
//! versionata **gratis**, zero righe.
//!
//! Il resto no. Backup, export, deploy e impronta sono **elenchi scritti a
//! mano**, uno per posto, e questo modulo esiste per non spargere la stessa
//! logica in quattro file diversi — che è esattamente come quegli elenchi hanno
//! cominciato a divergere fra loro (`backups.rs` non ha `faceplates` né
//! `cornici`, che gli altri due hanno).
//!
//! # Dove NON entra, di proposito
//!
//! Nell'**istantanea**. Quella copia il progetto in una cartella temporanea per
//! disegnarne una pagina col motore LVGL: la logica del PLC non partecipa al
//! disegno, e copiare megabyte a ogni fotografia sarebbe un costo senza
//! contropartita.

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use std::io::Cursor;
use std::path::{Path as FsPath, PathBuf};

/// Il nome della cartella, dentro il progetto. Anche il prefisso nel bundle.
pub const CARTELLA: &str = "openplc";

/// Oltre questo, la cartella non entra in un bundle.
///
/// Un progetto OpenPLC sorgente sta in qualche centinaio di kB; se qualcuno ci
/// lascia dentro l'output della compilazione — il C generato, o peggio un
/// `program.zip` — un deploy diventa improvvisamente pesante, e il motivo non
/// si vede da nessuna parte. Meglio dirlo.
pub const TETTO_BYTE: u64 = 32 * 1024 * 1024;

pub fn dir_at(project_dir: &FsPath) -> PathBuf {
    project_dir.join(CARTELLA)
}

/// Un percorso relativo che si può scrivere dentro la cartella senza uscirne.
///
/// Sta qui e non dentro i due chiamanti perché è la regola di sicurezza del
/// modulo: un bundle è un file che arriva da fuori, e `pous/../../etc/passwd`
/// è esattamente quello che un bundle ostile proverebbe.
pub fn percorso_sicuro(rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.starts_with('/') || rel.starts_with('\\') {
        return None;
    }
    let mut out = PathBuf::new();
    for pezzo in rel.split('/') {
        if pezzo.is_empty() || pezzo == "." || pezzo == ".." || pezzo.contains('\\') {
            return None;
        }
        out.push(pezzo);
    }
    Some(out)
}

/// La cartella intera, come coppie (percorso relativo, contenuto).
///
/// Ricorsiva, perché l'albero di un progetto OpenPLC lo è: `project.json`,
/// `pous/programs/…`, `devices/servers/…`. I percorsi usano sempre `/`, anche
/// dove il sistema userebbe altro: è quello che finisce nel bundle.
///
/// Vuota se la cartella non c'è — un progetto senza logica PLC è la norma — e
/// vuota anche se sfora il tetto, con un avviso: meglio un deploy senza la
/// logica e un messaggio, che un deploy che non finisce più.
pub async fn leggi_per_bundle(project_dir: &FsPath) -> Vec<(String, Vec<u8>)> {
    let radice = dir_at(project_dir);
    if !radice.is_dir() {
        return Vec::new();
    }
    let mut out: Vec<(String, Vec<u8>)> = Vec::new();
    let mut totale: u64 = 0;
    // Iterativa e non ricorsiva: una `async fn` che chiama sé stessa va
    // incapsulata in un `Box`, e qui non serve.
    let mut da_visitare = vec![(radice.clone(), String::new())];
    while let Some((dir, prefisso)) = da_visitare.pop() {
        let Ok(mut rd) = tokio::fs::read_dir(&dir).await else { continue };
        while let Ok(Some(e)) = rd.next_entry().await {
            let nome = e.file_name().to_string_lossy().into_owned();
            if nome.starts_with('.') {
                continue; // `.git`, e qualunque cosa l'editor lasci indietro
            }
            let rel = if prefisso.is_empty() { nome.clone() } else { format!("{prefisso}/{nome}") };
            match e.file_type().await {
                Ok(t) if t.is_dir() => da_visitare.push((e.path(), rel)),
                Ok(t) if t.is_file() => {
                    let Ok(b) = tokio::fs::read(e.path()).await else { continue };
                    totale += b.len() as u64;
                    if totale > TETTO_BYTE {
                        tracing::warn!(
                            cartella = %radice.display(),
                            tetto_mb = TETTO_BYTE / 1024 / 1024,
                            "la logica PLC supera il tetto: non entra nel bundle"
                        );
                        return Vec::new();
                    }
                    out.push((rel, b));
                }
                // Un collegamento simbolico non si segue: puntare fuori dal
                // progetto è il modo più semplice di far uscire un file che
                // non doveva uscire.
                _ => {}
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Scrive nel bundle quello che `leggi_per_bundle` ha letto.
pub fn nel_bundle<W: std::io::Write + std::io::Seek>(
    z: &mut zip::ZipWriter<W>,
    opts: zip::write::SimpleFileOptions,
    file: &[(String, Vec<u8>)],
) -> zip::result::ZipResult<()> {
    use std::io::Write;
    for (rel, bytes) in file {
        z.start_file(format!("{CARTELLA}/{rel}"), opts)?;
        z.write_all(bytes)?;
    }
    Ok(())
}

/// Rimette la cartella com'è nel bundle: scrive quello che porta e **toglie il
/// resto**, come già fanno `faceplates/`, `recipes/` e `boot/`.
///
/// Un bundle che non ha la cartella non la cancella: un progetto senza logica
/// PLC distribuito su un pannello che ce l'ha è quasi sempre un bundle vecchio,
/// non una richiesta di cancellare il programma del PLC.
pub async fn sincronizza_da_zip(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    target_dir: &FsPath,
) -> std::io::Result<()> {
    let nomi: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let prefisso = format!("{CARTELLA}/");
    if !nomi.iter().any(|n| n.starts_with(&prefisso)) {
        return Ok(());
    }
    let mut tenuti = std::collections::HashSet::<PathBuf>::new();
    for nome in &nomi {
        let Some(rel) = nome.strip_prefix(&prefisso) else { continue };
        let Some(sicuro) = percorso_sicuro(rel) else { continue };
        let mut buf = Vec::new();
        {
            let mut f = archive.by_name(nome)?;
            std::io::copy(&mut f, &mut buf)?;
        }
        let dest = target_dir.join(&sicuro);
        if let Some(p) = dest.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        tokio::fs::write(&dest, &buf).await?;
        tenuti.insert(sicuro);
    }
    pota(target_dir, target_dir, &tenuti).await;
    Ok(())
}

/// Toglie i file che il bundle non porta, e le cartelle rimaste vuote.
async fn pota(radice: &FsPath, _dir: &FsPath, tenuti: &std::collections::HashSet<PathBuf>) {
    let mut da_visitare = vec![radice.to_path_buf()];
    let mut viste = Vec::new();
    while let Some(d) = da_visitare.pop() {
        let Ok(mut rd) = tokio::fs::read_dir(&d).await else { continue };
        while let Ok(Some(e)) = rd.next_entry().await {
            let p = e.path();
            match e.file_type().await {
                Ok(t) if t.is_dir() => {
                    da_visitare.push(p.clone());
                    viste.push(p);
                }
                Ok(t) if t.is_file() => {
                    if let Ok(rel) = p.strip_prefix(radice) {
                        if !tenuti.contains(rel) {
                            let _ = tokio::fs::remove_file(&p).await;
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Dal fondo verso l'alto: una cartella si può togliere solo quando i suoi
    // figli non ci sono più. `remove_dir` fallisce se non è vuota, ed è proprio
    // il controllo che serve.
    viste.sort();
    for d in viste.into_iter().rev() {
        let _ = tokio::fs::remove_dir(&d).await;
    }
}

/// Aggiunge la cartella all'impronta del deploy.
///
/// Entra nell'hash **solo se c'è**, come fa già `boot/`: l'impronta di un
/// progetto senza logica PLC resta quella di prima, e i progetti esistenti non
/// risultano tutti da ridistribuire il giorno dell'aggiornamento.
pub fn aggiungi_all_impronta(hasher: &mut sha2::Sha256, project_dir: &FsPath) {
    use sha2::Digest;
    let radice = dir_at(project_dir);
    if !radice.is_dir() {
        return;
    }
    let mut file: Vec<(String, PathBuf)> = Vec::new();
    let mut da_visitare = vec![(radice.clone(), String::new())];
    while let Some((dir, prefisso)) = da_visitare.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let nome = e.file_name().to_string_lossy().into_owned();
            if nome.starts_with('.') {
                continue;
            }
            let rel = if prefisso.is_empty() { nome.clone() } else { format!("{prefisso}/{nome}") };
            match e.file_type() {
                Ok(t) if t.is_dir() => da_visitare.push((e.path(), rel)),
                Ok(t) if t.is_file() => file.push((rel, e.path())),
                _ => {}
            }
        }
    }
    file.sort_by(|a, b| a.0.cmp(&b.0));
    for (rel, path) in &file {
        hasher.update(format!("{CARTELLA}/").as_bytes());
        hasher.update(rel.as_bytes());
        if let Ok(b) = std::fs::read(path) {
            hasher.update(&b);
        }
    }
}

/// `GET /api/project/logica-plc` — scarica la sola cartella `openplc/`.
///
/// # Perché esiste
///
/// L'IDE di OpenPLC è un'applicazione desktop e apre una cartella sul disco.
/// Quando l'IDE di SWS gira **sul PC di chi lavora**, quella cartella è lì e
/// non serve niente: `~/sws_projects/<nome>/openplc/` si apre e basta.
///
/// Quando invece l'IDE è **nel cloud**, i file stanno sul VPS e l'Editor non li
/// raggiunge. Queste due rotte sono il ponte che il maintainer ha scelto il
/// 23-10-2026: si scarica la cartella, la si apre con l'Editor sul proprio PC,
/// e la si rimanda su.
///
/// È l'export/import di progetto ristretto a una cartella, e riusa le stesse
/// due funzioni del bundle — quindi le stesse regole, compreso il rifiuto dei
/// percorsi che escono dalla cartella.
pub async fn scarica(State(s): State<crate::router::AppState>) -> Response {
    let dir = match crate::router::active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let file = leggi_per_bundle(&dir).await;
    if file.is_empty() {
        return (StatusCode::NOT_FOUND, "questo progetto non ha una logica PLC").into_response();
    }
    let mut cursore = Cursor::new(Vec::<u8>::new());
    {
        let mut z = zip::ZipWriter::new(&mut cursore);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        // Qui **senza** il prefisso `openplc/`: chi scarica vuole il progetto
        // OpenPLC, non una cartella dentro un'altra. Il prefisso serve dentro
        // un bundle di progetto, dove convive con synoptics/ e images/.
        for (rel, bytes) in &file {
            use std::io::Write;
            if z.start_file(rel.clone(), opts).and_then(|_| z.write_all(bytes).map_err(Into::into)).is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "non riesco a comporre lo zip").into_response();
            }
        }
        if z.finish().is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, "non riesco a chiudere lo zip").into_response();
        }
    }
    let buf = cursore.into_inner();
    tracing::info!(file = file.len(), byte = buf.len(), "logica PLC scaricata");
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"openplc.zip\"".to_string(),
            ),
        ],
        buf,
    )
        .into_response()
}

/// `PUT /api/project/logica-plc` — rimette la cartella da uno zip.
///
/// **Sostituisce**: quello che lo zip non porta viene tolto, come già fanno
/// `faceplates/`, `recipes/` e `boot/` quando arrivano da un bundle. Uno zip
/// vuoto quindi svuota la cartella, ed è il modo di cancellare la logica.
pub async fn carica(State(s): State<crate::router::AppState>, body: axum::body::Bytes) -> Response {
    let dir = match crate::router::active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    if body.len() as u64 > TETTO_BYTE {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("la logica PLC supera {} MiB", TETTO_BYTE / 1024 / 1024),
        )
            .into_response();
    }
    let mut archivio = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a) => a,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("non è uno zip leggibile: {e}")).into_response(),
    };
    // `sincronizza_da_zip` vuole il prefisso `openplc/`, perché nasce per i
    // bundle di progetto; qui lo zip è la cartella nuda. Si riusa lo stesso
    // codice passando la radice come destinazione e aggiungendo il prefisso ai
    // nomi — così la regola dei percorsi sicuri resta una sola.
    let nomi: Vec<String> = archivio.file_names().map(|s| s.to_string()).collect();
    let mut tenuti = std::collections::HashSet::<PathBuf>::new();
    let destinazione = dir_at(&dir);
    for nome in &nomi {
        if nome.ends_with('/') {
            continue; // una voce di cartella non è un file
        }
        let Some(sicuro) = percorso_sicuro(nome) else {
            return (StatusCode::BAD_REQUEST, format!("percorso non ammesso: {nome}")).into_response();
        };
        let mut buf = Vec::new();
        let letto = archivio
            .by_name(nome)
            .map_err(|e| e.to_string())
            .and_then(|mut f| std::io::copy(&mut f, &mut buf).map(|_| ()).map_err(|e| e.to_string()));
        if let Err(e) = letto {
            return (StatusCode::BAD_REQUEST, format!("{nome}: {e}")).into_response();
        }
        let dest = destinazione.join(&sicuro);
        if let Some(p) = dest.parent() {
            if tokio::fs::create_dir_all(p).await.is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "non riesco a creare la cartella").into_response();
            }
        }
        if tokio::fs::write(&dest, &buf).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("non riesco a scrivere {nome}")).into_response();
        }
        tenuti.insert(sicuro);
    }
    pota(&destinazione, &destinazione, &tenuti).await;
    crate::router::signal_project_changed(&s, "logica-plc");
    tracing::info!(file = tenuti.len(), "logica PLC caricata");
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Un bundle è un file che arriva da fuori: i percorsi che escono dalla
    /// cartella non si scrivono, e non è un dettaglio di stile.
    #[test]
    fn un_percorso_che_esce_dalla_cartella_si_rifiuta() {
        assert!(percorso_sicuro("project.json").is_some());
        assert!(percorso_sicuro("pous/programs/main.st").is_some());
        assert!(percorso_sicuro("../../etc/passwd").is_none());
        assert!(percorso_sicuro("pous/../../fuori").is_none());
        assert!(percorso_sicuro("/etc/passwd").is_none());
        assert!(percorso_sicuro("").is_none());
        assert!(percorso_sicuro("pous//main.st").is_none(), "un pezzo vuoto non è un nome");
        assert!(percorso_sicuro("pous\\main.st").is_none(), "il separatore di Windows no");
    }

    #[tokio::test]
    async fn legge_l_albero_annidato_coi_percorsi_relativi() {
        let t = tempfile::tempdir().unwrap();
        let d = dir_at(t.path());
        tokio::fs::create_dir_all(d.join("pous/programs")).await.unwrap();
        tokio::fs::write(d.join("project.json"), b"{}").await.unwrap();
        tokio::fs::write(d.join("pous/programs/main.st"), b"PROGRAM main").await.unwrap();
        // Quello che l'editor lascia indietro non entra.
        tokio::fs::create_dir_all(d.join(".git")).await.unwrap();
        tokio::fs::write(d.join(".git/HEAD"), b"ref").await.unwrap();

        let letti = leggi_per_bundle(t.path()).await;
        let nomi: Vec<&str> = letti.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(nomi, vec!["pous/programs/main.st", "project.json"]);
    }

    #[tokio::test]
    async fn un_progetto_senza_logica_non_da_niente() {
        let t = tempfile::tempdir().unwrap();
        assert!(leggi_per_bundle(t.path()).await.is_empty());
        // E non entra nell'impronta: i progetti di oggi non devono risultare
        // tutti da ridistribuire il giorno dell'aggiornamento.
        use sha2::Digest;
        let mut a = sha2::Sha256::new();
        a.update(b"x");
        let mut b = sha2::Sha256::new();
        b.update(b"x");
        aggiungi_all_impronta(&mut b, t.path());
        assert_eq!(a.finalize(), b.finalize());
    }

    #[tokio::test]
    async fn l_impronta_cambia_se_cambia_un_file_in_fondo_all_albero() {
        use sha2::Digest;
        let t = tempfile::tempdir().unwrap();
        let d = dir_at(t.path());
        tokio::fs::create_dir_all(d.join("pous/programs")).await.unwrap();
        tokio::fs::write(d.join("pous/programs/main.st"), b"PROGRAM a").await.unwrap();
        let mut h1 = sha2::Sha256::new();
        aggiungi_all_impronta(&mut h1, t.path());
        tokio::fs::write(d.join("pous/programs/main.st"), b"PROGRAM b").await.unwrap();
        let mut h2 = sha2::Sha256::new();
        aggiungi_all_impronta(&mut h2, t.path());
        assert_ne!(h1.finalize(), h2.finalize());
    }

    /// Il giro completo che le due rotte fanno: si legge la cartella, si
    /// compone uno zip **senza** il prefisso, e lo si rimette.
    ///
    /// Qui si prova la parte che conta — la forma dello zip e la potatura —
    /// senza montare un router: quello che resta fuori è il codice di axum.
    #[tokio::test]
    async fn il_giro_scarica_e_ricarica_sostituisce_la_cartella() {
        use std::io::Write;
        let t = tempfile::tempdir().unwrap();
        let d = dir_at(t.path());
        tokio::fs::create_dir_all(d.join("pous")).await.unwrap();
        tokio::fs::write(d.join("project.json"), b"{\"v\":1}").await.unwrap();
        tokio::fs::write(d.join("pous/main.st"), b"PROGRAM main").await.unwrap();
        tokio::fs::write(d.join("vecchio.st"), b"da togliere").await.unwrap();

        // Lo zip come lo compone `scarica`: percorsi nudi, niente prefisso.
        let letti = leggi_per_bundle(t.path()).await;
        assert_eq!(letti.len(), 3);
        let mut cur = Cursor::new(Vec::<u8>::new());
        {
            let mut z = zip::ZipWriter::new(&mut cur);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            // Si rimanda su solo quello che l'Editor ha tenuto: `vecchio.st` no.
            for (rel, b) in letti.iter().filter(|(r, _)| r != "vecchio.st") {
                z.start_file(rel.clone(), opts).unwrap();
                z.write_all(b).unwrap();
            }
            z.finish().unwrap();
        }
        let zip_bytes = cur.into_inner();

        // E la parte di `carica`: scrive quello che c'è e pota il resto.
        let mut a = zip::ZipArchive::new(Cursor::new(zip_bytes.as_slice())).unwrap();
        let nomi: Vec<String> = a.file_names().map(|s| s.to_string()).collect();
        let mut tenuti = std::collections::HashSet::<PathBuf>::new();
        for nome in &nomi {
            let sicuro = percorso_sicuro(nome).unwrap();
            let mut buf = Vec::new();
            {
                let mut f = a.by_name(nome).unwrap();
                std::io::copy(&mut f, &mut buf).unwrap();
            }
            let dest = d.join(&sicuro);
            tokio::fs::create_dir_all(dest.parent().unwrap()).await.unwrap();
            tokio::fs::write(&dest, &buf).await.unwrap();
            tenuti.insert(sicuro);
        }
        pota(&d, &d, &tenuti).await;

        assert!(d.join("project.json").exists());
        assert!(d.join("pous/main.st").exists());
        assert!(!d.join("vecchio.st").exists(), "la sostituzione non ha tolto il file di prima");
    }

    /// La potatura toglie anche le cartelle rimaste vuote: un `pous/` vuoto
    /// dopo che l'ultimo programma è sparito confonde chi apre con l'Editor.
    #[tokio::test]
    async fn la_potatura_porta_via_anche_le_cartelle_vuote() {
        let t = tempfile::tempdir().unwrap();
        let d = dir_at(t.path());
        tokio::fs::create_dir_all(d.join("pous/programs")).await.unwrap();
        tokio::fs::write(d.join("pous/programs/main.st"), b"x").await.unwrap();
        tokio::fs::write(d.join("project.json"), b"{}").await.unwrap();
        let mut tenuti = std::collections::HashSet::<PathBuf>::new();
        tenuti.insert(PathBuf::from("project.json"));
        pota(&d, &d, &tenuti).await;
        assert!(d.join("project.json").exists());
        assert!(!d.join("pous").exists(), "la cartella vuota è rimasta");
    }

    #[tokio::test]
    async fn oltre_il_tetto_non_entra_nel_bundle() {
        let t = tempfile::tempdir().unwrap();
        let d = dir_at(t.path());
        tokio::fs::create_dir_all(&d).await.unwrap();
        tokio::fs::write(d.join("grosso.bin"), vec![0u8; (TETTO_BYTE + 1) as usize]).await.unwrap();
        assert!(leggi_per_bundle(t.path()).await.is_empty());
    }
}
