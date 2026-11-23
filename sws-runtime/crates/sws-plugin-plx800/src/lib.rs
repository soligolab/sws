//! Source `plx800_io`: the I/O module of a Pixsys PLX800.
//!
//! PixsysOS (2.0 and later) publishes the module as a shared segment,
//! `/dev/shm/qmb800_registers`, refreshed about every millisecond by a system
//! service. This source maps it, reads a consistent copy at every poll, and —
//! only with `writes: true` — commands outputs, LEDs, PWM and PoE as the
//! single writer of the segment. Plan: `docs/plans/2026-11-23-plx800-sws-e-modulo-io.md`.
//!
//! In the container the segment is reached through the host `/dev/shm`, which
//! the installer mounts when the file exists.

pub mod points;
pub mod shm;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use serde::Serialize;
use shm::{Command, OpenError, Segment, Snapshot, WriterLock};
use sws_core::{
    stato_sorgenti::{Collegamento, StatoSorgenti},
    Plx800IoConfig, Plx800Point, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest,
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// The image counts as fresh if its counter moved within this time, measured
/// with our own monotonic clock (never `timestamp_ns`, which follows the wall
/// clock). The reference suggests 100 ms; a slower poll widens it.
fn stale_after(poll: Duration) -> Duration {
    (poll * 3).max(Duration::from_millis(300))
}

/// Not fresh for this long on the same file: the system service is stuck. The
/// outputs go to rest and the writer lock is let go until the image moves.
/// (A file removed or replaced is opened again at once, see [`watch`].)
const REOPEN_AFTER: Duration = Duration::from_secs(5);

/// A missing segment is looked for again this often. It is a local file, so
/// looking costs nothing: the generic reconnection doubled its wait up to 30 s
/// and kept the points Bad for 24 s after the service came back (PLX800,
/// 23-11-2026).
const SEGMENT_RETRY: Duration = Duration::from_millis(500);

/// Unchanged values are sent again this often, so their timestamp stays
/// recent for the objects that check it.
const REFRESH_EVERY: Duration = Duration::from_secs(1);

/// A busy writer lock is tried again this often.
const LOCK_RETRY: Duration = Duration::from_secs(5);

/// Where the segment and the lock are: the system paths, or a test folder.
#[derive(Debug, Clone)]
pub struct Paths {
    pub segment: PathBuf,
    pub lock: PathBuf,
}

impl Default for Paths {
    fn default() -> Self {
        Paths {
            segment: PathBuf::from(shm::SHM_PATH),
            lock: PathBuf::from(shm::LOCK_PATH),
        }
    }
}

/// Freshness of the image: when its counter last moved.
#[derive(Debug, Default)]
struct Freshness {
    last_count: Option<u64>,
    last_change: Option<Instant>,
}

impl Freshness {
    /// Records a sample; `true` if the image is fresh. The first sample is
    /// never fresh: one value of the counter says nothing about it moving.
    fn sample(&mut self, count: u64, now: Instant, limit: Duration) -> bool {
        if self.last_count != Some(count) {
            if self.last_count.is_some() {
                self.last_change = Some(now);
            }
            self.last_count = Some(count);
        }
        self.last_change
            .is_some_and(|t| now.duration_since(t) <= limit)
    }

    fn silent_for(&self, now: Instant) -> Option<Duration> {
        self.last_change.map(|t| now.duration_since(t))
    }
}

/// The writer side: the lock, our copy of the command, and what is needed to
/// leave the module in its safe state.
struct Commander {
    seg: Segment,
    _lock: WriterLock,
    /// Our copy of the complete command. `None` = start again from the
    /// read-back (at the start, and after someone else wrote).
    cmd: Option<Command>,
    /// `cmd_seq` after our last commit: anything else means a foreign writer.
    last_commit: Option<u32>,
    run_led_mode_at_start: u16,
    wrote: bool,
}

impl Commander {
    fn foreign_writer(&self) -> bool {
        self.last_commit.is_some_and(|s| s != self.seg.cmd_seq())
    }

    /// Applies one write and publishes the complete command.
    fn write(&mut self, s: &Snapshot, point: Plx800Point, v: &TagValue) -> Result<(), String> {
        if self.foreign_writer() {
            // Not ours any more: start from what the module does now, so the
            // other writer's points are not overwritten with our old copy.
            self.cmd = None;
        }
        let mut cmd = self.cmd.unwrap_or_else(|| Command::from_readback(s));
        points::apply(point, v, &mut cmd)?;
        shm::set_bit(
            &mut cmd.coils,
            points::RESERVED_COIL,
            s.coil(points::RESERVED_COIL),
        );
        self.last_commit = Some(self.seg.commit(&cmd));
        self.cmd = Some(cmd);
        self.wrote = true;
        Ok(())
    }
}

impl Drop for Commander {
    /// The commands stay in the segment after we stop: if we wrote, the
    /// outputs go to their safe state — unless someone else has written since,
    /// whose state is not ours to undo.
    fn drop(&mut self) {
        if !self.wrote {
            return;
        }
        if self.foreign_writer() {
            warn!("plx800: another writer took over, outputs left as they are");
            return;
        }
        let Some(s) = self.seg.read() else { return };
        let base = self.cmd.unwrap_or_else(|| Command::from_readback(&s));
        let mut safe = points::safe_state(base, self.run_led_mode_at_start);
        shm::set_bit(
            &mut safe.coils,
            points::RESERVED_COIL,
            s.coil(points::RESERVED_COIL),
        );
        self.seg.commit(&safe);
        info!("plx800: outputs put in their safe state");
    }
}

/// Entry point, run until `cancel` fires.
pub async fn run(
    cfg: Plx800IoConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
    stato: Arc<StatoSorgenti>,
) {
    run_at(Paths::default(), cfg, db, bus, cancel, stato).await
}

/// [`run`] on given paths: the tests use a file in a temporary folder.
pub async fn run_at(
    paths: Paths,
    cfg: Plx800IoConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
    stato: Arc<StatoSorgenti>,
) {
    info!(source = %cfg.id, points = cfg.points.len(), writes = cfg.writes, "PLX800 I/O source started");
    let (write_tx, write_rx) = mpsc::channel::<WriteRequest>(32);
    if cfg.writes {
        for m in cfg.points.iter().filter(|m| m.point.writable()) {
            bus.register(m.tag.clone(), write_tx.clone()).await;
        }
    }
    drop(write_tx);
    let write_rx = tokio::sync::Mutex::new(write_rx);

    sws_core::riconnessione::con_attesa_e_stato(
        &cfg.id,
        &stato,
        cancel.clone(),
        || async { session(&paths, &cfg, &db, &mut *write_rx.lock().await, &stato).await },
        || async {
            for m in &cfg.points {
                db.marca_qualita(&m.tag, TagQuality::Bad).await;
            }
        },
    )
    .await;
}

/// The session never ends on its own: the segment is a local file, so when it
/// is missing it is looked for again every [`SEGMENT_RETRY`] here, instead of
/// going back to the generic reconnection, whose wait doubles up to 30 s.
async fn session(
    paths: &Paths,
    cfg: &Plx800IoConfig,
    db: &TagDb,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    stato: &StatoSorgenti,
) -> anyhow::Result<()> {
    let mut missing_said = false;
    loop {
        match Segment::open(&paths.segment, false) {
            Ok(seg) => {
                if missing_said {
                    info!(source = %cfg.id, "PLX800: I/O module segment found again");
                    missing_said = false;
                }
                watch(&seg, paths, cfg, db, write_rx, stato).await;
            }
            Err(e) => {
                if !missing_said {
                    warn!(source = %cfg.id, "PLX800: {e} — looking again every {} ms", SEGMENT_RETRY.as_millis());
                    for m in &cfg.points {
                        db.marca_qualita(&m.tag, TagQuality::Bad).await;
                    }
                    stato.bus(&cfg.id, Collegamento::NonRisponde, Some(e.to_string()));
                    missing_said = true;
                }
                // Writes asked meanwhile are refused, not left queued.
                let wait = tokio::time::sleep(SEGMENT_RETRY);
                tokio::pin!(wait);
                loop {
                    tokio::select! {
                        _ = &mut wait => break,
                        Some((tag, _, _)) = write_rx.recv() => {
                            warn!(source = %cfg.id, tag = %tag, "PLX800: write refused, the I/O module segment is missing");
                        }
                    }
                }
            }
        }
    }
}

/// Reads one mapping of the segment, and returns when its file is gone or has
/// been replaced: the old mapping stays valid but would never move again.
async fn watch(
    seg: &Segment,
    paths: &Paths,
    cfg: &Plx800IoConfig,
    db: &TagDb,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    stato: &StatoSorgenti,
) {
    let poll = Duration::from_millis(cfg.poll_interval_ms.max(10));
    let limit = stale_after(poll);
    let mut fresh = Freshness::default();
    let mut commander: Option<Commander> = None;
    let mut lock_retry_at = Instant::now();
    let mut lock_busy_said = false;
    let mut foreign_said = false;
    let mut last_sent: HashMap<&str, (TagValue, TagQuality)> = HashMap::new();
    let mut refresh_at = Instant::now();
    let mut link_ok: Option<bool> = None;

    let by_tag: HashMap<&str, Plx800Point> = cfg
        .points
        .iter()
        .map(|m| (m.tag.as_str(), m.point))
        .collect();

    let mut ticker = tokio::time::interval(poll);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let _round = sws_core::prestazioni::Misura::nuova(format!("sorgente.plx800.{}", cfg.id));
                let now = Instant::now();
                let Some(s) = seg.read() else {
                    // The system kept the sequence odd for 100 tries: try at
                    // the next poll.
                    continue;
                };
                let is_fresh = fresh.sample(s.update_count, now, limit);

                // Only on a moving image: the lock is taken to command a module
                // that answers.
                if cfg.writes && is_fresh && commander.is_none() && now >= lock_retry_at {
                    match take_writer(paths, &s) {
                        Ok(Some(c)) => {
                            info!(source = %cfg.id, "PLX800: writer lock taken, commands enabled");
                            lock_busy_said = false;
                            commander = Some(c);
                        }
                        Ok(None) => {
                            if !lock_busy_said {
                                warn!(source = %cfg.id, "PLX800: another writer holds the lock — read only until it lets go");
                                lock_busy_said = true;
                            }
                            lock_retry_at = now + LOCK_RETRY;
                        }
                        Err(e) => {
                            if !lock_busy_said {
                                warn!(source = %cfg.id, "PLX800: cannot take the writer lock: {e}");
                                lock_busy_said = true;
                            }
                            lock_retry_at = now + LOCK_RETRY;
                        }
                    }
                }

                let foreign = commander.as_ref().is_some_and(Commander::foreign_writer);
                if foreign && !foreign_said {
                    warn!(source = %cfg.id, "PLX800: someone else wrote the command (another PLC runtime?) — the next write starts from the module state");
                }
                foreign_said = foreign;

                let meta = points::Meta {
                    fresh: is_fresh,
                    writer_active: commander.is_some(),
                    foreign_writer: foreign,
                };
                let refresh = now >= refresh_at;
                if refresh {
                    refresh_at = now + REFRESH_EVERY;
                }
                for m in &cfg.points {
                    let v = points::value(m.point, &s, &meta);
                    let q = if is_fresh || points::is_meta(m.point) {
                        TagQuality::Good
                    } else {
                        TagQuality::Bad
                    };
                    let changed = last_sent.get(m.tag.as_str()) != Some(&(v.clone(), q.clone()));
                    if changed || refresh {
                        last_sent.insert(m.tag.as_str(), (v.clone(), q.clone()));
                        if q == TagQuality::Good {
                            db.ingest(m.tag.clone(), v, q).await;
                        } else {
                            db.marca_qualita(&m.tag, q).await;
                        }
                    }
                }

                if link_ok != Some(is_fresh) {
                    link_ok = Some(is_fresh);
                    if is_fresh {
                        stato.bus(&cfg.id, Collegamento::Ok, None);
                    } else {
                        stato.bus(&cfg.id, Collegamento::NonRisponde, Some("PLX800 I/O image not refreshed".into()));
                    }
                }
                if !is_fresh {
                    // The service stopped (file removed) or restarted (a new
                    // file): open again at once.
                    if !seg.is_still_at(&paths.segment) {
                        return;
                    }
                    // Same file, not moving: the service is stuck. Outputs at
                    // rest, as when the source stops; the lock is taken again
                    // when the image moves.
                    let silent = fresh.silent_for(now).unwrap_or_default();
                    if silent > REOPEN_AFTER && commander.is_some() {
                        warn!(
                            source = %cfg.id,
                            "PLX800: I/O image not refreshed for {} s — outputs put at rest, commands off until it moves again",
                            silent.as_secs()
                        );
                        commander = None;
                        lock_retry_at = now;
                    }
                }
            }

            Some((tag, path, value)) = write_rx.recv() => {
                if path.is_some() {
                    warn!(source = %cfg.id, tag = %tag, "PLX800: points are scalars, a leaf write makes no sense");
                    continue;
                }
                let Some(&point) = by_tag.get(tag.as_str()) else { continue };
                let Some(c) = commander.as_mut() else {
                    warn!(source = %cfg.id, tag = %tag, "PLX800: write refused, the writer lock is not ours");
                    continue;
                };
                let Some(s) = seg.read().filter(|_| fresh.last_change.is_some_and(|t| t.elapsed() <= limit)) else {
                    warn!(source = %cfg.id, tag = %tag, "PLX800: write refused, the I/O image is not being refreshed");
                    continue;
                };
                if let Err(e) = c.write(&s, point, &value) {
                    warn!(source = %cfg.id, tag = %tag, "PLX800: write refused: {e}");
                }
            }
        }
    }
}

fn take_writer(paths: &Paths, s: &Snapshot) -> std::io::Result<Option<Commander>> {
    let Some(lock) = WriterLock::try_take(&paths.lock)? else {
        return Ok(None);
    };
    let seg =
        Segment::open(&paths.segment, true).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(Some(Commander {
        seg,
        _lock: lock,
        cmd: None,
        last_commit: None,
        run_led_mode_at_start: s.hr[0],
        wrote: false,
    }))
}

/// What the device endpoint says about the segment of this machine.
#[derive(Debug, Serialize, Default, PartialEq)]
pub struct Status {
    /// The file exists.
    pub present: bool,
    /// Header as this code knows it (interface version 1).
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub cycle_us: u32,
    /// The counter moved between two samples 20 ms apart.
    pub fresh: bool,
    pub last_ok: bool,
    pub update_count: u64,
    pub fail_count: u64,
    /// Someone holds the writer lock (it may be this runtime's own source).
    pub writer_lock_busy: bool,
}

/// A look at the segment, for `GET /api/plx800/status`. Blocking (it sleeps
/// 20 ms between the two samples): call it from `spawn_blocking`.
pub fn probe() -> Status {
    probe_at(&Paths::default())
}

pub fn probe_at(paths: &Paths) -> Status {
    let seg = match Segment::open(&paths.segment, false) {
        Ok(s) => s,
        Err(OpenError::Missing) => return Status::default(),
        Err(e) => {
            return Status {
                present: true,
                error: Some(e.to_string()),
                ..Default::default()
            }
        }
    };
    let Some(a) = seg.read() else {
        return Status {
            present: true,
            valid: true,
            ..Default::default()
        };
    };
    std::thread::sleep(Duration::from_millis(20));
    let b = seg.read().unwrap_or(a);
    Status {
        present: true,
        valid: true,
        error: None,
        cycle_us: b.cycle_us,
        fresh: b.update_count != a.update_count,
        last_ok: b.last_ok,
        update_count: b.update_count,
        fail_count: b.fail_count,
        writer_lock_busy: lock_busy(&paths.lock),
    }
}

fn lock_busy(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    // Taking it and letting it go at once: busy means someone keeps it.
    matches!(WriterLock::try_take(path), Ok(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shm::fake::Fake;
    use sws_core::Plx800PointMapping;

    /// Against the simulator of the reference project, on a PC:
    /// `python3 /home/ut1/Git/openplc/lib/python/qmb800_sim.py --loopback &`
    /// then `cargo test -p sws-plugin-plx800 -- --ignored`. OUT0 commanded by
    /// the source comes back on IN0, and stopping puts it off again.
    #[tokio::test]
    #[ignore = "needs qmb800_sim.py --loopback running"]
    async fn against_the_simulator_with_loopback() {
        let cfg = Plx800IoConfig {
            id: "sim".into(),
            enabled: true,
            poll_interval_ms: 20,
            writes: true,
            points: vec![
                Plx800PointMapping {
                    tag: "sim.out0".into(),
                    point: Plx800Point::Out0,
                },
                Plx800PointMapping {
                    tag: "sim.in0".into(),
                    point: Plx800Point::In0,
                },
                Plx800PointMapping {
                    tag: "sim.writer".into(),
                    point: Plx800Point::WriterActive,
                },
                Plx800PointMapping {
                    tag: "sim.fresh".into(),
                    point: Plx800Point::Fresh,
                },
            ],
        };
        let db = Arc::new(TagDb::new(256));
        let bus = Arc::new(TagWriteBus::new());
        let stato = Arc::new(StatoSorgenti::new());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(run(cfg, db.clone(), bus.clone(), cancel.clone(), stato));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            db.get("sim.fresh").await.unwrap().value,
            TagValue::Bool(true)
        );
        assert_eq!(
            db.get("sim.writer").await.unwrap().value,
            TagValue::Bool(true)
        );
        bus.write("sim.out0", TagValue::Bool(true))
            .await
            .expect("write routed");
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            db.get("sim.out0").await.unwrap().value,
            TagValue::Bool(true)
        );
        assert_eq!(
            db.get("sim.in0").await.unwrap().value,
            TagValue::Bool(true),
            "loopback"
        );
        cancel.cancel();
        task.await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let seg = Segment::open(Path::new(shm::SHM_PATH), false).unwrap();
        assert!(!seg.read().unwrap().coil(0), "safe state at stop");
    }

    #[test]
    fn the_source_reads_as_written_in_project_yaml() {
        let y = "kind: plx800_io\nid: io\nwrites: true\npoints:\n  - { tag: io.out0, point: out0 }\n  - { tag: io.temp, point: board_temp_c }\n";
        let s: sws_core::SourceDef = serde_yaml::from_str(y).unwrap();
        let sws_core::SourceDef::Plx800Io(c) = &s else {
            panic!("not plx800_io: {s:?}")
        };
        assert!(c.enabled && c.writes);
        assert_eq!(c.poll_interval_ms, 100);
        assert_eq!(c.points[1].point, Plx800Point::BoardTempC);
        // The IDE instance runs every source read only: here that is one switch.
        let sws_core::SourceDef::Plx800Io(ro) = s.sola_lettura() else {
            unreachable!()
        };
        assert!(!ro.writes);
        // `writes: false` is not written back.
        let back = serde_yaml::to_string(&sws_core::SourceDef::Plx800Io(ro)).unwrap();
        assert!(!back.contains("writes"), "{back}");
    }

    #[test]
    fn freshness_needs_the_counter_to_move() {
        let mut f = Freshness::default();
        let t0 = Instant::now();
        let lim = Duration::from_millis(300);
        assert!(!f.sample(10, t0, lim), "one value says nothing");
        assert!(!f.sample(10, t0 + Duration::from_millis(100), lim));
        assert!(f.sample(11, t0 + Duration::from_millis(200), lim));
        assert!(f.sample(11, t0 + Duration::from_millis(450), lim));
        assert!(
            !f.sample(11, t0 + Duration::from_millis(600), lim),
            "stopped"
        );
        assert!(
            f.sample(12, t0 + Duration::from_millis(700), lim),
            "and back"
        );
    }

    fn commander(fake: &Fake, hr0: u16) -> Commander {
        let paths = Paths {
            segment: fake.path.clone(),
            lock: fake.dir.join("lock"),
        };
        let mut s = Snapshot::default();
        s.hr[0] = hr0;
        take_writer(&paths, &s).unwrap().unwrap()
    }

    #[test]
    fn a_write_starts_from_the_read_back_and_keeps_the_reserved_coil() {
        let fake = Fake::new("write");
        let mut c = commander(&fake, 1);
        // OUT1, reserved coil 15, PoE; RUN LED to the system.
        let mut hr = [0; 12];
        hr[0] = 1;
        let s = Snapshot {
            coils: [0b0000_0010, 0b1000_0000, 0b1],
            hr,
            ..Default::default()
        };
        c.write(&s, Plx800Point::Out0, &TagValue::Bool(true))
            .unwrap();
        let (seq, apply, coils, hr) = fake.cmd();
        assert_eq!((seq, apply), (1, 1));
        assert_eq!(coils, [0b0000_0011, 0b1000_0000, 0b1]);
        assert_eq!(hr[0], 1);
        // The second write keeps our copy, not a lagging read-back.
        let stale = Snapshot::default();
        c.write(&stale, Plx800Point::LedA1Green, &TagValue::Bool(true))
            .unwrap();
        let (seq, _, coils, _) = fake.cmd();
        assert_eq!(seq, 2);
        assert_eq!(
            coils,
            [0b0000_0011, 0b0001_0000, 0b1],
            "reserved coil follows the read-back"
        );
    }

    #[test]
    fn a_foreign_writer_is_seen_and_not_overwritten() {
        let fake = Fake::new("foreign");
        let mut c = commander(&fake, 1);
        let s = Snapshot::default();
        c.write(&s, Plx800Point::Out0, &TagValue::Bool(true))
            .unwrap();
        assert!(!c.foreign_writer());
        fake.set_cmd_seq(10); // somebody else committed
        assert!(c.foreign_writer());
        // The other writer drives OUT7 only.
        let now = Snapshot {
            coils: [0b1000_0000, 0, 0],
            ..Default::default()
        };
        c.write(&now, Plx800Point::Out1, &TagValue::Bool(true))
            .unwrap();
        let (seq, _, coils, _) = fake.cmd();
        assert_eq!(seq, 11);
        assert_eq!(
            coils[0], 0b1000_0010,
            "OUT0 of our old copy is not brought back"
        );
    }

    #[test]
    fn stopping_leaves_the_safe_state_only_if_we_wrote_and_nobody_else_did() {
        let fake = Fake::new("safe");
        {
            let _c = commander(&fake, 1);
        }
        assert_eq!(fake.cmd().0, 0, "never wrote: nothing committed at the end");

        {
            let mut c = commander(&fake, 2);
            let s = Snapshot {
                coils: [0, 0, 0b1],
                hr: [2, 0x0F, 50, 0, 500, 0, 0, 0, 0, 0, 0, 0],
                ..Default::default()
            };
            c.write(&s, Plx800Point::Out5, &TagValue::Bool(true))
                .unwrap();
        }
        let (seq, _, coils, hr) = fake.cmd();
        assert_eq!(seq, 2, "one write, one safe state");
        assert_eq!(coils[0], 0, "outputs off");
        assert_eq!(coils[2], 0b1, "PoE kept");
        assert_eq!(hr[1], 0, "PWM off");
        assert_eq!(hr[0], 1, "RUN LED back to the system");

        {
            let mut c = commander(&fake, 1);
            c.write(
                &Snapshot::default(),
                Plx800Point::Out0,
                &TagValue::Bool(true),
            )
            .unwrap();
            fake.set_cmd_seq(99);
        }
        assert_eq!(
            fake.cmd().0,
            99,
            "someone else wrote after us: their state stays"
        );
    }

    #[test]
    fn the_probe_tells_a_missing_segment_from_a_stopped_one() {
        let missing = Paths {
            segment: std::env::temp_dir().join("sws-plx800-none"),
            lock: std::env::temp_dir().join("sws-plx800-none.lock"),
        };
        assert_eq!(probe_at(&missing), Status::default());
        let fake = Fake::new("probe");
        let paths = Paths {
            segment: fake.path.clone(),
            lock: fake.dir.join("lock"),
        };
        let st = probe_at(&paths);
        assert!(st.present && st.valid && !st.fresh && st.last_ok);
        assert_eq!(st.cycle_us, 1000);
        let _held = WriterLock::try_take(&paths.lock).unwrap().unwrap();
        assert!(probe_at(&paths).writer_lock_busy);
    }

    #[tokio::test]
    async fn the_source_reads_the_segment_into_tags() {
        let fake = Fake::new("run");
        let paths = Paths {
            segment: fake.path.clone(),
            lock: fake.dir.join("lock"),
        };
        let mut ir = [0u16; 18];
        ir[0] = 5000;
        fake.set_image([0b1, 0, 0], [0b10, 0], ir, [0; 12]);
        let cfg = Plx800IoConfig {
            id: "io".into(),
            enabled: true,
            poll_interval_ms: 20,
            writes: false,
            points: vec![
                Plx800PointMapping {
                    tag: "io.out0".into(),
                    point: Plx800Point::Out0,
                },
                Plx800PointMapping {
                    tag: "io.in1".into(),
                    point: Plx800Point::In1,
                },
                Plx800PointMapping {
                    tag: "io.vcap".into(),
                    point: Plx800Point::VcapMv,
                },
                Plx800PointMapping {
                    tag: "io.fresh".into(),
                    point: Plx800Point::Fresh,
                },
            ],
        };
        let db = Arc::new(TagDb::new(256));
        let bus = Arc::new(TagWriteBus::new());
        let stato = Arc::new(StatoSorgenti::new());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(run_at(paths, cfg, db.clone(), bus, cancel.clone(), stato));
        // The system refreshes: move the counter for a while.
        for n in 1..=10u64 {
            fake.set_update_count(n);
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        let out0 = db.get("io.out0").await.expect("out0 written");
        assert_eq!(out0.value, TagValue::Bool(true));
        assert_eq!(out0.quality, TagQuality::Good);
        assert_eq!(db.get("io.in1").await.unwrap().value, TagValue::Bool(true));
        assert_eq!(db.get("io.vcap").await.unwrap().value, TagValue::Int(5000));
        assert_eq!(
            db.get("io.fresh").await.unwrap().value,
            TagValue::Bool(true)
        );
        // The system stops: the module points go Bad, the meta point says so.
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(db.get("io.out0").await.unwrap().quality, TagQuality::Bad);
        let fresh = db.get("io.fresh").await.unwrap();
        assert_eq!(
            (fresh.value, fresh.quality),
            (TagValue::Bool(false), TagQuality::Good)
        );
        cancel.cancel();
        task.await.unwrap();
    }

    /// The service stops (it removes the file) and starts again (a new file):
    /// the points go Bad, and are Good again within a second of the restart —
    /// not after the generic reconnection's wait, up to 30 s (PLX800 collaudo,
    /// 23-11-2026: 24 s).
    #[tokio::test]
    async fn the_points_come_back_within_a_second_of_a_service_restart() {
        let fake = Fake::new("restart");
        let paths = Paths {
            segment: fake.path.clone(),
            lock: fake.dir.join("lock"),
        };
        let cfg = Plx800IoConfig {
            id: "io".into(),
            enabled: true,
            poll_interval_ms: 20,
            writes: true,
            points: vec![Plx800PointMapping {
                tag: "io.vcap".into(),
                point: Plx800Point::VcapMv,
            }],
        };
        let db = Arc::new(TagDb::new(16));
        let bus = Arc::new(TagWriteBus::new());
        let stato = Arc::new(StatoSorgenti::new());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(run_at(paths, cfg, db.clone(), bus, cancel.clone(), stato));
        let quality = || async { db.get("io.vcap").await.map(|t| t.quality) };
        let mut n = 0u64;
        let mut tick = || {
            n += 1;
            fake.set_update_count(n);
        };

        for _ in 0..10 {
            tick();
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        assert_eq!(quality().await, Some(TagQuality::Good));

        // Stopped, and stopped long enough for the old wait to grow.
        fake.remove();
        tokio::time::sleep(Duration::from_millis(3000)).await;
        assert_eq!(quality().await, Some(TagQuality::Bad));

        fake.create();
        let restarted = Instant::now();
        let mut good_after = None;
        while restarted.elapsed() < Duration::from_secs(3) {
            tick();
            tokio::time::sleep(Duration::from_millis(15)).await;
            if quality().await == Some(TagQuality::Good) {
                good_after = Some(restarted.elapsed());
                break;
            }
        }
        let good_after = good_after.expect("the points never came back");
        assert!(good_after < Duration::from_secs(1), "Good again after {good_after:?}");
        cancel.cancel();
        task.await.unwrap();
    }
}
