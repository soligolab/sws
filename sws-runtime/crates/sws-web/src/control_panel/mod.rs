//! The device control panel: network, time, information and reboot of the
//! operating system under SWS, from the device's own screen.
//!
//! Plan `docs/plans/2026-11-13-pannello-di-controllo.md`. It exists because on
//! 13-11-2026 a TY570 came back from a reboot without IPv4, with the Pixsys
//! setup hidden by the viewer and USB off: no local way back to the network.
//!
//! The API is the same for the screen (LVGL viewer, web viewer) and, later,
//! for the IDE and the cloud. It sits outside the project's authentication:
//! the panel must open on a device with no project, or with a project whose
//! users nobody on site knows. A **service PIN** opens a short **service
//! session** instead ([`pin`]); the session lives in memory, like the failed
//! attempts, so a restart closes it.
//!
//! The project can disable the panel (`control_panel.enabled: false`): the
//! screen then hides the runtime gesture and the synoptic action. The API stays
//! open, because the window shown when SWS starts is the way back that always
//! remains (decision of 13-11-2026).

pub mod backend;
pub mod dbus;
pub mod pin;

use crate::router::{active_dir, AppState};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use backend::{Backend, Hotspot, Ipv4Change, TimeChange, WifiConnect, CONFIRM_WITHIN_SECS};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sws_core::project::ControlPanelConfig;

/// The header that carries the service session.
pub const SESSION_HEADER: &str = "x-sws-control-panel";

/// How long a service session lasts without being used.
const SESSION_IDLE: Duration = Duration::from_secs(15 * 60);
/// Wrong PINs before the panel stops listening for [`LOCKOUT`].
const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

/// Sessions and failed attempts. In memory on purpose: a restart closes every
/// session and forgets the attempts, as in `sws-auth`.
#[derive(Default)]
struct Gate {
    sessions: HashMap<String, Instant>,
    failures: u32,
    locked_until: Option<Instant>,
}

fn gate() -> &'static Mutex<Gate> {
    static GATE: OnceLock<Mutex<Gate>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}

fn backend() -> &'static Backend {
    static BACKEND: OnceLock<Backend> = OnceLock::new();
    BACKEND.get_or_init(Backend::from_env)
}

pub(crate) fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = std::io::Read::read_exact(&mut f, &mut bytes);
    }
    bytes
}

fn new_token() -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

/// The project's settings, or the defaults when no project is open or it
/// cannot be read: the panel must work exactly then.
async fn project_config(s: &AppState) -> ControlPanelConfig {
    let Ok(dir) = active_dir(s).await else {
        return ControlPanelConfig::default();
    };
    sws_core::project::Project::load(&dir)
        .ok()
        .and_then(|p| p.control_panel)
        .unwrap_or_default()
}

fn initial_pin() -> Option<String> {
    pin::initial_pin(std::path::Path::new(pin::SYS_CLASS_NET))
}

pub fn routes() -> Router<AppState> {
    let open = Router::new()
        .route("/api/control-panel", get(status))
        .route("/api/control-panel/session", post(open_session));
    let guarded = Router::new()
        .route("/api/control-panel/capabilities", get(capabilities))
        .route("/api/control-panel/info", get(info))
        .route("/api/control-panel/network", get(network))
        .route("/api/control-panel/network/:card", put(set_network))
        .route("/api/control-panel/network/confirm", post(confirm_network))
        .route(
            "/api/control-panel/network/rollback",
            post(rollback_network),
        )
        .route("/api/control-panel/time", get(time).put(set_time))
        .route("/api/control-panel/timezones", get(timezones))
        .route("/api/control-panel/reboot", post(reboot))
        .route("/api/control-panel/power-off", post(power_off))
        .route("/api/control-panel/wifi", get(wifi))
        .route("/api/control-panel/wifi/scan", post(wifi_scan))
        .route("/api/control-panel/wifi/connect", post(wifi_connect))
        .route("/api/control-panel/wifi/forget", post(wifi_forget))
        .route("/api/control-panel/wifi/radio", put(wifi_radio))
        .route(
            "/api/control-panel/wifi/hotspot",
            get(hotspot).put(set_hotspot),
        )
        .route("/api/control-panel/display", get(display).put(set_display))
        .route(
            "/api/control-panel/touch-calibration",
            post(start_touch_calibration),
        )
        .route_layer(middleware::from_fn(require_session));
    open.merge(guarded)
}

/// `GET /api/control-panel` — public: whether the project shows the gesture
/// and the action, and which PIN counts. Never the PIN itself.
async fn status(State(s): State<AppState>) -> Response {
    let cfg = project_config(&s).await;
    let initial = initial_pin();
    Json(json!({
        "enabled": cfg.enabled,
        "pin": pin::pin_source(cfg.pin_hash.as_deref(), initial.as_deref()),
        // Public because the viewer applies it before anyone opens the panel.
        "brightness": DeviceSettings::load(&s.config_dir).brightness,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct PinBody {
    pin: String,
}

/// `POST /api/control-panel/session` `{pin}` → `{token, idle_secs}`.
async fn open_session(State(s): State<AppState>, Json(body): Json<PinBody>) -> Response {
    let now = Instant::now();
    if let Some(until) = gate().lock().unwrap().locked_until.filter(|t| *t > now) {
        let secs = until.duration_since(now).as_secs().max(1);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"retry_after_secs": secs})),
        )
            .into_response();
    }
    let cfg = project_config(&s).await;
    let initial = initial_pin();
    let ok = pin::pin_matches(&body.pin, cfg.pin_hash.as_deref(), initial.as_deref());
    let mut g = gate().lock().unwrap();
    if !ok {
        g.failures += 1;
        if g.failures >= MAX_FAILURES {
            g.failures = 0;
            g.locked_until = Some(now + LOCKOUT);
        }
        tracing::warn!("control panel: wrong PIN");
        return StatusCode::UNAUTHORIZED.into_response();
    }
    g.failures = 0;
    g.locked_until = None;
    g.sessions
        .retain(|_, last| now.duration_since(*last) < SESSION_IDLE);
    let token = new_token();
    g.sessions.insert(token.clone(), now);
    tracing::info!("control panel: service session opened");
    Json(json!({"token": token, "idle_secs": SESSION_IDLE.as_secs()})).into_response()
}

async fn require_session(req: Request<Body>, next: Next) -> Response {
    let token = req
        .headers()
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let now = Instant::now();
    {
        let mut g = gate().lock().unwrap();
        match g.sessions.get_mut(&token) {
            Some(last) if now.duration_since(*last) < SESSION_IDLE => *last = now,
            _ => {
                g.sessions.remove(&token);
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
    }
    next.run(req).await
}

fn failed(e: String) -> Response {
    (StatusCode::BAD_GATEWAY, Json(json!({"error": e}))).into_response()
}

async fn capabilities() -> Response {
    Json(backend().capabilities().await).into_response()
}

/// `GET /api/control-panel/info` — what the device is. The initial PIN only
/// while the project has none of its own: then it is the one to write down.
async fn info(State(s): State<AppState>) -> Response {
    use sws_plugin_host as host;
    let cfg = project_config(&s).await;
    let model = host::pixsys_device_info(
        std::path::Path::new(host::PIXSYS_DEVICE_INFO),
        "Device_Name",
    )
    .or_else(|| host::leggi_device_tree(host::DEVICE_TREE, "model"));
    let hostname = std::fs::read_to_string("/etc/hostname")
        .map(|h| h.trim().to_string())
        .unwrap_or_default();
    Json(json!({
        "model": model,
        "serial": host::leggi_seriale(),
        "hostname": hostname,
        "sws_version": env!("CARGO_PKG_VERSION"),
        "initial_pin": if cfg.pin_hash.is_none() { initial_pin() } else { None },
    }))
    .into_response()
}

async fn network() -> Response {
    match backend().cards().await {
        Ok(c) => Json(c).into_response(),
        Err(e) => failed(e),
    }
}

/// `PUT /api/control-panel/network/:card` — applied at once, undone after
/// [`CONFIRM_WITHIN_SECS`] unless `POST …/network/confirm` arrives.
async fn set_network(
    State(s): State<AppState>,
    Path(card): Path<String>,
    Json(change): Json<Ipv4Change>,
) -> Response {
    if let Err(e) = change.validate() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    match backend().set_ipv4(&card, &change).await {
        Ok(()) => {
            s.audit.log(
                "control_panel.network",
                None,
                json!({"card": card, "method": change.method}),
            );
            Json(json!({"confirm_within_secs": CONFIRM_WITHIN_SECS})).into_response()
        }
        Err(e) => failed(e),
    }
}

async fn confirm_network() -> Response {
    match backend().confirm_network().await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::CONFLICT, Json(json!({"error": e}))).into_response(),
    }
}

async fn rollback_network() -> Response {
    match backend().rollback_network().await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::CONFLICT, Json(json!({"error": e}))).into_response(),
    }
}

async fn time() -> Response {
    match backend().time().await {
        Ok(t) => Json(t).into_response(),
        Err(e) => failed(e),
    }
}

async fn set_time(State(s): State<AppState>, Json(change): Json<TimeChange>) -> Response {
    match backend().set_time(&change).await {
        Ok(()) => {
            s.audit.log("control_panel.time", None, json!({}));
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => failed(e),
    }
}

async fn timezones() -> Response {
    match backend().timezones().await {
        Ok(t) => Json(t).into_response(),
        Err(e) => failed(e),
    }
}

async fn reboot(State(s): State<AppState>) -> Response {
    s.audit.log("control_panel.reboot", None, json!({}));
    match backend().reboot().await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(e) => failed(e),
    }
}

async fn power_off(State(s): State<AppState>) -> Response {
    s.audit.log("control_panel.power_off", None, json!({}));
    match backend().power_off().await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(e) => failed(e),
    }
}

// ── Wi-Fi ───────────────────────────────────────────────────────────────────

async fn wifi() -> Response {
    match backend().wifi().await {
        Ok(w) => Json(w).into_response(),
        Err(e) => failed(e),
    }
}

async fn wifi_scan() -> Response {
    match backend().wifi_scan().await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(e) => failed(e),
    }
}

fn bad_request(e: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response()
}

/// `POST /api/control-panel/wifi/connect` — like a network change: undone
/// after [`CONFIRM_WITHIN_SECS`] unless confirmed.
async fn wifi_connect(State(s): State<AppState>, Json(req): Json<WifiConnect>) -> Response {
    if let Err(e) = req.validate() {
        return bad_request(e);
    }
    match backend().wifi_connect(&req).await {
        Ok(()) => {
            s.audit
                .log("control_panel.wifi", None, json!({"ssid": req.ssid}));
            Json(json!({"confirm_within_secs": CONFIRM_WITHIN_SECS})).into_response()
        }
        Err(e) => failed(e),
    }
}

#[derive(Deserialize)]
struct SsidBody {
    ssid: String,
}

async fn wifi_forget(State(s): State<AppState>, Json(body): Json<SsidBody>) -> Response {
    match backend().wifi_forget(&body.ssid).await {
        Ok(()) => {
            s.audit.log(
                "control_panel.wifi_forget",
                None,
                json!({"ssid": body.ssid}),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => failed(e),
    }
}

#[derive(Deserialize)]
struct EnabledBody {
    enabled: bool,
}

async fn wifi_radio(Json(body): Json<EnabledBody>) -> Response {
    match backend().wifi_radio(body.enabled).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => failed(e),
    }
}

/// A password for a new hotspot: 10 characters with no look-alikes (no
/// `0/o`, `1/l/i`), so it can be read off the screen and typed on a phone.
fn proposed_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    random_bytes::<10>()
        .iter()
        .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
        .collect()
}

/// `GET /api/control-panel/wifi/hotspot` — the saved hotspot, or a proposal
/// (`proposed: true`): SSID `sws-<the initial PIN>`, the same suffix as the
/// device's network name, and a random password. Never the PIN as password:
/// anyone who sees the MAC knows it.
async fn hotspot() -> Response {
    let (h, proposed) = match backend().hotspot().await {
        Ok(Some(h)) => (h, false),
        Ok(None) => (
            Hotspot {
                enabled: false,
                ssid: format!("sws-{}", initial_pin().unwrap_or_else(|| "device".into())),
                password: proposed_password(),
            },
            true,
        ),
        Err(e) => return failed(e),
    };
    Json(json!({
        "enabled": h.enabled,
        "ssid": h.ssid,
        "password": h.password,
        "proposed": proposed,
        "qr": backend::wifi_qr(&h.ssid, &h.password),
    }))
    .into_response()
}

async fn set_hotspot(State(s): State<AppState>, Json(h): Json<Hotspot>) -> Response {
    if let Err(e) = h.validate() {
        return bad_request(e);
    }
    match backend().set_hotspot(&h).await {
        Ok(()) => {
            s.audit.log(
                "control_panel.hotspot",
                None,
                json!({"enabled": h.enabled, "ssid": h.ssid}),
            );
            Json(json!({"confirm_within_secs": CONFIRM_WITHIN_SECS})).into_response()
        }
        Err(e) => failed(e),
    }
}

// ── Display ─────────────────────────────────────────────────────────────────

/// The device's own settings, which no deploy rewrites:
/// `<config>/control_panel.json`. Today only the brightness, which wins over
/// the project's (`pannello.luminosita`) until it is set back to `null`
/// (decision of the maintainer, 14-11-2026).
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize, Deserialize)]
pub struct DeviceSettings {
    #[serde(default)]
    pub brightness: Option<u8>,
}

/// Below 5 % many screens are already dark: same floor as the project.
const MIN_BRIGHTNESS: u8 = 5;

impl DeviceSettings {
    const FILE: &'static str = "control_panel.json";

    pub fn load(config_dir: &std::path::Path) -> Self {
        std::fs::read_to_string(config_dir.join(Self::FILE))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &std::path::Path) -> std::io::Result<()> {
        let path = config_dir.join(Self::FILE);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)
    }
}

async fn display(State(s): State<AppState>) -> Response {
    Json(DeviceSettings::load(&s.config_dir)).into_response()
}

/// `PUT /api/control-panel/display` `{brightness: 5-100 | null}`.
async fn set_display(State(s): State<AppState>, Json(body): Json<DeviceSettings>) -> Response {
    if let Some(b) = body.brightness {
        if !(MIN_BRIGHTNESS..=100).contains(&b) {
            return bad_request(format!(
                "brightness {b} is not between {MIN_BRIGHTNESS} and 100"
            ));
        }
        if let Err(e) = backend().apply_brightness(b).await {
            return failed(e);
        }
    }
    let mut settings = DeviceSettings::load(&s.config_dir);
    settings.brightness = body.brightness;
    if let Err(e) = settings.save(&s.config_dir) {
        return failed(format!("cannot save the brightness: {e}"));
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn start_touch_calibration(State(s): State<AppState>) -> Response {
    s.audit
        .log("control_panel.touch_calibration", None, json!({}));
    match backend().start_touch_calibration().await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(e) => failed(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_settings_round_trip() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(DeviceSettings::load(d.path()), DeviceSettings::default());
        let s = DeviceSettings {
            brightness: Some(40),
        };
        s.save(d.path()).unwrap();
        assert_eq!(DeviceSettings::load(d.path()), s);
    }

    #[test]
    fn a_proposed_password_has_no_look_alikes() {
        let p = proposed_password();
        assert_eq!(p.len(), 10);
        assert!(!p.contains(['0', 'o', '1', 'l', 'i']));
        assert!(backend::validate_psk(&p).is_ok());
    }
}
