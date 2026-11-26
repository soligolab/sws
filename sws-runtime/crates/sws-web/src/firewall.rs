//! The device's firewall, when the system runs firewalld (PixsysOS 2.2.0 and
//! later; plan `docs/archive/2026-11-26-firewall-dei-dispositivi.md`).
//!
//! The runtime talks to firewalld over the system D-Bus, like the control
//! panel talks to NetworkManager. PixsysOS lets the service user change the
//! configuration through polkit (`org.fedoraproject.FirewallD1.config`,
//! measured on the WP630 on 26-11-2026).
//!
//! One change is a list of operations (add or remove a service, a port or a
//! rich rule in a zone). It is applied to the running firewall only, and it
//! waits [`CONFIRM_WITHIN_SECS`] for a confirmation: then it goes into the
//! permanent configuration too. Without the confirmation the runtime undoes
//! it. An addition carries firewalld's own timeout as well, so it goes away
//! even if this process stops.
//!
//! firewalld has no "disabled" entry: to disable is to remove. The entries
//! that SWS removed stay in `<config>/firewall.json`, so the screens still
//! show them as switches that are off.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// How long a change waits for a confirmation. The same time as a network
/// change of the control panel.
pub const CONFIRM_WITHIN_SECS: u32 = crate::control_panel::backend::CONFIRM_WITHIN_SECS;

/// The ports of SWS on a device: viewer and management.
pub const SWS_PORTS: [u16; 2] = [7443, 7444];

const FW: &str = "org.fedoraproject.FirewallD1";
const FW_PATH: &str = "/org/fedoraproject/FirewallD1";
const FW_ZONE: &str = "org.fedoraproject.FirewallD1.zone";
const FW_CONFIG: &str = "org.fedoraproject.FirewallD1.config";
const FW_CONFIG_PATH: &str = "/org/fedoraproject/FirewallD1/config";
const FW_CONFIG_ZONE: &str = "org.fedoraproject.FirewallD1.config.zone";

const STATE_FILE: &str = "firewall.json";

// ── The model ───────────────────────────────────────────────────────────────

/// One entry of a zone.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Item {
    Service { name: String },
    Port { port: String, protocol: String },
    RichRule { rule: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Add,
    Remove,
}

impl Action {
    fn inverse(self) -> Self {
        match self {
            Action::Add => Action::Remove,
            Action::Remove => Action::Add,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Op {
    pub zone: String,
    pub action: Action,
    pub item: Item,
}

impl Op {
    fn inverse(&self) -> Op {
        Op {
            zone: self.zone.clone(),
            action: self.action.inverse(),
            item: self.item.clone(),
        }
    }
}

/// The body of `POST …/firewall/apply`.
#[derive(Debug, Clone, Deserialize)]
pub struct Change {
    pub ops: Vec<Op>,
}

/// What a rich rule does with the traffic it matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Accept,
    Reject,
    Drop,
}

impl Verdict {
    fn word(self) -> &'static str {
        match self {
            Verdict::Accept => "accept",
            Verdict::Reject => "reject",
            Verdict::Drop => "drop",
        }
    }
}

/// What a rich rule of the form matches: a port or a service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuleTarget {
    Port { port: String, protocol: String },
    Service { name: String },
}

/// The rich rules the screens can build and read back: one source address
/// or network, one port or service, one verdict. Other rules show as text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleForm {
    pub source: String,
    pub target: RuleTarget,
    pub verdict: Verdict,
}

impl RuleForm {
    pub fn validate(&self) -> Result<(), String> {
        valid_source(&self.source)?;
        match &self.target {
            RuleTarget::Port { port, protocol } => {
                valid_port(port)?;
                valid_protocol(protocol)
            }
            RuleTarget::Service { name } => valid_name(name, "service"),
        }
    }

    /// The firewalld text of the rule.
    pub fn compose(&self) -> Result<String, String> {
        self.validate()?;
        let family = if source_is_v6(&self.source) {
            "ipv6"
        } else {
            "ipv4"
        };
        let what = match &self.target {
            RuleTarget::Port { port, protocol } => {
                format!("port port=\"{port}\" protocol=\"{protocol}\"")
            }
            RuleTarget::Service { name } => format!("service name=\"{name}\""),
        };
        Ok(format!(
            "rule family=\"{family}\" source address=\"{}\" {what} {}",
            self.source,
            self.verdict.word()
        ))
    }

    /// The form of a rule, when the rule has exactly that shape.
    pub fn parse(rule: &str) -> Option<RuleForm> {
        let t = tokens(rule)?;
        let t: Vec<&str> = t.iter().map(String::as_str).collect();
        let (source, rest) = match t.as_slice() {
            ["rule", fam, "source", addr, rest @ ..]
                if (*fam == "family=ipv4" || *fam == "family=ipv6") =>
            {
                (addr.strip_prefix("address=")?, rest)
            }
            _ => return None,
        };
        let (target, verdict) = match rest {
            ["port", p, proto, v] => (
                RuleTarget::Port {
                    port: p.strip_prefix("port=")?.to_string(),
                    protocol: proto.strip_prefix("protocol=")?.to_string(),
                },
                *v,
            ),
            ["service", n, v] => (
                RuleTarget::Service {
                    name: n.strip_prefix("name=")?.to_string(),
                },
                *v,
            ),
            _ => return None,
        };
        let verdict = match verdict {
            "accept" => Verdict::Accept,
            "reject" => Verdict::Reject,
            "drop" => Verdict::Drop,
            _ => return None,
        };
        let f = RuleForm {
            source: source.to_string(),
            target,
            verdict,
        };
        f.validate().ok().map(|_| f)
    }
}

/// The words of a rule, with the quotes taken away: `port="80"` → `port=80`.
fn tokens(rule: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in rule.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if quoted {
        return None;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    Some(out)
}

// ── Validation ──────────────────────────────────────────────────────────────

pub fn valid_name(s: &str, what: &str) -> Result<(), String> {
    let ok = !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'));
    if ok {
        Ok(())
    } else {
        Err(format!("{what} name not valid: {s:?}"))
    }
}

/// A port (`443`) or a range (`1740-1743`), from 1 to 65535.
pub fn valid_port(s: &str) -> Result<(), String> {
    let bad = || format!("port not valid: {s:?} (1-65535, or a range like 1740-1743)");
    let n = |x: &str| x.parse::<u16>().ok().filter(|v| *v > 0);
    match s.split_once('-') {
        Some((a, b)) => match (n(a), n(b)) {
            (Some(a), Some(b)) if a < b => Ok(()),
            _ => Err(bad()),
        },
        None => n(s).map(|_| ()).ok_or_else(bad),
    }
}

pub fn valid_protocol(s: &str) -> Result<(), String> {
    if matches!(s, "tcp" | "udp" | "sctp" | "dccp") {
        Ok(())
    } else {
        Err(format!("protocol not valid: {s:?} (tcp, udp, sctp, dccp)"))
    }
}

/// An address or a network: `192.168.0.10`, `192.168.0.0/23`, `fd00::/8`.
pub fn valid_source(s: &str) -> Result<(), String> {
    let bad = || format!("source not valid: {s:?} (an address or a network, like 192.168.0.0/23)");
    let (addr, prefix) = match s.split_once('/') {
        Some((a, p)) => (a, Some(p)),
        None => (s, None),
    };
    let ip: IpAddr = addr.parse().map_err(|_| bad())?;
    if let Some(p) = prefix {
        let p: u8 = p.parse().map_err(|_| bad())?;
        let max = if ip.is_ipv4() { 32 } else { 128 };
        if p > max {
            return Err(bad());
        }
    }
    Ok(())
}

fn source_is_v6(s: &str) -> bool {
    s.split('/').next().is_some_and(|a| a.contains(':'))
}

/// A rich rule written as text: firewalld checks the grammar, here only what
/// would never be a rule.
fn valid_rule_text(s: &str) -> Result<(), String> {
    if s.trim().is_empty() || s.len() > 512 || s.contains(['\n', '\r', '\0']) {
        return Err("rich rule not valid".into());
    }
    if !s.trim_start().starts_with("rule") {
        return Err("a rich rule starts with \"rule\"".into());
    }
    Ok(())
}

impl Item {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Item::Service { name } => valid_name(name, "service"),
            Item::Port { port, protocol } => {
                valid_port(port)?;
                valid_protocol(protocol)
            }
            Item::RichRule { rule } => valid_rule_text(rule),
        }
    }

    /// Does this entry let `port/protocol` in? Rich rules are not counted.
    fn opens(
        &self,
        port: u16,
        protocol: &str,
        services: &HashMap<String, Vec<(String, String)>>,
    ) -> bool {
        let in_range = |p: &str| match p.split_once('-') {
            Some((a, b)) => {
                matches!((a.parse::<u16>(), b.parse::<u16>()), (Ok(a), Ok(b)) if a <= port && port <= b)
            }
            None => p.parse::<u16>() == Ok(port),
        };
        match self {
            Item::Port {
                port: p,
                protocol: pr,
            } => pr == protocol && in_range(p),
            Item::Service { name } => services
                .get(name)
                .is_some_and(|ports| ports.iter().any(|(p, pr)| pr == protocol && in_range(p))),
            Item::RichRule { .. } => false,
        }
    }
}

// ── The picture of the firewall ─────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ZoneNow {
    pub name: String,
    pub interfaces: Vec<String>,
    pub sources: Vec<String>,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Default)]
pub struct Picture {
    pub default_zone: String,
    pub zones: Vec<ZoneNow>,
    pub known_services: Vec<String>,
    /// The ports of each service the zones use, as firewalld defines them.
    pub service_ports: HashMap<String, Vec<(String, String)>>,
}

// ── What the screens get ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    #[serde(flatten)]
    pub item: Item,
    pub enabled: bool,
    /// For a service: the ports it opens (`80/tcp`).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<String>,
    /// For a rich rule: its form, when the screens can edit it as a form.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form: Option<RuleForm>,
    /// For an entry SWS disabled: who and when.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneView {
    pub name: String,
    pub default: bool,
    pub interfaces: Vec<String>,
    pub sources: Vec<String>,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ListenPort {
    pub port: u16,
    pub protocol: String,
    /// One of the ports of SWS itself (viewer, management).
    pub sws: bool,
    /// The zones that let it in.
    pub open_in: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingView {
    pub ops: Vec<Op>,
    pub seconds_left: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FirewallView {
    pub available: bool,
    pub default_zone: String,
    pub zones: Vec<ZoneView>,
    pub known_services: Vec<String>,
    pub listen_ports: Vec<ListenPort>,
    pub pending: Option<PendingView>,
    pub confirm_within_secs: u32,
}

// ── The file of SWS ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Disabled {
    pub zone: String,
    pub item: Item,
    pub at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

impl Default for Item {
    fn default() -> Self {
        Item::Service {
            name: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Stored {
    /// The ports of SWS were opened once: never again by themselves, so an
    /// administrator who closes them later keeps them closed.
    #[serde(default)]
    pub sws_ports_opened: bool,
    #[serde(default)]
    pub disabled: Vec<Disabled>,
}

fn state_path(config_dir: &Path) -> PathBuf {
    config_dir.join(STATE_FILE)
}

pub fn read_stored(config_dir: &Path) -> Stored {
    std::fs::read(state_path(config_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_stored(config_dir: &Path, s: &Stored) -> Result<(), String> {
    let p = state_path(config_dir);
    let tmp = p.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("{}: {e}", p.display()))
}

/// The file after a confirmed change: a removed entry is remembered, an
/// added one is forgotten.
fn remember(stored: &mut Stored, ops: &[Op], by: Option<&str>, now_ms: i64) {
    for op in ops {
        stored
            .disabled
            .retain(|d| !(d.zone == op.zone && d.item == op.item));
        if op.action == Action::Remove {
            stored.disabled.push(Disabled {
                zone: op.zone.clone(),
                item: op.item.clone(),
                at_ms: now_ms,
                by: by.map(str::to_string),
            });
        }
    }
}

/// What the screens show: the entries of each zone, the disabled ones
/// after them, and the ports SWS listens on.
pub fn view(
    p: &Picture,
    stored: &Stored,
    listen: &[(u16, String)],
    pending: Option<PendingView>,
) -> FirewallView {
    let zones = p
        .zones
        .iter()
        .map(|z| {
            let mut entries: Vec<Entry> = z.items.iter().map(|i| entry(i, true, p, None)).collect();
            for d in stored.disabled.iter().filter(|d| d.zone == z.name) {
                if !z.items.contains(&d.item) {
                    entries.push(entry(&d.item, false, p, Some(d)));
                }
            }
            ZoneView {
                name: z.name.clone(),
                default: z.name == p.default_zone,
                interfaces: z.interfaces.clone(),
                sources: z.sources.clone(),
                entries,
            }
        })
        .collect();
    let mut seen = BTreeSet::new();
    let listen_ports = listen
        .iter()
        .filter(|(port, proto)| seen.insert((*port, proto.clone())))
        .map(|(port, proto)| ListenPort {
            port: *port,
            protocol: proto.clone(),
            sws: proto == "tcp" && SWS_PORTS.contains(port),
            open_in: p
                .zones
                .iter()
                .filter(|z| {
                    z.items
                        .iter()
                        .any(|i| i.opens(*port, proto, &p.service_ports))
                })
                .map(|z| z.name.clone())
                .collect(),
        })
        .collect();
    FirewallView {
        available: true,
        default_zone: p.default_zone.clone(),
        zones,
        known_services: p.known_services.clone(),
        listen_ports,
        pending,
        confirm_within_secs: CONFIRM_WITHIN_SECS,
    }
}

fn entry(i: &Item, enabled: bool, p: &Picture, d: Option<&Disabled>) -> Entry {
    Entry {
        item: i.clone(),
        enabled,
        ports: match i {
            Item::Service { name } => p
                .service_ports
                .get(name)
                .map(|v| v.iter().map(|(a, b)| format!("{a}/{b}")).collect())
                .unwrap_or_default(),
            _ => vec![],
        },
        form: match i {
            Item::RichRule { rule } => RuleForm::parse(rule),
            _ => None,
        },
        disabled_by: d.and_then(|d| d.by.clone()),
        disabled_at_ms: d.map(|d| d.at_ms),
    }
}

/// The operations, checked against the firewall as it is now: every zone
/// exists, every addition is new, every removal is there. In order, so a
/// change can remove an entry and add its new version.
pub fn check_ops(p: &Picture, ops: &[Op]) -> Result<(), String> {
    if ops.is_empty() {
        return Err("no operation in the change".into());
    }
    if ops.len() > 64 {
        return Err("too many operations in one change (64 at most)".into());
    }
    let mut zones: HashMap<&str, Vec<Item>> = p
        .zones
        .iter()
        .map(|z| (z.name.as_str(), z.items.clone()))
        .collect();
    for op in ops {
        valid_name(&op.zone, "zone")?;
        op.item.validate()?;
        let items = zones
            .get_mut(op.zone.as_str())
            .ok_or_else(|| format!("zone {:?} is not active", op.zone))?;
        let at = items.iter().position(|i| *i == op.item);
        match (op.action, at) {
            (Action::Add, Some(_)) => {
                return Err(format!(
                    "already in zone {}: {}",
                    op.zone,
                    describe(&op.item)
                ))
            }
            (Action::Remove, None) => {
                return Err(format!("not in zone {}: {}", op.zone, describe(&op.item)))
            }
            (Action::Add, None) => items.push(op.item.clone()),
            (Action::Remove, Some(i)) => {
                items.remove(i);
            }
        }
    }
    Ok(())
}

pub fn describe(i: &Item) -> String {
    match i {
        Item::Service { name } => format!("service {name}"),
        Item::Port { port, protocol } => format!("port {port}/{protocol}"),
        Item::RichRule { rule } => format!("rule {rule}"),
    }
}

// ── The ports SWS listens on ────────────────────────────────────────────────

/// The sockets of this process that listen on an address other than the
/// loopback: `/proc/self/fd` gives the inodes, `/proc/net/*` their ports.
pub fn listen_ports() -> Vec<(u16, String)> {
    let mut inodes = BTreeSet::new();
    if let Ok(rd) = std::fs::read_dir("/proc/self/fd") {
        for e in rd.flatten() {
            if let Ok(t) = std::fs::read_link(e.path()) {
                if let Some(n) = t
                    .to_str()
                    .and_then(|s| s.strip_prefix("socket:["))
                    .and_then(|s| s.strip_suffix(']'))
                    .and_then(|s| s.parse::<u64>().ok())
                {
                    inodes.insert(n);
                }
            }
        }
    }
    let mut out = Vec::new();
    for (file, proto) in [
        ("/proc/net/tcp", "tcp"),
        ("/proc/net/tcp6", "tcp"),
        ("/proc/net/udp", "udp"),
        ("/proc/net/udp6", "udp"),
    ] {
        if let Ok(text) = std::fs::read_to_string(file) {
            out.extend(parse_proc_net(&text, proto, &inodes));
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The listening entries of one `/proc/net/{tcp,udp}{,6}` table that belong
/// to `inodes`, without the loopback.
pub fn parse_proc_net(text: &str, proto: &str, inodes: &BTreeSet<u64>) -> Vec<(u16, String)> {
    let listening = if proto == "tcp" { "0A" } else { "07" };
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 || f[3] != listening {
            continue;
        }
        let Ok(inode) = f[9].parse::<u64>() else {
            continue;
        };
        if !inodes.contains(&inode) {
            continue;
        }
        let Some((addr, port)) = f[1].split_once(':') else {
            continue;
        };
        if is_loopback_hex(addr) {
            continue;
        }
        if let Ok(port) = u16::from_str_radix(port, 16) {
            out.push((port, proto.to_string()));
        }
    }
    out
}

fn is_loopback_hex(addr: &str) -> bool {
    match addr.len() {
        // IPv4, little-endian: 127.x.x.x ends with 7F.
        8 => addr.ends_with("7F"),
        // ::1, and ::ffff:127.x.x.x.
        32 => {
            addr == "00000000000000000000000001000000"
                || (addr.starts_with("0000000000000000FFFF0000") && addr.ends_with("7F"))
        }
        _ => false,
    }
}

// ── The two backends ────────────────────────────────────────────────────────

enum Backend {
    Dbus,
    Fake(Mutex<Picture>),
}

static BACKEND: OnceLock<Backend> = OnceLock::new();

fn backend() -> &'static Backend {
    BACKEND.get_or_init(|| {
        if cfg!(test) || std::env::var("SWS_CONTROL_PANEL_FAKE").is_ok_and(|v| v == "1") {
            Backend::Fake(Mutex::new(fake_picture()))
        } else {
            Backend::Dbus
        }
    })
}

/// A firewall like the one of PixsysOS 2.2.0 on the WP630.
pub fn fake_picture() -> Picture {
    let svc = |n: &str| Item::Service { name: n.into() };
    let mut service_ports = HashMap::new();
    for (n, ports) in [
        ("ssh", vec![("22", "tcp")]),
        ("mdns", vec![("5353", "udp")]),
        ("http", vec![("80", "tcp")]),
        ("https", vec![("443", "tcp")]),
        ("cockpit", vec![("9090", "tcp")]),
        (
            "codesys",
            vec![("11740", "tcp"), ("1740-1743", "udp"), ("4840", "tcp")],
        ),
        ("pixsys-portal", vec![("8080", "tcp")]),
    ] {
        service_ports.insert(
            n.to_string(),
            ports
                .into_iter()
                .map(|(a, b)| (a.to_string(), b.to_string()))
                .collect(),
        );
    }
    Picture {
        default_zone: "public".into(),
        zones: vec![ZoneNow {
            name: "public".into(),
            interfaces: vec!["ethernet0".into()],
            sources: vec![],
            items: [
                "ssh",
                "mdns",
                "http",
                "https",
                "cockpit",
                "codesys",
                "pixsys-portal",
            ]
            .into_iter()
            .map(svc)
            .collect(),
        }],
        known_services: [
            "cockpit",
            "codesys",
            "ftp",
            "http",
            "https",
            "mdns",
            "mqtt",
            "pixsys-portal",
            "ssh",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        service_ports,
    }
}

fn fake_apply(p: &mut Picture, op: &Op) -> Result<(), String> {
    let z = p
        .zones
        .iter_mut()
        .find(|z| z.name == op.zone)
        .ok_or_else(|| format!("INVALID_ZONE: {}", op.zone))?;
    let at = z.items.iter().position(|i| *i == op.item);
    match (op.action, at) {
        (Action::Add, None) => z.items.push(op.item.clone()),
        (Action::Remove, Some(i)) => {
            z.items.remove(i);
        }
        (Action::Add, Some(_)) => return Err("ALREADY_ENABLED".into()),
        (Action::Remove, None) => return Err("NOT_ENABLED".into()),
    }
    Ok(())
}

async fn system() -> Result<zbus::Connection, String> {
    zbus::Connection::system()
        .await
        .map_err(|e| format!("system bus not reachable: {e}"))
}

async fn call<B, R>(
    c: &zbus::Connection,
    path: &str,
    iface: &str,
    method: &str,
    body: &B,
) -> Result<R, String>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
    R: for<'d> zbus::zvariant::DynamicDeserialize<'d>,
{
    let m = c
        .call_method(Some(FW), path, Some(iface), method, body)
        .await
        .map_err(|e| format!("firewalld {method}: {e}"))?;
    m.body()
        .deserialize::<R>()
        .map_err(|e| format!("firewalld {method}: {e}"))
}

async fn call0<B>(
    c: &zbus::Connection,
    path: &str,
    iface: &str,
    method: &str,
    body: &B,
) -> Result<(), String>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    c.call_method(Some(FW), path, Some(iface), method, body)
        .await
        .map(|_| ())
        .map_err(|e| format!("firewalld {method}: {e}"))
}

/// firewalld runs and answers on the system bus.
pub async fn available() -> bool {
    match backend() {
        Backend::Fake(_) => true,
        Backend::Dbus => match system().await {
            Ok(c) => call::<_, String>(&c, FW_PATH, FW, "getDefaultZone", &())
                .await
                .is_ok(),
            Err(_) => false,
        },
    }
}

async fn picture() -> Result<Picture, String> {
    match backend() {
        Backend::Fake(p) => Ok(p.lock().unwrap().clone()),
        Backend::Dbus => dbus_picture().await,
    }
}

async fn dbus_picture() -> Result<Picture, String> {
    let c = system().await?;
    let default_zone: String = call(&c, FW_PATH, FW, "getDefaultZone", &()).await?;
    let active: HashMap<String, HashMap<String, Vec<String>>> =
        call(&c, FW_PATH, FW_ZONE, "getActiveZones", &()).await?;
    let mut names: Vec<String> = active.keys().cloned().collect();
    names.sort();
    // The default zone takes every interface no other zone has: it counts
    // even when no interface names it.
    if !names.contains(&default_zone) {
        names.insert(0, default_zone.clone());
    }
    let mut zones = Vec::new();
    let mut used = BTreeSet::new();
    for name in names {
        let services: Vec<String> =
            call(&c, FW_PATH, FW_ZONE, "getServices", &(name.as_str(),)).await?;
        let ports: Vec<Vec<String>> =
            call(&c, FW_PATH, FW_ZONE, "getPorts", &(name.as_str(),)).await?;
        let rules: Vec<String> =
            call(&c, FW_PATH, FW_ZONE, "getRichRules", &(name.as_str(),)).await?;
        let mut items = Vec::new();
        for s in services {
            used.insert(s.clone());
            items.push(Item::Service { name: s });
        }
        for p in ports {
            if let [port, protocol] = p.as_slice() {
                items.push(Item::Port {
                    port: port.clone(),
                    protocol: protocol.clone(),
                });
            }
        }
        for rule in rules {
            if let Some(RuleForm {
                target: RuleTarget::Service { name },
                ..
            }) = RuleForm::parse(&rule)
            {
                used.insert(name);
            }
            items.push(Item::RichRule { rule });
        }
        let a = active.get(&name);
        zones.push(ZoneNow {
            interfaces: a
                .and_then(|a| a.get("interfaces"))
                .cloned()
                .unwrap_or_default(),
            sources: a
                .and_then(|a| a.get("sources"))
                .cloned()
                .unwrap_or_default(),
            name,
            items,
        });
    }
    let mut known_services: Vec<String> = call(&c, FW_PATH, FW, "listServices", &()).await?;
    known_services.sort();
    let p = Picture {
        default_zone,
        zones,
        known_services,
        service_ports: HashMap::new(),
    };
    with_service_ports(&c, p, used).await
}

/// The ports of the services in use, and of the disabled ones, read once.
async fn with_service_ports(
    c: &zbus::Connection,
    mut p: Picture,
    used: BTreeSet<String>,
) -> Result<Picture, String> {
    for name in used {
        let settings: HashMap<String, zbus::zvariant::OwnedValue> =
            match call(c, FW_PATH, FW, "getServiceSettings2", &(name.as_str(),)).await {
                Ok(s) => s,
                Err(_) => continue,
            };
        let ports = settings
            .get("ports")
            .and_then(|v| v.try_clone().ok())
            .and_then(|v| <Vec<(String, String)>>::try_from(v).ok())
            .unwrap_or_default();
        p.service_ports.insert(name, ports);
    }
    Ok(p)
}

/// One operation on the running firewall. `timeout` in seconds, for an
/// addition (0 = until the next reload).
async fn runtime_op(op: &Op, timeout: i32) -> Result<(), String> {
    match backend() {
        Backend::Fake(p) => fake_apply(&mut p.lock().unwrap(), op),
        Backend::Dbus => {
            let c = system().await?;
            let z = op.zone.as_str();
            match (&op.item, op.action) {
                (Item::Service { name }, Action::Add) => {
                    call::<_, String>(
                        &c,
                        FW_PATH,
                        FW_ZONE,
                        "addService",
                        &(z, name.as_str(), timeout),
                    )
                    .await?;
                }
                (Item::Service { name }, Action::Remove) => {
                    call::<_, String>(&c, FW_PATH, FW_ZONE, "removeService", &(z, name.as_str()))
                        .await?;
                }
                (Item::Port { port, protocol }, Action::Add) => {
                    call::<_, String>(
                        &c,
                        FW_PATH,
                        FW_ZONE,
                        "addPort",
                        &(z, port.as_str(), protocol.as_str(), timeout),
                    )
                    .await?;
                }
                (Item::Port { port, protocol }, Action::Remove) => {
                    call::<_, String>(
                        &c,
                        FW_PATH,
                        FW_ZONE,
                        "removePort",
                        &(z, port.as_str(), protocol.as_str()),
                    )
                    .await?;
                }
                (Item::RichRule { rule }, Action::Add) => {
                    call::<_, String>(
                        &c,
                        FW_PATH,
                        FW_ZONE,
                        "addRichRule",
                        &(z, rule.as_str(), timeout),
                    )
                    .await?;
                }
                (Item::RichRule { rule }, Action::Remove) => {
                    call::<_, String>(&c, FW_PATH, FW_ZONE, "removeRichRule", &(z, rule.as_str()))
                        .await?;
                }
            }
            Ok(())
        }
    }
}

/// One operation on the permanent configuration.
async fn permanent_op(op: &Op) -> Result<(), String> {
    match backend() {
        // The fake has one configuration only: the running one.
        Backend::Fake(_) => Ok(()),
        Backend::Dbus => {
            let c = system().await?;
            let path: zbus::zvariant::OwnedObjectPath = call(
                &c,
                FW_CONFIG_PATH,
                FW_CONFIG,
                "getZoneByName",
                &(op.zone.as_str(),),
            )
            .await?;
            let path = path.as_str();
            match (&op.item, op.action) {
                (Item::Service { name }, Action::Add) => {
                    call0(&c, path, FW_CONFIG_ZONE, "addService", &(name.as_str(),)).await
                }
                (Item::Service { name }, Action::Remove) => {
                    call0(&c, path, FW_CONFIG_ZONE, "removeService", &(name.as_str(),)).await
                }
                (Item::Port { port, protocol }, Action::Add) => {
                    call0(
                        &c,
                        path,
                        FW_CONFIG_ZONE,
                        "addPort",
                        &(port.as_str(), protocol.as_str()),
                    )
                    .await
                }
                (Item::Port { port, protocol }, Action::Remove) => {
                    call0(
                        &c,
                        path,
                        FW_CONFIG_ZONE,
                        "removePort",
                        &(port.as_str(), protocol.as_str()),
                    )
                    .await
                }
                (Item::RichRule { rule }, Action::Add) => {
                    call0(&c, path, FW_CONFIG_ZONE, "addRichRule", &(rule.as_str(),)).await
                }
                (Item::RichRule { rule }, Action::Remove) => {
                    call0(
                        &c,
                        path,
                        FW_CONFIG_ZONE,
                        "removeRichRule",
                        &(rule.as_str(),),
                    )
                    .await
                }
            }
        }
    }
}

/// firewalld's answer when the entry is already as asked: not an error for
/// an undo or for the permanent configuration.
fn already(e: &str) -> bool {
    e.contains("ALREADY_ENABLED") || e.contains("NOT_ENABLED")
}

// ── The change that waits for a confirmation ────────────────────────────────

struct Pending {
    id: u64,
    ops: Vec<Op>,
    deadline: std::time::Instant,
    by: Option<String>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// One change at a time also while it is being applied or confirmed.
static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn pending_view() -> Option<PendingView> {
    PENDING.lock().unwrap().as_ref().map(|p| PendingView {
        ops: p.ops.clone(),
        seconds_left: p
            .deadline
            .saturating_duration_since(std::time::Instant::now())
            .as_secs() as u32,
        by: p.by.clone(),
    })
}

#[derive(Debug, PartialEq)]
pub enum FwError {
    /// The request is not valid: 400.
    Bad(String),
    /// Another change waits, or none waits: 409.
    Conflict(String),
    /// firewalld refused or is not there: 502.
    Failed(String),
}

/// `GET …/firewall`.
pub async fn state(config_dir: &Path) -> Result<FirewallView, String> {
    if !available().await {
        return Ok(FirewallView {
            available: false,
            default_zone: String::new(),
            zones: vec![],
            known_services: vec![],
            listen_ports: vec![],
            pending: None,
            confirm_within_secs: CONFIRM_WITHIN_SECS,
        });
    }
    let mut p = picture().await?;
    let stored = read_stored(config_dir);
    // The ports of the disabled services too, so their rows say what they open.
    if let Backend::Dbus = backend() {
        let missing: BTreeSet<String> = stored
            .disabled
            .iter()
            .filter_map(|d| match &d.item {
                Item::Service { name } if !p.service_ports.contains_key(name) => Some(name.clone()),
                _ => None,
            })
            .collect();
        if !missing.is_empty() {
            let c = system().await?;
            p = with_service_ports(&c, p, missing).await?;
        }
    }
    let mut listen = listen_ports();
    for port in SWS_PORTS {
        if !listen.iter().any(|(p, pr)| *p == port && pr == "tcp")
            && matches!(backend(), Backend::Fake(_))
        {
            listen.push((port, "tcp".into()));
        }
    }
    Ok(view(&p, &stored, &listen, pending_view()))
}

/// `POST …/firewall/apply`: the operations on the running firewall, in
/// order. If one fails, the ones before it are undone. When the wait ends
/// without a confirmation, `audit` gets a `firewall.expired` entry.
pub async fn apply(
    ops: Vec<Op>,
    by: Option<String>,
    audit: Option<std::sync::Arc<sws_audit::AuditLog>>,
) -> Result<u32, FwError> {
    let _busy = BUSY.lock().await;
    if PENDING.lock().unwrap().is_some() {
        return Err(FwError::Conflict(
            "another firewall change waits for its confirmation".into(),
        ));
    }
    if !available().await {
        return Err(FwError::Failed(
            "firewalld is not running on this device".into(),
        ));
    }
    let p = picture().await.map_err(FwError::Failed)?;
    check_ops(&p, &ops).map_err(FwError::Bad)?;
    // Firewalld takes away an addition by itself a little after the undo of
    // SWS: so it goes away even if this process stops.
    let timeout = (CONFIRM_WITHIN_SECS + 15) as i32;
    let mut done: Vec<&Op> = Vec::new();
    for op in &ops {
        if let Err(e) = runtime_op(op, timeout).await {
            for d in done.iter().rev() {
                let _ = runtime_op(&d.inverse(), 0).await;
            }
            return Err(FwError::Failed(e));
        }
        done.push(op);
    }
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *PENDING.lock().unwrap() = Some(Pending {
        id,
        ops,
        deadline: std::time::Instant::now()
            + std::time::Duration::from_secs(CONFIRM_WITHIN_SECS as u64),
        by,
    });
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(CONFIRM_WITHIN_SECS as u64)).await;
        let still = PENDING.lock().unwrap().as_ref().is_some_and(|p| p.id == id);
        if still {
            tracing::warn!("firewall: no confirmation in time, the change is undone");
            if let Ok(ops) = rollback().await {
                if let Some(a) = audit {
                    a.log("firewall.expired", None, serde_json::json!({ "ops": ops }));
                }
            }
        }
    });
    Ok(CONFIRM_WITHIN_SECS)
}

/// `POST …/firewall/confirm`: the pending change into the permanent
/// configuration, and its additions without the timeout.
pub async fn confirm(config_dir: &Path, by: Option<&str>) -> Result<Vec<Op>, FwError> {
    let _busy = BUSY.lock().await;
    let pending =
        PENDING.lock().unwrap().take().ok_or_else(|| {
            FwError::Conflict("no firewall change waits for a confirmation".into())
        })?;
    let mut errors = Vec::new();
    for op in &pending.ops {
        if let Err(e) = permanent_op(op).await {
            if !already(&e) {
                errors.push(e);
            }
        }
        if op.action == Action::Add && matches!(backend(), Backend::Dbus) {
            // The timed addition becomes a lasting one.
            let _ = runtime_op(&op.inverse(), 0).await;
            if let Err(e) = runtime_op(op, 0).await {
                if !already(&e) {
                    errors.push(e);
                }
            }
        }
    }
    let mut stored = read_stored(config_dir);
    remember(
        &mut stored,
        &pending.ops,
        by.or(pending.by.as_deref()),
        chrono::Utc::now().timestamp_millis(),
    );
    if let Err(e) = write_stored(config_dir, &stored) {
        tracing::warn!(error = %e, "firewall: the list of disabled entries was not saved");
    }
    if errors.is_empty() {
        Ok(pending.ops)
    } else {
        Err(FwError::Failed(errors.join("; ")))
    }
}

/// `POST …/firewall/rollback`, and the end of the wait: the running
/// firewall as before the change.
pub async fn rollback() -> Result<Vec<Op>, FwError> {
    let pending =
        PENDING.lock().unwrap().take().ok_or_else(|| {
            FwError::Conflict("no firewall change waits for a confirmation".into())
        })?;
    let mut errors = Vec::new();
    for op in pending.ops.iter().rev() {
        if let Err(e) = runtime_op(&op.inverse(), 0).await {
            if !already(&e) {
                errors.push(e);
            }
        }
    }
    if errors.is_empty() {
        Ok(pending.ops)
    } else {
        Err(FwError::Failed(errors.join("; ")))
    }
}

/// At the start of a runtime on a device, once in its life: the ports of SWS
/// open in the zones of the network cards, running and permanent. Returns
/// the operations done (empty if there was nothing to do), `None` when
/// firewalld is not there or this was done before.
pub async fn ensure_sws_ports(config_dir: &Path) -> Result<Option<Vec<Op>>, String> {
    let mut stored = read_stored(config_dir);
    if stored.sws_ports_opened || matches!(backend(), Backend::Fake(_)) || !available().await {
        return Ok(None);
    }
    let p = picture().await?;
    let ops = sws_port_ops(&p);
    for op in &ops {
        if let Err(e) = runtime_op(op, 0).await {
            if !already(&e) {
                return Err(e);
            }
        }
        if let Err(e) = permanent_op(op).await {
            if !already(&e) {
                return Err(e);
            }
        }
    }
    stored.sws_ports_opened = true;
    write_stored(config_dir, &stored)?;
    Ok(Some(ops))
}

/// [`ensure_sws_ports`] at the start of the runtime, with the log and the
/// audit entry.
pub async fn at_startup(s: crate::router::AppState) {
    match ensure_sws_ports(&s.config_dir).await {
        Ok(Some(ops)) if !ops.is_empty() => {
            tracing::info!(
                ops = ops.len(),
                "firewall: the ports of SWS are now open in firewalld"
            );
            s.audit.log(
                "firewall.sws_ports",
                None,
                serde_json::json!({ "ops": ops }),
            );
        }
        Ok(Some(_)) => tracing::info!("firewall: the ports of SWS were already open in firewalld"),
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(error = %e, "firewall: the ports of SWS could not be opened in firewalld")
        }
    }
}

/// The additions that open 7443 and 7444 in each zone with an interface (or
/// in the default zone, when no zone has one) that does not let them in.
pub fn sws_port_ops(p: &Picture) -> Vec<Op> {
    let with_cards: Vec<&ZoneNow> = p
        .zones
        .iter()
        .filter(|z| !z.interfaces.is_empty())
        .collect();
    let zones: Vec<&ZoneNow> = if with_cards.is_empty() {
        p.zones
            .iter()
            .filter(|z| z.name == p.default_zone)
            .collect()
    } else {
        with_cards
    };
    let mut ops = Vec::new();
    for z in zones {
        for port in SWS_PORTS {
            if !z
                .items
                .iter()
                .any(|i| i.opens(port, "tcp", &p.service_ports))
            {
                ops.push(Op {
                    zone: z.name.clone(),
                    action: Action::Add,
                    item: Item::Port {
                        port: port.to_string(),
                        protocol: "tcp".into(),
                    },
                });
            }
        }
    }
    ops
}

// ── The HTTP handlers, shared by the control panel and the management API ───

pub mod http {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::{IntoResponse, Response};
    use axum::Json;
    use serde_json::json;

    fn error(e: FwError) -> Response {
        let (code, msg) = match e {
            FwError::Bad(m) => (StatusCode::BAD_REQUEST, m),
            FwError::Conflict(m) => (StatusCode::CONFLICT, m),
            FwError::Failed(m) => (StatusCode::BAD_GATEWAY, m),
        };
        (code, Json(json!({ "error": msg }))).into_response()
    }

    pub async fn get(s: &crate::router::AppState) -> Response {
        match state(&s.config_dir).await {
            Ok(v) => Json(v).into_response(),
            Err(e) => error(FwError::Failed(e)),
        }
    }

    pub async fn apply(
        s: &crate::router::AppState,
        change: Change,
        by: Option<String>,
    ) -> Response {
        let ops = change.ops.clone();
        match super::apply(change.ops, by.clone(), Some(s.audit.clone())).await {
            Ok(secs) => {
                s.audit.log("firewall.apply", by, json!({ "ops": ops }));
                Json(json!({ "confirm_within_secs": secs })).into_response()
            }
            Err(e) => error(e),
        }
    }

    pub async fn confirm(s: &crate::router::AppState, by: Option<String>) -> Response {
        match super::confirm(&s.config_dir, by.as_deref()).await {
            Ok(ops) => {
                s.audit.log("firewall.confirm", by, json!({ "ops": ops }));
                StatusCode::NO_CONTENT.into_response()
            }
            Err(e) => error(e),
        }
    }

    pub async fn rollback(s: &crate::router::AppState, by: Option<String>) -> Response {
        match super::rollback().await {
            Ok(ops) => {
                s.audit.log("firewall.rollback", by, json!({ "ops": ops }));
                StatusCode::NO_CONTENT.into_response()
            }
            Err(e) => error(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(p: &str) -> Item {
        Item::Port {
            port: p.into(),
            protocol: "tcp".into(),
        }
    }

    fn svc(n: &str) -> Item {
        Item::Service { name: n.into() }
    }

    #[test]
    fn a_rule_of_the_form_is_written_and_read_back() {
        let f = RuleForm {
            source: "192.168.0.0/23".into(),
            target: RuleTarget::Port {
                port: "7444".into(),
                protocol: "tcp".into(),
            },
            verdict: Verdict::Accept,
        };
        let text = f.compose().unwrap();
        assert_eq!(
            text,
            r#"rule family="ipv4" source address="192.168.0.0/23" port port="7444" protocol="tcp" accept"#
        );
        assert_eq!(RuleForm::parse(&text), Some(f));
        let s = RuleForm {
            source: "fd00::/8".into(),
            target: RuleTarget::Service { name: "ssh".into() },
            verdict: Verdict::Drop,
        };
        let text = s.compose().unwrap();
        assert!(text.starts_with(r#"rule family="ipv6""#));
        assert_eq!(RuleForm::parse(&text), Some(s));
    }

    #[test]
    fn a_rule_of_another_shape_stays_text() {
        assert_eq!(
            RuleForm::parse(r#"rule family="ipv4" source NOT address="10.0.0.1" accept"#),
            None
        );
        assert_eq!(
            RuleForm::parse(r#"rule service name="ssh" log prefix="x" accept"#),
            None
        );
        assert_eq!(
            RuleForm::parse(r#"rule family="ipv4" source address="1.2.3.4 accept"#),
            None
        );
    }

    #[test]
    fn ports_sources_and_names_are_checked() {
        assert!(valid_port("443").is_ok());
        assert!(valid_port("1740-1743").is_ok());
        for bad in ["0", "65536", "10-5", "a", "", "1-"] {
            assert!(valid_port(bad).is_err(), "{bad}");
        }
        assert!(valid_source("192.168.0.10").is_ok());
        assert!(valid_source("192.168.0.0/23").is_ok());
        assert!(valid_source("fd00::/8").is_ok());
        for bad in ["192.168.0.0/33", "host", "1.2.3.4/x", ""] {
            assert!(valid_source(bad).is_err(), "{bad}");
        }
        assert!(valid_name("pixsys-portal", "service").is_ok());
        assert!(valid_name("a b", "service").is_err());
        assert!(valid_protocol("udp").is_ok());
        assert!(valid_protocol("icmp").is_err());
        assert!(Item::RichRule {
            rule: "rule\naccept".into()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn the_operations_follow_the_firewall_as_it_is() {
        let p = fake_picture();
        let add = |i: Item| Op {
            zone: "public".into(),
            action: Action::Add,
            item: i,
        };
        let rm = |i: Item| Op {
            zone: "public".into(),
            action: Action::Remove,
            item: i,
        };
        assert!(check_ops(&p, &[add(port("7444"))]).is_ok());
        assert!(check_ops(&p, &[add(svc("ssh"))]).is_err());
        assert!(check_ops(&p, &[rm(port("7444"))]).is_err());
        assert!(check_ops(&p, &[]).is_err());
        // An edit: the old entry out, the new one in, in one change.
        assert!(check_ops(
            &p,
            &[add(port("4840")), rm(port("4840")), add(port("4841"))]
        )
        .is_ok());
        let other = Op {
            zone: "trusted".into(),
            action: Action::Add,
            item: port("1"),
        };
        assert!(check_ops(&p, &[other]).is_err());
    }

    #[test]
    fn a_disabled_entry_stays_on_the_screen_until_it_comes_back() {
        let mut p = fake_picture();
        let mut stored = Stored::default();
        let off = Op {
            zone: "public".into(),
            action: Action::Remove,
            item: svc("cockpit"),
        };
        fake_apply(&mut p, &off).unwrap();
        remember(&mut stored, std::slice::from_ref(&off), Some("admin"), 5);
        let v = view(&p, &stored, &[], None);
        let e = v.zones[0]
            .entries
            .iter()
            .find(|e| e.item == svc("cockpit"))
            .unwrap();
        assert!(!e.enabled);
        assert_eq!(e.ports, vec!["9090/tcp"]);
        assert_eq!(e.disabled_by.as_deref(), Some("admin"));
        let on = off.inverse();
        fake_apply(&mut p, &on).unwrap();
        remember(&mut stored, &[on], Some("admin"), 6);
        assert!(stored.disabled.is_empty());
        let v = view(&p, &stored, &[], None);
        assert!(v.zones[0].entries.iter().all(|e| e.enabled));
    }

    #[test]
    fn the_ports_of_sws_open_only_where_they_are_closed() {
        let mut p = fake_picture();
        let ops = sws_port_ops(&p);
        assert_eq!(ops.len(), 2);
        assert!(ops
            .iter()
            .all(|o| o.zone == "public" && o.action == Action::Add));
        for op in &ops {
            fake_apply(&mut p, op).unwrap();
        }
        assert!(sws_port_ops(&p).is_empty());
        let v = view(
            &p,
            &Stored::default(),
            &[(7444, "tcp".into()), (4840, "tcp".into())],
            None,
        );
        let l = &v.listen_ports;
        assert_eq!(l[0].open_in, vec!["public"]);
        assert!(l[0].sws);
        // 4840 is in the codesys service.
        assert_eq!(l[1].open_in, vec!["public"]);
        assert!(!l[1].sws);
    }

    #[test]
    fn the_listening_sockets_of_this_process_without_the_loopback() {
        let tcp = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1D13 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 112 1 0000000000000000 100 0 0 10 0
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 999 1 0000000000000000 100 0 0 10 0
   3: 6A01A8C0:1D13 6501A8C0:C350 01 00000000:00000000 00:00000000 00000000  1000        0 113 1 0000000000000000 100 0 0 10 0";
        let inodes: BTreeSet<u64> = [111, 112, 113].into_iter().collect();
        assert_eq!(
            parse_proc_net(tcp, "tcp", &inodes),
            vec![(7443, "tcp".to_string())]
        );
        assert!(is_loopback_hex("00000000000000000000000001000000"));
        assert!(!is_loopback_hex("00000000000000000000000000000000"));
    }

    /// The whole wait, on the fake: one test, because the pending change is
    /// one for the process.
    #[tokio::test]
    async fn a_change_waits_then_is_confirmed_or_undone() {
        let dir = tempfile::tempdir().unwrap();
        let off = |n: &str| Op {
            zone: "public".into(),
            action: Action::Remove,
            item: svc(n),
        };
        // Undone: the entries come back.
        apply(
            vec![off("cockpit"), off("http")],
            Some("admin".into()),
            None,
        )
        .await
        .unwrap();
        let v = state(dir.path()).await.unwrap();
        assert_eq!(v.pending.as_ref().unwrap().ops.len(), 2);
        assert!(!v.zones[0].entries.iter().any(|e| e.item == svc("http")));
        // A second change waits for the first.
        assert!(matches!(
            apply(vec![off("ssh")], None, None).await,
            Err(FwError::Conflict(_))
        ));
        rollback().await.unwrap();
        let v = state(dir.path()).await.unwrap();
        assert!(v.pending.is_none());
        assert!(v.zones[0]
            .entries
            .iter()
            .any(|e| e.item == svc("http") && e.enabled));
        assert!(matches!(rollback().await, Err(FwError::Conflict(_))));
        // Confirmed: the entry stays off, and on the screen.
        apply(vec![off("cockpit")], None, None).await.unwrap();
        confirm(dir.path(), Some("admin")).await.unwrap();
        let v = state(dir.path()).await.unwrap();
        let e = v.zones[0]
            .entries
            .iter()
            .find(|e| e.item == svc("cockpit"))
            .unwrap();
        assert!(!e.enabled);
        assert_eq!(read_stored(dir.path()).disabled.len(), 1);
        // A wrong change touches nothing.
        assert!(matches!(
            apply(vec![off("cockpit")], None, None).await,
            Err(FwError::Bad(_))
        ));
        // Back on.
        apply(vec![off("cockpit").inverse()], None, None)
            .await
            .unwrap();
        confirm(dir.path(), None).await.unwrap();
        assert!(read_stored(dir.path()).disabled.is_empty());
    }

    #[test]
    fn the_api_names_are_stable() {
        let op: Op = serde_json::from_str(
            r#"{"zone":"public","action":"remove","item":{"kind":"port","port":"80","protocol":"tcp"}}"#,
        )
        .unwrap();
        assert_eq!(
            op.item,
            Item::Port {
                port: "80".into(),
                protocol: "tcp".into()
            }
        );
        let e = serde_json::to_value(entry(&svc("ssh"), true, &fake_picture(), None)).unwrap();
        assert_eq!(e["kind"], "service");
        assert_eq!(e["name"], "ssh");
        assert_eq!(e["ports"][0], "22/tcp");
    }
}
