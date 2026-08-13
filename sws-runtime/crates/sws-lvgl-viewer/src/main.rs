//! `sws-lvgl-viewer` — motore di rendering LVGL con finestra SDL2 interattiva
//! (Fase 2, `docs/adr/0002-lvgl-rendering-engine.md`).
//!
//! Si connette a un runtime `sws-web` già in esecuzione (stesso ruolo che ha
//! oggi il browser/`sws-kiosk`), legge una pagina synottico + resta iscritto
//! a `/ws/tags` e `/ws/alarms` per tutta la durata della finestra
//! (`client::spawn_tag_subscription`/`spawn_alarm_subscription`),
//! interpreta il sottoinsieme di widget supportato (vedi `lvgl_render.rs`) e
//! li disegna in una finestra SDL2, aggiornando i widget tag-dipendenti dal
//! vivo (`lvgl_render::update_bindings`) a ogni frame — non solo lo snapshot
//! iniziale. Bottone/checkbox/radio/slider sono cliccabili/trascinabili
//! (`lvgl_indev.rs`) e scrivono i tag corrispondenti sul backend; il
//! pulsante ACK di un `alarm_viewer` manda un id allarme su un canale
//! dedicato (`ack_tx`/`ack_rx`, stesso principio di `tag_tx`/`nav_tx`).
//!
//! **Multi-pagina**: un `navbutton` cliccato manda l'`id:` della pagina di
//! destinazione su un canale (`nav_rx`, separato da `tag_rx`); il loop
//! principale (`run_window`) lo riceve, risolve l'id nella pagina giusta
//! (`client::resolve_page_by_id` — l'id non è il nome file usato dall'API
//! REST, vedi lì per il perché) e richiama
//! `lvgl_render::render_page_objects` sullo **stesso** display già
//! registrato (pulendo prima lo schermo) — un pannello fisico ha un solo
//! display, la navigazione lo ridisegna, non ne apre un altro. La
//! risoluzione è quella della prima pagina caricata per l'intera sessione
//! (vedi `lvgl_render::resolve_resolution`): le pagine raggiunte per
//! navigazione la ereditano anche se il loro `width`/`height` fosse diverso.
//!
//! La registrazione del display bypassa `lvgl::Display::register()` (bug di
//! lifetime confermato, `docs/OPEN_QUESTIONS.md` Q14) — vedi `lvgl_display.rs`.

mod client;
mod drm_display;
mod lvgl_display;
mod lvgl_indev;
mod lvgl_render;
mod model;
mod tls;
mod touch_indev;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use clap::Parser;
use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::mouse::MouseButton;
use sdl2::pixels::PixelFormatEnum;
use sdl2::surface::Surface;

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

    /// Nome della pagina synottico da interpretare all'avvio (es. "Page 1") —
    /// pagina di partenza: la navigazione con i navbutton può portare altrove.
    #[arg(long)]
    page: String,

    /// Backend di rendering. "sdl2" (default) apre una finestra SDL2 — vedi
    /// docs/OPEN_QUESTIONS.md Q14 per i bug noti su Wayland/X11/kmsdrm reali.
    /// "drm" scrive direttamente sul framebuffer via libdrm (API legacy, non
    /// atomica — bypassa SDL2 del tutto, vedi drm_display.rs). Touch via
    /// tslib (vedi touch_indev.rs) se --touch-device è impostato.
    #[arg(long, default_value = "sdl2")]
    backend: String,

    /// Device DRM da usare col backend "drm" (es. /dev/dri/card1 — NON è
    /// sempre card0, verificato su tc620-a-p3-c6-07aff9.local: quello è
    /// card1, il device di test/sviluppo di questo repo).
    #[arg(long, default_value = "/dev/dri/card0")]
    drm_card: String,

    /// Device touch da leggere (solo backend "drm") — il symlink tslib, non
    /// l'/dev/input/eventN grezzo (quel numero cambia da device a device).
    /// Vuoto = nessun touch (solo rendering). Verificato su
    /// tc620-a-p3-c6-07aff9.local: /dev/input/ts_uinput, già calibrato dal
    /// demone ts-uinput.service.
    #[arg(long, default_value = "")]
    touch_device: String,
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
    let (page, shared_tags, shared_alarms, lang_table) = rt.block_on(async {
        let page = client::fetch_page(&args.base_url, &args.page).await?;
        let shared_tags = client::spawn_tag_subscription(&args.base_url).await?;
        let shared_alarms = client::spawn_alarm_subscription(&args.base_url).await?;
        // Non fatale: un progetto senza T-40 configurato (la maggioranza)
        // non ha nulla da tradurre — `LanguageTable::default()` (entries
        // vuoto) fa sì che `resolve_msg`/`localize_object` siano dei no-op
        // a costo quasi zero, stesso comportamento di un fetch riuscito ma
        // con `entries: []`.
        let lang_table = client::fetch_languages(&args.base_url)
            .await
            .unwrap_or_else(|e| {
                eprintln!("[lang] impossibile leggere project.languages, nessuna traduzione attiva: {e}");
                model::LanguageTable::default()
            });
        anyhow::Ok((page, shared_tags, shared_alarms, lang_table))
    })?;
    let shared_lang: client::SharedLang = std::sync::Arc::new(std::sync::Mutex::new(lang_table.default.clone()));

    let initial_tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
    eprintln!(
        "pagina '{}' caricata: {} oggetti, {} tag nello snapshot iniziale",
        page.name,
        page.objects.len(),
        initial_tags.len()
    );

    let (tag_tx, tag_rx) = mpsc::channel::<TagCommand>();
    let (nav_tx, nav_rx) = mpsc::channel::<String>();
    let (ack_tx, ack_rx) = mpsc::channel::<String>();
    let (summary, styles, live_bindings, hor_res, ver_res) = lvgl_render::interpret_page(
        &page, &initial_tags, &tag_tx, &nav_tx, &args.base_url, rt.handle(), &shared_alarms, &ack_tx, &lang_table,
        &shared_lang,
    )?;

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
    // Comune a entrambi i backend: touch_indev.rs (backend "drm") alimenta
    // lo stesso indev del mouse SDL2, non ne registra uno diverso.
    lvgl_indev::init_pointer_indev()?;

    if args.backend == "drm" {
        if !args.touch_device.is_empty() {
            touch_indev::spawn(&args.touch_device, hor_res, ver_res)?;
        } else {
            eprintln!("[drm] --touch-device non impostato: nessun input, solo rendering");
        }
        run_drm(
            &args.drm_card,
            hor_res,
            ver_res,
            shared_tags,
            styles,
            live_bindings,
            tag_tx,
            tag_rx,
            nav_tx,
            nav_rx,
            ack_tx,
            ack_rx,
            rt.handle().clone(),
            args.base_url.clone(),
            shared_alarms,
            lang_table,
            shared_lang,
        )?;
        drop(rt);
        return Ok(());
    }

    run_window(
        hor_res,
        ver_res,
        shared_tags,
        styles,
        live_bindings,
        tag_tx,
        tag_rx,
        nav_tx,
        nav_rx,
        ack_tx,
        ack_rx,
        rt.handle().clone(),
        args.base_url.clone(),
        shared_alarms,
        lang_table,
        shared_lang,
    )?;
    drop(rt);
    Ok(())
}

/// Loop di rendering per il backend "drm" — scrive direttamente sul
/// framebuffer via `DrmDisplay` (API DRM legacy), senza SDL2. Stessa
/// gestione tag/navigazione/allarmi di `run_window` (vedi lì per i
/// commenti, qui non ripetuti) — l'unica differenza reale è la sorgente dei
/// pixel (DRM invece di Canvas/Surface SDL2) e degli eventi di input (il
/// thread di `touch_indev.rs`, se avviato, invece del loop eventi SDL2:
/// entrambi alimentano lo stesso `lvgl_indev::set_pointer_state`, il resto
/// del ciclo non sa/non gli importa quale dei due).
//
// allow(unused_assignments) su `styles`: stesso motivo di `run_window`, il
// compilatore non vede che LVGL tiene puntatori al suo contenuto via FFI —
// qui più visibile perché il loop non ha mai un `break` che lo "consumi".
#[allow(clippy::too_many_arguments, unused_variables, unused_assignments)]
fn run_drm(
    card_path: &str,
    hor_res: u32,
    ver_res: u32,
    shared_tags: SharedTagSnapshot,
    mut styles: Vec<lvgl::style::Style>,
    mut live_bindings: Vec<lvgl_render::LiveBinding>,
    tag_tx: mpsc::Sender<TagCommand>,
    tag_rx: mpsc::Receiver<TagCommand>,
    nav_tx: mpsc::Sender<String>,
    nav_rx: mpsc::Receiver<String>,
    ack_tx: mpsc::Sender<String>,
    ack_rx: mpsc::Receiver<String>,
    rt_handle: tokio::runtime::Handle,
    base_url: String,
    shared_alarms: client::SharedAlarms,
    lang_table: model::LanguageTable,
    shared_lang: client::SharedLang,
) -> anyhow::Result<()> {
    let mut drm = drm_display::DrmDisplay::open(card_path)?;
    if drm.width != hor_res || drm.height != ver_res {
        eprintln!(
            "[drm] attenzione: risoluzione pagina {hor_res}x{ver_res} diversa da quella del \
             display {}x{} — il rendering potrebbe non riempire lo schermo",
            drm.width, drm.height
        );
    }
    eprintln!(
        "[drm] framebuffer aperto su {card_path}: {}x{}",
        drm.width, drm.height
    );

    let mut frame_buf = vec![0u8; (hor_res * ver_res * 3) as usize];

    loop {
        let frame_start = Instant::now();

        let tags_now = {
            let tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
            lvgl_render::update_bindings(&mut live_bindings, &tags);
            tags
        };

        lvgl::task_handler();
        lvgl::tick_inc(Duration::from_millis(16));

        while let Ok(cmd) = tag_rx.try_recv() {
            let base_url = base_url.clone();
            rt_handle.spawn(async move {
                if let Err(e) = client::put_tag(&base_url, &cmd.tag, cmd.value).await {
                    eprintln!("[tag] scrittura '{}' fallita: {e}", cmd.tag);
                }
            });
        }

        while let Ok(alarm_id) = ack_rx.try_recv() {
            let base_url = base_url.clone();
            rt_handle.spawn(async move {
                if let Err(e) = client::ack_alarm(&base_url, &alarm_id).await {
                    eprintln!("[alarm] ack di '{alarm_id}' fallito: {e}");
                }
            });
        }

        if let Ok(target_page) = nav_rx.try_recv() {
            match rt_handle.block_on(client::resolve_page_by_id(&base_url, &target_page)) {
                Ok(new_page) => match lvgl_render::render_page_objects(
                    &new_page, &tags_now, &tag_tx, &nav_tx, &base_url, &rt_handle, &shared_alarms, &ack_tx,
                    &lang_table, &shared_lang,
                ) {
                    Ok((summary, new_styles, new_live)) => {
                        eprintln!(
                            "navigato a '{}': {} oggetti creati, {} non supportati",
                            target_page,
                            summary.rendered.len(),
                            summary.skipped_unsupported.len()
                        );
                        styles = new_styles;
                        live_bindings = new_live;
                    }
                    Err(e) => eprintln!("[nav] rendering di '{target_page}' fallito: {e}"),
                },
                Err(e) => eprintln!("[nav] impossibile caricare pagina '{target_page}': {e}"),
            }
        }

        if lvgl_display::copy_frame_rgb888(&mut frame_buf) {
            drm.flush_rgb888(&frame_buf);
        }

        let elapsed = frame_start.elapsed();
        let target = Duration::from_millis(16);
        if elapsed < target {
            std::thread::sleep(target - elapsed);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_window(
    hor_res: u32,
    ver_res: u32,
    shared_tags: SharedTagSnapshot,
    // `styles`/`live_bindings` presi per valore, non `&mut`: la navigazione
    // li sostituisce per intero (pagina nuova = widget nuovi), non li
    // aggiorna sul posto come fa `update_bindings` per i valori tag.
    mut styles: Vec<lvgl::style::Style>,
    mut live_bindings: Vec<lvgl_render::LiveBinding>,
    // Cloni dei Sender: quelli passati a interpret_page hanno già cablato i
    // widget della prima pagina, ma render_page_objects ne serve un altro
    // paio identico per cablare i widget di ogni pagina successiva raggiunta
    // navigando.
    tag_tx: mpsc::Sender<TagCommand>,
    tag_rx: mpsc::Receiver<TagCommand>,
    nav_tx: mpsc::Sender<String>,
    nav_rx: mpsc::Receiver<String>,
    // Manda id allarme da ackare — stesso principio di tag_tx/nav_tx: la
    // callback FFI del pulsante ACK (lvgl_render.rs) accoda qui, niente I/O
    // di rete dentro la callback sincrona.
    ack_tx: mpsc::Sender<String>,
    ack_rx: mpsc::Receiver<String>,
    rt_handle: tokio::runtime::Handle,
    base_url: String,
    shared_alarms: client::SharedAlarms,
    lang_table: model::LanguageTable,
    shared_lang: client::SharedLang,
) -> anyhow::Result<()> {
    let sdl_context = sdl2::init().map_err(|e| anyhow::anyhow!("sdl2::init: {e}"))?;
    let video = sdl_context.video().map_err(|e| anyhow::anyhow!("sdl2 video subsystem: {e}"))?;
    // Storia completa di questa finestra, verificata su hardware reale
    // (tc620-a-p3-c6-07aff9.local, 2026-08-09) perché nessuna delle scelte
    // sotto è ovvia — vedi anche docs/OPEN_QUESTIONS.md Q14:
    // 1) Canvas/Renderer (SDL_CreateRenderer) crashava sempre (SIGSEGV) su
    //    Wayland nativo, con o senza accelerazione GPU (questo container non
    //    ha alcun driver Mali/EGL) — bug noto upstream (libsdl-org/SDL#4650,
    //    #5386, libsdl-org/sdl2-compat#266).
    // 2) Passare alla Surface diretta (SDL_GetWindowSurface) non è bastato:
    //    stesso identico crash, stesso punto della classe di bug — Wayland
    //    nativo su questo hardware/SDL2 non regge nessuna delle due vie.
    // 3) SDL_VIDEODRIVER=x11 (via XWayland, che Weston 13 su questo device
    //    avvia on-demand) elimina il crash del tutto, ma senza `.borderless()`
    //    fallisce con un errore X11 pulito ("BadValue" su MIT-SHM
    //    X_ShmPutImage): il window manager aggiunge una barra del titolo,
    //    l'area disegnabile reale diventa più piccola di hor_res×ver_res, e
    //    il blit alla dimensione piena esce dai bordi — stesso meccanismo
    //    descritto su discourse.libsdl.org per SDL_UpdateWindowRects.
    //    `.borderless()` è comunque quello che vogliamo per un pannello HMI
    //    che non deve avere alcuna cornice.
    let window = video
        // Niente em-dash: il titolo finestra passa per WM_NAME (X11/XWayland),
        // non per il font LVGL — stesso genere di problema dei glyph mancanti
        // U+2014 nel synottico (vedi Q14), ma un percorso di rendering
        // completamente diverso (mojibake nella title bar, non un quadratino
        // mancante). ASCII puro evita entrambe le classi di problema. Il
        // titolo comunque non si vede mai con `.borderless()` — lasciato per
        // quando/se si tornerà a una finestra decorata.
        .window("SWS - LVGL viewer", hor_res, ver_res)
        .position_centered()
        .borderless()
        .build()?;
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

        let tags_now = {
            // Lock breve: solo per clonare lo stato corrente, mai tenuto
            // durante le chiamate FFI a LVGL più sotto.
            let tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
            lvgl_render::update_bindings(&mut live_bindings, &tags);
            tags
        };

        // Qui LVGL processa l'indev (click/drag) e può invocare sincronamente
        // le callback registrate in lvgl_render.rs, che accodano su tag_tx/
        // nav_tx — niente I/O di rete dentro quelle callback, solo dopo, qui
        // sotto.
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

        // ACK allarme dal pulsante di un alarm_viewer: stesso pattern di
        // tag_rx, girato a un task async invece di bloccare il loop.
        while let Ok(alarm_id) = ack_rx.try_recv() {
            let base_url = base_url.clone();
            rt_handle.spawn(async move {
                if let Err(e) = client::ack_alarm(&base_url, &alarm_id).await {
                    eprintln!("[alarm] ack di '{alarm_id}' fallito: {e}");
                }
            });
        }

        // Navigazione: al più una per frame (un click è un evento discreto,
        // non un flusso continuo come il drag) — se ce ne fosse più di una in
        // coda, le successive si processano ai frame dopo, senza problemi di
        // correttezza. A differenza della scrittura tag, qui si blocca
        // davvero il loop di rendering per la durata della fetch: accettabile
        // per un runtime locale (tipicamente pochi millisecondi), non lo
        // sarebbe per una pagina servita da lontano.
        if let Ok(target_page) = nav_rx.try_recv() {
            match rt_handle.block_on(client::resolve_page_by_id(&base_url, &target_page)) {
                Ok(new_page) => match lvgl_render::render_page_objects(
                    &new_page, &tags_now, &tag_tx, &nav_tx, &base_url, &rt_handle, &shared_alarms, &ack_tx,
                    &lang_table, &shared_lang,
                ) {
                    Ok((summary, new_styles, new_live)) => {
                        eprintln!(
                            "navigato a '{}': {} oggetti creati, {} non supportati",
                            target_page,
                            summary.rendered.len(),
                            summary.skipped_unsupported.len()
                        );
                        // Sostituzione, non fusione: gli Style/LiveBinding
                        // vecchi puntano a widget appena distrutti da
                        // render_page_objects (lv_obj_clean). Droppare gli
                        // Style dopo è sicuro (nessun Drop personalizzato che
                        // tocchi LVGL — verificato nel crate prima di
                        // affidarcisi), ma i contesti Box::leak delle
                        // callback dei widget vecchi restano orfani per
                        // sempre: limite noto, accettabile per una sessione
                        // di test — vedi Q14.
                        styles = new_styles;
                        live_bindings = new_live;
                    }
                    Err(e) => eprintln!("[nav] rendering di '{target_page}' fallito: {e}"),
                },
                Err(e) => eprintln!("[nav] impossibile caricare pagina '{target_page}': {e}"),
            }
        }

        if lvgl_display::copy_frame_rgb888(&mut frame_buf) {
            let mut window_surface = window
                .surface(&event_pump)
                .map_err(|e| anyhow::anyhow!("window.surface: {e}"))?;
            let src_surface = Surface::from_data(
                &mut frame_buf,
                hor_res,
                ver_res,
                pitch as u32,
                PixelFormatEnum::RGB24,
            )
            .map_err(|e| anyhow::anyhow!("Surface::from_data: {e}"))?;
            src_surface
                .blit(None, &mut window_surface, None)
                .map_err(|e| anyhow::anyhow!("blit: {e}"))?;
            window_surface
                .update_window()
                .map_err(|e| anyhow::anyhow!("update_window: {e}"))?;
        }

        let elapsed = frame_start.elapsed();
        let target = Duration::from_millis(16); // ~60 fps
        if elapsed < target {
            std::thread::sleep(target - elapsed);
        }
    }
    // `styles`/`live_bindings` vivono fino a qui (fine del loop, fine del
    // processo in pratica) — LVGL tiene puntatori ai loro contenuti, non
    // copie, per tutta la durata della finestra.
    drop(styles);
    drop(live_bindings);
    Ok(())
}
