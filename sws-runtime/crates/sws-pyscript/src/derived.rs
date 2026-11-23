//! The derived-tag evaluator: the quality of a derived tag, and one round.
//!
//! Until the rc.29 a derived tag was written Good whenever its expression ran
//! (test of the rc.29, 23-11-2026): on the WP630 `round(tags['ty.eth0_rx_bps']
//! / 1024, 1)` gave 0.0 Good from an input that was 0.0 Bad, and alarms,
//! history, MQTT and the viewers believed it. The result now takes the worst
//! quality of the tags the expression names.
//!
//! The loop that wakes the round up (the channel, `Lagged`, the registry
//! compared with the previous round) stays in `sws-runtime`'s `main.rs`.

use std::collections::{HashMap, HashSet};

use sws_core::{TagDb, TagQuality, TagState};
use tracing::warn;

use crate::{eval_expressions_with, expression_reads, reads_changed};

/// What a successful evaluation of a derived tag writes.
#[derive(Debug, Clone, PartialEq)]
pub enum DerivedOutcome {
    /// The value, with this quality.
    Write(TagQuality),
    /// Nothing: the derived tag was never received and one of its inputs
    /// still is, so the value would come from the zeros of the seeding
    /// (decision A2, 23-11-2026). It stays seeded: the viewers dim it, the
    /// history skips it, MQTT sends null.
    LeaveNeverReceived,
}

/// «Never received» (12-11-2026): seeded, Uncertain with timestamp 0.
fn never_received(s: &TagState) -> bool {
    s.quality == TagQuality::Uncertain && s.timestamp_ms == 0
}

/// The quality of a derived tag whose expression has just run.
///
/// - The inputs are the names the expression reads (`expression_reads`,
///   comments excluded), its own id excluded: its previous value is state,
///   not an input. Every name counts, also one in a branch not taken (A1,
///   static reading).
/// - An input takes the quality it has in `states`, the union of leaves and
///   roots the expression sees: `tags['sala.temperatura']` the leaf's,
///   `tags['sala']['temperatura']` the whole root's.
/// - A name not in `states` does not count; `undeclared` hears about it. With
///   `tags['x']` the expression fails anyway (KeyError → Bad).
/// - No input (a constant), or reads the scan cannot follow (`reads` None:
///   `tags[k]`, `tags.values()`): Good, as before.
/// - Any input Bad → Bad. Otherwise, while the derived tag and one input are
///   both never received → [`DerivedOutcome::LeaveNeverReceived`]. Otherwise
///   the worst quality.
pub fn derived_quality<'a>(
    own_id: &str,
    reads: Option<&'a [String]>,
    own: Option<&TagState>,
    states: &HashMap<String, TagState>,
    mut undeclared: impl FnMut(&'a str),
) -> DerivedOutcome {
    let Some(reads) = reads else {
        return DerivedOutcome::Write(TagQuality::Good);
    };
    let mut worst = TagQuality::Good;
    let mut input_never_received = false;
    for name in reads.iter().filter(|n| n.as_str() != own_id) {
        match states.get(name) {
            Some(s) => {
                worst = worst.worst(s.quality.clone());
                input_never_received |= never_received(s);
            }
            None => undeclared(name),
        }
    }
    if worst == TagQuality::Bad {
        return DerivedOutcome::Write(TagQuality::Bad);
    }
    // A derived tag missing from the store has no value yet: never received.
    if input_never_received && own.is_none_or(never_received) {
        return DerivedOutcome::LeaveNeverReceived;
    }
    DerivedOutcome::Write(worst)
}

/// What the derived-tag evaluator keeps from one round to the next.
#[derive(Default)]
pub struct DerivedState {
    /// The tags each expression reads, by its text: scanned once.
    reads_of: HashMap<String, Option<Vec<String>>>,
    /// The last error logged for each derived tag: an expression that fails
    /// fails at every change of the tags it reads, and the log would say the
    /// same thing many times a second.
    failing: HashMap<String, String>,
    /// Derived tag → the names it reads that are not tags, already logged.
    undeclared: HashMap<String, HashSet<String>>,
}

impl DerivedState {
    /// A new registry (deploy, save, an edited expression): a name that is
    /// not a tag is logged again, once.
    pub fn registry_changed(&mut self) {
        self.undeclared.clear();
    }
}

/// One round of the derived-tag evaluator over the registry `pairs`
/// (derived id, expression).
///
/// A normal round evaluates the expressions that read a tag of `changed`,
/// and is skipped when every change is a derived tag it would write itself
/// (the `set` → broadcast → evaluate loop). A `full` round evaluates every
/// expression, constants included, with neither filter: the loop asks for it
/// when the registry differs from the previous round and after a `Lagged`.
pub async fn run_derived_round(
    db: &TagDb,
    pairs: &[(String, String)],
    changed: &HashSet<String>,
    full: bool,
    state: &mut DerivedState,
) {
    if state.reads_of.len() > 2000 {
        state.reads_of.clear();
    }
    for (_, expr) in pairs {
        if !state.reads_of.contains_key(expr) {
            state.reads_of.insert(expr.clone(), expression_reads(expr));
        }
    }
    let reads_of = &state.reads_of;
    // Only the expressions that read a tag of this batch (17-11-2026): the
    // others would give the same value. One the scan cannot follow is always
    // evaluated, as before.
    let chosen: Vec<(&str, &str, Option<&[String]>)> = pairs
        .iter()
        .map(|(id, expr)| (id.as_str(), expr.as_str(), reads_of[expr].as_deref()))
        .filter(|(_, _, reads)| {
            full || match reads {
                Some(r) => changed.iter().any(|c| reads_changed(r, c)),
                None => true,
            }
        })
        .collect();
    if chosen.is_empty() {
        return;
    }
    if !full {
        let derived_ids: HashSet<&str> = chosen.iter().map(|(id, _, _)| *id).collect();
        if changed.iter().all(|id| derived_ids.contains(id.as_str())) {
            return;
        }
    }

    let t0 = std::time::Instant::now();
    // Fase 1e: the **leaves** and the **roots**. An expression can write
    // `tags["motore1.velocita"]` or `tags["motore1"]["velocita"]`: the dict is
    // flat in Python and parses no paths, so both keys must be there.
    let mut states: HashMap<String, TagState> = db.snapshot_foglie().await;
    for (k, v) in db.snapshot().await {
        states.entry(k).or_insert(v);
    }
    // The qualities before the snapshot goes to Python, which takes it as it
    // is (no copy of the values).
    let undeclared = &mut state.undeclared;
    let outcomes: Vec<DerivedOutcome> = chosen
        .iter()
        .map(|(id, _, reads)| {
            derived_quality(id, *reads, states.get(*id), &states, |name| {
                let seen = undeclared.get(*id).is_some_and(|s| s.contains(name));
                if !seen {
                    warn!(
                        tag = %id,
                        "derived tag reads «{name}», which is not a tag: it does not count for the quality"
                    );
                    undeclared
                        .entry(id.to_string())
                        .or_default()
                        .insert(name.to_string());
                }
            })
        })
        .collect();
    // One Python round for all of them (17-11-2026): one expression at a
    // time kept a Tiny TY at 67 % with eight bits of one counter.
    let exprs: Vec<String> = chosen.iter().map(|(_, e, _)| e.to_string()).collect();
    let results = eval_expressions_with(exprs, states, |s| &s.value).await;
    for ((id, _, _), (outcome, result)) in chosen.iter().zip(outcomes.into_iter().zip(results)) {
        match result {
            Ok(value) => {
                state.failing.remove(*id);
                // `set_tipizzato` and not `set`: a derived tag declared `i32`
                // must not keep the 29.8 the expression gave. Not `ingest`,
                // whose raw→eng scale is for the field: this value is already
                // in engineering units. A saturated value becomes Uncertain,
                // a Bad stays Bad.
                if let DerivedOutcome::Write(q) = outcome {
                    db.set_tipizzato(id.to_string(), value, q).await;
                }
            }
            Err(e) => {
                // The last good value stays, marked Bad (18-11-2026): an
                // expression the sandbox refuses must not look like a live
                // value.
                if state.failing.get(*id) != Some(&e) {
                    warn!(tag = %id, "derived tag eval error: {e}");
                    state.failing.insert(id.to_string(), e);
                }
                db.marca_qualita(id, TagQuality::Bad).await;
            }
        }
    }
    sws_core::prestazioni::registra("derivati", t0.elapsed());
}

#[cfg(test)]
mod tests {
    use super::*;
    use sws_core::{AlarmDb, AlarmDef, Forma, TagDef, TagUpdate, TagValue, TypeDef};
    use tokio::sync::broadcast::{self, error::TryRecvError};
    use TagQuality::{Bad, Good, Uncertain};

    fn pairs(v: &[(&str, &str)]) -> Vec<(String, String)> {
        v.iter()
            .map(|(id, e)| (id.to_string(), e.to_string()))
            .collect()
    }

    fn ids(v: &[&str]) -> HashSet<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    async fn get(db: &TagDb, id: &str) -> TagState {
        db.get(id).await.unwrap_or_else(|| panic!("no tag {id}"))
    }

    async fn full(db: &TagDb, p: &[(String, String)], state: &mut DerivedState) {
        run_derived_round(db, p, &HashSet::new(), true, state).await;
    }

    /// What the loop of `main.rs` does between full rounds: drain a batch,
    /// run a normal round, until nothing is left. How many rounds ran.
    async fn settle(
        db: &TagDb,
        rx: &mut broadcast::Receiver<TagUpdate>,
        p: &[(String, String)],
        state: &mut DerivedState,
    ) -> usize {
        let mut rounds = 0;
        loop {
            let mut changed = HashSet::new();
            while let Ok(u) = rx.try_recv() {
                changed.insert(u.id);
            }
            if changed.is_empty() {
                return rounds;
            }
            rounds += 1;
            assert!(rounds < 20, "the rounds do not settle");
            run_derived_round(db, p, &changed, false, state).await;
        }
    }

    async fn seeded(db: &TagDb, v: &[&str]) {
        for id in v {
            db.semina(id.to_string(), TagValue::Float(0.0)).await;
        }
    }

    /// A room as a structure (`sala.temperatura`, `sala.umidita`), seeded.
    async fn db_with_room() -> TagDb {
        let db = TagDb::new(64);
        let types: Vec<TypeDef> = serde_yaml::from_str(
            "- id: Stanza\n  members:\n    - { name: temperatura, data_type: f64 }\n    - { name: umidita, data_type: f64 }\n",
        )
        .unwrap();
        let tag: TagDef = serde_yaml::from_str("{ id: sala, type_ref: Stanza }").unwrap();
        let forma = Forma::da_tag(&tag, &types).unwrap().unwrap();
        let initial = forma.valore_iniziale();
        db.set_forme(HashMap::from([("sala".to_string(), forma)]))
            .await;
        db.semina("sala".into(), initial).await;
        db
    }

    fn state(q: TagQuality, ts: u64) -> TagState {
        TagState {
            value: TagValue::Float(1.0),
            quality: q,
            timestamp_ms: ts,
        }
    }

    // ── The rule, as a pure function ────────────────────────────────────────

    #[test]
    fn the_worst_input_quality_wins() {
        let states: HashMap<String, TagState> = [
            ("a", state(Good, 5)),
            ("b", state(Uncertain, 5)),
            ("c", state(Bad, 5)),
        ]
        .into_iter()
        .map(|(k, s)| (k.to_string(), s))
        .collect();
        let own = state(Good, 5);
        let q = |reads: &[&str]| {
            let r: Vec<String> = reads.iter().map(|s| s.to_string()).collect();
            derived_quality("d", Some(&r), Some(&own), &states, |_| {})
        };
        assert_eq!(q(&["a"]), DerivedOutcome::Write(Good));
        assert_eq!(q(&["a", "b"]), DerivedOutcome::Write(Uncertain));
        assert_eq!(q(&["a", "c", "b"]), DerivedOutcome::Write(Bad));
        assert_eq!(q(&["b", "c"]), DerivedOutcome::Write(Bad));
    }

    /// A constant reads nothing, and an expression the scan cannot follow
    /// stays Good as before: the documented limit.
    #[test]
    fn a_constant_expression_is_good_and_an_unscannable_one_stays_good() {
        let states = HashMap::from([("a".to_string(), state(Bad, 5))]);
        let seeded = state(Uncertain, 0);
        assert_eq!(
            derived_quality("d", Some(&[]), Some(&seeded), &states, |_| {}),
            DerivedOutcome::Write(Good)
        );
        let reads = expression_reads("k = 'a'\ntags[k]");
        assert_eq!(reads, None);
        assert_eq!(
            derived_quality("d", reads.as_deref(), Some(&seeded), &states, |_| {}),
            DerivedOutcome::Write(Good)
        );
    }

    /// `max(tags['picco'], tags['p'])` written on `picco`: its own value is
    /// state, not an input, and its «never received» does not hold it back.
    #[test]
    fn the_derived_tag_own_value_is_not_an_input() {
        let states = HashMap::from([
            ("picco".to_string(), state(Uncertain, 0)),
            ("p".to_string(), state(Good, 5)),
        ]);
        let reads = expression_reads("max(tags['picco'], tags['p'])");
        assert_eq!(
            derived_quality(
                "picco",
                reads.as_deref(),
                states.get("picco"),
                &states,
                |_| {}
            ),
            DerivedOutcome::Write(Good)
        );
    }

    // ── The round, on a real TagDb ──────────────────────────────────────────

    /// The case of the WP630 (test of the rc.29, 23-11-2026): the host metric
    /// does not exist, the input is 0.0 Bad, the derived tag was 0.0 Good.
    #[tokio::test]
    async fn a_derived_tag_from_a_bad_input_is_bad() {
        let db = TagDb::new(64);
        seeded(&db, &["ty.eth0_rx_bps", "ty.eth0_rx_kbs"]).await;
        let p = pairs(&[("ty.eth0_rx_kbs", "round(tags['ty.eth0_rx_bps'] / 1024, 1)")]);
        let mut st = DerivedState::default();
        let mut rx = db.subscribe();
        db.marca_qualita("ty.eth0_rx_bps", Bad).await;
        settle(&db, &mut rx, &p, &mut st).await;
        let kbs = get(&db, "ty.eth0_rx_kbs").await;
        assert_eq!(kbs.value, TagValue::Float(0.0));
        assert_eq!(kbs.quality, Bad);
        assert!(kbs.timestamp_ms > 0);
    }

    #[tokio::test]
    async fn a_derived_tag_recovers_with_an_identical_value() {
        let db = TagDb::new(64);
        seeded(&db, &["in", "out"]).await;
        let p = pairs(&[("out", "tags['in'] * 2")]);
        let mut st = DerivedState::default();
        let mut rx = db.subscribe();
        db.marca_qualita("in", Bad).await;
        settle(&db, &mut rx, &p, &mut st).await;
        assert_eq!(get(&db, "out").await.quality, Bad);
        // The source comes back with the same value: `ingest` broadcasts
        // anyway, and the derived tag is Good again.
        db.ingest("in".into(), TagValue::Float(0.0), Good).await;
        settle(&db, &mut rx, &p, &mut st).await;
        let out = get(&db, "out").await;
        assert_eq!((out.value, out.quality), (TagValue::Float(0.0), Good));
    }

    /// Decision A2: while the derived tag and an input are never received
    /// nothing is written; a Bad input writes Bad anyway; an input seeded
    /// again after the derived tag had a value gives Uncertain.
    #[tokio::test]
    async fn startup_partial_inputs() {
        let db = TagDb::new(64);
        seeded(&db, &["a", "b", "d"]).await;
        db.set("a".into(), TagValue::Float(2.0), Good).await;
        let p = pairs(&[("d", "tags['a'] + tags['b']")]);
        let mut st = DerivedState::default();
        let mut rx = db.subscribe();
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!(
            (d.quality, d.timestamp_ms),
            (Uncertain, 0),
            "still never received"
        );
        assert!(rx.try_recv().is_err(), "nothing written, nothing broadcast");

        db.marca_qualita("b", Bad).await;
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(2.0), Bad));

        db.set("b".into(), TagValue::Float(3.0), Good).await;
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(5.0), Good));

        db.semina("b".into(), TagValue::Float(0.0)).await;
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(2.0), Uncertain));
        assert!(d.timestamp_ms > 0);
    }

    /// A saturated value is Uncertain, but a Bad input keeps it Bad.
    #[tokio::test]
    async fn saturation_keeps_bad() {
        let db = TagDb::new(64);
        db.set_data_types(HashMap::from([("d".to_string(), "u8".to_string())]))
            .await;
        seeded(&db, &["a"]).await;
        db.semina("d".into(), TagValue::Int(0)).await;
        db.set("a".into(), TagValue::Float(3.0), Good).await;
        let p = pairs(&[("d", "tags['a'] * 100")]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "d").await.quality, Uncertain);
        db.marca_qualita("a", Bad).await;
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "d").await.quality, Bad);
    }

    /// The rule of 18-11-2026 does not change: an error keeps the last value,
    /// marked Bad.
    #[tokio::test]
    async fn an_eval_error_still_marks_bad_and_keeps_the_value() {
        let db = TagDb::new(64);
        seeded(&db, &["d"]).await;
        db.set("a".into(), TagValue::Float(10.0), Good).await;
        db.set("b".into(), TagValue::Float(2.0), Good).await;
        let p = pairs(&[("d", "tags['a'] / tags['b']")]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "d").await.value, TagValue::Float(5.0));
        db.set("b".into(), TagValue::Float(0.0), Good).await;
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(5.0), Bad));
    }

    /// A name that is not a tag does not count, and is logged once per
    /// (derived tag, name) until the registry changes. `tags['x']` on it is
    /// still an error.
    #[tokio::test]
    async fn an_undeclared_name_is_neutral_and_logged_once() {
        let db = TagDb::new(64);
        seeded(&db, &["d", "e"]).await;
        db.set("a".into(), TagValue::Float(1.0), Good).await;
        let p = pairs(&[
            ("d", "tags.get('missing', 0) + tags['a']"),
            ("e", "tags['missing']"),
        ]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(1.0), Good));
        assert_eq!(get(&db, "e").await.quality, Bad, "KeyError");
        assert_eq!(st.undeclared.len(), 2);
        assert_eq!(st.undeclared["d"], ids(&["missing"]));
        st.registry_changed();
        assert!(
            st.undeclared.is_empty(),
            "logged again after a new registry"
        );
    }

    #[tokio::test]
    async fn a_comment_does_not_make_the_derived_bad() {
        let db = TagDb::new(64);
        seeded(&db, &["d", "dead"]).await;
        db.marca_qualita("dead", Bad).await;
        db.set("a".into(), TagValue::Float(2.0), Good).await;
        let p = pairs(&[(
            "d",
            "# it was: tags['dead'] * 2\ntags['a'] * 2  # the tags of the pump",
        )]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        let d = get(&db, "d").await;
        assert_eq!((d.value, d.quality), (TagValue::Float(4.0), Good));
    }

    /// `tags['sala']['temperatura']` takes the quality of the whole room,
    /// `tags['sala.temperatura']` the leaf's: the limit the manual states.
    #[tokio::test]
    async fn a_root_read_takes_the_root_quality_a_leaf_read_the_leaf_quality() {
        let db = db_with_room().await;
        seeded(&db, &["r", "l"]).await;
        db.set("sala.temperatura".into(), TagValue::Float(21.0), Good)
            .await;
        db.set("sala.umidita".into(), TagValue::Float(50.0), Good)
            .await;
        db.marca_qualita("sala.umidita", Bad).await;
        let p = pairs(&[
            ("r", "tags['sala']['temperatura']"),
            ("l", "tags['sala.temperatura']"),
        ]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        let r = get(&db, "r").await;
        let l = get(&db, "l").await;
        assert_eq!((r.value, r.quality), (TagValue::Float(21.0), Bad));
        assert_eq!((l.value, l.quality), (TagValue::Float(21.0), Good));
    }

    /// A root is the worst of the leaves already written (D6): a leaf never
    /// arrived does not touch a read of the root, but a read of that leaf
    /// stays never received.
    #[tokio::test]
    async fn a_root_with_a_never_arrived_leaf_reads_good() {
        let db = db_with_room().await;
        seeded(&db, &["r", "u"]).await;
        db.set("sala.temperatura".into(), TagValue::Float(21.0), Good)
            .await;
        let p = pairs(&[
            ("r", "tags['sala']['temperatura']"),
            ("u", "tags['sala.umidita']"),
        ]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "r").await.quality, Good);
        let u = get(&db, "u").await;
        assert_eq!((u.quality, u.timestamp_ms), (Uncertain, 0));
    }

    /// A leaf marked Bad broadcasts its root: the derived tag reading the
    /// leaf is evaluated and becomes Bad.
    #[tokio::test]
    async fn a_leaf_marked_bad_reaches_a_derived_reading_the_leaf() {
        let db = db_with_room().await;
        seeded(&db, &["l"]).await;
        db.set("sala.temperatura".into(), TagValue::Float(21.0), Good)
            .await;
        db.set("sala.umidita".into(), TagValue::Float(50.0), Good)
            .await;
        let p = pairs(&[("l", "tags['sala.temperatura'] + 1")]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "l").await.quality, Good);
        let mut rx = db.subscribe();
        db.marca_qualita("sala.temperatura", Bad).await;
        settle(&db, &mut rx, &p, &mut st).await;
        assert_eq!(get(&db, "l").await.quality, Bad);
    }

    #[tokio::test]
    async fn a_chain_of_derived_tags_propagates_bad() {
        let db = TagDb::new(64);
        seeded(&db, &["a", "b"]).await;
        db.set("x".into(), TagValue::Float(1.0), Good).await;
        let p = pairs(&[("a", "tags['x'] + 1"), ("b", "tags['a'] * 2")]);
        let mut st = DerivedState::default();
        let mut rx = db.subscribe();
        full(&db, &p, &mut st).await;
        settle(&db, &mut rx, &p, &mut st).await;
        let b = get(&db, "b").await;
        assert_eq!((b.value, b.quality), (TagValue::Float(4.0), Good));
        db.marca_qualita("x", Bad).await;
        settle(&db, &mut rx, &p, &mut st).await;
        assert_eq!(get(&db, "a").await.quality, Bad);
        assert_eq!(get(&db, "b").await.quality, Bad);
    }

    /// A constant is evaluated by a full round, never by a normal one; who
    /// reads it is then Good.
    #[tokio::test]
    async fn a_constant_derived_is_evaluated_in_the_full_round_and_its_reader_is_good() {
        let db = TagDb::new(64);
        seeded(&db, &["soglia", "allarme"]).await;
        db.set("t".into(), TagValue::Float(30.0), Good).await;
        let p = pairs(&[
            ("soglia", "25.0"),
            ("allarme", "tags['t'] > tags['soglia']"),
        ]);
        let mut st = DerivedState::default();
        run_derived_round(&db, &p, &ids(&["t"]), false, &mut st).await;
        assert_eq!(
            get(&db, "soglia").await.timestamp_ms,
            0,
            "not in a normal round"
        );
        let mut rx = db.subscribe();
        full(&db, &p, &mut st).await;
        let soglia = get(&db, "soglia").await;
        assert_eq!(
            (soglia.value, soglia.quality),
            (TagValue::Float(25.0), Good)
        );
        settle(&db, &mut rx, &p, &mut st).await;
        let allarme = get(&db, "allarme").await;
        assert_eq!(
            (allarme.value, allarme.quality),
            (TagValue::Bool(true), Good)
        );
    }

    /// An edited expression whose inputs do not change: a normal round does
    /// not see it, the full round the loop runs on a new registry does.
    #[tokio::test]
    async fn a_registry_change_forces_a_full_round() {
        let db = TagDb::new(64);
        seeded(&db, &["d"]).await;
        db.set("a".into(), TagValue::Float(3.0), Good).await;
        let mut st = DerivedState::default();
        full(&db, &pairs(&[("d", "tags['a'] * 2")]), &mut st).await;
        assert_eq!(get(&db, "d").await.value, TagValue::Float(6.0));
        let edited = pairs(&[("d", "tags['a'] * 3")]);
        run_derived_round(&db, &edited, &ids(&["other"]), false, &mut st).await;
        assert_eq!(get(&db, "d").await.value, TagValue::Float(6.0));
        run_derived_round(&db, &edited, &ids(&["other"]), true, &mut st).await;
        assert_eq!(get(&db, "d").await.value, TagValue::Float(9.0));
    }

    /// A `Lagged` loses the transition of an input without saying which: the
    /// batch that follows does not name it, and only the full round the loop
    /// runs after a `Lagged` brings the derived tag to Bad.
    #[tokio::test]
    async fn a_lagged_receiver_forces_a_full_round() {
        let db = TagDb::new(4);
        seeded(&db, &["a", "d"]).await;
        db.set("a".into(), TagValue::Float(1.0), Good).await;
        let p = pairs(&[("d", "tags['a'] * 2")]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        assert_eq!(get(&db, "d").await.quality, Good);
        let mut rx = db.subscribe();
        db.marca_qualita("a", Bad).await;
        for i in 0..6 {
            db.set(format!("other{i}"), TagValue::Int(i), Good).await;
        }
        assert!(matches!(rx.try_recv(), Err(TryRecvError::Lagged(_))));
        let mut changed = HashSet::new();
        while let Ok(u) = rx.try_recv() {
            changed.insert(u.id);
        }
        assert!(!changed.contains("a"), "the transition was lost");
        run_derived_round(&db, &p, &changed, false, &mut st).await;
        assert_eq!(
            get(&db, "d").await.quality,
            Good,
            "a normal round misses it"
        );
        run_derived_round(&db, &p, &changed, true, &mut st).await;
        assert_eq!(get(&db, "d").await.quality, Bad);
    }

    /// Woken up only by the write of a derived tag, a normal round is skipped
    /// (the loop guard); a full one is not.
    #[tokio::test]
    async fn the_full_round_bypasses_the_derived_only_guard() {
        let db = TagDb::new(64);
        seeded(&db, &["picco"]).await;
        db.set("p".into(), TagValue::Float(5.0), Good).await;
        let p = pairs(&[("picco", "max(tags['picco'], tags['p'])")]);
        let mut st = DerivedState::default();
        run_derived_round(&db, &p, &ids(&["picco"]), false, &mut st).await;
        assert_eq!(
            get(&db, "picco").await.timestamp_ms,
            0,
            "skipped by the guard"
        );
        run_derived_round(&db, &p, &ids(&["picco"]), true, &mut st).await;
        let picco = get(&db, "picco").await;
        assert_eq!((picco.value, picco.quality), (TagValue::Float(5.0), Good));
    }

    #[tokio::test]
    async fn a_self_reading_derived_with_a_bad_input_does_not_loop() {
        let db = TagDb::new(64);
        seeded(&db, &["picco"]).await;
        db.set("p".into(), TagValue::Float(5.0), Good).await;
        let p = pairs(&[("picco", "max(tags['picco'], tags['p'])")]);
        let mut st = DerivedState::default();
        full(&db, &p, &mut st).await;
        let mut rx = db.subscribe();
        let mut watch = db.subscribe();
        db.marca_qualita("p", Bad).await;
        let rounds = settle(&db, &mut rx, &p, &mut st).await;
        assert!(rounds <= 2, "{rounds} rounds");
        assert_eq!(get(&db, "picco").await.quality, Bad);
        let mut writes = 0;
        while let Ok(u) = watch.try_recv() {
            writes += usize::from(u.id == "picco");
        }
        assert_eq!(writes, 1);
    }

    /// The chain to the alarms: a derived tag Bad from its input does not
    /// fire an alarm on 0.0; the same 0.0 Good does.
    #[tokio::test]
    async fn an_alarm_on_a_bad_derived_does_not_fire() {
        let db = TagDb::new(64);
        seeded(&db, &["ty.eth0_rx_bps", "ty.eth0_rx_kbs"]).await;
        let p = pairs(&[("ty.eth0_rx_kbs", "round(tags['ty.eth0_rx_bps'] / 1024, 1)")]);
        let alarms = AlarmDb::new(8);
        let def: AlarmDef = serde_yaml::from_str(
            "id: rete_ferma\ntag: ty.eth0_rx_kbs\nmessage: ferma\ncondition:\n  kind: below\n  threshold: 1.0\n",
        )
        .unwrap();
        alarms.load(vec![def]).await;
        let active = || async { alarms.snapshot().await.first().is_some_and(|a| a.active) };
        let mut st = DerivedState::default();
        let mut rx = db.subscribe();
        let mut watch = db.subscribe();
        db.marca_qualita("ty.eth0_rx_bps", Bad).await;
        settle(&db, &mut rx, &p, &mut st).await;
        while let Ok(u) = watch.try_recv() {
            alarms.evaluate(&u.id, &u.state).await;
        }
        assert!(
            !active().await,
            "an alarm believed a derived tag from a Bad input"
        );
        db.ingest("ty.eth0_rx_bps".into(), TagValue::Float(0.0), Good)
            .await;
        settle(&db, &mut rx, &p, &mut st).await;
        while let Ok(u) = watch.try_recv() {
            alarms.evaluate(&u.id, &u.state).await;
        }
        assert!(active().await, "a Good 0.0 fires it as always");
    }

    /// Every derived tag of the templates is Good when all its inputs are,
    /// and names only tags: a comment or a name that is not a tag would show
    /// here.
    #[tokio::test]
    async fn every_template_derived_is_good_when_its_inputs_are_good() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../examples/templates");
        let mut seen = 0;
        for entry in std::fs::read_dir(&root).unwrap() {
            let file = entry.unwrap().path().join("project.yaml");
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let v: serde_yaml::Value = serde_yaml::from_str(&text).unwrap();
            let types: Vec<TypeDef> = match v.get("types") {
                Some(t) => serde_yaml::from_value(t.clone()).unwrap(),
                None => Vec::new(),
            };
            let tags: Vec<TagDef> = match v.get("tags") {
                Some(t) => serde_yaml::from_value(t.clone()).unwrap(),
                None => continue,
            };
            let db = TagDb::new(16);
            let mut forme = HashMap::new();
            for t in &tags {
                if let Ok(Some(f)) = Forma::da_tag(t, &types) {
                    forme.insert(t.id.clone(), f);
                }
            }
            db.set_forme(forme.clone()).await;
            for t in &tags {
                let initial = match forme.get(&t.id) {
                    Some(f) => f.valore_iniziale(),
                    None => t.initial_value(),
                };
                db.semina(t.id.clone(), initial).await;
            }
            for (id, s) in db.snapshot_foglie().await {
                db.set(id, s.value, Good).await;
            }
            let mut states = db.snapshot_foglie().await;
            for (k, s) in db.snapshot().await {
                states.entry(k).or_insert(s);
            }
            for t in &tags {
                let Some(expr) = &t.expression else { continue };
                seen += 1;
                let reads = expression_reads(expr);
                let mut missing = Vec::new();
                let q = derived_quality(&t.id, reads.as_deref(), states.get(&t.id), &states, |n| {
                    missing.push(n.to_string())
                });
                let where_ = format!("{}: {}: {expr}", file.display(), t.id);
                assert_eq!(q, DerivedOutcome::Write(Good), "{where_}");
                assert!(missing.is_empty(), "{where_}: not tags {missing:?}");
            }
        }
        assert!(seen >= 10, "found only {seen} expressions");
    }
}
