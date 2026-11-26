//! The device control panel: network, time, information and reboot of the
//! operating system under SWS, from the device's own screen.
//!
//! Plan `docs/archive/2026-11-13-pannello-di-controllo.md`. It exists because on
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
    extract::{FromRequestParts, Path, State},
    http::{request::Parts, HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Extension, Json, Router,
};
use backend::{
    Backend, Hotspot, Ipv4Change, PanelCornerOptions, RebootCorner, RebootCornerOptions,
    TimeChange, WifiConnect, CONFIRM_WITHIN_SECS,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sws_core::project::ControlPanelConfig;

/// The header that carries the service session.
pub const SESSION_HEADER: &str = "x-sws-control-panel";
/// On a request the panel makes by itself (the cards read again every few
/// seconds, to see a Wi-Fi dongle come and go): the session must be valid, but
/// the request does not count as use, or an open panel would never lock.
pub const WATCH_HEADER: &str = "x-sws-control-panel-watch";

/// Set by [`crate::schermo::dal_gateway`] on everything it forwards to the
/// operator page: the request comes from the cloud's remote screen, even though
/// it reaches the viewer port from 127.0.0.1.
pub const REMOTE_SCREEN_HEADER: &str = "x-sws-remote-screen";
/// The cloud user behind the remote screen. The gateway sets it and removes one
/// sent by the browser; the panel reads it only on a remote-screen request.
pub const REMOTE_USER_HEADER: &str = "x-sws-remote-user";

/// The port the panel's routes are mounted on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Listener {
    /// The operator page's port: the one the device's screen uses.
    Viewer,
    /// The management port, and the instance's full router.
    Management,
}

/// Where a request comes from (18-11-2026, decisions D13-D16 of the CRA
/// sessions). The device's PIN and the pairing code count only on the screen,
/// the lockout is counted per origin, and the reset from the cloud keeps the
/// pairing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Origin {
    /// The device's own screen: the viewer port, from the loopback, not
    /// forwarded from the cloud, and not a page of another site in a browser
    /// on the device. The kiosk and the LVGL viewers call
    /// `https://localhost:7443` or `127.0.0.1`.
    Screen,
    /// The cloud's remote screen: the viewer port, from the loopback, with the
    /// header that `dal_gateway` puts on what it forwards.
    RemoteScreen,
    /// The management port from the loopback: the cloud tunnel (signed or
    /// not: a panel declared by hand on the gateway gets no signature), or a
    /// process on the device. Treated like the remote screen for the reset.
    Tunnel,
    /// Anything else, by address: the LAN, a container installed with
    /// `--bridge`, a page of another site in a browser on the device.
    Network(IpAddr),
}

impl Origin {
    pub fn name(self) -> &'static str {
        match self {
            Origin::Screen => "screen",
            Origin::RemoteScreen => "remote_screen",
            Origin::Tunnel => "tunnel",
            Origin::Network(_) => "network",
        }
    }

    /// For the audit log: the address when there is one.
    fn describe(self) -> String {
        match self {
            Origin::Network(ip) => format!("network {ip}"),
            other => other.name().into(),
        }
    }

    /// From the cloud: the full reset is refused, it would leave a code that
    /// can be read only on site (D14).
    pub fn from_the_cloud(self) -> bool {
        matches!(self, Origin::RemoteScreen | Origin::Tunnel)
    }
}

/// A page of another site, in a browser on the device: it reaches 127.0.0.1
/// like the kiosk does, and the runtime answers it (CORS is open on the viewer
/// port). The browser says so: `Sec-Fetch-Site` other than `same-origin` and
/// `none`, or an `Origin` that is not the device itself. The kiosk's own page,
/// the LVGL viewers (no such headers) and the installers are not.
fn foreign_page(headers: &HeaderMap) -> bool {
    let text = |h: &str| headers.get(h).and_then(|v| v.to_str().ok());
    if let Some(site) = text("sec-fetch-site") {
        if site != "same-origin" && site != "none" {
            return true;
        }
    }
    match text("origin") {
        None => false,
        Some(o) => {
            let host = o
                .split_once("://")
                .map_or(o, |(_, rest)| rest)
                .rsplit_once(':')
                .map_or_else(|| o.split_once("://").map_or(o, |(_, r)| r), |(h, _)| h);
            !matches!(host, "localhost" | "127.0.0.1" | "[::1]")
        }
    }
}

/// The origin of a request. Without the caller's address (a test, or a server
/// that does not record it) it is the network: never more trust than known.
pub fn origin(listener: Listener, peer: Option<SocketAddr>, headers: &HeaderMap) -> Origin {
    let Some(peer) = peer else {
        return Origin::Network(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    };
    let ip = peer.ip().to_canonical();
    if !ip.is_loopback() || foreign_page(headers) {
        return Origin::Network(ip);
    }
    match listener {
        Listener::Viewer if headers.contains_key(REMOTE_SCREEN_HEADER) => Origin::RemoteScreen,
        Listener::Viewer => Origin::Screen,
        Listener::Management => Origin::Tunnel,
    }
}

#[axum::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for Origin {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let listener = parts
            .extensions
            .get::<Listener>()
            .copied()
            .unwrap_or(Listener::Management);
        let peer = parts.extensions.get::<SocketAddr>().copied();
        Ok(origin(listener, peer, &parts.headers))
    }
}

/// The cloud user of a remote-screen request, for the audit log.
fn remote_user(origin: Origin, headers: &HeaderMap) -> Option<String> {
    (origin == Origin::RemoteScreen)
        .then(|| headers.get(REMOTE_USER_HEADER)?.to_str().ok())
        .flatten()
        .map(|u| format!("cloud:{u}"))
}

/// How long a service session lasts without being used.
const SESSION_IDLE: Duration = Duration::from_secs(15 * 60);
/// Wrong PINs before an origin stops being listened to for [`LOCKOUT`].
const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);
/// Mistakes are forgotten this long after the last one: whoever tries a PIN a
/// minute, under the lockout, still adds up.
const FORGET_AFTER: Duration = Duration::from_secs(15 * 60);
/// PIN attempts from the network as a whole, per minute. Counted per address
/// alone, many addresses would multiply both the guesses and the password
/// checks; past this the network waits, and the screen, the remote screen and
/// the tunnel do not.
const NETWORK_ATTEMPTS_PER_MINUTE: u32 = 30;
/// Network addresses followed at once. With the cap above the table does not
/// fill in fifteen minutes; if it does, a new address waits like the rest of
/// the network.
const MAX_ORIGINS: usize = 512;

struct Session {
    last_use: Instant,
    /// A session opened from the screen is not good from the network.
    origin: Origin,
}

#[derive(Default)]
struct Attempts {
    failures: u32,
    last_failure: Option<Instant>,
    locked_until: Option<Instant>,
}

/// Sessions and failed attempts. In memory on purpose: a restart closes every
/// session and forgets the attempts, as in `sws-auth`. The attempts are counted
/// per origin (D15): whoever tries PINs from the network locks out only
/// themselves, never the person in front of the screen.
#[derive(Default)]
struct Gate {
    sessions: HashMap<String, Session>,
    attempts: HashMap<Origin, Attempts>,
    /// The network's attempts in the current minute.
    network_window: Option<(Instant, u32)>,
}

/// What an attempt led to, counted before the PIN is checked.
#[derive(Debug, PartialEq)]
enum Attempt {
    Counted,
    /// This attempt reached [`MAX_FAILURES`]: if it is wrong, the origin is
    /// locked out from now.
    Locking,
}

impl Gate {
    /// Before the PIN is checked: refused while the origin is locked, or while
    /// the network has used its minute; otherwise the attempt counts as a
    /// mistake until it proves right ([`Gate::succeed`]), so attempts made at
    /// the same moment cannot all pass the check.
    fn attempt(&mut self, origin: Origin, now: Instant) -> Result<Attempt, u64> {
        self.forget_stale(now);
        if let Some(until) = self
            .attempts
            .get(&origin)
            .and_then(|a| a.locked_until)
            .filter(|t| *t > now)
        {
            return Err(until.duration_since(now).as_secs().max(1));
        }
        if let Origin::Network(_) = origin {
            let (start, n) = match self.network_window {
                Some((start, n)) if now.duration_since(start) < LOCKOUT => (start, n),
                _ => (now, 0),
            };
            if n >= NETWORK_ATTEMPTS_PER_MINUTE {
                return Err(LOCKOUT
                    .saturating_sub(now.duration_since(start))
                    .as_secs()
                    .max(1));
            }
            if !self.attempts.contains_key(&origin) && self.attempts.len() >= MAX_ORIGINS {
                return Err(LOCKOUT.as_secs());
            }
            self.network_window = Some((start, n + 1));
        }
        let a = self.attempts.entry(origin).or_default();
        a.failures += 1;
        a.last_failure = Some(now);
        if a.failures >= MAX_FAILURES {
            a.failures = 0;
            a.locked_until = Some(now + LOCKOUT);
            Ok(Attempt::Locking)
        } else {
            Ok(Attempt::Counted)
        }
    }

    /// The PIN was right: the origin starts again from zero.
    fn succeed(&mut self, origin: Origin) {
        self.attempts.remove(&origin);
    }

    /// An origin whose last mistake is older than [`FORGET_AFTER`], and that is
    /// not locked, starts again from zero.
    fn forget_stale(&mut self, now: Instant) {
        self.attempts.retain(|_, a| {
            a.locked_until.is_some_and(|t| t > now)
                || a.last_failure
                    .is_some_and(|t| now.duration_since(t) < FORGET_AFTER)
        });
    }
}

fn gate() -> &'static Mutex<Gate> {
    static GATE: OnceLock<Mutex<Gate>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}

fn too_many(secs: u64) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({ "retry_after_secs": secs })),
    )
        .into_response()
}

/// Checks `typed` from `origin`, with the gate around it: `Ok(true)` right,
/// `Ok(false)` wrong (written in the audit log, as the lockout it caused: the
/// CRA asks to record possible unauthorised access), `Err` the answer to give
/// while the origin waits.
async fn checked_pin(
    s: &AppState,
    origin: Origin,
    headers: &HeaderMap,
    typed: &str,
    action: &str,
) -> Result<bool, Response> {
    let attempt = gate()
        .lock()
        .unwrap()
        .attempt(origin, Instant::now())
        .map_err(too_many)?;
    if pin_ok(s, origin, typed).await {
        gate().lock().unwrap().succeed(origin);
        return Ok(true);
    }
    let who = remote_user(origin, headers);
    tracing::warn!(origin = %origin.describe(), action, "control panel: wrong PIN");
    s.audit.log(
        "control_panel.pin_wrong",
        who.clone(),
        json!({ "origin": origin.describe(), "action": action }),
    );
    if attempt == Attempt::Locking {
        tracing::warn!(origin = %origin.describe(), secs = LOCKOUT.as_secs(), "control panel: locked out");
        s.audit.log(
            "control_panel.locked",
            who,
            json!({ "origin": origin.describe(), "secs": LOCKOUT.as_secs() }),
        );
    }
    Ok(false)
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

/// The rotation asked and not there yet, while its retry window is open.
pub fn pending_rotation(current: u32, last: Option<(u32, u64)>, now_ms: u64) -> Option<u32> {
    match last {
        Some((w, at)) if w != current && now_ms.saturating_sub(at) < ROTATION_RETRY_MS => Some(w),
        _ => None,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// The system's rotation as the deploy needs it (rc.30): `None` where the
/// system does not turn the screen, or does not answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenRotation {
    /// Quarter turns clockwise, as the system has it now.
    pub current: u32,
    /// The device is mounted upside down (the control panel's «Flipped»).
    pub flipped: bool,
    /// A rotation already asked and still on its way (`rotation_attempt`,
    /// inside its retry window): a second deploy must not ask it again
    /// (review of the rc.30).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<u32>,
}

pub async fn screen_rotation(config_dir: &std::path::Path) -> Option<ScreenRotation> {
    if !backend().rotation_by_system().await {
        return None;
    }
    let current = backend().system_rotation().await.ok()?;
    let settings = DeviceSettings::load(config_dir);
    Some(ScreenRotation {
        current,
        flipped: settings.flipped,
        pending: pending_rotation(current, settings.rotation_attempt, now_ms()),
    })
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

/// The panel's routes, for the router of `listener`: only the viewer port can
/// be the device's screen.
pub fn routes(listener: Listener) -> Router<AppState> {
    let open = Router::new()
        .route("/api/control-panel", get(status))
        .route("/api/control-panel/session", post(open_session));
    let guarded = Router::new()
        .route("/api/control-panel/capabilities", get(capabilities))
        .route("/api/control-panel/info", get(info))
        .route("/api/control-panel/about", get(about::about))
        .route("/api/control-panel/openplc", get(openplc))
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
        .route("/api/control-panel/firewall", get(firewall))
        .route("/api/control-panel/firewall/apply", post(firewall_apply))
        .route(
            "/api/control-panel/firewall/confirm",
            post(firewall_confirm),
        )
        .route(
            "/api/control-panel/firewall/rollback",
            post(firewall_rollback),
        )
        .route_layer(middleware::from_fn(require_session));
    open.merge(guarded).layer(Extension(listener))
}

/// `GET /api/control-panel` — public: whether the project shows the gesture
/// and the action, and which PIN counts from where the request comes. Never
/// the PIN itself.
async fn status(State(s): State<AppState>, origin: Origin) -> Response {
    let cfg = project_config(&s).await;
    let initial = initial_pin();
    let settings = DeviceSettings::load(&s.config_dir);
    Json(json!({
        // The master, as before; and the two ways already composed with it.
        "enabled": cfg.enabled,
        "gesture_enabled": cfg.gesture(),
        "button_enabled": cfg.button(),
        "pin": pin::pin_source(cfg.pin_hash.as_deref(), initial.as_deref(), origin == Origin::Screen),
        // `screen`, `remote_screen`, `network`: the reset from the cloud keeps
        // the pairing, and the screens say why the device's PIN does not count.
        "origin": origin.name(),
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

/// Whether `typed` opens the panel from `origin`: the device's PIN only from
/// the screen (D13).
async fn pin_ok(s: &AppState, origin: Origin, typed: &str) -> bool {
    let cfg = project_config(s).await;
    let typed = typed.to_string();
    // Argon2 off the async workers: a burst of attempts must not stall the
    // runtime's other requests.
    tokio::task::spawn_blocking(move || {
        pin::pin_matches(
            &typed,
            cfg.pin_hash.as_deref(),
            initial_pin().as_deref(),
            origin == Origin::Screen,
        )
    })
    .await
    .unwrap_or(false)
}

/// `POST /api/control-panel/session` `{pin}` → `{token, idle_secs}`.
async fn open_session(
    State(s): State<AppState>,
    origin: Origin,
    headers: HeaderMap,
    Json(body): Json<PinBody>,
) -> Response {
    match checked_pin(&s, origin, &headers, &body.pin, "session").await {
        Err(wait) => return wait,
        Ok(false) => return StatusCode::UNAUTHORIZED.into_response(),
        Ok(true) => {}
    }
    let now = Instant::now();
    let token = new_token();
    {
        let mut g = gate().lock().unwrap();
        g.sessions
            .retain(|_, v| now.duration_since(v.last_use) < SESSION_IDLE);
        g.sessions.insert(
            token.clone(),
            Session {
                last_use: now,
                origin,
            },
        );
    }
    tracing::info!(origin = %origin.describe(), "control panel: service session opened");
    s.audit.log(
        "control_panel.session_opened",
        remote_user(origin, &headers),
        json!({ "origin": origin.describe() }),
    );
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
    let listener = req
        .extensions()
        .get::<Listener>()
        .copied()
        .unwrap_or(Listener::Management);
    let here = origin(
        listener,
        req.extensions().get::<SocketAddr>().copied(),
        req.headers(),
    );
    let now = Instant::now();
    {
        let mut g = gate().lock().unwrap();
        match g.sessions.get_mut(&token) {
            Some(v) if now.duration_since(v.last_use) < SESSION_IDLE && v.origin == here => {
                if !watch {
                    v.last_use = now;
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

async fn capabilities(State(s): State<AppState>) -> Response {
    let mut caps = serde_json::to_value(backend().capabilities().await).unwrap_or_default();
    // The OpenPLC section, where the installation put it (D20).
    caps["openplc"] = json!(crate::openplc::installed(&s.config_dir));
    // The Firewall section, where firewalld runs (26-11-2026).
    caps["firewall"] = json!(crate::firewall::available().await);
    Json(caps).into_response()
}

/// Who changes the firewall from the control panel, for the audit log: the
/// cloud user from the remote screen, otherwise where the request came from.
fn firewall_actor(origin: Origin, headers: &HeaderMap) -> Option<String> {
    remote_user(origin, headers).or_else(|| Some(format!("control-panel:{}", origin.describe())))
}

async fn firewall(State(s): State<AppState>) -> Response {
    crate::firewall::http::get(&s).await
}

/// `POST /api/control-panel/firewall/apply` — applied at once, undone after
/// [`CONFIRM_WITHIN_SECS`] unless `POST …/firewall/confirm` arrives.
async fn firewall_apply(
    State(s): State<AppState>,
    origin: Origin,
    headers: HeaderMap,
    Json(change): Json<crate::firewall::Change>,
) -> Response {
    crate::firewall::http::apply(&s, change, firewall_actor(origin, &headers)).await
}

async fn firewall_confirm(
    State(s): State<AppState>,
    origin: Origin,
    headers: HeaderMap,
) -> Response {
    crate::firewall::http::confirm(&s, firewall_actor(origin, &headers)).await
}

async fn firewall_rollback(
    State(s): State<AppState>,
    origin: Origin,
    headers: HeaderMap,
) -> Response {
    crate::firewall::http::rollback(&s, firewall_actor(origin, &headers)).await
}

/// `GET /api/control-panel/openplc` — the OpenPLC on this device, with the
/// Editor's credentials, behind the service PIN (decision D20 of the CRA
/// sessions, 18-11-2026).
async fn openplc(State(s): State<AppState>) -> Response {
    Json(crate::openplc::panel_view(&s.config_dir).await).into_response()
}

/// `GET /api/control-panel/info` — what the device is. The initial PIN only
/// while the project has none of its own, and only to the screen: then it is
/// the one to write down, and nowhere else does it open anything.
async fn info(State(s): State<AppState>, origin: Origin) -> Response {
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
        "sws_version": sws_core::project::runtime_version(),
        "initial_pin": if cfg.pin_hash.is_none() && origin == Origin::Screen { initial_pin() } else { None },
        // The cloud the panel is paired to: the reset can then keep it.
        "cloud": s.abbinamento.tunnel().map(|(name, _)| name),
        // From the cloud's remote screen the reset keeps the pairing (D14).
        "origin": origin.name(),
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
/// The OpenPLC Editor's user gets one too.
pub(crate) fn proposed_password() -> String {
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

    /// The rotation on its way is said while its window is open (review of
    /// the rc.30): a second deploy then does not ask it again.
    #[test]
    fn a_rotation_on_its_way_is_said() {
        assert_eq!(pending_rotation(0, Some((1, 1_000)), 2_000), Some(1));
        assert_eq!(
            pending_rotation(1, Some((1, 1_000)), 2_000),
            None,
            "already there"
        );
        assert_eq!(
            pending_rotation(0, Some((1, 1_000)), 1_000 + ROTATION_RETRY_MS),
            None,
            "window over"
        );
        assert_eq!(pending_rotation(0, None, 2_000), None);
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

#[cfg(test)]
mod origin_tests {
    use super::*;

    fn peer(ip: &str) -> Option<SocketAddr> {
        Some(SocketAddr::new(ip.parse().unwrap(), 40000))
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn the_screen_is_the_viewer_port_from_the_loopback() {
        let none = HeaderMap::new();
        assert_eq!(
            origin(Listener::Viewer, peer("127.0.0.1"), &none),
            Origin::Screen
        );
        assert_eq!(origin(Listener::Viewer, peer("::1"), &none), Origin::Screen);
        assert_eq!(
            origin(Listener::Viewer, peer("::ffff:127.0.0.1"), &none),
            Origin::Screen
        );
        let mut remote = HeaderMap::new();
        remote.insert(REMOTE_SCREEN_HEADER, "1".parse().unwrap());
        assert_eq!(
            origin(Listener::Viewer, peer("127.0.0.1"), &remote),
            Origin::RemoteScreen
        );
        // The tunnel reaches the management port from the loopback.
        assert_eq!(
            origin(Listener::Management, peer("127.0.0.1"), &none),
            Origin::Tunnel
        );
        assert!(Origin::Tunnel.from_the_cloud() && Origin::RemoteScreen.from_the_cloud());
        assert!(!Origin::Screen.from_the_cloud());
        // The LAN is the network, whatever header it sends.
        assert_eq!(
            origin(Listener::Viewer, peer("192.168.0.10"), &remote),
            Origin::Network(ip("192.168.0.10"))
        );
        // A caller nobody recorded is the network.
        assert!(matches!(
            origin(Listener::Viewer, None, &none),
            Origin::Network(_)
        ));
    }

    /// A page of another site, in a browser on the device, reaches 127.0.0.1
    /// too: the browser's own headers say it is not the kiosk's page.
    #[test]
    fn a_foreign_page_in_a_browser_on_the_device_is_the_network() {
        let with = |pairs: &[(&'static str, &str)]| {
            let mut h = HeaderMap::new();
            for (k, v) in pairs {
                h.insert(*k, v.parse().unwrap());
            }
            origin(Listener::Viewer, peer("127.0.0.1"), &h)
        };
        assert!(matches!(
            with(&[("sec-fetch-site", "cross-site")]),
            Origin::Network(_)
        ));
        assert!(matches!(
            with(&[("origin", "https://evil.example")]),
            Origin::Network(_)
        ));
        assert!(matches!(
            with(&[("origin", "http://192.168.1.5:7443")]),
            Origin::Network(_)
        ));
        // The kiosk's own page, and the LVGL viewers that send nothing.
        assert_eq!(
            with(&[
                ("sec-fetch-site", "same-origin"),
                ("origin", "https://127.0.0.1:7443")
            ]),
            Origin::Screen
        );
        assert_eq!(
            with(&[("origin", "https://localhost:7443")]),
            Origin::Screen
        );
        assert_eq!(with(&[("origin", "http://[::1]:7443")]), Origin::Screen);
        assert_eq!(with(&[]), Origin::Screen);
    }

    #[test]
    fn the_cloud_user_is_read_only_on_the_remote_screen() {
        let mut h = HeaderMap::new();
        h.insert(REMOTE_USER_HEADER, "mauro".parse().unwrap());
        assert_eq!(
            remote_user(Origin::RemoteScreen, &h).as_deref(),
            Some("cloud:mauro")
        );
        assert_eq!(remote_user(Origin::Screen, &h), None);
        assert_eq!(remote_user(Origin::Tunnel, &h), None);
        assert_eq!(remote_user(Origin::Network(ip("10.0.0.1")), &h), None);
    }

    #[test]
    fn a_lockout_is_per_origin_and_temporary() {
        let mut g = Gate::default();
        let now = Instant::now();
        let lan = Origin::Network(ip("10.0.0.7"));
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(g.attempt(lan, now), Ok(Attempt::Counted));
        }
        assert_eq!(g.attempt(lan, now), Ok(Attempt::Locking));
        assert!(g.attempt(lan, now).is_err());
        // Whoever tries from the network does not lock out the screen, nor
        // another address.
        assert_eq!(g.attempt(Origin::Screen, now), Ok(Attempt::Counted));
        assert_eq!(
            g.attempt(Origin::Network(ip("10.0.0.8")), now),
            Ok(Attempt::Counted)
        );
        // After the lockout it listens again.
        assert!(g
            .attempt(lan, now + LOCKOUT + Duration::from_secs(1))
            .is_ok());
    }

    /// The attempt counts before the PIN is checked: attempts made at the same
    /// moment cannot all pass, and a right PIN clears the count.
    #[test]
    fn an_attempt_counts_until_it_proves_right() {
        let mut g = Gate::default();
        let now = Instant::now();
        for _ in 0..MAX_FAILURES - 1 {
            g.attempt(Origin::Screen, now).unwrap();
        }
        g.succeed(Origin::Screen);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(g.attempt(Origin::Screen, now), Ok(Attempt::Counted));
        }
    }

    #[test]
    fn slow_mistakes_add_up_and_old_ones_are_forgotten() {
        let t0 = Instant::now();
        let lan = Origin::Network(ip("10.0.0.9"));
        let mut g = Gate::default();
        for i in 0..u64::from(MAX_FAILURES) - 1 {
            let t = t0 + Duration::from_secs(50 * i);
            assert_eq!(g.attempt(lan, t), Ok(Attempt::Counted));
        }
        // One every 50 s stays under the lockout and still adds up.
        let t = t0 + Duration::from_secs(50 * u64::from(MAX_FAILURES - 1));
        assert_eq!(g.attempt(lan, t), Ok(Attempt::Locking));

        let mut g = Gate::default();
        g.attempt(lan, t0).unwrap();
        g.forget_stale(t0 + FORGET_AFTER + Duration::from_secs(1));
        assert!(g.attempts.is_empty());
    }

    /// Many addresses do not multiply the guesses: the network as a whole has
    /// its minute, and the screen and the tunnel keep theirs.
    #[test]
    fn the_network_as_a_whole_has_a_cap() {
        let mut g = Gate::default();
        let now = Instant::now();
        for i in 0..NETWORK_ATTEMPTS_PER_MINUTE {
            let o = Origin::Network(IpAddr::V4(Ipv4Addr::from(0x0a00_0000 + i)));
            assert!(g.attempt(o, now).is_ok());
        }
        assert!(g.attempt(Origin::Network(ip("172.16.0.1")), now).is_err());
        assert!(g.attempt(Origin::Screen, now).is_ok());
        assert!(g.attempt(Origin::Tunnel, now).is_ok());
        assert!(g.attempt(Origin::RemoteScreen, now).is_ok());
        // A minute later the network is heard again.
        assert!(g
            .attempt(Origin::Network(ip("172.16.0.1")), now + LOCKOUT)
            .is_ok());
    }

    /// The routes with a caller of our choosing, as `main.rs` records it.
    async fn serve_as(listener: Listener, caller: &'static str) -> (String, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        std::mem::forget(dir);
        let caller: SocketAddr = SocketAddr::new(caller.parse().unwrap(), 40000);
        let app = routes(listener)
            .layer(middleware::from_fn(
                move |mut req: Request<Body>, next: Next| async move {
                    req.extensions_mut().insert(caller);
                    next.run(req).await
                },
            ))
            .with_state(s.clone());
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (format!("http://127.0.0.1:{port}"), s)
    }

    /// D13: the device's PIN opens the panel from the screen, not from the
    /// network nor from the cloud's remote screen.
    #[tokio::test]
    async fn the_device_pin_opens_only_from_the_screen() {
        let Some(device_pin) = initial_pin() else {
            // A machine with no wired card has no device PIN to test.
            return;
        };
        let c = reqwest::Client::new();
        let session = |base: String, remote: bool| {
            let mut r = c
                .post(format!("{base}/api/control-panel/session"))
                .json(&json!({ "pin": device_pin }));
            if remote {
                r = r.header(REMOTE_SCREEN_HEADER, "1");
            }
            r.send()
        };

        let (lan, _) = serve_as(Listener::Viewer, "10.77.0.1").await;
        assert_eq!(session(lan.clone(), false).await.unwrap().status(), 401);
        let status: serde_json::Value = c
            .get(format!("{lan}/api/control-panel"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(status["origin"], "network");
        assert_eq!(status["pin"], "screen_only");

        let (screen, _) = serve_as(Listener::Viewer, "127.0.0.1").await;
        assert_eq!(session(screen.clone(), true).await.unwrap().status(), 401);
        let opened = session(screen.clone(), false).await.unwrap();
        assert_eq!(opened.status(), 200);
        let token = opened.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();
        // The initial PIN is shown to the screen only.
        let info: serde_json::Value = c
            .get(format!("{screen}/api/control-panel/info"))
            .header(SESSION_HEADER, &token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(info["initial_pin"], device_pin.as_str());
        // A session opened at the screen is not good from the network.
        assert_eq!(
            c.get(format!("{lan}/api/control-panel/info"))
                .header(SESSION_HEADER, &token)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
    }

    /// D14: from the cloud's remote screen, the project's PIN opens the panel,
    /// and the reset can only keep the pairing.
    #[tokio::test]
    async fn the_remote_screen_resets_only_keeping_the_cloud() {
        // The remote screen, and the tunnel on the management port (D14).
        for (listener, remote) in [(Listener::Viewer, true), (Listener::Management, false)] {
            let (base, s) = serve_as(listener, "127.0.0.1").await;
            let project = tempfile::tempdir().unwrap();
            let hash = sws_auth::hash_password("4711").unwrap();
            std::fs::write(
                project.path().join("project.yaml"),
                format!("meta:\n  name: p\n  version: '1'\ncontrol_panel:\n  pin_hash: '{hash}'\n"),
            )
            .unwrap();
            *s.project_dir.write().await = Some(project.path().to_path_buf());
            let c = reqwest::Client::new();
            let post = |path: &str| {
                let r = c.post(format!("{base}{path}"));
                if remote {
                    r.header(REMOTE_SCREEN_HEADER, "1")
                } else {
                    r
                }
            };
            let opened = post("/api/control-panel/session")
                .json(&json!({ "pin": "4711" }))
                .send()
                .await
                .unwrap();
            assert_eq!(opened.status(), 200);
            let token = opened.json::<serde_json::Value>().await.unwrap()["token"]
                .as_str()
                .unwrap()
                .to_string();
            // Only the refusal is tried here: an accepted reset would wipe and
            // restart the test process.
            let full = post("/api/control-panel/reset")
                .header(SESSION_HEADER, &token)
                .json(&json!({ "pin": "4711", "keep_cloud": false }))
                .send()
                .await
                .unwrap();
            assert_eq!(full.status(), 400, "{listener:?}");
        }
    }

    /// The management port is never the screen, even from the loopback: it is
    /// where the cloud tunnel arrives.
    #[tokio::test]
    async fn the_management_port_is_not_the_screen() {
        let Some(device_pin) = initial_pin() else {
            return;
        };
        let (base, _) = serve_as(Listener::Management, "127.0.0.1").await;
        let r = reqwest::Client::new()
            .post(format!("{base}/api/control-panel/session"))
            .json(&json!({ "pin": device_pin }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401);
    }
}
