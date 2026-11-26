//! The Firewall section of the LVGL control panel (26-11-2026): the same
//! draft as the web (`sws-editor/src/firewall/core.ts`), on the same routes
//! (`/api/control-panel/firewall*`). Pure, so the tests need no screen. Plan
//! `docs/plans/2026-11-26-firewall-dei-dispositivi.md`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Op {
    pub zone: String,
    pub action: Action,
    pub item: Item,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuleTarget {
    Port { port: String, protocol: String },
    Service { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RuleForm {
    pub source: String,
    pub target: RuleTarget,
    pub verdict: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Entry {
    #[serde(flatten)]
    pub item: Item,
    pub enabled: bool,
    #[serde(default)]
    pub ports: Vec<String>,
    #[serde(default)]
    pub form: Option<RuleForm>,
    #[serde(default)]
    pub disabled_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Zone {
    pub name: String,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub interfaces: Vec<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListenPort {
    pub port: u16,
    pub protocol: String,
    #[serde(default)]
    pub sws: bool,
    #[serde(default)]
    pub open_in: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PendingView {
    pub seconds_left: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct View {
    pub available: bool,
    #[serde(default)]
    pub zones: Vec<Zone>,
    #[serde(default)]
    pub known_services: Vec<String>,
    #[serde(default)]
    pub listen_ports: Vec<ListenPort>,
    #[serde(default)]
    pub pending: Option<PendingView>,
}

pub const PROTOCOLS: [&str; 4] = ["tcp", "udp", "sctp", "dccp"];
pub const VERDICTS: [&str; 3] = ["accept", "reject", "drop"];
const SWS_PORTS: [u16; 2] = [7443, 7444];

// ── Validation and rules, the same as the runtime's ─────────────────────────

pub fn valid_port(s: &str) -> bool {
    let n = |x: &str| x.len() <= 5 && x.parse::<u16>().is_ok_and(|v| v > 0);
    match s.split_once('-') {
        Some((a, b)) => n(a) && n(b) && a.parse::<u16>().ok() < b.parse::<u16>().ok(),
        None => n(s),
    }
}

pub fn valid_source(s: &str) -> bool {
    let (addr, prefix) = match s.split_once('/') {
        Some((a, p)) => (a, Some(p)),
        None => (s, None),
    };
    let Ok(ip) = addr.parse::<std::net::IpAddr>() else {
        return false;
    };
    match prefix {
        None => true,
        Some(p) => p
            .parse::<u8>()
            .is_ok_and(|p| p <= if ip.is_ipv4() { 32 } else { 128 }),
    }
}

/// The firewalld text of a rule of the form: the same text the runtime writes.
pub fn compose_rule(source: &str, target: &RuleTarget, verdict: &str) -> String {
    let family = if source.split('/').next().unwrap_or("").contains(':') {
        "ipv6"
    } else {
        "ipv4"
    };
    let what = match target {
        RuleTarget::Port { port, protocol } => {
            format!("port port=\"{port}\" protocol=\"{protocol}\"")
        }
        RuleTarget::Service { name } => format!("service name=\"{name}\""),
    };
    format!("rule family=\"{family}\" source address=\"{source}\" {what} {verdict}")
}

/// What a row shows as its name.
pub fn label(i: &Item) -> String {
    match i {
        Item::Service { name } => name.clone(),
        Item::Port { port, protocol } => format!("{port}/{protocol}"),
        Item::RichRule { rule } => rule.clone(),
    }
}

fn in_range(p: &str, port: u16) -> bool {
    match p.split_once('-') {
        Some((a, b)) => {
            matches!((a.parse::<u16>(), b.parse::<u16>()), (Ok(a), Ok(b)) if a <= port && port <= b)
        }
        None => p.parse::<u16>() == Ok(port),
    }
}

/// Removing this entry can cut the line to the device: a port of SWS, or ssh.
pub fn is_sensitive(e: &Entry) -> bool {
    if matches!(&e.item, Item::Service { name } if name == "ssh") {
        return true;
    }
    let ports: Vec<String> = match &e.item {
        Item::Port { port, protocol } => vec![format!("{port}/{protocol}")],
        Item::Service { .. } => e.ports.clone(),
        Item::RichRule { .. } => vec![],
    };
    ports.iter().any(|t| {
        let (p, proto) = t.split_once('/').unwrap_or((t, ""));
        proto == "tcp" && (SWS_PORTS.iter().any(|s| in_range(p, *s)) || in_range(p, 22))
    })
}

// ── The draft ───────────────────────────────────────────────────────────────

/// A row as the screen draws it: the entry with the draft applied.
#[derive(Debug, Clone)]
pub struct Row {
    pub entry: Entry,
    pub on: bool,
    pub changed: bool,
    pub added: bool,
}

pub fn rows_of(z: &Zone, draft: &[Op]) -> Vec<Row> {
    let ops: Vec<&Op> = draft.iter().filter(|o| o.zone == z.name).collect();
    let mut rows: Vec<Row> = z
        .entries
        .iter()
        .map(|e| {
            let last = ops.iter().rev().find(|o| o.item == e.item);
            let on = last.map_or(e.enabled, |o| o.action == Action::Add);
            Row {
                entry: e.clone(),
                on,
                changed: on != e.enabled,
                added: false,
            }
        })
        .collect();
    for o in &ops {
        if o.action != Action::Add || rows.iter().any(|r| r.entry.item == o.item) {
            continue;
        }
        rows.push(Row {
            entry: Entry {
                item: o.item.clone(),
                enabled: false,
                ports: vec![],
                form: None,
                disabled_by: None,
            },
            on: true,
            changed: true,
            added: true,
        });
    }
    rows
}

/// The draft with this row switched. Switching back takes the operation away.
pub fn toggle(draft: &[Op], zone: &str, r: &Row) -> Vec<Op> {
    let without: Vec<Op> = draft
        .iter()
        .filter(|o| !(o.zone == zone && o.item == r.entry.item))
        .cloned()
        .collect();
    if r.added || r.changed {
        return without;
    }
    let mut d = without;
    d.push(Op {
        zone: zone.to_string(),
        action: if r.entry.enabled {
            Action::Remove
        } else {
            Action::Add
        },
        item: r.entry.item.clone(),
    });
    d
}

pub fn add_item(draft: &[Op], z: &Zone, item: Item) -> Vec<Op> {
    if let Some(r) = rows_of(z, draft).into_iter().find(|r| r.entry.item == item) {
        return if r.on {
            draft.to_vec()
        } else {
            toggle(draft, &z.name, &r)
        };
    }
    let mut d = draft.to_vec();
    d.push(Op {
        zone: z.name.clone(),
        action: Action::Add,
        item,
    });
    d
}

/// The draft with the row's entry replaced by `next`, in one change.
pub fn edit_item(draft: &[Op], z: &Zone, r: &Row, next: Item) -> Vec<Op> {
    if r.entry.item == next {
        return draft.to_vec();
    }
    let mut d = draft.to_vec();
    if r.added {
        d = toggle(&d, &z.name, r);
    } else if r.on && !r.changed {
        d.push(Op {
            zone: z.name.clone(),
            action: Action::Remove,
            item: r.entry.item.clone(),
        });
    }
    add_item(&d, z, next)
}

/// The removals first, then the additions.
pub fn ops_to_send(draft: &[Op]) -> Vec<Op> {
    let mut v: Vec<Op> = draft
        .iter()
        .filter(|o| o.action == Action::Remove)
        .cloned()
        .collect();
    v.extend(draft.iter().filter(|o| o.action == Action::Add).cloned());
    v
}

pub fn draft_is_sensitive(v: &View, draft: &[Op]) -> bool {
    draft.iter().any(|o| {
        o.action == Action::Remove
            && v.zones
                .iter()
                .filter(|z| z.name == o.zone)
                .flat_map(|z| z.entries.iter())
                .any(|e| e.item == o.item && is_sensitive(e))
    })
}

/// The zone where «Open» puts a closed port.
pub fn zone_for_open(v: &View) -> Option<&Zone> {
    v.zones
        .iter()
        .find(|z| !z.interfaces.is_empty())
        .or_else(|| v.zones.iter().find(|z| z.default))
        .or_else(|| v.zones.first())
}

// ── The form ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum FormKind {
    Service,
    Port,
    Rule,
    /// Edit of the row with this entry.
    Edit(Item),
}

/// What is being typed on the on-screen keyboard.
#[derive(Debug, Clone)]
pub struct Form {
    pub zone: String,
    pub kind: FormKind,
    /// A port (Port, edit of a port).
    pub port: String,
    pub protocol: usize,
    /// A rule: the source, and the port or the service.
    pub source: String,
    pub rule_port: String,
    pub target_port: bool,
    pub service: usize,
    pub verdict: usize,
    /// The text field the keyboard writes in.
    pub focus: usize,
    pub shift: bool,
    pub symbols: bool,
}

impl Form {
    pub fn new(zone: &str, kind: FormKind) -> Form {
        Form {
            zone: zone.to_string(),
            kind,
            port: String::new(),
            protocol: 0,
            source: String::new(),
            rule_port: String::new(),
            target_port: true,
            service: 0,
            verdict: 0,
            focus: 0,
            shift: false,
            symbols: false,
        }
    }

    /// The form of an existing entry: a port, or a rule of the form.
    pub fn edit(zone: &str, e: &Entry, services: &[String]) -> Option<Form> {
        let mut f = Form::new(zone, FormKind::Edit(e.item.clone()));
        match (&e.item, &e.form) {
            (Item::Port { port, protocol }, _) => {
                f.port = port.clone();
                f.protocol = PROTOCOLS.iter().position(|p| p == protocol).unwrap_or(0);
            }
            (Item::RichRule { .. }, Some(rf)) => {
                f.source = rf.source.clone();
                f.verdict = VERDICTS.iter().position(|v| *v == rf.verdict).unwrap_or(0);
                match &rf.target {
                    RuleTarget::Port { port, protocol } => {
                        f.rule_port = port.clone();
                        f.protocol = PROTOCOLS.iter().position(|p| p == protocol).unwrap_or(0);
                    }
                    RuleTarget::Service { name } => {
                        f.target_port = false;
                        f.service = services.iter().position(|s| s == name).unwrap_or(0);
                    }
                }
            }
            _ => return None,
        }
        Some(f)
    }

    /// This form edits or makes a rule.
    pub fn is_rule(&self) -> bool {
        match &self.kind {
            FormKind::Rule => true,
            FormKind::Edit(i) => matches!(i, Item::RichRule { .. }),
            _ => false,
        }
    }

    /// The text fields, in order: what `focus` counts.
    pub fn text_fields(&self) -> usize {
        match &self.kind {
            FormKind::Service => 0,
            _ if self.is_rule() => {
                if self.target_port {
                    2
                } else {
                    1
                }
            }
            _ => 1,
        }
    }

    fn field(&mut self) -> Option<&mut String> {
        if self.is_rule() {
            match self.focus {
                0 => Some(&mut self.source),
                1 if self.target_port => Some(&mut self.rule_port),
                _ => None,
            }
        } else if self.kind == FormKind::Service {
            None
        } else {
            Some(&mut self.port)
        }
    }

    /// A key of the keyboard: a character, `⌫`, `⇧`, `?123`/`abc`.
    pub fn key(&mut self, k: &str) {
        match k {
            "⇧" => self.shift = !self.shift,
            "?123" | "abc" => self.symbols = !self.symbols,
            _ => {
                if let Some(f) = self.field() {
                    if k == "⌫" {
                        f.pop();
                    } else if f.chars().count() < 45 {
                        f.push_str(k);
                    }
                }
            }
        }
    }

    /// The entry the form makes, when every field is valid.
    pub fn item(&self, services: &[String]) -> Option<Item> {
        let protocol = PROTOCOLS[self.protocol % PROTOCOLS.len()].to_string();
        if self.kind == FormKind::Service {
            return services
                .get(self.service)
                .map(|n| Item::Service { name: n.clone() });
        }
        if !self.is_rule() {
            let port = self.port.trim();
            return valid_port(port).then(|| Item::Port {
                port: port.to_string(),
                protocol,
            });
        }
        let source = self.source.trim();
        if !valid_source(source) {
            return None;
        }
        let target = if self.target_port {
            let p = self.rule_port.trim();
            if !valid_port(p) {
                return None;
            }
            RuleTarget::Port {
                port: p.to_string(),
                protocol,
            }
        } else {
            RuleTarget::Service {
                name: services.get(self.service)?.clone(),
            }
        };
        Some(Item::RichRule {
            rule: compose_rule(source, &target, VERDICTS[self.verdict % VERDICTS.len()]),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view() -> View {
        serde_json::from_value(serde_json::json!({
            "available": true,
            "default_zone": "public",
            "zones": [{
                "name": "public", "default": true, "interfaces": ["ethernet0"], "sources": [],
                "entries": [
                    { "kind": "service", "name": "ssh", "enabled": true, "ports": ["22/tcp"] },
                    { "kind": "service", "name": "cockpit", "enabled": true, "ports": ["9090/tcp"] },
                    { "kind": "port", "port": "7444", "protocol": "tcp", "enabled": true },
                    { "kind": "service", "name": "atvise", "enabled": false, "disabled_by": "admin" },
                    { "kind": "rich_rule", "rule": "rule family=\"ipv4\" source address=\"10.0.0.0/8\" service name=\"ssh\" accept",
                      "enabled": true,
                      "form": { "source": "10.0.0.0/8", "target": { "kind": "service", "name": "ssh" }, "verdict": "accept" } }
                ]
            }],
            "known_services": ["atvise", "cockpit", "http", "ssh"],
            "listen_ports": [{ "port": 7443, "protocol": "tcp", "sws": true, "open_in": [] }],
            "pending": null,
            "confirm_within_secs": 60
        }))
        .unwrap()
    }

    #[test]
    fn the_view_of_the_runtime_is_read() {
        let v = view();
        let z = &v.zones[0];
        assert_eq!(z.entries.len(), 5);
        assert!(z.entries[4].form.is_some());
        assert!(!z.entries[3].enabled);
    }

    #[test]
    fn a_switch_off_and_back_leaves_nothing() {
        let v = view();
        let z = &v.zones[0];
        let rows = rows_of(z, &[]);
        let d = toggle(&[], &z.name, &rows[1]);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].action, Action::Remove);
        let rows = rows_of(z, &d);
        assert!(!rows[1].on && rows[1].changed);
        assert!(toggle(&d, &z.name, &rows[1]).is_empty());
        // A disabled entry comes back with an addition.
        let d = toggle(&[], &z.name, &rows_of(z, &[])[3]);
        assert_eq!(d[0].action, Action::Add);
    }

    #[test]
    fn an_edit_is_one_change() {
        let v = view();
        let z = &v.zones[0];
        let r = &rows_of(z, &[])[2];
        let d = edit_item(
            &[],
            z,
            r,
            Item::Port {
                port: "7445".into(),
                protocol: "tcp".into(),
            },
        );
        let ops = ops_to_send(&d);
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].action, Action::Remove);
        assert_eq!(ops[1].action, Action::Add);
        assert!(draft_is_sensitive(&v, &d));
    }

    #[test]
    fn the_form_makes_the_same_rule_as_the_web() {
        let mut f = Form::new("public", FormKind::Rule);
        for k in "192.168.0.0/23".chars() {
            f.key(&k.to_string());
        }
        f.focus = 1;
        for k in "7444".chars() {
            f.key(&k.to_string());
        }
        assert_eq!(
            f.item(&[]),
            Some(Item::RichRule {
                rule: r#"rule family="ipv4" source address="192.168.0.0/23" port port="7444" protocol="tcp" accept"#.into()
            })
        );
        f.key("⌫");
        f.key("⌫");
        f.key("⌫");
        f.key("⌫");
        assert_eq!(f.item(&[]), None);
        let v = view();
        let e = &v.zones[0].entries[4];
        let f = Form::edit("public", e, &v.known_services).unwrap();
        assert!(!f.target_port);
        assert_eq!(f.item(&v.known_services), Some(e.item.clone()));
    }

    #[test]
    fn ports_and_sources_are_checked() {
        assert!(valid_port("1740-1743"));
        assert!(!valid_port("0"));
        assert!(!valid_port("10-5"));
        assert!(valid_source("fd00::/8"));
        assert!(!valid_source("10.0.0.0/33"));
    }
}
