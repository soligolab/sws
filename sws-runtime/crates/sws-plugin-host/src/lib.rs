//! Sorgente «host»: le risorse di sistema (CPU, RAM, temperature, disco, rete,
//! uptime) lette dentro il runtime e scritte nei tag, in sola lettura.
//!
//! Nessun canale verso l'host: nel container `/proc` e `/sys/class/thermal`
//! sono quelli della macchina (misurato sul TC620, 20-09-2026), e con
//! `Network=host` lo sono anche le interfacce. Le letture stanno in funzioni
//! pure (`leggi`, `leggi_temperature`) provabili senza toccare il sistema.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use sws_core::{HostConfig, HostMetric, TagDb, TagQuality, TagValue};
use sysinfo::{Disks, Networks, System};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Una lettura completa dell'host: tutto ciò che una metrica può chiedere.
#[derive(Debug, Default, Clone)]
pub struct Snapshot {
    pub cpu_total: f64,
    pub cpu_core: Vec<f64>,
    pub load: [f64; 3],
    pub mem_total_b: u64,
    pub mem_used_b: u64,
    pub mem_available_b: u64,
    pub swap_total_b: u64,
    pub swap_used_b: u64,
    /// Nome zona → °C.
    pub temp: HashMap<String, f64>,
    /// Mount point → (totale, disponibile) in byte.
    pub disk: HashMap<String, (u64, u64)>,
    /// Interfaccia → (rx, tx) in byte/s.
    pub net_bps: HashMap<String, (f64, f64)>,
    pub uptime_s: u64,
    pub hostname: Option<String>,
    pub serial: Option<String>,
    pub model: Option<String>,
}

const MB: f64 = 1024.0 * 1024.0;
const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn pct(usata: u64, totale: u64) -> Option<f64> {
    (totale > 0).then(|| usata as f64 * 100.0 / totale as f64)
}

/// Il valore di una metrica in una lettura, o `None` se non esiste (param
/// mancante, zona/mount/interfaccia sconosciuti): chi chiama marca il tag Bad.
pub fn leggi(metric: HostMetric, param: Option<&str>, s: &Snapshot) -> Option<f64> {
    let p = param.map(str::trim).filter(|p| !p.is_empty());
    match metric {
        HostMetric::CpuPct => Some(s.cpu_total),
        HostMetric::CpuCorePct => s.cpu_core.get(p?.parse::<usize>().ok()?).copied(),
        HostMetric::Load1 => Some(s.load[0]),
        HostMetric::Load5 => Some(s.load[1]),
        HostMetric::Load15 => Some(s.load[2]),
        HostMetric::MemUsedPct => pct(s.mem_used_b, s.mem_total_b),
        HostMetric::MemUsedMb => Some(s.mem_used_b as f64 / MB),
        HostMetric::MemAvailableMb => Some(s.mem_available_b as f64 / MB),
        HostMetric::MemTotalMb => Some(s.mem_total_b as f64 / MB),
        // Senza swap la percentuale è 0, non un errore: il tag resta buono.
        HostMetric::SwapUsedPct => Some(pct(s.swap_used_b, s.swap_total_b).unwrap_or(0.0)),
        HostMetric::Temp => s.temp.get(p?).copied(),
        HostMetric::DiskUsedPct => {
            let (tot, disp) = *s.disk.get(p?)?;
            pct(tot.saturating_sub(disp), tot)
        }
        HostMetric::DiskFreeGb => s.disk.get(p?).map(|&(_, disp)| disp as f64 / GB),
        HostMetric::NetRxBps => s.net_bps.get(p?).map(|v| v.0),
        HostMetric::NetTxBps => s.net_bps.get(p?).map(|v| v.1),
        HostMetric::UptimeS => Some(s.uptime_s as f64),
        HostMetric::Hostname | HostMetric::SerialNumber | HostMetric::Model => None,
    }
}

/// Il valore di una metrica **testuale**, o `None` se la scheda non lo espone.
pub fn leggi_testo(metric: HostMetric, s: &Snapshot) -> Option<String> {
    match metric {
        HostMetric::Hostname => s.hostname.clone(),
        HostMetric::SerialNumber => s.serial.clone(),
        HostMetric::Model => s.model.clone(),
        _ => None,
    }
}

/// Dove cercare i dati di scheda del device-tree. Nel container `/proc/device-tree`
/// non c'è (podman maschera `/sys/firmware`): `install-container.sh` monta
/// `/sys/firmware/devicetree/base` in sola lettura su `/host/devicetree`.
const DEVICE_TREE: &[&str] = &[
    "/proc/device-tree",
    "/sys/firmware/devicetree/base",
    "/host/devicetree",
];

/// Un campo del device-tree (`serial-number`, `model`): testo con NUL finale.
pub fn leggi_device_tree(basi: &[&str], campo: &str) -> Option<String> {
    basi.iter().find_map(|b| {
        let raw = std::fs::read(Path::new(b).join(campo)).ok()?;
        let t = String::from_utf8_lossy(&raw).replace('\0', "");
        let t = t.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

/// Il seriale: device-tree su ARM, poi il DMI su x86.
fn leggi_seriale() -> Option<String> {
    leggi_device_tree(DEVICE_TREE, "serial-number").or_else(|| {
        let t = std::fs::read_to_string("/sys/class/dmi/id/product_serial").ok()?;
        let t = t.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

/// Le temperature di `root` (di norma `/sys/class`): ogni `thermal/thermal_zone*`
/// col nome del suo `type` (`cpu-thermal`), e ogni `hwmon/hwmon*/temp*_input`
/// come `<name>/tempN`. I valori sono in millesimi di grado.
pub fn leggi_temperature(root: &Path) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let leggi_str = |p: PathBuf| {
        std::fs::read_to_string(p)
            .ok()
            .map(|s| s.trim().to_string())
    };
    if let Ok(rd) = std::fs::read_dir(root.join("thermal")) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if !n.starts_with("thermal_zone") {
                continue;
            }
            let (Some(tipo), Some(t)) = (
                leggi_str(e.path().join("type")),
                leggi_str(e.path().join("temp")),
            ) else {
                continue;
            };
            if let Ok(m) = t.parse::<f64>() {
                out.insert(tipo, m / 1000.0);
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(root.join("hwmon")) {
        for e in rd.flatten() {
            let nome = leggi_str(e.path().join("name"))
                .unwrap_or_else(|| e.file_name().to_string_lossy().to_string());
            let Ok(files) = std::fs::read_dir(e.path()) else {
                continue;
            };
            for f in files.flatten() {
                let fname = f.file_name().to_string_lossy().to_string();
                if let Some(base) = fname
                    .strip_suffix("_input")
                    .filter(|b| b.starts_with("temp"))
                {
                    if let Some(m) = leggi_str(f.path()).and_then(|t| t.parse::<f64>().ok()) {
                        out.insert(format!("{nome}/{base}"), m / 1000.0);
                    }
                }
            }
        }
    }
    out
}

/// Chi tiene gli oggetti `sysinfo` fra una lettura e l'altra: la CPU e la rete
/// sono differenze fra due letture, quindi non si può ricrearli a ogni giro.
pub struct Collector {
    sys: System,
    nets: Networks,
    ultima: Instant,
    sysfs: PathBuf,
    /// Seriale e modello non cambiano: si leggono una volta.
    serial: Option<String>,
    model: Option<String>,
}

impl Collector {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu();
        sys.refresh_memory();
        Self {
            sys,
            nets: Networks::new_with_refreshed_list(),
            ultima: Instant::now(),
            sysfs: PathBuf::from("/sys/class"),
            serial: leggi_seriale(),
            model: leggi_device_tree(DEVICE_TREE, "model"),
        }
    }

    pub fn leggi(&mut self) -> Snapshot {
        self.sys.refresh_cpu();
        self.sys.refresh_memory();
        self.nets.refresh();
        let dt = self.ultima.elapsed().as_secs_f64().max(0.001);
        self.ultima = Instant::now();
        let la = System::load_average();
        Snapshot {
            cpu_total: f64::from(self.sys.global_cpu_info().cpu_usage()),
            cpu_core: self
                .sys
                .cpus()
                .iter()
                .map(|c| f64::from(c.cpu_usage()))
                .collect(),
            load: [la.one, la.five, la.fifteen],
            mem_total_b: self.sys.total_memory(),
            mem_used_b: self.sys.used_memory(),
            mem_available_b: self.sys.available_memory(),
            swap_total_b: self.sys.total_swap(),
            swap_used_b: self.sys.used_swap(),
            temp: leggi_temperature(&self.sysfs),
            disk: Disks::new_with_refreshed_list()
                .iter()
                .map(|d| {
                    (
                        d.mount_point().to_string_lossy().to_string(),
                        (d.total_space(), d.available_space()),
                    )
                })
                .collect(),
            net_bps: self
                .nets
                .iter()
                .map(|(n, d)| {
                    (
                        n.clone(),
                        (d.received() as f64 / dt, d.transmitted() as f64 / dt),
                    )
                })
                .collect(),
            uptime_s: System::uptime(),
            hostname: std::fs::read_to_string("/proc/sys/kernel/hostname")
                .ok()
                .map(|h| h.trim().to_string())
                .filter(|h| !h.is_empty())
                .or_else(System::host_name),
            serial: self.serial.clone(),
            model: self.model.clone(),
        }
    }
}

impl Default for Collector {
    fn default() -> Self {
        Self::new()
    }
}

/// Cosa c'è su questa macchina: alimenta il catalogo dell'editor.
#[derive(Debug, Default, Clone)]
pub struct Catalogo {
    pub temperature: Vec<String>,
    pub mount: Vec<String>,
    pub interfacce: Vec<String>,
    pub core: usize,
}

pub fn catalogo() -> Catalogo {
    let s = Collector::new().leggi();
    let ordinati = |mut v: Vec<String>| {
        v.sort();
        v
    };
    Catalogo {
        temperature: ordinati(s.temp.keys().cloned().collect()),
        mount: ordinati(s.disk.keys().cloned().collect()),
        interfacce: ordinati(s.net_bps.keys().cloned().collect()),
        core: s.cpu_core.len(),
    }
}

/// Entry point. Legge l'host a ogni intervallo finché `cancel` non scatta.
pub async fn run(cfg: HostConfig, db: Arc<TagDb>, cancel: CancellationToken) {
    info!(source = %cfg.id, metriche = cfg.metrics.len(), "Host metrics source started");
    let mut collector = Collector::new();
    // Una metrica non disponibile si segnala una volta, non a ogni lettura.
    let mut segnalati: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut ticker = tokio::time::interval(Duration::from_millis(cfg.poll_interval_ms.max(200)));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = ticker.tick() => {
                let snap = collector.leggi();
                for m in &cfg.metrics {
                    if m.metric.e_testo() {
                        match leggi_testo(m.metric, &snap) {
                            Some(t) => {
                                segnalati.remove(&m.tag);
                                db.ingest(m.tag.clone(), TagValue::Str(t), TagQuality::Good).await;
                            }
                            None => {
                                if segnalati.insert(m.tag.clone()) {
                                    warn!(source = %cfg.id, tag = %m.tag, "host metric unavailable on this device");
                                }
                                db.marca_qualita(&m.tag, TagQuality::Bad).await;
                            }
                        }
                        continue;
                    }
                    match leggi(m.metric, m.param.as_deref(), &snap) {
                        Some(v) => {
                            segnalati.remove(&m.tag);
                            db.ingest(m.tag.clone(), TagValue::Float(v), TagQuality::Good).await;
                        }
                        None => {
                            if segnalati.insert(m.tag.clone()) {
                                warn!(source = %cfg.id, tag = %m.tag, "host metric unavailable (param mancante o sconosciuto)");
                            }
                            db.marca_qualita(&m.tag, TagQuality::Bad).await;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap() -> Snapshot {
        let mut s = Snapshot {
            cpu_total: 12.5,
            cpu_core: vec![10.0, 20.0],
            load: [1.0, 2.0, 3.0],
            mem_total_b: 2000 * 1024 * 1024,
            mem_used_b: 500 * 1024 * 1024,
            mem_available_b: 1400 * 1024 * 1024,
            swap_total_b: 0,
            uptime_s: 99,
            ..Default::default()
        };
        s.temp.insert("cpu-thermal".into(), 60.0);
        s.disk.insert(
            "/var/sws/projects".into(),
            (10 * 1024 * 1024 * 1024, 4 * 1024 * 1024 * 1024),
        );
        s.net_bps.insert("eth0".into(), (100.0, 50.0));
        s
    }

    #[test]
    fn metriche_senza_param() {
        let s = snap();
        assert_eq!(leggi(HostMetric::CpuPct, None, &s), Some(12.5));
        assert_eq!(leggi(HostMetric::Load15, None, &s), Some(3.0));
        assert_eq!(leggi(HostMetric::MemUsedPct, None, &s), Some(25.0));
        assert_eq!(leggi(HostMetric::MemTotalMb, None, &s), Some(2000.0));
        assert_eq!(leggi(HostMetric::UptimeS, None, &s), Some(99.0));
        // Senza swap: 0 %, non un errore.
        assert_eq!(leggi(HostMetric::SwapUsedPct, None, &s), Some(0.0));
    }

    #[test]
    fn metriche_con_param() {
        let s = snap();
        assert_eq!(leggi(HostMetric::CpuCorePct, Some("1"), &s), Some(20.0));
        assert_eq!(leggi(HostMetric::Temp, Some("cpu-thermal"), &s), Some(60.0));
        assert_eq!(
            leggi(HostMetric::DiskUsedPct, Some("/var/sws/projects"), &s),
            Some(60.0)
        );
        assert_eq!(
            leggi(HostMetric::DiskFreeGb, Some("/var/sws/projects"), &s),
            Some(4.0)
        );
        assert_eq!(leggi(HostMetric::NetTxBps, Some("eth0"), &s), Some(50.0));
    }

    #[test]
    fn param_mancante_o_sconosciuto_e_none() {
        let s = snap();
        assert_eq!(leggi(HostMetric::Temp, None, &s), None);
        assert_eq!(leggi(HostMetric::Temp, Some("  "), &s), None);
        assert_eq!(leggi(HostMetric::Temp, Some("gpu"), &s), None);
        assert_eq!(leggi(HostMetric::CpuCorePct, Some("9"), &s), None);
        assert_eq!(leggi(HostMetric::CpuCorePct, Some("x"), &s), None);
        assert_eq!(leggi(HostMetric::DiskFreeGb, Some("/nope"), &s), None);
    }

    #[test]
    fn temperature_da_sysfs_finto() {
        let root = std::env::temp_dir().join(format!("sws-host-sysfs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let z = root.join("thermal/thermal_zone0");
        std::fs::create_dir_all(&z).unwrap();
        std::fs::write(z.join("type"), "cpu-thermal\n").unwrap();
        std::fs::write(z.join("temp"), "60000\n").unwrap();
        let h = root.join("hwmon/hwmon1");
        std::fs::create_dir_all(&h).unwrap();
        std::fs::write(h.join("name"), "nvme\n").unwrap();
        std::fs::write(h.join("temp1_input"), "41500\n").unwrap();
        let t = leggi_temperature(&root);
        assert_eq!(t.get("cpu-thermal"), Some(&60.0));
        assert_eq!(t.get("nvme/temp1"), Some(&41.5));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn metriche_di_testo() {
        let mut s = snap();
        s.hostname = Some("tc620".into());
        s.serial = Some("P052600C00292600014".into());
        assert_eq!(
            leggi_testo(HostMetric::Hostname, &s).as_deref(),
            Some("tc620")
        );
        assert_eq!(
            leggi_testo(HostMetric::SerialNumber, &s).as_deref(),
            Some("P052600C00292600014")
        );
        assert_eq!(leggi_testo(HostMetric::Model, &s), None);
        assert!(HostMetric::Model.e_testo() && !HostMetric::CpuPct.e_testo());
        // Una metrica testuale non ha un valore numerico.
        assert_eq!(leggi(HostMetric::Hostname, None, &s), None);
    }

    #[test]
    fn device_tree_toglie_il_nul_finale() {
        let root = std::env::temp_dir().join(format!("sws-host-dt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("serial-number"), b"P0526\0").unwrap();
        let r = root.to_string_lossy().to_string();
        assert_eq!(
            leggi_device_tree(&["/non/esiste", &r], "serial-number").as_deref(),
            Some("P0526")
        );
        assert_eq!(leggi_device_tree(&[&r], "model"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sysfs_assente_non_e_un_errore() {
        assert!(leggi_temperature(Path::new("/non/esiste")).is_empty());
    }
}
