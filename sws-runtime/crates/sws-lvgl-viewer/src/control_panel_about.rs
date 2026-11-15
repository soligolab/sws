//! The About section of the control panel: the answer of
//! `GET /api/control-panel/about` turned into cards of label and value. Pure,
//! so the tests need no screen; `lvgl_control_panel` only draws them.

use crate::control_panel::word;
use serde_json::Value;

pub struct Card {
    pub title: String,
    pub rows: Vec<(String, String)>,
}

/// «1,2 MB»: one decimal from the kilobyte up.
pub fn size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = bytes as f64;
    let mut unit = 0;
    while v >= 1024.0 && unit < UNITS.len() - 1 {
        v /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[unit])
    }
}

/// «3 g 4 h», «4 h 12 min», «12 min».
pub fn duration(lang: &str, secs: u64) -> String {
    let (d, h, m) = (secs / 86_400, secs % 86_400 / 3_600, secs % 3_600 / 60);
    let days = word(lang, "aboutDays", &[]);
    if d > 0 {
        format!("{d} {days} {h} h")
    } else if h > 0 {
        format!("{h} h {m} min")
    } else {
        format!("{m} min")
    }
}

fn date(ms: u64) -> Option<String> {
    use chrono::TimeZone;
    let t = chrono::Local.timestamp_millis_opt(ms as i64).single()?;
    Some(t.format("%d-%m-%Y %H:%M").to_string())
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_string)
}

fn number(v: &Value, key: &str) -> Option<u64> {
    v.get(key)?.as_u64()
}

pub fn cards(about: &Value, lang: &str) -> Vec<Card> {
    let w = |key: &str| word(lang, key, &[]);
    let dash = || "—".to_string();
    let mut out = Vec::new();

    let sws = &about["sws"];
    let mut rows = vec![(
        w("aboutVersion"),
        match (text(sws, "version"), text(sws, "git")) {
            (Some(v), Some(g)) => format!("{v} ({g})"),
            (v, _) => v.unwrap_or_else(dash),
        },
    )];
    if let Some(d) = number(sws, "build_ms").and_then(date) {
        rows.push((w("aboutBuilt"), d));
    }
    rows.push((w("aboutEngine"), "LVGL".into()));
    if let Some(s) = number(sws, "uptime_s") {
        rows.push((w("aboutRunning"), duration(lang, s)));
    }
    out.push(Card {
        title: "SWS".into(),
        rows,
    });

    let p = &about["project"];
    let rows = if p.is_null() {
        vec![(w("aboutName"), w("aboutNoProject"))]
    } else {
        let mut rows = vec![(
            w("aboutName"),
            match (text(p, "name"), text(p, "version")) {
                (Some(n), Some(v)) => format!("{n} · {v}"),
                (n, _) => n.unwrap_or_else(dash),
            },
        )];
        if let Some(d) = number(p, "loaded_ms").and_then(date) {
            rows.push((w("aboutLoaded"), d));
        }
        rows.push((w("aboutSize"), size(number(p, "size_bytes").unwrap_or(0))));
        rows.push((
            w("aboutHistory"),
            size(number(p, "history_bytes").unwrap_or(0)),
        ));
        rows.push((
            w("aboutContents"),
            word(
                lang,
                "aboutContentsValue",
                &[
                    ("pages", &number(p, "pages").unwrap_or(0).to_string()),
                    ("tags", &number(p, "tags").unwrap_or(0).to_string()),
                    ("sources", &number(p, "sources").unwrap_or(0).to_string()),
                ],
            ),
        ));
        rows
    };
    out.push(Card {
        title: w("aboutProject"),
        rows,
    });

    let sys = &about["system"];
    let mut rows = Vec::new();
    for (key, label) in [
        ("os", "aboutOs"),
        ("kernel", "aboutKernel"),
        ("image", "aboutImage"),
    ] {
        if let Some(v) = text(sys, key) {
            rows.push((w(label), v));
        }
    }
    let of = |used: Option<u64>, total: Option<u64>, unit: &str| {
        Some(word(
            lang,
            "aboutOf",
            &[
                ("used", &used?.to_string()),
                ("total", &total?.to_string()),
                ("unit", unit),
            ],
        ))
    };
    if let Some(v) = of(
        number(sys, "disk_used_gb"),
        number(sys, "disk_total_gb"),
        "GB",
    ) {
        rows.push((w("aboutDisk"), v));
    }
    if let Some(v) = of(
        number(sys, "mem_used_mb"),
        number(sys, "mem_total_mb"),
        "MB",
    ) {
        rows.push((w("aboutMemory"), v));
    }
    if let Some(t) = sys.get("cpu_temp_c").and_then(Value::as_f64) {
        rows.push((w("aboutTemp"), format!("{t:.0} °C")));
    }
    if let Some(s) = number(sys, "uptime_s") {
        rows.push((w("aboutUptime"), duration(lang, s)));
    }
    out.push(Card {
        title: w("aboutSystem"),
        rows,
    });

    let st = &about["state"];
    let sources = if st.get("armed").and_then(Value::as_bool) == Some(false) {
        w("aboutStopped")
    } else {
        word(
            lang,
            "aboutSourcesValue",
            &[
                (
                    "running",
                    &number(st, "sources_running").unwrap_or(0).to_string(),
                ),
                ("total", &number(st, "sources").unwrap_or(0).to_string()),
            ],
        )
    };
    let mut rows = vec![
        (w("aboutSources"), sources),
        (
            w("aboutAlarms"),
            number(st, "alarms_active").unwrap_or(0).to_string(),
        ),
        (
            w("aboutCloud"),
            text(st, "cloud").unwrap_or_else(|| w("aboutCloudNone")),
        ),
        (
            w("aboutUpdate"),
            text(st, "update_available").unwrap_or_else(|| w("aboutUpdateNone")),
        ),
    ];
    if let Some(d) = number(st, "certificate_expires_ms").and_then(date) {
        rows.push((
            w("aboutCertificate"),
            word(lang, "aboutExpires", &[("date", &d)]),
        ));
    }
    out.push(Card {
        title: w("aboutState"),
        rows,
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_durations_read_well() {
        assert_eq!(size(812), "812 B");
        assert_eq!(size(300 * 1024), "300.0 KB");
        assert_eq!(size(13 * 1024 * 1024 + 512 * 1024), "13.5 MB");
        assert_eq!(duration("en", 59), "0 min");
        assert_eq!(duration("en", 4 * 3600 + 12 * 60), "4 h 12 min");
        assert_eq!(duration("it", 3 * 86_400 + 4 * 3600), "3 g 4 h");
    }

    #[test]
    fn the_cards_follow_the_answer() {
        let about = serde_json::json!({
            "sws": {"version": "2.26.0", "git": "abc1234", "uptime_s": 120},
            "project": {"name": "tiny-ty", "version": "1.0", "size_bytes": 302_080,
                "history_bytes": 13_631_488, "pages": 3, "tags": 12, "sources": 2},
            "system": {"os": "Ubuntu 22.04.5 LTS", "kernel": "5.10.252",
                "disk_used_gb": 2, "disk_total_gb": 6, "cpu_temp_c": 58.2},
            "state": {"sources_running": 1, "sources": 2, "armed": true, "alarms_active": 0},
        });
        let c = cards(&about, "it");
        assert_eq!(c.len(), 4);
        assert_eq!(c[0].rows[0].1, "2.26.0 (abc1234)");
        assert_eq!(c[1].rows[0].1, "tiny-ty · 1.0");
        assert!(c[1].rows.iter().any(|(_, v)| v == "295.0 KB"));
        assert!(c[1].rows.iter().any(|(_, v)| v == "13.0 MB"));
        assert!(c[2].rows.iter().any(|(_, v)| v == "58 °C"));
        assert_eq!(c[3].rows[0].1, "1 di 2 in funzione");
        // No project: the card says so instead of showing zeros.
        let none = serde_json::json!({"sws": {}, "project": null, "system": {}, "state": {}});
        assert_eq!(cards(&none, "it")[1].rows.len(), 1);
    }
}
