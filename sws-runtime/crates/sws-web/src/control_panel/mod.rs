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

pub mod about;
pub mod backend;
pub mod dbus;
pub mod diagnostics;
pub mod pin;
pub mod reset;

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
use backend::{
    Backend, Hotspot, Ipv4Change, PanelCornerOptions, RebootCorner, RebootCornerOptions,
    TimeChange, WifiConnect, CONFIRM_WITHIN_SECS,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sws_core::project::ControlPanelConfig;

/// The header that carries the service session.
pub const SESSION_HEADER: &str = "x-sws-control-panel";
/// On a request the panel makes by itself (the cards read again every few
/// seconds, to see a Wi-Fi dongle come and go): the session must be valid, but
/// the request does not count as use, or an open panel would never lock.
pub const WATCH_HEADER: &str = "x-sws-control-panel-watch";

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

/// What the project asks of the system, applied where the setting is the
/// system's. Called when a project starts or changes.
///
/// - **The reboot corner.** On PixsysOS it is in `Config1`: a project that
///   does not allow one switches it off there (maintainer, 15-11-2026: «lo
///   spegne in PixsysOS»). Where the viewer watches the corner there is nothing
///   to do: the status stops handing it out.
/// - **The rotation.** On PixsysOS a portrait project, or a device set upside
///   down, is a rotation of the system, which restarts the panel once.
pub async fn enforce_project(config_dir: &std::path::Path, project_dir: &std::path::Path) {
    let project = sws_core::project::Project::load(project_dir).ok();
    let allowed = project
        .as_ref()
        .and_then(|p| p.control_panel.clone())
        .unwrap_or_default()
        .reboot_corner_enabled;
    if !allowed && !backend().reboot_corner_by_viewer() {
        // No answer: this system has no corner of its own.
        match backend().reboot_corner().await {
            Ok(RebootCorner::None) | Err(_) => {}
            Ok(corner) => match backend().set_reboot_corner(RebootCorner::None).await {
                Ok(()) => tracing::info!(
                    ?corner,
                    "control panel: the project allows no reboot corner, switched off in the system"
                ),
                Err(e) => tracing::warn!(
                    "control panel: cannot switch the system's reboot corner off: {e}"
                ),
            },
        }
    }
    let portrait = project
        .and_then(|p| p.page_layout)
        .and_then(|l| l.orientation)
        == Some(sws_core::project::Orientation::Portrait);
    enforce_rotation(config_dir, portrait).await;
}

/// Quarter turns clockwise the picture must sit at: a portrait project is one,
/// a device mounted upside down adds two.
pub fn wanted_rotation(portrait: bool, flipped: bool) -> u32 {
    u32::from(portrait) + 2 * u32::from(flipped)
}

/// How long a rotation already asked for is waited for before asking again.
const ROTATION_RETRY_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, PartialEq, Eq)]
pub enum RotationStep {
    /// The system is already there.
    Nothing,
    /// Ask the system: it restarts the panel.
    Write,
    /// Asked a moment ago and not there yet: not again, or a system that does
    /// not take the value would restart the panel in a loop.
    Waiting,
}

pub fn rotation_step(
    current: u32,
    wanted: u32,
    last: Option<(u32, u64)>,
    now_ms: u64,
) -> RotationStep {
    if current == wanted {
        RotationStep::Nothing
    } else if matches!(last, Some((w, at)) if w == wanted && now_ms.saturating_sub(at) < ROTATION_RETRY_MS)
    {
        RotationStep::Waiting
    } else {
        RotationStep::Write
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Brings PixsysOS' rotation to what the project and the device ask. Writes only
/// when it differs: after the restart it is there, and nothing happens again.
pub async fn enforce_rotation(config_dir: &std::path::Path, portrait: bool) {
    if !backend().rotation_by_system().await {
        return;
    }
    let Ok(current) = backend().system_rotation().await else {
        return;
    };
    let mut settings = DeviceSettings::load(config_dir);
    let wanted = wanted_rotation(portrait, settings.flipped);
    match rotation_step(current, wanted, settings.rotation_attempt, now_ms()) {
        RotationStep::Nothing => {}
        RotationStep::Waiting => tracing::warn!(
            current,
            wanted,
            "control panel: the rotation was asked a moment ago and the system is not there"
        ),
        RotationStep::Write => {
            // Written down first: the system restarts the panel on this call.
            settings.rotation_attempt = Some((wanted, now_ms()));
            if let Err(e) = settings.save(config_dir) {
                tracing::warn!("control panel: cannot note the rotation asked: {e}");
                return;
            }
            tracing::info!(
                current,
                wanted,
                "control panel: rotating the screen, the panel restarts"
            );
            if let Err(e) = backend().set_system_rotation(wanted).await {
                tracing::warn!("control panel: cannot rotate the screen: {e}");
            }
        }
    }
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
        .route("/api/control-panel/about", get(about::about))
        .route("/api/control-panel/diagnostics", get(diagnostics::download))
        .route(
            "/api/control-panel/diagnostics/usb",
            post(diagnostics::to_usb),
        )
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
        .route("/api/control-panel/reset", post(reset::reset))
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
        .route("/api/control-panel/reboot-corner", put(set_reboot_corner))
        .route("/api/control-panel/panel-corner", put(set_panel_corner))
        .route("/api/control-panel/flip", put(set_flip))
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
    let settings = DeviceSettings::load(&s.config_dir);
    Json(json!({
        // The master, as before; and the two ways already composed with it.
        "enabled": cfg.enabled,
        "gesture_enabled": cfg.gesture(),
        "button_enabled": cfg.button(),
        "pin": pin::pin_source(cfg.pin_hash.as_deref(), initial.as_deref()),
        // Public because the viewer applies it before anyone opens the panel.
        "brightness": settings.brightness,
        "panel_corner": settings.panel_corner,
        "panel_corner_options": settings.panel_corner_options,
        // Read by the viewer that turns the picture itself.
        "flipped": settings.flipped,
        // Only where the viewer is the one that watches the corner, and the
        // project allows one.
        "reboot_corner": (backend().reboot_corner_by_viewer() && cfg.reboot_corner_enabled).then(|| json!({
            "corner": settings.reboot_corner,
            "options": settings.reboot_corner_options,
        })),
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
    let watch = req.headers().contains_key(WATCH_HEADER);
    let now = Instant::now();
    {
        let mut g = gate().lock().unwrap();
        match g.sessions.get_mut(&token) {
            Some(last) if now.duration_since(*last) < SESSION_IDLE => {
                if !watch {
                    *last = now;
                }
            }
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
    if let Some(Err(e)) = change.ntp_servers.as_ref().map(|n| n.validate()) {
        return bad_request(e);
    }
    match backend().set_time(&change).await {
        Ok(()) => {
            s.audit.log(
                "control_panel.time",
                None,
                json!({ "ntp_servers": change.ntp_servers }),
            );
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
/// `<config>/control_panel.json`. The brightness wins over the project's
/// (`pannello.luminosita`) until it is set back to `null` (decision of the
/// maintainer, 14-11-2026). The reboot corner is here only where the viewer
/// watches it (Tiny TY): on PixsysOS it is the system's. The corner that opens
/// the panel is the viewers' on every device.
#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
pub struct DeviceSettings {
    #[serde(default)]
    pub brightness: Option<u8>,
    /// The corner that opens the control panel when held; `none` leaves the
    /// button at start-up as the only way in.
    #[serde(default = "default_panel_corner")]
    pub panel_corner: RebootCorner,
    #[serde(default)]
    pub panel_corner_options: PanelCornerOptions,
    /// The device is mounted upside down: the viewer that owns the glass
    /// turns the picture 180° (on top of the project's orientation).
    #[serde(default)]
    pub flipped: bool,
    /// The last rotation written to PixsysOS and when (ms): without it a system
    /// that does not take the value would be asked, and restarted, at every start.
    #[serde(default)]
    pub rotation_attempt: Option<(u32, u64)>,
    #[serde(default)]
    pub reboot_corner: RebootCorner,
    #[serde(default)]
    pub reboot_corner_options: RebootCornerOptions,
}

fn default_panel_corner() -> RebootCorner {
    RebootCorner::TopRight
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            brightness: None,
            panel_corner: default_panel_corner(),
            panel_corner_options: PanelCornerOptions::default(),
            flipped: false,
            rotation_attempt: None,
            reboot_corner: RebootCorner::default(),
            reboot_corner_options: RebootCornerOptions::default(),
        }
    }
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

/// `GET /api/control-panel/display` → `{brightness, panel_corner, reboot_corner,
/// reboot_corner_options}`: the corner wherever it lives, the options only
/// where the viewer watches it (`null` on PixsysOS, which has its own).
async fn display(State(s): State<AppState>) -> Response {
    let settings = DeviceSettings::load(&s.config_dir);
    let allowed = project_config(&s).await.reboot_corner_enabled;
    let by_viewer = backend().reboot_corner_by_viewer();
    let rotation_by_viewer = backend().rotation_by_viewer();
    let rotation_by_system = !rotation_by_viewer && backend().rotation_by_system().await;
    let corner = if by_viewer {
        settings.reboot_corner
    } else {
        backend().reboot_corner().await.unwrap_or_default()
    };
    Json(json!({
        "brightness": settings.brightness,
        "panel_corner": settings.panel_corner,
        "panel_corner_options": settings.panel_corner_options,
        // `null` where nobody turns the screen. Under PixsysOS the change
        // restarts the panel: `flipped_restarts` lets the card say so.
        "flipped": (rotation_by_viewer || rotation_by_system).then_some(settings.flipped),
        "flipped_restarts": rotation_by_system,
        "reboot_corner": corner,
        // `false`: the project switched the corner off; the card says so.
        "reboot_corner_allowed": allowed,
        "reboot_corner_options": by_viewer.then_some(settings.reboot_corner_options),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct RebootCornerBody {
    corner: RebootCorner,
    #[serde(default)]
    options: Option<RebootCornerOptions>,
}

/// `PUT /api/control-panel/reboot-corner` `{corner, options?}`.
async fn set_reboot_corner(
    State(s): State<AppState>,
    Json(body): Json<RebootCornerBody>,
) -> Response {
    if let Some(Err(e)) = body.options.map(|o| o.validate()) {
        return bad_request(e);
    }
    if body.corner != RebootCorner::None && !project_config(&s).await.reboot_corner_enabled {
        return bad_request("the project does not allow a reboot corner".into());
    }
    // Two long presses cannot share a corner.
    if body.corner != RebootCorner::None
        && body.corner == DeviceSettings::load(&s.config_dir).panel_corner
    {
        return bad_request("that corner opens the control panel".into());
    }
    s.audit.log(
        "control_panel.reboot_corner",
        None,
        json!({ "corner": body.corner, "options": body.options }),
    );
    if backend().reboot_corner_by_viewer() {
        let mut settings = DeviceSettings::load(&s.config_dir);
        settings.reboot_corner = body.corner;
        if let Some(o) = body.options {
            settings.reboot_corner_options = o;
        }
        if let Err(e) = settings.save(&s.config_dir) {
            return failed(format!("cannot save the reboot corner: {e}"));
        }
    } else if let Err(e) = backend().set_reboot_corner(body.corner).await {
        return failed(e);
    }
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
struct FlipBody {
    flipped: bool,
}

/// `PUT /api/control-panel/flip` `{flipped}`: the device mounted upside down.
/// Where the viewer turns the picture itself it turns at once and the boot
/// image follows; under PixsysOS the system turns it and **restarts the panel**.
async fn set_flip(State(s): State<AppState>, Json(body): Json<FlipBody>) -> Response {
    let by_viewer = backend().rotation_by_viewer();
    if !by_viewer && !backend().rotation_by_system().await {
        return bad_request("nothing turns the screen on this device".into());
    }
    s.audit.log(
        "control_panel.flip",
        None,
        json!({ "flipped": body.flipped }),
    );
    let mut settings = DeviceSettings::load(&s.config_dir);
    settings.flipped = body.flipped;
    if let Err(e) = settings.save(&s.config_dir) {
        return failed(format!("cannot save the rotation: {e}"));
    }
    let dir = active_dir(&s).await.ok();
    if by_viewer {
        if let Some(dir) = dir {
            crate::boot_image::publish(&s.config_dir, &dir, crate::boot_image::Occasione::Modifica)
                .await;
        }
    } else {
        let portrait = dir
            .and_then(|d| sws_core::project::Project::load(&d).ok())
            .and_then(|p| p.page_layout)
            .and_then(|l| l.orientation)
            == Some(sws_core::project::Orientation::Portrait);
        enforce_rotation(&s.config_dir, portrait).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
struct PanelCornerBody {
    corner: RebootCorner,
    #[serde(default)]
    options: Option<PanelCornerOptions>,
}

/// `PUT /api/control-panel/panel-corner` `{corner}`: where a held finger opens
/// the panel, or `none`.
async fn set_panel_corner(
    State(s): State<AppState>,
    Json(body): Json<PanelCornerBody>,
) -> Response {
    if let Some(Err(e)) = body.options.map(|o| o.validate()) {
        return bad_request(e);
    }
    let mut settings = DeviceSettings::load(&s.config_dir);
    let reboot = if backend().reboot_corner_by_viewer() {
        settings.reboot_corner
    } else {
        backend().reboot_corner().await.unwrap_or_default()
    };
    if body.corner != RebootCorner::None && body.corner == reboot {
        return bad_request("that corner reboots the device".into());
    }
    s.audit.log(
        "control_panel.panel_corner",
        None,
        json!({ "corner": body.corner, "options": body.options }),
    );
    settings.panel_corner = body.corner;
    if let Some(o) = body.options {
        settings.panel_corner_options = o;
    }
    if let Err(e) = settings.save(&s.config_dir) {
        return failed(format!("cannot save the panel corner: {e}"));
    }
    StatusCode::NO_CONTENT.into_response()
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
            panel_corner: RebootCorner::None,
            panel_corner_options: PanelCornerOptions {
                hold_secs: 3,
                size_px: 120,
            },
            flipped: true,
            rotation_attempt: Some((3, 1_000)),
            reboot_corner: RebootCorner::BottomRight,
            reboot_corner_options: Default::default(),
        };
        s.save(d.path()).unwrap();
        assert_eq!(DeviceSettings::load(d.path()), s);
        // A file from before the panel's corner could be moved: top right.
        std::fs::write(d.path().join(DeviceSettings::FILE), r#"{"brightness":40}"#).unwrap();
        assert_eq!(
            DeviceSettings::load(d.path()).panel_corner,
            RebootCorner::TopRight
        );
    }

    #[test]
    fn the_rotation_is_asked_once_and_never_in_a_loop() {
        // Project and device add up in quarter turns clockwise.
        assert_eq!(wanted_rotation(false, false), 0);
        assert_eq!(wanted_rotation(true, false), 1);
        assert_eq!(wanted_rotation(false, true), 2);
        assert_eq!(wanted_rotation(true, true), 3);
        let min = 60_000;
        // Already there: nothing, whatever was asked before.
        assert_eq!(rotation_step(1, 1, None, 0), RotationStep::Nothing);
        assert_eq!(
            rotation_step(1, 1, Some((1, 0)), min),
            RotationStep::Nothing
        );
        // Not there, never asked: ask.
        assert_eq!(rotation_step(0, 1, None, 0), RotationStep::Write);
        // Asked a moment ago and the system is still at the old value: wait.
        assert_eq!(
            rotation_step(0, 1, Some((1, 0)), 2 * min),
            RotationStep::Waiting
        );
        // Long enough: ask again. And a different value is a new request.
        assert_eq!(
            rotation_step(0, 1, Some((1, 0)), 11 * min),
            RotationStep::Write
        );
        assert_eq!(
            rotation_step(0, 2, Some((1, 0)), 2 * min),
            RotationStep::Write
        );
    }

    #[test]
    fn a_proposed_password_has_no_look_alikes() {
        let p = proposed_password();
        assert_eq!(p.len(), 10);
        assert!(!p.contains(['0', 'o', '1', 'l', 'i']));
        assert!(backend::validate_psk(&p).is_ok());
    }
}
