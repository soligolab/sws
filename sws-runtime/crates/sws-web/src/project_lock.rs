//! The project lock (21-11-2026, plan
//! `docs/plans/2026-11-21-lock-salva-come-sorgenti-sandbox.md`).
//!
//! Two IDEs could open the same project and both save: `If-Match` (Q30) kept
//! one from silently overwriting the other, but nothing told the second one
//! that someone was already working there. Now the runtime that serves the
//! project — the container in the cloud, the runtime in a LAN — keeps, per
//! project, **which IDE tab may write**.
//!
//! - A tab claims the lock when it opens the project and keeps it alive with a
//!   heartbeat (`POST /api/project/lock` every 15 s). Without a heartbeat for
//!   [`EXPIRY`] the lock is free: a browser closed on a train frees the
//!   project in a minute.
//! - A tab that finds the lock taken opens read-only, or takes control: the
//!   tab that had it learns it at its next heartbeat.
//! - The server enforces it ([`route_needs_lock`] in a middleware): a project
//!   write from a tab without the lock gets 423. A request without the tab
//!   header (a script, `curl`, the viewer) passes as before — the same rule as
//!   `If-Match`.
//!
//! In memory, not on disk: a restarted runtime starts with no lock, and the
//! tabs that are still open claim it again at their next heartbeat.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A lock without heartbeats for this long is free (maintainer's choice:
/// four missed heartbeats).
pub const EXPIRY: Duration = Duration::from_secs(60);

/// The header with which the IDE says which tab a request comes from.
pub const TAB_HEADER: &str = "x-sws-tab";

#[derive(Debug, Clone)]
struct Holder {
    tab: String,
    user: Option<String>,
    since_ms: u64,
    beat: Instant,
}

/// Who holds a lock, as the other tabs see it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct HolderView {
    /// The user name; `None` on an instance without users.
    pub user: Option<String>,
    /// Since when it holds it, in ms since the epoch.
    pub since_ms: u64,
    /// The same user as the one asking: «open by you in another tab».
    pub same_user: bool,
}

/// The answer to a claim or a heartbeat.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Claim {
    pub held: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<HolderView>,
}

#[derive(Default)]
pub struct ProjectLock {
    by_project: Mutex<HashMap<String, Holder>>,
}

impl ProjectLock {
    pub fn new() -> Self {
        Self::default()
    }

    /// Claim (or keep alive) the lock of `project` for `tab`. With `take`, a
    /// lock held by another tab passes to this one.
    pub fn claim(
        &self,
        project: &str,
        tab: &str,
        user: Option<&str>,
        take: bool,
        now: Instant,
        now_ms: u64,
    ) -> Claim {
        let mut map = self.by_project.lock().unwrap_or_else(|e| e.into_inner());
        match map.get_mut(project) {
            Some(h) if h.tab == tab => {
                h.beat = now;
                return Claim {
                    held: true,
                    holder: None,
                };
            }
            Some(h) if !take && now.duration_since(h.beat) < EXPIRY => {
                return Claim {
                    held: false,
                    holder: Some(HolderView {
                        user: h.user.clone(),
                        since_ms: h.since_ms,
                        same_user: h.user.is_some() && h.user.as_deref() == user,
                    }),
                };
            }
            _ => {}
        }
        map.insert(
            project.to_string(),
            Holder {
                tab: tab.to_string(),
                user: user.map(str::to_string),
                since_ms: now_ms,
                beat: now,
            },
        );
        Claim {
            held: true,
            holder: None,
        }
    }

    /// The tab lets the lock go (closing the project, logging out).
    pub fn release(&self, project: &str, tab: &str) {
        let mut map = self.by_project.lock().unwrap_or_else(|e| e.into_inner());
        if map.get(project).is_some_and(|h| h.tab == tab) {
            map.remove(project);
        }
    }

    /// Whether `tab` may write `project`: yes when it holds the lock, when
    /// nobody does, or when the holder stopped beating.
    pub fn may_write(&self, project: &str, tab: &str, now: Instant) -> bool {
        let map = self.by_project.lock().unwrap_or_else(|e| e.into_inner());
        match map.get(project) {
            Some(h) => h.tab == tab || now.duration_since(h.beat) >= EXPIRY,
            None => true,
        }
    }
}

/// The writes the lock guards: the same as a git trial blocks (project files,
/// pages, faceplates, frames, floor plans, recipes, project users), plus
/// entering a trial, which rewrites the files. The lock's own routes are out.
pub fn route_needs_lock(path: &str) -> bool {
    if path == "/api/project/lock" || path.starts_with("/api/project/lock/") {
        return false;
    }
    crate::git_deploy::rotta_bloccata_in_prova(path)
        || path == "/api/project/git/prova"
        || path.starts_with("/api/project/git/prova/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: &str = "/progetti/casa";

    #[test]
    fn the_first_tab_gets_it_the_second_sees_who() {
        let l = ProjectLock::new();
        let t0 = Instant::now();
        assert!(l.claim(P, "a", Some("mauro"), false, t0, 1000).held);
        let c = l.claim(P, "b", Some("mario"), false, t0, 2000);
        assert!(!c.held);
        assert_eq!(
            c.holder,
            Some(HolderView {
                user: Some("mauro".into()),
                since_ms: 1000,
                same_user: false
            })
        );
        // The same user in another tab is told so.
        let c = l.claim(P, "c", Some("mauro"), false, t0, 2000);
        assert!(c.holder.unwrap().same_user);
        // Without users nobody is «the same user».
        let l = ProjectLock::new();
        l.claim(P, "a", None, false, t0, 0);
        assert!(
            !l.claim(P, "b", None, false, t0, 0)
                .holder
                .unwrap()
                .same_user
        );
    }

    #[test]
    fn the_heartbeat_keeps_it_and_its_absence_frees_it() {
        let l = ProjectLock::new();
        let t0 = Instant::now();
        l.claim(P, "a", None, false, t0, 0);
        let t1 = t0 + Duration::from_secs(50);
        assert!(l.claim(P, "a", None, false, t1, 0).held, "heartbeat");
        let t2 = t1 + Duration::from_secs(50);
        assert!(
            !l.claim(P, "b", None, false, t2, 0).held,
            "beaten 50 s ago: still held"
        );
        assert!(!l.may_write(P, "b", t2));
        let t3 = t1 + EXPIRY;
        assert!(l.may_write(P, "b", t3), "expired: anyone may write");
        assert!(l.claim(P, "b", None, false, t3, 0).held, "expired: free");
        assert!(
            !l.claim(P, "a", None, false, t3, 0).held,
            "the old holder learns it"
        );
    }

    #[test]
    fn taking_control_passes_it_over() {
        let l = ProjectLock::new();
        let t0 = Instant::now();
        l.claim(P, "a", Some("mauro"), false, t0, 0);
        assert!(l.claim(P, "b", Some("mario"), true, t0, 5).held);
        assert!(l.may_write(P, "b", t0));
        assert!(!l.may_write(P, "a", t0));
        let c = l.claim(P, "a", Some("mauro"), false, t0, 6);
        assert_eq!(c.holder.unwrap().user.as_deref(), Some("mario"));
    }

    #[test]
    fn release_frees_only_ones_own_lock() {
        let l = ProjectLock::new();
        let t0 = Instant::now();
        l.claim(P, "a", None, false, t0, 0);
        l.release(P, "b");
        assert!(!l.may_write(P, "b", t0));
        l.release(P, "a");
        assert!(l.may_write(P, "b", t0));
    }

    #[test]
    fn two_projects_two_locks() {
        let l = ProjectLock::new();
        let t0 = Instant::now();
        l.claim(P, "a", None, false, t0, 0);
        assert!(l.claim("/progetti/altro", "b", None, false, t0, 0).held);
    }

    #[test]
    fn which_routes_need_it() {
        for p in [
            "/api/project/tags",
            "/api/synoptics/home",
            "/api/faceplates/f1",
            "/api/recipes/r1",
            "/api/project/git/prova",
            "/api/auth/users/mario",
        ] {
            assert!(route_needs_lock(p), "{p}");
        }
        for p in [
            "/api/project/lock",
            "/api/project/lock/release",
            "/api/recipes/r1/apply",
            "/api/tags/x",
            "/api/alarms/a/ack",
            "/api/project/validate",
            "/api/script/run/f",
        ] {
            assert!(!route_needs_lock(p), "{p}");
        }
    }
}
