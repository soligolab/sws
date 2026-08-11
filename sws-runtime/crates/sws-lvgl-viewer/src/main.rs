//! `sws-lvgl-viewer` — motore di rendering LVGL con finestra SDL2 interattiva
//! (Fase 2, `docs/adr/0002-lvgl-rendering-engine.md`).
//!
//! Si connette a un runtime `sws-web` già in esecuzione (stesso ruolo che ha
//! oggi il browser/`sws-kiosk`), legge una pagina synottico + resta iscritto
//! a `/ws/tags` per tutta la durata della finestra (`client::spawn_tag_subscription`),
//! interpreta il sottoinsieme di widget supportato (vedi `lvgl_render.rs`) e
//! li disegna in una finestra SDL2, aggiornando i widget tag-dipendenti dal
//! vivo (`lvgl_render::update_bindings`) a ogni frame — non solo lo snapshot
//! iniziale.
//!
//! La registrazione del display bypassa `lvgl::Display::register()` (bug di
//! lifetime confermato, `docs/OPEN_QUESTIONS.md` Q14) — vedi `lvgl_display.rs`.
//!
//! **Limite noto**: niente input (click/drag) — vedi `docs/OPEN_QUESTIONS.md`
//! Q14 per lo stato di questo e degli altri limiti.

mod client;
mod lvgl_display;
mod lvgl_indev;
mod lvgl_render;
mod model;
mod tls;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use clap::Parser;
use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::mouse::MouseButton;
use sdl2::pixels::PixelFormatEnum;

use client::SharedTagSnapshot;
use lvgl_render::TagCommand;

/// Interpreta una pagina synottico SWS con il motore LVGL e la mostra in una
/// finestra SDL2, aggiornata dal vivo.
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

    // Il runtime tokio NON viene droppato dopo block_on: il task di lettura
    // WS in background (avviato dentro spawn_tag_subscription) deve restare
    // vivo per tutta la finestra, non solo per la fetch iniziale.
    let rt = tokio::runtime::Runtime::new()?;
    let (page, shared_tags) = rt.block_on(async {
        let page = client::fetch_page(&args.base_url, &args.page).await?;
        let shared_tags = client::spawn_tag_subscription(&args.base_url).await?;
        anyhow::Ok((page, shared_tags))
    })?;

    let initial_tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
    eprintln!(
        "pagina '{}' caricata: {} oggetti, {} tag nello snapshot iniziale",
        page.name,
        page.objects.len(),
        initial_tags.len()
    );

    let (tag_tx, tag_rx) = mpsc::channel::<TagCommand>();
    let (summary, _styles, mut live_bindings) = lvgl_render::interpret_page(&page, &initial_tags, &tag_tx)?;

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

    // Deve seguire interpret_page (che chiama lvgl_display::init_display):
    // lv_indev_drv_register si aggancia da solo al display di default, che
    // deve quindi esistere già — vedi commento di modulo in lvgl_indev.rs.
    lvgl_indev::init_pointer_indev()?;

    // `_styles` deve restare vivo per tutta la finestra (LVGL tiene un
    // puntatore ai suoi Style, non una copia) — vive nello stack di questa
    // funzione, che avvolge l'intero event loop, quindi va bene così. Stesso
    // discorso per `rt` (task WS in background + PUT dei click) e
    // `live_bindings` (Style dinamici + puntatori aggiornati a ogni frame).
    run_window(
        lvgl_render::HOR_RES,
        lvgl_render::VER_RES,
        shared_tags,
        &mut live_bindings,
        tag_rx,
        rt.handle().clone(),
        args.base_url.clone(),
    )?;
    drop(rt);
    Ok(())
}

fn run_window(
    hor_res: u32,
    ver_res: u32,
    shared_tags: SharedTagSnapshot,
    live_bindings: &mut [lvgl_render::LiveBinding],
    tag_rx: mpsc::Receiver<TagCommand>,
    rt_handle: tokio::runtime::Handle,
    base_url: String,
) -> anyhow::Result<()> {
    let sdl_context = sdl2::init().map_err(|e| anyhow::anyhow!("sdl2::init: {e}"))?;
    let video = sdl_context.video().map_err(|e| anyhow::anyhow!("sdl2 video subsystem: {e}"))?;
    let window = video
        // Niente em-dash: il titolo finestra passa per WM_NAME (X11/XWayland),
        // non per il font LVGL — stesso genere di problema dei glyph mancanti
        // U+2014 nel synottico (vedi Q14), ma un percorso di rendering
        // completamente diverso (mojibake nella title bar, non un quadratino
        // mancante). ASCII puro evita entrambe le classi di problema.
        .window("SWS - LVGL viewer", hor_res, ver_res)
        .position_centered()
        .build()?;
    let mut canvas = window.into_canvas().build()?;
    let texture_creator = canvas.texture_creator();
    let mut texture = texture_creator.create_texture_streaming(PixelFormatEnum::RGB24, hor_res, ver_res)?;
    let mut event_pump = sdl_context.event_pump().map_err(|e| anyhow::anyhow!("event_pump: {e}"))?;

    let mut frame_buf = vec![0u8; (hor_res * ver_res * 3) as usize];
    let pitch = (hor_res * 3) as usize;
    let mut mouse_pressed = false;

    eprintln!("finestra SDL2 aperta — click/drag sui widget interattivi, chiudi la finestra o premi Esc per uscire");

    'running: loop {
        let frame_start = Instant::now();

        // Prima gli eventi SDL2 (incluso il mouse, che alimenta l'indev
        // LVGL): task_handler() più sotto deve vedere lo stato del puntatore
        // più fresco possibile per questo frame, non quello di un frame fa.
        for event in event_pump.poll_iter() {
            match event {
                Event::Quit { .. } | Event::KeyDown { keycode: Some(Keycode::Escape), .. } => break 'running,
                Event::MouseButtonDown { x, y, mouse_btn: MouseButton::Left, .. } => {
                    mouse_pressed = true;
                    lvgl_indev::set_pointer_state(x, y, mouse_pressed);
                }
                Event::MouseButtonUp { x, y, mouse_btn: MouseButton::Left, .. } => {
                    mouse_pressed = false;
                    lvgl_indev::set_pointer_state(x, y, mouse_pressed);
                }
                Event::MouseMotion { x, y, .. } => {
                    lvgl_indev::set_pointer_state(x, y, mouse_pressed);
                }
                _ => {}
            }
        }

        {
            // Lock breve: solo per clonare lo stato corrente, mai tenuto
            // durante le chiamate FFI a LVGL più sotto.
            let tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
            lvgl_render::update_bindings(live_bindings, &tags);
        }

        // Qui LVGL processa l'indev (click/drag) e può invocare sincronamente
        // le callback registrate in lvgl_render.rs, che accodano su tag_tx —
        // niente I/O di rete dentro quelle callback, solo dopo, qui sotto.
        lvgl::task_handler();
        lvgl::tick_inc(Duration::from_millis(16));

        // Scrittura tag generate da click/drag in questo frame: girate a un
        // task async sul runtime tokio del processo (già vivo per il task WS
        // in background) invece che bloccare il loop di rendering su una PUT
        // HTTP. `try_recv` drena tutto ciò che è pronto senza aspettare.
        while let Ok(cmd) = tag_rx.try_recv() {
            let base_url = base_url.clone();
            rt_handle.spawn(async move {
                if let Err(e) = client::put_tag(&base_url, &cmd.tag, cmd.value).await {
                    eprintln!("[tag] scrittura '{}' fallita: {e}", cmd.tag);
                }
            });
        }

        if lvgl_display::copy_frame_rgb888(&mut frame_buf) {
            texture
                .update(None, &frame_buf, pitch)
                .map_err(|e| anyhow::anyhow!("texture.update: {e}"))?;
            canvas.clear();
            canvas
                .copy(&texture, None, None)
                .map_err(|e| anyhow::anyhow!("canvas.copy: {e}"))?;
            canvas.present();
        }

        let elapsed = frame_start.elapsed();
        let target = Duration::from_millis(16); // ~60 fps
        if elapsed < target {
            std::thread::sleep(target - elapsed);
        }
    }
    Ok(())
}
