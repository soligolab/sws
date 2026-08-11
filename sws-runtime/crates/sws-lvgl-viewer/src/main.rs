//! `sws-lvgl-viewer` — motore di rendering LVGL, MVP a riga di comando
//! (Fase 2, `docs/adr/0002-lvgl-rendering-engine.md`).
//!
//! Si connette a un runtime `sws-web` già in esecuzione (stesso ruolo che ha
//! oggi il browser/`sws-kiosk`), legge una pagina synottico + lo snapshot dei
//! tag, e interpreta il sottoinsieme di widget supportato creando i
//! corrispondenti oggetti LVGL (posizione, colore, testo, stato — vedi
//! `lvgl_render.rs`).
//!
//! **Export immagine non ancora disponibile**: `lvgl::Display::register()`
//! (crate `lvgl` 0.6.2) ha un bug di lifetime confermato — vedi
//! `docs/OPEN_QUESTIONS.md` Q14 per l'analisi completa (backtrace GDB
//! incluso). Il primo `task_handler()` dopo la creazione dei widget causa un
//! segfault, quindi questo binario si ferma subito dopo aver creato gli
//! oggetti e riporta un riepilogo testuale di cosa è stato interpretato,
//! invece di tentare il redraw che oggi crasherebbe in modo affidabile.

mod client;
mod lvgl_render;
mod model;
mod tls;

use clap::Parser;

/// Interpreta una pagina synottico SWS con il motore LVGL (crea i widget
/// corrispondenti) e riporta un riepilogo di cosa è stato interpretato.
#[derive(Parser, Debug)]
#[command(version)]
struct Args {
    /// URL base del runtime sws-web (porta viewer, es. https://127.0.0.1:8443)
    #[arg(long, default_value = "https://127.0.0.1:8443")]
    base_url: String,

    /// Nome della pagina synottico da interpretare (es. "Page 1")
    #[arg(long)]
    page: String,
}

fn main() -> anyhow::Result<()> {
    // Stesso belt-and-suspenders di sws-runtime/src/main.rs: rustls 0.23 va in
    // panic se più provider crypto finiscono nel grafo delle dipendenze
    // (reqwest + tokio-tungstenite + il nostro rustls diretto potrebbero
    // altrimenti ognuno provare a impostarne uno di default).
    let _ = rustls::crypto::ring::default_provider().install_default();

    let args = Args::parse();

    let rt = tokio::runtime::Runtime::new()?;
    let (page, tags) = rt.block_on(async {
        let page = client::fetch_page(&args.base_url, &args.page).await?;
        let tags = client::fetch_tag_snapshot(&args.base_url).await?;
        anyhow::Ok((page, tags))
    })?;

    eprintln!(
        "pagina '{}' caricata: {} oggetti, {} tag nello snapshot",
        page.name,
        page.objects.len(),
        tags.len()
    );

    let summary = lvgl_render::interpret_page(&page, &tags)?;

    eprintln!(
        "widget LVGL creati correttamente ({}): {}",
        summary.rendered.len(),
        summary.rendered.join(", ")
    );
    if !summary.skipped_unsupported.is_empty() {
        eprintln!(
            "non supportati/ignorati ({}): {}",
            summary.skipped_unsupported.len(),
            summary.skipped_unsupported.join(", ")
        );
    }
    eprintln!(
        "export immagine non tentato (task_handler() crasherebbe — bug upstream, vedi docs/OPEN_QUESTIONS.md Q14)"
    );
    Ok(())
}
