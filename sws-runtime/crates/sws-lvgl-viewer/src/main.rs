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
mod effects;
mod lvgl_display;
mod lvgl_font;
mod lvgl_indev;
mod lvgl_log;
mod lvgl_render;
mod model;
mod svg_assets;
mod svg_raster;
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
    ///
    /// **Omettendolo** si parte dalla *home page* dichiarata dal progetto, e
    /// in mancanza dalla prima pagina in elenco (vedi
    /// `client::resolve_start_page`). È così che va avviato da una unit
    /// systemd: un nome cablato smette di esistere al primo progetto diverso,
    /// e il viewer non parte più senza che si capisca perché.
    #[arg(long)]
    page: Option<String>,

    /// Disegna la pagina, salva un'immagine e esce — nessuna finestra.
    ///
    /// Serve a **guardare cosa disegna davvero questo motore** senza avere un
    /// pannello sotto mano. Fino a oggi l'unico modo era andare fisicamente
    /// davanti al dispositivo: le differenze rispetto al browser si scoprivano
    /// per caso, guardando lo schermo, spesso settimane dopo averle
    /// introdotte — è così che sono venuti fuori il label del gauge fuori dal
    /// cerchio, il navbutton che dava schermo nero e la pipe che non si
    /// riempiva.
    ///
    /// Il rendering di LVGL è già interamente software (`lvgl_display.rs`
    /// scrive in un buffer RGB888): SDL2 e DRM servono solo a *mostrare* quel
    /// buffer. Qui lo si salva invece di mostrarlo.
    ///
    /// Formato **PPM** (P6, RGB888 grezzo) e non PNG di proposito: nessun
    /// encoder da aggiungere, quindi nessun peso in più nel binario che finisce
    /// sul dispositivo — e qualunque strumento lo converte:
    ///
    /// ```text
    /// sws-lvgl-viewer --base-url ... --istantanea /tmp/p.ppm
    /// convert /tmp/p.ppm /tmp/p.png      # ImageMagick
    /// pnmtopng /tmp/p.ppm > /tmp/p.png   # netpbm
    /// ```
    #[arg(long)]
    istantanea: Option<String>,

    /// Prima dell'istantanea, tocca lo schermo in questi punti — `x,y` in
    /// coordinate di pagina, più tocchi separati da `;`.
    ///
    /// Serve a fotografare quello che si vede **dopo** un tocco: la finestra di
    /// conferma di un comando, un pulsante premuto, una pagina raggiunta da un
    /// navbutton. Senza, si può guardare solo lo stato a riposo, e le parti
    /// interattive resterebbero da provare a mano davanti a un pannello — che è
    /// esattamente il modo di lavorare da cui `--istantanea` serve a uscire.
    ///
    /// Più tocchi servono a percorrere una sequenza breve: aprire la finestra
    /// di conferma di un comando **e poi rispondere**. Con un tocco solo si può
    /// fotografare la domanda, non la risposta — e la risposta è la parte che
    /// esegue il comando.
    ///
    /// Esempio: `--tocca 160,277` (apre la conferma)
    ///          `--tocca "160,277;661,459"` (apre e conferma)
    #[arg(long, value_name = "X,Y")]
    tocca: Option<String>,

    /// Quanti millisecondi lasciar lavorare LVGL prima dell'istantanea.
    ///
    /// Non è un'attesa di cortesia: LVGL disegna dentro `task_handler()`, e
    /// widget come il gauge o i grafici hanno bisogno di più di un giro. Il
    /// default copre abbondantemente una pagina piena; serve alzarlo solo per
    /// cogliere una fase precisa di un lampeggio.
    #[arg(long, default_value_t = 500)]
    istantanea_ms: u64,

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

    /// Device touch da leggere (solo backend "drm").
    ///
    /// Default `auto`: prova `/dev/input/ts_uinput` e ripiega su
    /// `/dev/input/ts`. Sono i due symlink che PixsysOS crea da sé, e vanno
    /// usati **al posto di un `/dev/input/eventN`**, il cui numero cambia da
    /// prodotto a prodotto e anche fra due avvii.
    ///
    /// I due link non sono equivalenti, misurato su wp630-a-p3-07a077.local:
    /// `find-touchscreen.service` crea `/dev/input/ts` → il pannello **grezzo**
    /// (lì `event1`, "ILITEK ILITEK-TP"), e `ts-uinput.service` lo filtra con
    /// tslib producendo `/dev/input/ts_uinput` → il device virtuale
    /// **calibrato** (lì `event3`, "ts_uinput"). Su quel dispositivo
    /// `/etc/pointercal` non è identitario e `/etc/ts.conf` carica il modulo
    /// `linear`, quindi leggere il grezzo darebbe coordinate spostate: qui non
    /// linkiamo tslib e non applichiamo `pointercal` a mano (vedi
    /// touch_indev.rs), quindi ci serve l'uscita già filtrata.
    ///
    /// Conferma indipendente: **è `ts_uinput` che apre Weston** su quel
    /// dispositivo, non il pannello grezzo — cioè è la scelta dell'OS stesso.
    ///
    /// Valore esplicito = quel percorso e basta. `off` = nessun touch, solo
    /// rendering.
    #[arg(long, default_value = "auto")]
    touch_device: String,
}

/// Risolve `--touch-device`.
///
/// `None` significa "nessun touch". Il ripiego sul device grezzo esiste perché
/// un dispositivo senza `ts-uinput.service` attivo resti comunque usabile, ma
/// chi ci finisce va avvisato: le coordinate non saranno calibrate.
fn resolve_touch_device(arg: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    match arg {
        "off" | "" => None,
        "auto" => {
            if exists("/dev/input/ts_uinput") {
                Some("/dev/input/ts_uinput".to_string())
            } else if exists("/dev/input/ts") {
                eprintln!(
                    "[touch] /dev/input/ts_uinput assente, uso /dev/input/ts (pannello grezzo): \
                     le coordinate NON sono calibrate. Verifica ts-uinput.service."
                );
                Some("/dev/input/ts".to_string())
            } else {
                eprintln!("[touch] nessun symlink ts/ts_uinput: nessun input, solo rendering");
                None
            }
        }
        esplicito => Some(esplicito.to_string()),
    }
}

/// Dove va disegnata la pagina dentro la finestra: centrata.
///
/// Il viewer web mette la pagina in un contenitore centrato, e il motore LVGL
/// rispecchia il web (vedi `lvgl_render.rs`). Senza questo, una pagina più
/// piccola dello schermo finiva nell'angolo in alto a sinistra: la stessa
/// pagina in due posti diversi a seconda del motore.
///
/// Mai negativo: una pagina più grande della finestra parte dall'angolo e viene
/// ritagliata: spostarla in negativo taglierebbe anche il lato opposto,
/// nascondendo il doppio delle cose.
fn page_offset(page_w: u32, page_h: u32, win_w: u32, win_h: u32) -> (i32, i32) {
    let dx = (win_w as i32 - page_w as i32) / 2;
    let dy = (win_h as i32 - page_h as i32) / 2;
    (dx.max(0), dy.max(0))
}

/// Porta le coordinate del puntatore da spazio-finestra a spazio-pagina.
///
/// Serve perché la pagina è centrata: senza la traslazione, toccare un pulsante
/// disegnato al centro dello schermo scriverebbe un tocco spostato in alto a
/// sinistra della metà del margine, e il pulsante non reagirebbe. Il difetto
/// sarebbe "il touch non funziona bene", non "manca una sottrazione".
///
/// `None` per i tocchi fuori dalla pagina: sono i margini attorno, dove non c'è
/// niente da toccare. Consegnarli comunque a LVGL produceva i 314 avvisi
/// `X is 1631 which is greater than hor. res` per sessione.
fn pointer_to_page(x: i32, y: i32, off_x: i32, off_y: i32, page_w: u32, page_h: u32) -> Option<(i32, i32)> {
    let (px, py) = (x - off_x, y - off_y);
    if px < 0 || py < 0 || px >= page_w as i32 || py >= page_h as i32 {
        return None;
    }
    Some((px, py))
}

fn main() -> anyhow::Result<()> {
    // Stesso belt-and-suspenders di sws-runtime/src/main.rs: rustls 0.23 va in
    // panic se più provider crypto finiscono nel grafo delle dipendenze
    // (reqwest + tokio-tungstenite + il nostro rustls diretto potrebbero
    // altrimenti ognuno provare a impostarne uno di default).
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Prima di qualunque cosa tocchi LVGL: gli avvisi cominciano da `lv_init`,
    // e senza il filtro sono loro a decidere cosa resta leggibile nel log
    // (Q24 — 10.284 righe in 44 s sul WP630, che cancellavano le righe
    // d'avvio del viewer).
    lvgl_log::install();

    let args = Args::parse();



    // Il runtime tokio NON viene droppato dopo block_on: il task di lettura
    // WS in background (avviato dentro spawn_tag_subscription) deve restare
    // vivo per tutta la finestra, non solo per la fetch iniziale.
    let rt = tokio::runtime::Runtime::new()?;
    let (page, shared_tags, reload_flag, shared_alarms, lang_table) = rt.block_on(async {
        let page = match args.page.as_deref() {
            Some(nome) => client::fetch_page(&args.base_url, nome).await?,
            None => client::resolve_start_page(&args.base_url).await?,
        };
        let (shared_tags, reload_flag) = client::spawn_tag_subscription(&args.base_url).await?;
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
        anyhow::Ok((page, shared_tags, reload_flag, shared_alarms, lang_table))
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
    let (summary, styles, mut live_bindings, hor_res, ver_res) = lvgl_render::interpret_page(
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
    // La memoria delle bitmap SVG, se ce ne sono: è il numero su cui si
    // giocava la decisione D2, e vederlo a ogni caricamento costa una riga —
    // molto meno che andarlo a cercare il giorno in cui una pagina esagera.
    let svg_bytes = lvgl_render::svg_bitmap_bytes(&live_bindings);
    if svg_bytes > 0 {
        eprintln!("bitmap SVG di questa pagina: {} KB", svg_bytes / 1024);
    }

    // Deve seguire interpret_page (che chiama lvgl_display::init_display):
    // lv_indev_drv_register si aggancia da solo al display di default, che
    // deve quindi esistere già — vedi commento di modulo in lvgl_indev.rs.
    // Comune a entrambi i backend: touch_indev.rs (backend "drm") alimenta
    // lo stesso indev del mouse SDL2, non ne registra uno diverso.
    lvgl_indev::init_pointer_indev()?;

    // Istantanea: disegna, salva, esce. Prima di registrare l'indev e prima
    // di qualunque backend — non serve né un puntatore né una finestra.
    if let Some(percorso) = args.istantanea.clone() {
        // Il puntatore serve a `--tocca`, ed è già registrato qui sopra:
        // `init_pointer_indev` va chiamata una volta sola (e lo dice).
        scrivi_istantanea(
            &percorso, hor_res, ver_res, args.istantanea_ms, args.tocca.as_deref(),
            &shared_tags, &mut live_bindings, &tag_rx, &nav_rx,
        )?;
        drop(rt);
        return Ok(());
    }

    if args.backend == "drm" {
        // Solo il backend DRM apre /dev/input: su SDL2/Wayland gli eventi li
        // consegna il compositor, che li legge già calibrati per conto suo.
        match resolve_touch_device(&args.touch_device, |p| std::path::Path::new(p).exists()) {
            Some(dev) => {
                eprintln!("[touch] device: {dev}");
                touch_indev::spawn(&dev, hor_res, ver_res)?;
            }
            None => eprintln!("[drm] nessun touch: solo rendering"),
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
        reload_flag,
        (page.id.clone(), page.name.clone()),
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
/// Perché il backend DRM non può funzionare qui, se non può.
///
/// `None` = nessun ostacolo noto, si prova ad aprire il device.
///
/// Pura (l'ambiente arriva come parametro) per poterla verificare senza un
/// compositore acceso e senza un `/dev/dri` vero: è logica di diagnosi, e una
/// diagnosi che nessuno prova è una diagnosi di cui non ci si può fidare.
/// `"130,277"` → `(130, 277)`.
///
/// Rifiuta invece di indovinare: un `--tocca` scritto male che venisse letto
/// come `(0, 0)` toccherebbe l'angolo in alto a sinistra, e l'istantanea
/// mostrerebbe una pagina a riposo che si scambierebbe per «il tocco non fa
/// niente».
fn punto_tocco(s: &str) -> Option<(i32, i32)> {
    let (a, b) = s.split_once(',')?;
    Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
}

/// Fa disegnare LVGL per un po' e salva il frame in un file PPM.
///
/// Il `task_handler()` in un ciclo, e non una chiamata sola, per una ragione
/// concreta: LVGL disegna a pezzi (`sws_flush_cb` riceve un'area alla volta) e
/// alcuni widget — il gauge, i grafici — arrivano a schermo solo dopo qualche
/// giro. Un'istantanea presa subito coglierebbe una pagina a metà, e la si
/// scambierebbe per un difetto di rendering.
///
/// `update_bindings` gira dentro il ciclo perché la pagina mostri i valori tag
/// veri e non quelli con cui è nata — è il compito che nel loop normale svolge
/// a ogni frame.
fn scrivi_istantanea(
    percorso: &str,
    hor_res: u32,
    ver_res: u32,
    per_ms: u64,
    tocca: Option<&str>,
    shared_tags: &client::SharedTagSnapshot,
    live_bindings: &mut [lvgl_render::LiveBinding],
    tag_rx: &mpsc::Receiver<lvgl_render::TagCommand>,
    nav_rx: &mpsc::Receiver<String>,
) -> anyhow::Result<()> {
    const PASSO_MS: u64 = 16;
    let giri = (per_ms / PASSO_MS).max(1);
    let punti: Vec<(i32, i32)> = match tocca {
        None => Vec::new(),
        Some(s) => s
            .split(';')
            .map(|p| {
                punto_tocco(p).ok_or_else(|| {
                    anyhow::anyhow!(
                        "--tocca vuole coppie `x,y` separate da `;` (es. \"160,277;661,459\"), non '{p}'"
                    )
                })
            })
            .collect::<anyhow::Result<_>>()?,
    };
    // I tocchi si distribuiscono nella seconda metà del tempo: la prima metà
    // serve a far disegnare la pagina (LVGL costruisce a pezzi), e dopo l'ultimo
    // tocco restano giri perché ciò che fa apparire faccia in tempo a comparire.
    //
    // `giu`/`su` distinti e non un tocco istantaneo: LVGL riconosce il click al
    // **rilascio** (`LV_EVENT_CLICKED` da `lv_indev`), quindi un dito che tocca
    // e non stacca non preme niente.
    let inizio = giri / 3;
    let passo = ((giri.saturating_sub(inizio + 3)) / punti.len().max(1) as u64).max(3);
    for giro in 0..giri {
        for (i, (x, y)) in punti.iter().enumerate() {
            let giu = inizio + passo * i as u64;
            if giro == giu {
                lvgl_indev::set_pointer_state(*x, *y, true);
            } else if giro == giu + 2 {
                lvgl_indev::set_pointer_state(*x, *y, false);
            }
        }
        {
            let tags = shared_tags.lock().unwrap_or_else(|e| e.into_inner()).clone();
            lvgl_render::update_bindings(live_bindings, &tags);
        }
        lvgl::task_handler();
        lvgl::tick_inc(Duration::from_millis(PASSO_MS));
    }

    // Cosa ha PRODOTTO il tocco, non solo cosa si vede.
    //
    // In modalità istantanea nessuno svuota le code dei comandi (il ciclo
    // normale non gira), quindi qui dentro c'è esattamente ciò che il tocco ha
    // generato. Senza questo, `--tocca` direbbe solo che qualcosa è comparso a
    // schermo: un pulsante che apre la finestra giusta e poi scrive il valore
    // sbagliato sembrerebbe funzionare.
    let mut comandi = 0;
    while let Ok(c) = tag_rx.try_recv() {
        eprintln!("  comando prodotto: scrivere {:?} su '{}'", c.value, c.tag);
        comandi += 1;
    }
    while let Ok(p) = nav_rx.try_recv() {
        eprintln!("  navigazione richiesta: pagina '{p}'");
        comandi += 1;
    }
    if !punti.is_empty() && comandi == 0 {
        eprintln!("  il tocco non ha prodotto nessun comando");
    }

    let mut frame = vec![0u8; (hor_res * ver_res * 3) as usize];
    if !lvgl_display::copy_frame_rgb888(&mut frame) {
        anyhow::bail!("nessun frame: il display LVGL non è stato inizializzato");
    }

    // PPM binario (P6): intestazione di testo, poi i pixel RGB888 così come
    // stanno nel frame buffer. Nessun encoder, nessuna dipendenza in più.
    let mut out = format!("P6\n{hor_res} {ver_res}\n255\n").into_bytes();
    out.extend_from_slice(&frame);
    std::fs::write(percorso, &out)
        .map_err(|e| anyhow::anyhow!("scrittura di '{percorso}' fallita: {e}"))?;

    eprintln!(
        "istantanea: {percorso} ({hor_res}x{ver_res}, {} KB, dopo {} ms di rendering)",
        out.len() / 1024,
        giri * PASSO_MS
    );
    eprintln!("            convertila con `convert {percorso} out.png` o `pnmtopng {percorso} > out.png`");
    Ok(())
}

fn drm_backend_blocker(card_path: &str, env: impl Fn(&str) -> Option<String>) -> Option<String> {
    let non_vuota = |k: &str| env(k).filter(|v| !v.trim().is_empty());

    // Un compositore attivo tiene il DRM master: nessun altro processo può
    // fare il modeset, permessi o no. Si controlla prima dei permessi perché è
    // la causa che resta anche dopo averli sistemati.
    if let Some(d) = non_vuota("WAYLAND_DISPLAY") {
        return Some(format!(
            "c'è un compositore Wayland attivo (WAYLAND_DISPLAY={d}) e il DRM master è suo — \
             ce n'è uno solo per seat, quindi servirebbe fermarlo"
        ));
    }
    if let Some(d) = non_vuota("DISPLAY") {
        return Some(format!(
            "c'è un server X attivo (DISPLAY={d}) e il DRM master è suo — \
             servirebbe fermarlo"
        ));
    }

    // `seatd` significa che i device li distribuisce lui, e questo backend non
    // sa chiederglieli: fa `open()` diretto.
    if std::path::Path::new("/run/seatd.sock").exists() {
        return Some(
            "il sistema usa seatd (/run/seatd.sock) per distribuire i device grafici, \
             mentre questo backend apre /dev/dri direttamente e non sa chiederglieli"
                .to_string(),
        );
    }

    if !std::path::Path::new(card_path).exists() {
        return Some(format!("{card_path} non esiste"));
    }
    None
}

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
    // Diagnosi PRIMA di aprire il device.
    //
    // Su un pannello PixsysOS questo backend non può funzionare, e non per un
    // difetto correggibile: i device li distribuisce `seatd`, e il DRM master
    // ce l'ha Weston (ce n'è uno solo per seat). Un `open()` diretto fallisce
    // con "Permission denied", che è vero e inutile — chi lo legge cerca il
    // permesso mancante, e il permesso non è il punto. Vedi OPEN_QUESTIONS Q19.
    //
    // Il backend resta perché su hardware **senza** compositore sarebbe la
    // strada giusta; ma deve dire da sé quando non lo è.
    if let Some(motivo) = drm_backend_blocker(card_path, |k| std::env::var(k).ok()) {
        anyhow::bail!(
            "il backend DRM non è utilizzabile qui: {motivo}\n\
             \n\
             Su questi pannelli usa il backend predefinito SDL2, che passa dal\n\
             compositore e funziona senza privilegi:\n\
             \n\
                 sws-lvgl-viewer --base-url … --page … (senza --backend drm)\n\
             \n\
             Vedi docs/OPEN_QUESTIONS.md Q19 per il perché."
        );
    }

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
    // Alzato dal task WS quando il runtime dice che il progetto è cambiato
    // (Q20): il ridisegno avviene QUI, nel thread del rendering, perché LVGL
    // non è thread-safe e il task WS gira su tokio.
    //
    // Solo su questo backend, non su `run_drm`: quello è dichiarato non
    // supportato su questi pannelli (Q19) e non vale la pena duplicarci il
    // meccanismo finché resta tale.
    reload_flag: client::ReloadFlag,
    // Pagina mostrata adesso — id e nome — aggiornata a ogni navigazione:
    // serve a sapere COSA rileggere quando arriva la notifica.
    //
    // Servono entrambi perché `id` è opzionale nello schema: i navbutton
    // risolvono per id (chiave stabile), ma una pagina che non ne ha si può
    // rileggere solo per nome, che è ciò che usa l'API REST. Sono cose diverse
    // anche quando coincidono — vedi `client::resolve_page_by_id`.
    mut current_page: (Option<String>, String),
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
        // Schermo intero, non una finestra posizionata. Su un pannello HMI la
        // pagina deve occupare tutto e partire dall'angolo, e **chiedere una
        // posizione non funziona**: misurato su wp630-a-p3-07a077.local il
        // 2026-08-24, né `.position_centered()` né `.position(0, 0)` mettono la
        // finestra all'angolo — resta spostata in basso a destra. È il
        // comportamento normale di X11: il window manager decide dove mettere
        // le finestre e ignora la richiesta del client (solo una finestra
        // override-redirect potrebbe imporsi, e SDL2 non la espone).
        // `fullscreen_desktop` invece è una richiesta che il WM onora.
        //
        // Conseguenza da tenere d'occhio: la finestra prende la dimensione del
        // desktop, che può non coincidere con quella della pagina. Il blit è
        // ritagliato all'intersezione e la riga di ATTENZIONE qui sotto lo dice.
        .fullscreen_desktop()
        .borderless()
        .build()?;
    let mut event_pump = sdl_context.event_pump().map_err(|e| anyhow::anyhow!("event_pump: {e}"))?;

    let mut frame_buf = vec![0u8; (hor_res * ver_res * 3) as usize];
    let pitch = (hor_res * 3) as usize;
    let mut mouse_pressed = false;

    // La dimensione ottenuta non è quella chiesta finché non la si guarda.
    // Su wp630-a-p3-07a077.local (2026-08-24) `SDL_UpdateWindowSurface` moriva
    // con `BadValue` su `X_ShmPutImage` e valore 0x780 = 1920, cioè la larghezza
    // richiesta: segno che il drawable X vero era più stretto. Il commento qui
    // sopra attribuiva quel sintomo alla barra del titolo, ma `.borderless()`
    // c'è già — quindi la causa è un'altra e va misurata, non dedotta.
    let (win_w, win_h) = window.size();
    let (draw_w, draw_h) = window.drawable_size();
    let (pos_x, pos_y) = window.position();
    eprintln!("[sdl2] geometria: pagina {hor_res}x{ver_res}, finestra {win_w}x{win_h} a ({pos_x},{pos_y}), area disegnabile {draw_w}x{draw_h}");
    // L'avviso solo quando la pagina è più GRANDE della finestra, che è
    // l'unico caso in cui qualcosa si perde davvero. Una pagina più piccola
    // viene centrata e si vede tutta: avvisare anche lì — com'era prima —
    // faceva sembrare un guasto la situazione normale di un pannello
    // 1920x1080 con una pagina 1280x800, e chi legge il log impara a ignorare
    // gli avvisi.
    if hor_res > win_w || ver_res > win_h || hor_res > draw_w || ver_res > draw_h {
        eprintln!(
            "[sdl2] ATTENZIONE: la pagina è {hor_res}x{ver_res} ma la finestra è {win_w}x{win_h} \
             — quello che avanza NON si vede, la pagina risulta tagliata"
        );
    }
    if (pos_x, pos_y) != (0, 0) {
        eprintln!("[sdl2] ATTENZIONE: la finestra non è all'angolo ma a ({pos_x},{pos_y}) — il window manager ha ignorato la richiesta");
    }
    // Calcolato una volta: la finestra non cambia dimensione per tutta la
    // sessione (è a schermo intero su un pannello).
    let (off_x, off_y) = page_offset(hor_res, ver_res, win_w, win_h);
    if (off_x, off_y) != (0, 0) {
        eprintln!("[sdl2] pagina centrata con un margine di ({off_x},{off_y}) px — come fa il viewer web");
    }
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
                    if let Some((px, py)) = pointer_to_page(x, y, off_x, off_y, hor_res, ver_res) {
                        mouse_pressed = true;
                        lvgl_indev::set_pointer_state(px, py, mouse_pressed);
                    }
                }
                Event::MouseButtonUp { x, y, mouse_btn: MouseButton::Left, .. } => {
                    // Il rilascio si consegna SEMPRE, anche fuori dalla pagina:
                    // trascinando uno slider fuori dal bordo e rilasciando lì,
                    // ignorare il rilascio lascerebbe LVGL convinto che il dito
                    // sia ancora premuto — e lo slider seguirebbe il puntatore
                    // per il resto della sessione.
                    mouse_pressed = false;
                    let (px, py) = pointer_to_page(x, y, off_x, off_y, hor_res, ver_res)
                        .unwrap_or(((x - off_x).clamp(0, hor_res as i32 - 1), (y - off_y).clamp(0, ver_res as i32 - 1)));
                    lvgl_indev::set_pointer_state(px, py, mouse_pressed);
                }
                Event::MouseMotion { x, y, .. } => {
                    if let Some((px, py)) = pointer_to_page(x, y, off_x, off_y, hor_res, ver_res) {
                        lvgl_indev::set_pointer_state(px, py, mouse_pressed);
                    }
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
                        current_page = (new_page.id.clone(), new_page.name.clone());
                    }
                    Err(e) => eprintln!("[nav] rendering di '{target_page}' fallito: {e}"),
                },
                Err(e) => eprintln!("[nav] impossibile caricare pagina '{target_page}': {e}"),
            }
        }

        // Ricarica: il progetto è cambiato mentre lo stavamo guardando (Q20).
        //
        // `swap` e non `load` + `store`: fra le due ci starebbe una notifica, e
        // andrebbe persa. Così, se ne arriva un'altra durante il ridisegno, il
        // flag resta alzato e si ricarica di nuovo al frame successivo.
        //
        // Si rilegge la pagina CORRENTE, non quella di partenza: chi ha
        // navigato altrove deve restare dov'è, col contenuto aggiornato.
        if reload_flag.swap(false, std::sync::atomic::Ordering::Relaxed) {
            // Gli SVG già scaricati vanno buttati: un deploy può aver
            // cambiato un simbolo custom o un'immagine **sotto lo stesso
            // URL**, e una cache che non se ne accorge ridisegna la pagina
            // nuova col disegno vecchio — cioè proprio l'inganno che il
            // ricaricamento automatico doveva togliere di mezzo.
            svg_assets::invalidate();
            let (id, nome) = (&current_page.0, &current_page.1);
            let letta = match id {
                Some(id) => rt_handle.block_on(client::resolve_page_by_id(&base_url, id)),
                None => rt_handle.block_on(client::fetch_page(&base_url, nome)),
            };
            match letta {
                Ok(new_page) => match lvgl_render::render_page_objects(
                    &new_page, &tags_now, &tag_tx, &nav_tx, &base_url, &rt_handle, &shared_alarms, &ack_tx,
                    &lang_table, &shared_lang,
                ) {
                    Ok((summary, new_styles, new_live)) => {
                        eprintln!(
                            "[reload] '{}' ridisegnata: {} oggetti, {} non supportati",
                            new_page.name,
                            summary.rendered.len(),
                            summary.skipped_unsupported.len()
                        );
                        styles = new_styles;
                        live_bindings = new_live;
                    }
                    Err(e) => eprintln!("[reload] rendering fallito: {e} — resto sulla pagina di prima"),
                },
                // La pagina può essere sparita insieme al progetto vecchio: si
                // resta su quella che c'è, sbagliata ma visibile, invece di
                // lasciare lo schermo vuoto.
                Err(e) => eprintln!("[reload] impossibile rileggere '{nome}': {e} — resto sulla pagina di prima"),
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
            // Ritaglio esplicito all'intersezione fra il frame LVGL e la
            // superficie reale della finestra. `blit(None, .., None)` si
            // affiderebbe al clipping di SDL, che protegge la memoria ma non
            // impedisce a `SDL_UpdateWindowSurface` di chiedere a X un
            // `ShmPutImage` più largo del drawable — che è come muore su
            // XWayland qui.
            let (dst_w, dst_h) = (window_surface.width(), window_surface.height());
            let src_rect = sdl2::rect::Rect::new(0, 0, hor_res.min(dst_w), ver_res.min(dst_h));
            // Centrata, non in alto a sinistra: è ciò che fa il viewer web, che
            // mette la pagina in un contenitore `align/justify: center`. Una
            // pagina 1280x800 su un pannello 1920x1080 appariva centrata nel
            // browser e schiacciata nell'angolo sul dispositivo — la stessa
            // pagina, due posti diversi.
            let (off_x, off_y) = page_offset(hor_res, ver_res, dst_w, dst_h);
            let dst_rect = sdl2::rect::Rect::new(off_x, off_y, src_rect.width(), src_rect.height());
            src_surface
                .blit(src_rect, &mut window_surface, dst_rect)
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
    // Chiude il cerchio sulla strozzatura del log: senza questo riepilogo,
    // "quell'avviso non c'è" e "quell'avviso è uscito 9.000 volte" si
    // somigliano troppo (Q24).
    lvgl_log::print_summary();
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Il caso vero: pagina 1280x800 della demo su un pannello 1920x1080.
    /// Prima finiva nell'angolo, mentre il browser la centrava.
    #[test]
    fn la_pagina_si_centra_nella_finestra() {
        assert_eq!(super::page_offset(1280, 800, 1920, 1080), (320, 140));
    }

    #[test]
    fn combaciando_non_ce_margine() {
        assert_eq!(super::page_offset(1920, 1080, 1920, 1080), (0, 0));
    }

    /// Una pagina più grande della finestra parte dall'angolo: un margine
    /// negativo taglierebbe anche il lato opposto, nascondendo il doppio.
    #[test]
    fn una_pagina_piu_grande_dello_schermo_resta_nellangolo() {
        assert_eq!(super::page_offset(2560, 1440, 1920, 1080), (0, 0));
    }

    #[test]
    fn il_tocco_viene_traslato_nello_spazio_pagina() {
        // Il centro dello schermo è il centro della pagina.
        assert_eq!(super::pointer_to_page(960, 540, 320, 140, 1280, 800), Some((640, 400)));
        // L'angolo in alto a sinistra della pagina disegnata.
        assert_eq!(super::pointer_to_page(320, 140, 320, 140, 1280, 800), Some((0, 0)));
    }

    /// I margini attorno alla pagina non contengono niente da toccare.
    /// Consegnarli comunque produceva 314 avvisi per sessione sul WP630.
    #[test]
    fn i_tocchi_fuori_dalla_pagina_si_scartano() {
        for (x, y, dove) in [(10, 540, "margine sinistro"), (1900, 540, "margine destro"),
                             (960, 10, "margine alto"), (960, 1070, "margine basso")] {
            assert_eq!(super::pointer_to_page(x, y, 320, 140, 1280, 800), None, "{dove}");
        }
    }

    /// Il bordo destro/inferiore è esclusivo: l'ultimo pixel valido è
    /// `page_w - 1`, e accettare `page_w` rimetterebbe l'avviso che si voleva
    /// togliere.
    #[test]
    fn il_bordo_e_esclusivo() {
        assert_eq!(super::pointer_to_page(320 + 1279, 140 + 799, 320, 140, 1280, 800), Some((1279, 799)));
        assert_eq!(super::pointer_to_page(320 + 1280, 140 + 799, 320, 140, 1280, 800), None);
    }

    use super::{drm_backend_blocker, resolve_touch_device};

    /// Il caso normale su un Pixsys sano: entrambi i symlink esistono e va
    /// scelto quello calibrato da tslib, non il pannello grezzo.
    #[test]
    fn auto_preferisce_il_device_calibrato() {
        let ci_sono_entrambi = |p: &str| p == "/dev/input/ts_uinput" || p == "/dev/input/ts";
        assert_eq!(
            resolve_touch_device("auto", ci_sono_entrambi).as_deref(),
            Some("/dev/input/ts_uinput")
        );
    }

    /// Dispositivo senza ts-uinput.service attivo: meglio un touch con
    /// coordinate grezze che nessun touch, ma l'utente va avvisato (lo fa la
    /// funzione su stderr).
    #[test]
    fn auto_ripiega_sul_grezzo_quando_manca_il_filtrato() {
        assert_eq!(
            resolve_touch_device("auto", |p| p == "/dev/input/ts").as_deref(),
            Some("/dev/input/ts")
        );
    }

    #[test]
    fn auto_senza_nessun_symlink_non_apre_niente() {
        assert_eq!(resolve_touch_device("auto", |_| false), None);
    }

    /// Un percorso esplicito non viene messo in discussione: chi lo passa sa
    /// cosa sta facendo, e potrebbe puntare a un device che non esiste ancora.
    #[test]
    fn un_percorso_esplicito_vince_e_non_viene_sondato() {
        assert_eq!(
            resolve_touch_device("/dev/input/event7", |_| false).as_deref(),
            Some("/dev/input/event7")
        );
    }

    /// `off` e la stringa vuota disattivano il touch. La stringa vuota era il
    /// vecchio default: chi la passa ancora da uno script non deve trovarsi
    /// un comportamento diverso da prima.
    // ── Diagnosi del backend DRM (Q19) ──────────────────────────────────

    fn amb<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    /// Il caso del WP630: compositore acceso. Il messaggio deve parlare del DRM
    /// master, non dei permessi — è lì che si perde tempo altrimenti.
    #[test]
    fn un_compositore_wayland_blocca_il_drm() {
        let m = drm_backend_blocker("/dev/dri/card0", amb(&[("WAYLAND_DISPLAY", "wayland-1")]))
            .expect("dovrebbe segnalare un ostacolo");
        assert!(m.contains("DRM master"), "il messaggio deve dire di chi è il master: {m}");
        assert!(m.contains("wayland-1"), "e quale compositore: {m}");
    }

    #[test]
    fn anche_un_server_x_blocca_il_drm() {
        let m = drm_backend_blocker("/dev/dri/card0", amb(&[("DISPLAY", ":0")])).unwrap();
        assert!(m.contains("server X") && m.contains(":0"), "{m}");
    }

    /// Una variabile presente ma vuota non è un compositore acceso.
    #[test]
    fn variabili_vuote_non_contano_come_compositore() {
        let r = drm_backend_blocker("/dev/dri/card-inesistente",
            amb(&[("WAYLAND_DISPLAY", ""), ("DISPLAY", "   ")]));
        let m = r.expect("il device non esiste, quindi un ostacolo c'è");
        assert!(m.contains("non esiste"), "l'ostacolo dev'essere il device, non il compositore: {m}");
    }

    #[test]
    fn un_device_mancante_viene_detto_chiaramente() {
        let m = drm_backend_blocker("/dev/dri/card-inesistente", amb(&[])).unwrap();
        assert!(m.contains("/dev/dri/card-inesistente") && m.contains("non esiste"), "{m}");
    }

    #[test]
    fn off_e_stringa_vuota_disattivano_il_touch() {
        assert_eq!(resolve_touch_device("off", |_| true), None);
        assert_eq!(resolve_touch_device("", |_| true), None);
    }
}
