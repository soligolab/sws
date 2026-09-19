//! Le pagine di boot (T-72): l'immagine che il pannello mostra mentre parte.
//!
//! Una pagina di boot è, nell'IDE, una pagina come le altre — stesso canvas,
//! stessi oggetti — ma su disco è un documento a sé: `boot/<nome>.yaml` (la
//! pagina, con `kind: boot`) e accanto `boot/<nome>.png` (l'immagine
//! rasterizzata dal browser al salvataggio). Sta fuori da `synoptics/` di
//! proposito: il runtime, i viewer e il kiosk leggono solo quella cartella, e
//! quindi **non vedono mai** una pagina di boot. È lo stesso schema di
//! `faceplates/` e `recipes/`.
//!
//! Qui c'è la parte che tocca il disco, in funzioni che prendono la cartella
//! del progetto e si provano con una cartella temporanea; gli handler HTTP in
//! fondo sono sottili.

use crate::router::{
    active_dir, con_versione, conflitto_di_versione, scrivi_atomico, signal_project_changed,
    versione_attesa, AppState,
};
use crate::synoptic::{safe_filename, SynopticPage};
use axum::{
    body::{Body, Bytes},
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::io::Read;
use std::path::{Path as FsPath, PathBuf};
use tracing::warn;

/// Il valore di `SynopticPage::kind` per una pagina di boot.
pub const BOOT_KIND: &str = "boot";

/// Tetto del PNG. Sta sotto il limite del corpo delle richieste
/// (`LIMITE_CORPO_UPLOAD` in `router.rs`) e sopra un 1920×1080 con sfumature.
pub const MAX_BOOT_PNG_BYTES: usize = 5 * 1024 * 1024;

/// I tipi di oggetto ammessi su una pagina di boot: solo vettoriali statici. Gli
/// altri (trend, tabelle, controlli) sono `<foreignObject>` o `<canvas>`, e il
/// PNG che il browser ne ricava non sarebbe fedele — o non mostrerebbe niente.
pub const BOOT_TYPES: &[&str] = &["rect", "ellipse", "line", "pipe", "text", "image", "symbol"];

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Nome e dimensioni della pagina di boot con cui nasce ogni progetto.
pub const NOME_BOOT_INIZIALE: &str = "Immagine di boot";
const LARGHEZZA_INIZIALE: f64 = 1280.0;
const ALTEZZA_INIZIALE: f64 = 800.0;

pub fn boot_dir_at(project_dir: &FsPath) -> PathBuf {
    project_dir.join("boot")
}

pub fn e_pagina_di_boot(p: &SynopticPage) -> bool {
    p.kind.as_deref() == Some(BOOT_KIND)
}

fn yaml_path(dir: &FsPath, name: &str) -> PathBuf {
    boot_dir_at(dir).join(format!("{}.yaml", safe_filename(name)))
}

fn png_path(dir: &FsPath, name: &str) -> PathBuf {
    boot_dir_at(dir).join(format!("{}.png", safe_filename(name)))
}

/// Perché un salvataggio di pagina di boot è stato rifiutato.
#[derive(Debug, PartialEq)]
pub enum ErroreSalvataggio {
    /// La pagina non dichiara `kind: boot`: non è roba di questa cartella.
    NonBoot,
    /// Il file su disco non è più quello che chi salva aveva caricato (Q30).
    Conflitto,
    /// Un oggetto di un tipo che una pagina di boot non può avere.
    TipoNonAmmesso(String),
    Io(String),
}

/// Perché un PNG è stato rifiutato.
#[derive(Debug, PartialEq)]
pub enum ErrorePng {
    /// Non esiste la pagina di boot a cui il PNG appartiene.
    SenzaPagina,
    Vuoto,
    TroppoGrande,
    NonPng,
    Io(String),
}

/// I nomi (senza estensione) delle pagine di boot, in ordine alfabetico.
pub async fn elenca(dir: &FsPath) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(boot_dir_at(dir)).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    names.push(stem.to_owned());
                }
            }
        }
    }
    names.sort();
    names
}

/// Salva una pagina di boot. Restituisce il testo YAML scritto (serve per la
/// nuova versione). Se la pagina è stata rinominata, il vecchio file — e il
/// suo PNG — seguono il nome nuovo.
pub async fn salva(
    dir: &FsPath,
    name: &str,
    page: &SynopticPage,
    versione_attesa: Option<&str>,
) -> Result<String, (ErroreSalvataggio, Option<Response>)> {
    if !e_pagina_di_boot(page) {
        return Err((ErroreSalvataggio::NonBoot, None));
    }
    if let Some(o) = page
        .objects
        .iter()
        .find(|o| !BOOT_TYPES.contains(&o.obj_type.as_str()))
    {
        return Err((ErroreSalvataggio::TipoNonAmmesso(o.obj_type.clone()), None));
    }
    let bdir = boot_dir_at(dir);
    if let Err(e) = tokio::fs::create_dir_all(&bdir).await {
        return Err((ErroreSalvataggio::Io(format!("mkdir boot: {e}")), None));
    }
    let new_filename = format!("{}.yaml", safe_filename(name));
    let path = bdir.join(&new_filename);

    let su_disco = tokio::fs::read_to_string(&path).await.ok();
    if let Some(r) = conflitto_di_versione(
        versione_attesa,
        su_disco.as_deref(),
        "Questa pagina di boot",
    ) {
        return Err((ErroreSalvataggio::Conflitto, Some(r)));
    }

    let yaml = serde_yaml::to_string(page)
        .map_err(|e| (ErroreSalvataggio::Io(format!("serialize: {e}")), None))?;
    scrivi_atomico(&path, yaml.as_bytes())
        .await
        .map_err(|e| (ErroreSalvataggio::Io(format!("write: {e}")), None))?;

    // Rinomina: il vecchio file ha lo stesso `id` e un nome diverso. Si toglie,
    // e il suo PNG passa al nome nuovo (o si butta, se il nuovo ne ha già uno).
    if let Ok(mut entries) = tokio::fs::read_dir(&bdir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let fname = entry.file_name().to_string_lossy().into_owned();
            if !fname.ends_with(".yaml") || fname == new_filename {
                continue;
            }
            #[derive(serde::Deserialize)]
            struct IdOnly {
                id: String,
            }
            let Ok(text) = tokio::fs::read_to_string(entry.path()).await else {
                continue;
            };
            let Ok(p) = serde_yaml::from_str::<IdOnly>(&text) else {
                continue;
            };
            if p.id != page.id {
                continue;
            }
            let vecchio_png = entry.path().with_extension("png");
            let nuovo_png = png_path(dir, name);
            if tokio::fs::try_exists(&vecchio_png).await.unwrap_or(false) {
                if tokio::fs::try_exists(&nuovo_png).await.unwrap_or(false) {
                    let _ = tokio::fs::remove_file(&vecchio_png).await;
                } else {
                    let _ = tokio::fs::rename(&vecchio_png, &nuovo_png).await;
                }
            }
            if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                warn!("boot::salva: cannot remove stale {:?}: {e}", entry.path());
            }
        }
    }
    Ok(yaml)
}

/// Toglie la pagina e il suo PNG. `false` se la pagina non c'era.
pub async fn elimina(dir: &FsPath, name: &str) -> bool {
    let _ = tokio::fs::remove_file(png_path(dir, name)).await;
    tokio::fs::remove_file(yaml_path(dir, name)).await.is_ok()
}

/// Scrive il PNG di una pagina che esiste. Controlla che sia davvero un PNG:
/// il file finirà sul launcher del pannello, che non perdona un file storto.
pub async fn scrivi_png(dir: &FsPath, name: &str, bytes: &[u8]) -> Result<(), ErrorePng> {
    if !tokio::fs::try_exists(yaml_path(dir, name))
        .await
        .unwrap_or(false)
    {
        return Err(ErrorePng::SenzaPagina);
    }
    if bytes.is_empty() {
        return Err(ErrorePng::Vuoto);
    }
    if bytes.len() > MAX_BOOT_PNG_BYTES {
        return Err(ErrorePng::TroppoGrande);
    }
    if bytes.len() < PNG_MAGIC.len() || bytes[..PNG_MAGIC.len()] != PNG_MAGIC {
        return Err(ErrorePng::NonPng);
    }
    scrivi_atomico(&png_path(dir, name), bytes)
        .await
        .map_err(|e| ErrorePng::Io(e.to_string()))
}

/// La pagina di boot con cui nasce un progetto: vuota, 1280×800, sfondo neutro.
pub fn pagina_di_boot_iniziale() -> SynopticPage {
    SynopticPage {
        id: format!("boot-{}", crate::synoptic::nuovo_id_pagina()),
        name: NOME_BOOT_INIZIALE.to_string(),
        objects: vec![],
        background: Some("#0f172a".to_string()),
        background_dark: None,
        width: Some(LARGHEZZA_INIZIALE),
        height: Some(ALTEZZA_INIZIALE),
        groups: None,
        zones: None,
        auto_rotate_skip: None,
        locked: None,
        kind: Some(BOOT_KIND.to_string()),
    }
}

/// La pagina sinottica vuota con cui nasce un progetto vuoto.
pub fn pagina_uno_iniziale() -> SynopticPage {
    SynopticPage {
        id: format!("page-{}", crate::synoptic::nuovo_id_pagina()),
        name: "Page 1".to_string(),
        objects: vec![],
        background: None,
        background_dark: None,
        width: None,
        height: None,
        groups: None,
        zones: None,
        auto_rotate_skip: None,
        locked: None,
        kind: None,
    }
}

/// Alla creazione di un progetto: se manca `boot/`, ci mette la pagina di boot
/// vuota; se `con_pagina_uno` e manca `synoptics/`, anche `Page 1`. Non
/// sovrascrive niente: un template che porta già le sue pagine le tiene.
pub async fn semina(dir: &FsPath, con_pagina_uno: bool) -> std::io::Result<()> {
    if !tokio::fs::try_exists(boot_dir_at(dir))
        .await
        .unwrap_or(false)
    {
        let page = pagina_di_boot_iniziale();
        let yaml = serde_yaml::to_string(&page)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        tokio::fs::create_dir_all(boot_dir_at(dir)).await?;
        tokio::fs::write(yaml_path(dir, &page.name), yaml).await?;
    }
    if con_pagina_uno {
        let syn = crate::router::synoptics_dir_at(dir);
        if !tokio::fs::try_exists(&syn).await.unwrap_or(false) {
            let page = pagina_uno_iniziale();
            let yaml = serde_yaml::to_string(&page)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            tokio::fs::create_dir_all(&syn).await?;
            tokio::fs::write(
                syn.join(format!("{}.yaml", safe_filename(&page.name))),
                yaml,
            )
            .await?;
        }
    }
    Ok(())
}

/// Ogni file di `boot/` (pagine e PNG) come coppie (nome, byte), per il bundle
/// di export/deploy. Un file che non si legge si salta.
pub async fn leggi_per_bundle(dir: &FsPath) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(boot_dir_at(dir)).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !(name.ends_with(".yaml") || name.ends_with(".png")) {
                continue;
            }
            if let Ok(bytes) = tokio::fs::read(entry.path()).await {
                out.push((name, bytes));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Replace-mode di `boot/` da un bundle importato: scrive ciò che il bundle
/// porta e toglie il resto, come per `faceplates/` e `recipes/`.
pub async fn sincronizza_da_zip(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    target_dir: &FsPath,
) -> std::io::Result<()> {
    let names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let mut kept = std::collections::HashSet::<String>::new();
    for name in &names {
        let Some(fname) = name.strip_prefix("boot/") else {
            continue;
        };
        if fname.is_empty() || fname.contains('/') || fname.contains("..") {
            continue;
        }
        if !(fname.ends_with(".yaml") || fname.ends_with(".png")) {
            continue;
        }
        let mut buf = Vec::new();
        match archive.by_name(name) {
            Ok(mut f) => {
                f.read_to_end(&mut buf)?;
            }
            Err(_) => continue,
        }
        if fname.ends_with(".png") && buf.len() > MAX_BOOT_PNG_BYTES {
            continue;
        }
        tokio::fs::create_dir_all(target_dir).await?;
        tokio::fs::write(target_dir.join(fname), buf).await?;
        kept.insert(fname.to_string());
    }
    if let Ok(mut entries) = tokio::fs::read_dir(target_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let fname = entry.file_name().to_string_lossy().into_owned();
            if (fname.ends_with(".yaml") || fname.ends_with(".png")) && !kept.contains(&fname) {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    Ok(())
}

// ── Handler HTTP ─────────────────────────────────────────────────────────────

/// `GET /api/boot-pages` — i nomi delle pagine di boot.
pub async fn list_boot_pages(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    Json(elenca(&dir).await).into_response()
}

/// `GET /api/boot-pages/:name`
pub async fn get_boot_page(State(s): State<AppState>, Path(name): Path<String>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match tokio::fs::read_to_string(yaml_path(&dir, &name)).await {
        Ok(text) => match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => con_versione(Json(page).into_response(), &text),
            Err(e) => {
                warn!("failed to parse boot page {name}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `PUT /api/boot-pages/:name` — richiede `kind: boot` nel corpo.
pub async fn save_boot_page(
    State(s): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    Json(page): Json<SynopticPage>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match salva(&dir, &name, &page, versione_attesa(&headers).as_deref()).await {
        Ok(yaml) => {
            signal_project_changed(&s, "boot");
            con_versione(StatusCode::NO_CONTENT.into_response(), &yaml)
        }
        Err((ErroreSalvataggio::NonBoot, _)) => (
            StatusCode::BAD_REQUEST,
            "una pagina di boot deve dichiarare `kind: boot`",
        )
            .into_response(),
        Err((ErroreSalvataggio::TipoNonAmmesso(t), _)) => (
            StatusCode::BAD_REQUEST,
            format!(
                "una pagina di boot non può contenere oggetti di tipo «{t}»: solo {}",
                BOOT_TYPES.join(", ")
            ),
        )
            .into_response(),
        Err((ErroreSalvataggio::Conflitto, Some(r))) => r,
        Err((ErroreSalvataggio::Conflitto, None)) => StatusCode::CONFLICT.into_response(),
        Err((ErroreSalvataggio::Io(m), _)) => {
            warn!("save_boot_page: {m}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `DELETE /api/boot-pages/:name` — toglie la pagina e il suo PNG.
pub async fn delete_boot_page(State(s): State<AppState>, Path(name): Path<String>) -> StatusCode {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c,
    };
    if elimina(&dir, &name).await {
        signal_project_changed(&s, "boot");
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// `GET /api/boot-pages/:name/png`
pub async fn get_boot_png(State(s): State<AppState>, Path(name): Path<String>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match tokio::fs::read(png_path(&dir, &name)).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            // L'anteprima nell'IDE deve vedere subito il PNG rigenerato.
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(bytes))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "PNG non ancora generato").into_response(),
    }
}

/// `PUT /api/boot-pages/:name/png` — corpo raw.
pub async fn put_boot_png(
    State(s): State<AppState>,
    Path(name): Path<String>,
    body: Bytes,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match scrivi_png(&dir, &name, &body).await {
        Ok(()) => {
            signal_project_changed(&s, "boot");
            StatusCode::NO_CONTENT.into_response()
        }
        Err(ErrorePng::SenzaPagina) => {
            (StatusCode::NOT_FOUND, "la pagina di boot non esiste").into_response()
        }
        Err(ErrorePng::Vuoto) => (StatusCode::BAD_REQUEST, "file vuoto").into_response(),
        Err(ErrorePng::TroppoGrande) => (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "PNG troppo grande ({} KB, max {} KB)",
                body.len() / 1024,
                MAX_BOOT_PNG_BYTES / 1024
            ),
        )
            .into_response(),
        Err(ErrorePng::NonPng) => {
            (StatusCode::BAD_REQUEST, "il corpo non è un file PNG").into_response()
        }
        Err(ErrorePng::Io(m)) => {
            warn!("put_boot_png: {m}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `POST /api/boot-pages/import` — una pagina di boot da un YAML. Riceve
/// sempre un `id` nuovo e un nome che non collide, e `kind: boot` a prescindere
/// da ciò che il file dichiara.
pub async fn import_boot_page(State(s): State<AppState>, body: Bytes) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let Ok(text) = std::str::from_utf8(&body) else {
        return (StatusCode::BAD_REQUEST, "body is not UTF-8").into_response();
    };
    let mut page: SynopticPage = match serde_yaml::from_str(text) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("invalid boot page YAML: {e}"),
            )
                .into_response()
        }
    };
    page.kind = Some(BOOT_KIND.to_string());
    page.id = format!("boot-{}", crate::synoptic::nuovo_id_pagina());
    let base = page.name.clone();
    let mut suffix = 2;
    while tokio::fs::try_exists(yaml_path(&dir, &page.name))
        .await
        .unwrap_or(false)
    {
        page.name = format!("{base} ({suffix})");
        suffix += 1;
        if suffix > 100 {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "too many name collisions",
            )
                .into_response();
        }
    }
    let nome = page.name.clone();
    match salva(&dir, &nome, &page, None).await {
        Ok(_) => {
            signal_project_changed(&s, "boot");
            Json(serde_json::json!({ "id": page.id, "name": nome })).into_response()
        }
        Err((e, _)) => {
            warn!("import_boot_page: {e:?}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pagina(nome: &str, id: &str) -> SynopticPage {
        let mut p = pagina_di_boot_iniziale();
        p.name = nome.to_string();
        p.id = id.to_string();
        p
    }

    /// Un PNG minimo valido quanto basta per la firma.
    fn png(extra: usize) -> Vec<u8> {
        let mut v = PNG_MAGIC.to_vec();
        v.extend(std::iter::repeat_n(0u8, extra));
        v
    }

    #[tokio::test]
    async fn salva_rifiuta_una_pagina_che_non_e_di_boot() {
        let d = tempfile::tempdir().unwrap();
        let mut p = pagina("Splash", "b1");
        p.kind = None;
        let r = salva(d.path(), "Splash", &p, None).await;
        assert!(matches!(r, Err((ErroreSalvataggio::NonBoot, _))));
        assert!(elenca(d.path()).await.is_empty());
    }

    #[tokio::test]
    async fn salva_ed_elenca_una_pagina_di_boot_in_boot_e_non_in_synoptics() {
        let d = tempfile::tempdir().unwrap();
        salva(d.path(), "Splash", &pagina("Splash", "b1"), None)
            .await
            .unwrap();
        assert_eq!(elenca(d.path()).await, vec!["Splash".to_string()]);
        assert!(d.path().join("boot/Splash.yaml").is_file());
        // I viewer leggono solo `synoptics/`: non deve esserci niente.
        assert!(!d.path().join("synoptics").exists());
    }

    #[tokio::test]
    async fn una_pagina_di_boot_rifiuta_gli_oggetti_non_statici() {
        let d = tempfile::tempdir().unwrap();
        let mut p = pagina("Splash", "b1");
        p.objects = serde_yaml::from_str(
            "- {id: a, type: rect, x: 0, y: 0}\n- {id: b, type: trend, x: 0, y: 0}\n",
        )
        .unwrap();
        let r = salva(d.path(), "Splash", &p, None).await;
        assert!(matches!(r, Err((ErroreSalvataggio::TipoNonAmmesso(t), _)) if t == "trend"));
        assert!(elenca(d.path()).await.is_empty());
        p.objects.pop();
        assert!(salva(d.path(), "Splash", &p, None).await.is_ok());
    }

    #[tokio::test]
    async fn il_conflitto_di_versione_rifiuta_e_non_scrive() {
        let d = tempfile::tempdir().unwrap();
        salva(d.path(), "Splash", &pagina("Splash", "b1"), None)
            .await
            .unwrap();
        let r = salva(
            d.path(),
            "Splash",
            &pagina("Splash", "b1"),
            Some("versione-vecchia"),
        )
        .await;
        assert!(matches!(r, Err((ErroreSalvataggio::Conflitto, Some(_)))));
    }

    #[tokio::test]
    async fn rinominare_porta_con_se_il_png() {
        let d = tempfile::tempdir().unwrap();
        salva(d.path(), "Vecchio", &pagina("Vecchio", "b1"), None)
            .await
            .unwrap();
        scrivi_png(d.path(), "Vecchio", &png(10)).await.unwrap();
        // Stesso id, nome nuovo.
        salva(d.path(), "Nuovo", &pagina("Nuovo", "b1"), None)
            .await
            .unwrap();
        assert_eq!(elenca(d.path()).await, vec!["Nuovo".to_string()]);
        assert!(d.path().join("boot/Nuovo.png").is_file());
        assert!(!d.path().join("boot/Vecchio.png").exists());
    }

    #[tokio::test]
    async fn eliminare_toglie_anche_il_png() {
        let d = tempfile::tempdir().unwrap();
        salva(d.path(), "Splash", &pagina("Splash", "b1"), None)
            .await
            .unwrap();
        scrivi_png(d.path(), "Splash", &png(10)).await.unwrap();
        assert!(elimina(d.path(), "Splash").await);
        assert!(!d.path().join("boot/Splash.png").exists());
        assert!(!elimina(d.path(), "Splash").await);
    }

    #[tokio::test]
    async fn il_png_e_controllato() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            scrivi_png(d.path(), "Splash", &png(10)).await,
            Err(ErrorePng::SenzaPagina)
        );
        salva(d.path(), "Splash", &pagina("Splash", "b1"), None)
            .await
            .unwrap();
        assert_eq!(
            scrivi_png(d.path(), "Splash", &[]).await,
            Err(ErrorePng::Vuoto)
        );
        assert_eq!(
            scrivi_png(d.path(), "Splash", b"GIF89a not a png").await,
            Err(ErrorePng::NonPng)
        );
        assert_eq!(
            scrivi_png(d.path(), "Splash", &png(MAX_BOOT_PNG_BYTES)).await,
            Err(ErrorePng::TroppoGrande)
        );
        assert_eq!(scrivi_png(d.path(), "Splash", &png(100)).await, Ok(()));
    }

    #[tokio::test]
    async fn il_progetto_vuoto_nasce_con_due_pagine() {
        let d = tempfile::tempdir().unwrap();
        semina(d.path(), true).await.unwrap();
        let boot = elenca(d.path()).await;
        assert_eq!(boot, vec![NOME_BOOT_INIZIALE.to_string()]);
        assert!(d.path().join("synoptics/Page 1.yaml").is_file());
        // La pagina di boot ha dimensioni esplicite: è la risoluzione del PNG.
        let t = std::fs::read_to_string(d.path().join("boot/Immagine di boot.yaml")).unwrap();
        let p: SynopticPage = serde_yaml::from_str(&t).unwrap();
        assert!(e_pagina_di_boot(&p));
        assert_eq!((p.width, p.height), (Some(1280.0), Some(800.0)));
    }

    #[tokio::test]
    async fn un_progetto_da_template_riceve_la_pagina_di_boot_e_tiene_le_sue_pagine() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("synoptics")).unwrap();
        std::fs::write(d.path().join("synoptics/Home.yaml"), "id: h\nname: Home\n").unwrap();
        semina(d.path(), false).await.unwrap();
        assert_eq!(elenca(d.path()).await.len(), 1);
        assert!(!d.path().join("synoptics/Page 1.yaml").exists());
        assert!(d.path().join("synoptics/Home.yaml").is_file());
    }

    #[tokio::test]
    async fn seminare_due_volte_non_sovrascrive() {
        let d = tempfile::tempdir().unwrap();
        semina(d.path(), true).await.unwrap();
        salva(d.path(), "Mia", &pagina("Mia", "m1"), None)
            .await
            .unwrap();
        semina(d.path(), true).await.unwrap();
        assert_eq!(elenca(d.path()).await.len(), 2);
    }

    fn progetto_minimo(dir: &FsPath) {
        std::fs::write(
            dir.join("project.yaml"),
            "meta:\n  name: t\n  version: 0.1.0\n",
        )
        .unwrap();
    }

    #[tokio::test]
    async fn il_bundle_porta_boot_e_l_import_lo_ripristina_e_toglie_il_resto() {
        let src = tempfile::tempdir().unwrap();
        progetto_minimo(src.path());
        semina(src.path(), true).await.unwrap();
        scrivi_png(src.path(), NOME_BOOT_INIZIALE, &png(50))
            .await
            .unwrap();
        let zip = crate::router::build_project_zip(src.path()).await.unwrap();

        // Destinazione con una pagina di boot stantia che il bundle non ha.
        let dst = tempfile::tempdir().unwrap();
        salva(dst.path(), "Stantia", &pagina("Stantia", "s1"), None)
            .await
            .unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip.as_slice())).unwrap();
        sincronizza_da_zip(&mut archive, &boot_dir_at(dst.path()))
            .await
            .unwrap();
        assert_eq!(
            elenca(dst.path()).await,
            vec![NOME_BOOT_INIZIALE.to_string()]
        );
        assert!(dst.path().join("boot/Immagine di boot.png").is_file());
        assert!(!dst.path().join("boot/Stantia.yaml").exists());
    }

    #[tokio::test]
    async fn l_impronta_cambia_se_cambia_una_pagina_di_boot_o_il_suo_png() {
        let d = tempfile::tempdir().unwrap();
        progetto_minimo(d.path());
        let senza = crate::router::calcola_impronta(d.path()).unwrap();
        semina(d.path(), true).await.unwrap();
        let con = crate::router::calcola_impronta(d.path()).unwrap();
        assert_ne!(senza, con);
        scrivi_png(d.path(), NOME_BOOT_INIZIALE, &png(5))
            .await
            .unwrap();
        let col_png = crate::router::calcola_impronta(d.path()).unwrap();
        assert_ne!(con, col_png);
        scrivi_png(d.path(), NOME_BOOT_INIZIALE, &png(6))
            .await
            .unwrap();
        assert_ne!(col_png, crate::router::calcola_impronta(d.path()).unwrap());
    }

    /// Manda un PUT da `n` byte a un router con o senza il limite e dice se il
    /// server ha risposto 200. Vero HTTP su una porta locale: il limite è un
    /// comportamento del server, non di una funzione.
    async fn put_di(n: usize, con_limite: bool) -> bool {
        use axum::{extract::DefaultBodyLimit, routing::put, Router};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut r = put(|b: Bytes| async move { b.len().to_string() });
        if con_limite {
            r = r.layer(DefaultBodyLimit::max(crate::router::LIMITE_CORPO_UPLOAD));
        }
        let app = Router::new().route("/u", r);
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        let head = format!(
            "PUT /u HTTP/1.1\r\nHost: x\r\nContent-Length: {n}\r\nConnection: close\r\n\r\n"
        );
        s.write_all(head.as_bytes()).await.unwrap();
        // Il server può chiudere prima di aver letto tutto: un errore di scrittura
        // qui è la risposta, non un guasto.
        let _ = s.write_all(&vec![0u8; n]).await;
        let mut out = String::new();
        let _ = s.read_to_string(&mut out).await;
        out.starts_with("HTTP/1.1 200")
    }

    #[tokio::test]
    async fn un_upload_da_3_mib_passa_col_limite_e_senza_veniva_rifiutato() {
        let tre_mib = 3 * 1024 * 1024;
        assert!(
            !put_di(tre_mib, false).await,
            "senza il layer axum rifiuta sopra 2 MiB: è il difetto che il layer chiude"
        );
        assert!(put_di(tre_mib, true).await);
    }
}
