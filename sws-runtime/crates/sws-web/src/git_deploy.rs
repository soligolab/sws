//! T-20 — GitOps helpers: git operations on the active project directory.
//!
//! Versions the *project* the same way a developer would version any other
//! directory — never the SWS application/runtime source tree, which lives
//! entirely elsewhere on disk and this module never touches.
//!
//! All operations shell out to the `git` binary via `std::process::Command`.
//! No `libgit2` C dependency — git is assumed to be on PATH.
//!
//! Endpoints:
//!   GET    /api/project/git-status        — current sha, branch, remote, last deploy
//!   POST   /api/project/git/init          — attach the project to a repository (init + set/replace origin)
//!   POST   /api/project/deploy            — git pull + project hot-reload
//!   POST   /api/project/rollback          — git reset --hard HEAD~1 + hot-reload
//!   POST   /api/project/git/commit        — git add -A + commit
//!   POST   /api/project/git/push          — git push
//!   GET    /api/project/git/tags          — list tags
//!   POST   /api/project/git/tags          — create a tag
//!   POST   /api/project/git/tags/:name/push   — push a single tag
//!   DELETE /api/project/git/tags/:name    — delete a tag (local + remote)

use std::{
    path::PathBuf,
    process::Command,
};
use tracing::{info, warn};

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatus {
    /// Current HEAD commit SHA (short, 8 chars).
    pub sha: String,
    /// Commit author.
    pub author: String,
    /// Commit message (first line).
    pub message: String,
    /// ISO timestamp of the commit.
    pub commit_date: String,
    /// Current branch name.
    pub branch: String,
    /// Remote origin URL (if configured).
    pub remote_url: Option<String>,
    /// Whether the working tree is clean.
    pub clean: bool,
    /// Unix timestamp (ms) of the last deploy triggered via this API.
    pub last_deploy_ms: Option<u64>,
    /// Commits in HEAD not yet pushed to upstream (0 if no remote or no tracking branch).
    pub unpushed_commits: u32,
}

pub struct GitDeploy {
    pub project_dir: PathBuf,
}

impl GitDeploy {
    pub fn new(project_dir: PathBuf) -> Self {
        Self { project_dir }
    }

    /// Returns true if `project_dir` is itself the root of a git repository.
    ///
    /// Deliberately NOT `rev-parse --git-dir` alone: that succeeds for any directory
    /// nested inside any repository (git walks up parents to find `.git`), so a project
    /// living under a dev checkout of SWS itself (e.g. `--projects-root` pointed inside
    /// this repo) would silently report the SWS repo as the project's own — this method
    /// requires `project_dir` to equal the repo's `--show-toplevel`.
    pub fn is_git_repo(&self) -> bool {
        let canon_dir = match std::fs::canonicalize(&self.project_dir) {
            Ok(p) => p,
            Err(_) => return false,
        };
        let toplevel = match Command::new("git")
            .args(["-C", &self.project_dir.to_string_lossy(), "rev-parse", "--show-toplevel"])
            .output()
        {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => return false,
        };
        std::fs::canonicalize(&toplevel)
            .map(|p| p == canon_dir)
            .unwrap_or(false)
    }

    pub fn status(&self) -> anyhow::Result<GitStatus> {
        let dir = self.project_dir.to_string_lossy().to_string();

        let sha = git_out(&dir, &["log", "-1", "--format=%h"])?;
        let author = git_out(&dir, &["log", "-1", "--format=%an"])?;
        let message = git_out(&dir, &["log", "-1", "--format=%s"])?;
        let commit_date = git_out(&dir, &["log", "-1", "--format=%cI"])?;
        let branch = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "unknown".into());
        let remote_url = git_out(&dir, &["remote", "get-url", "origin"]).ok();
        let clean = Command::new("git")
            .args(["-C", &dir, "status", "--porcelain"])
            .output()
            .map(|o| o.stdout.is_empty())
            .unwrap_or(true);

        let unpushed_commits = self.unpushed_count();
        Ok(GitStatus {
            sha,
            author,
            message,
            commit_date,
            branch,
            remote_url,
            clean,
            last_deploy_ms: None,
            unpushed_commits,
        })
    }

    /// `git pull` in the project directory.
    pub fn pull(&self) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(["-C", &self.project_dir.to_string_lossy(), "pull", "--ff-only"])
            .output()
            .map_err(|e| anyhow::anyhow!("git pull: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            info!(dir = %self.project_dir.display(), "git pull: {stdout}");
            Ok(stdout)
        } else {
            Err(anyhow::anyhow!("git pull failed: {stderr}"))
        }
    }

    /// `git reset --hard HEAD~1` — revert to previous commit.
    pub fn rollback(&self) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(["-C", &self.project_dir.to_string_lossy(), "reset", "--hard", "HEAD~1"])
            .output()
            .map_err(|e| anyhow::anyhow!("git reset: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            info!(dir = %self.project_dir.display(), "git rollback: {stdout}");
            Ok(stdout)
        } else {
            Err(anyhow::anyhow!("git reset failed: {stderr}"))
        }
    }

    /// `git add -A && git commit -m <message>` — stage everything and commit.
    pub fn commit(&self, message: &str) -> anyhow::Result<String> {
        let dir = self.project_dir.to_string_lossy().to_string();
        let add = Command::new("git")
            .args(["-C", &dir, "add", "-A"])
            .output()
            .map_err(|e| anyhow::anyhow!("git add: {e}"))?;
        if !add.status.success() {
            return Err(anyhow::anyhow!("git add failed: {}", String::from_utf8_lossy(&add.stderr).trim()));
        }
        let out = Command::new("git")
            .args(["-C", &dir, "commit", "-m", message])
            .output()
            .map_err(|e| anyhow::anyhow!("git commit: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            info!(dir = %self.project_dir.display(), "git commit: {stdout}");
            Ok(stdout)
        } else {
            Err(anyhow::anyhow!("git commit failed: {stderr}"))
        }
    }

    /// `git push` — push to the default remote/branch from git config.
    pub fn push(&self) -> anyhow::Result<String> {
        let out = Command::new("git")
            .args(["-C", &self.project_dir.to_string_lossy().as_ref(), "push"])
            .output()
            .map_err(|e| anyhow::anyhow!("git push: {e}"))?;
        // git push writes progress to stderr even on success
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if stdout.is_empty() { stderr.clone() } else { stdout };
        if out.status.success() {
            info!(dir = %self.project_dir.display(), "git push: {msg}");
            Ok(msg)
        } else {
            Err(anyhow::anyhow!("git push failed: {stderr}"))
        }
    }

    /// Count commits in HEAD not yet in the upstream tracking branch.
    /// Returns 0 if there is no remote or no tracking branch.
    pub fn unpushed_count(&self) -> u32 {
        let dir = self.project_dir.to_string_lossy().to_string();
        git_out(&dir, &["rev-list", "--count", "HEAD", "^@{upstream}"])
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    }

    /// Aggancia il progetto a un repository: `git init` (idempotente — non
    /// distrugge la history se il progetto è già un repo) e, se `remote_url`
    /// è fornito, imposta/sostituisce `origin`. Copre sia un progetto mai
    /// versionato sia uno già inizializzato localmente senza remote.
    pub fn init_remote(&self, remote_url: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        run_git(&dir, &["init"])?;
        if let Some(url) = remote_url {
            // Rimuove l'eventuale remote esistente, ignora l'errore (non c'era).
            let _ = Command::new("git").args(["-C", &dir, "remote", "remove", "origin"]).output();
            run_git(&dir, &["remote", "add", "origin", url])?;
        }
        Ok(())
    }

    /// Nomi dei tag esistenti, più recente per prima.
    pub fn list_tags(&self) -> anyhow::Result<Vec<String>> {
        let dir = self.project_dir.to_string_lossy().to_string();
        let out = git_out(&dir, &["tag", "--sort=-creatordate"])?;
        Ok(out.lines().map(|s| s.to_string()).filter(|s| !s.is_empty()).collect())
    }

    /// Crea un tag — annotato (`-a -m`) se `message` è fornito, altrimenti
    /// leggero (solo un puntatore, come `git tag <name>`).
    pub fn create_tag(&self, name: &str, message: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        match message {
            Some(msg) => run_git(&dir, &["tag", "-a", name, "-m", msg]),
            None => run_git(&dir, &["tag", name]),
        }
    }

    /// `git push origin <name>` — pubblica un tag già esistente localmente.
    pub fn push_tag(&self, name: &str) -> anyhow::Result<String> {
        let dir = self.project_dir.to_string_lossy().to_string();
        git_out(&dir, &["push", "origin", name])
    }

    /// Elimina un tag: sempre in locale; anche sul remote se ne è configurato
    /// uno — un fallimento della sola parte remota (es. il tag non era mai
    /// stato pushato) non fa fallire l'operazione, viene solo loggato.
    pub fn delete_tag(&self, name: &str) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        run_git(&dir, &["tag", "-d", name])?;
        if git_out(&dir, &["remote", "get-url", "origin"]).is_ok() {
            if let Err(e) = git_out(&dir, &["push", "origin", &format!(":refs/tags/{name}")]) {
                warn!("delete_tag: rimozione del tag {name} sul remote fallita (forse non era mai stato pushato): {e}");
            }
        }
        Ok(())
    }
}

fn git_out(dir: &str, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .arg("-C").arg(dir)
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("git {}: {e}", args.join(" ")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(anyhow::anyhow!("{}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

fn run_git(dir: &str, args: &[&str]) -> anyhow::Result<()> {
    let status = Command::new("git").arg("-C").arg(dir).args(args).status()
        .map_err(|e| anyhow::anyhow!("git {}: {e}", args.join(" ")))?;
    if status.success() { Ok(()) } else { Err(anyhow::anyhow!("git {} failed", args.join(" "))) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn is_git_repo_true_when_dir_is_the_repo_root() {
        let tmp = TempDir::new().unwrap();
        run_git(&tmp.path().to_string_lossy(), &["init"]).unwrap();

        let gd = GitDeploy::new(tmp.path().to_path_buf());
        assert!(gd.is_git_repo());
    }

    #[test]
    fn is_git_repo_false_for_a_subdirectory_of_a_repo() {
        // Reproduces the Sandokan bug: a project dir nested inside an unrelated
        // repo (here, the tempdir itself) must NOT be reported as its own repo.
        let tmp = TempDir::new().unwrap();
        run_git(&tmp.path().to_string_lossy(), &["init"]).unwrap();
        let nested = tmp.path().join("projects").join("Sandokan");
        std::fs::create_dir_all(&nested).unwrap();

        let gd = GitDeploy::new(nested);
        assert!(!gd.is_git_repo());
    }

    #[test]
    fn is_git_repo_false_outside_any_repo() {
        let tmp = TempDir::new().unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        assert!(!gd.is_git_repo());
    }
}
