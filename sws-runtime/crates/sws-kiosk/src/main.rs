use clap::Parser;
use gtk4::gdk::Key;
use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{gdk, Application, ApplicationWindow, EventControllerKey};
use webkit6::prelude::WebViewExt;
use webkit6::{NetworkSession, TLSErrorsPolicy, WebView};

#[derive(Parser)]
#[command(name = "sws-kiosk", about = "SWS WebKit kiosk window")]
struct Args {
    /// URL to load
    #[arg(default_value = "https://127.0.0.1:8443")]
    url: String,

    /// Skip TLS certificate verification (needed for self-signed certs)
    #[arg(long, default_value_t = true)]
    allow_insecure_tls: bool,

    /// Start in windowed mode instead of fullscreen
    #[arg(long)]
    windowed: bool,
}

fn main() -> glib::ExitCode {
    let args = Args::parse();
    let app = Application::builder()
        .application_id("dev.sws.kiosk")
        .build();

    let url = args.url.clone();
    let fullscreen = !args.windowed;
    let insecure = args.allow_insecure_tls;

    app.connect_activate(move |app| {
        let session = NetworkSession::new_ephemeral();
        if insecure {
            session.set_tls_errors_policy(TLSErrorsPolicy::Ignore);
        }

        let webview = WebView::builder().network_session(&session).build();

        // Explicitly use WebViewExt::settings to avoid ambiguity with WidgetExt::settings.
        if let Some(settings) = WebViewExt::settings(&webview) {
            settings.set_enable_developer_extras(false);
            settings.set_enable_back_forward_navigation_gestures(false);
        }

        webview.load_uri(&url);

        let win = ApplicationWindow::builder()
            .application(app)
            .child(&webview)
            .title("SWS")
            .build();

        win.set_decorated(false);

        if fullscreen {
            win.fullscreen();
        }

        let key_ctrl = EventControllerKey::new();
        let win_clone = win.clone();
        key_ctrl.connect_key_pressed(move |_, key, _, mods| {
            match key {
                Key::F11 => {
                    if win_clone.is_fullscreen() {
                        win_clone.unfullscreen();
                    } else {
                        win_clone.fullscreen();
                    }
                    glib::Propagation::Stop
                }
                Key::q | Key::Q if mods.contains(gdk::ModifierType::CONTROL_MASK) => {
                    win_clone.close();
                    glib::Propagation::Stop
                }
                Key::Escape if mods.contains(gdk::ModifierType::CONTROL_MASK) => {
                    win_clone.close();
                    glib::Propagation::Stop
                }
                _ => glib::Propagation::Proceed,
            }
        });
        win.add_controller(key_ctrl);

        win.present();
    });

    app.run()
}
