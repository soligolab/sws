//! T-20 — GitOps helpers: git operations on the active project directory.
//!
//! All operations shell out to the `git` binary via `std::process::Command`.
//! No `libgit2` C dependency — git is assumed to be on PATH.
//!
//! Endpoints:
//!   GET  /api/project/git-status   — current sha, branch, remote, last deploy
//!   POST /api/project/deploy       — git pull + project hot-reload
//!   POST /api/project/rollback     — git reset --hard HEAD~1 + hot-reload

use std::{
    path::PathBuf,
    process::Command,
};
use tracing::info;

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
}

pub struct GitDeploy {
    pub project_dir: PathBuf,
}

impl GitDeploy {
    pub fn new(project_dir: PathBuf) -> Self {
        Self { project_dir }
    }

    /// Returns true if `project_dir` is inside a git repository.
    pub fn is_git_repo(&self) -> bool {
        Command::new("git")
            .args(["-C", &self.project_dir.to_string_lossy(), "rev-parse", "--git-dir"])
            .output()
            .map(|o| o.status.success())
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

        Ok(GitStatus {
            sha,
            author,
            message,
            commit_date,
            branch,
            remote_url,
            clean,
            last_deploy_ms: None,
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

    /// `git init` + `git remote add origin <url>` for a new project.
    pub fn init_remote(&self, remote_url: &str) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        run_git(&dir, &["init"])?;
        // Remove existing remote if present, ignore error.
        let _ = Command::new("git").args(["-C", &dir, "remote", "remove", "origin"]).output();
        run_git(&dir, &["remote", "add", "origin", remote_url])?;
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
