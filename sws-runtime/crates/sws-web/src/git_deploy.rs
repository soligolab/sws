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

use std::{path::PathBuf, process::Command};
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
            .args([
                "-C",
                &self.project_dir.to_string_lossy(),
                "rev-parse",
                "--show-toplevel",
            ])
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
        let branch = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
            .unwrap_or_else(|_| "unknown".into());
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
            .args([
                "-C",
                &self.project_dir.to_string_lossy(),
                "pull",
                "--ff-only",
            ])
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
            .args([
                "-C",
                &self.project_dir.to_string_lossy(),
                "reset",
                "--hard",
                "HEAD~1",
            ])
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
    ///
    /// Passo 2, 2e: prima di `add -A`, `secrets.yaml` esce dal tracciamento —
    /// anche in un repository già esistente, non solo in uno inizializzato da
    /// [`Self::init_remote`] dopo questa versione (conferma del maintainer,
    /// 22-09-2026). Servono **due** mosse, non una: `assicura_gitignore` basta
    /// per un file mai committato, ma `.gitignore` non ha alcun effetto su un
    /// file che è già nell'indice — quello va tolto con `git rm --cached`
    /// (`smetti_di_tracciare_secrets`), che lo lascia sul disco e lo rimuove
    /// solo dallo snapshot. Il commit registra la rimozione, quindi anche il
    /// remote smette di riceverlo.
    ///
    /// Quello che è già nei commit vecchi **resta lì**: non si riscrive la
    /// storia. Per questo, quando il file era tracciato, il messaggio
    /// ritornato lo dice a chiare lettere — il rimedio vero è ruotare le
    /// credenziali che quel file porta.
    pub fn commit(&self, message: &str) -> anyhow::Result<String> {
        let dir = self.project_dir.to_string_lossy().to_string();
        assicura_gitignore(&dir)?;
        // `git rm --cached` solo se serve davvero: su un repository sano è una
        // chiamata a git in meno per ogni commit, e l'avviso resta il segnale
        // che qualcosa di vecchio c'era.
        let avviso = if secrets_gia_tracciato(&dir) {
            Some(match smetti_di_tracciare_secrets(&dir) {
                Ok(()) => AVVISO_ERA_TRACCIATO.to_string(),
                Err(e) => format!("{AVVISO_RIMOZIONE_FALLITA} (dettaglio: {e})"),
            })
        } else {
            None
        };

        let add = Command::new("git")
            .args(["-C", &dir, "add", "-A"])
            .output()
            .map_err(|e| anyhow::anyhow!("git add: {e}"))?;
        if !add.status.success() {
            return Err(anyhow::anyhow!(
                "git add failed: {}",
                String::from_utf8_lossy(&add.stderr).trim()
            ));
        }
        let out = Command::new("git")
            .args(["-C", &dir, "commit", "-m", message])
            .output()
            .map_err(|e| anyhow::anyhow!("git commit: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            info!(dir = %self.project_dir.display(), "git commit: {stdout}");
            match avviso {
                Some(a) => {
                    warn!(dir = %self.project_dir.display(), "secrets.yaml era tracciato in git: tolto dall'indice con questo commit");
                    Ok(format!("{stdout}\n\n{a}"))
                }
                None => Ok(stdout),
            }
        } else {
            Err(anyhow::anyhow!("git commit failed: {stderr}"))
        }
    }

    /// `git push` — push to the default remote/branch from git config.
    pub fn push(&self) -> anyhow::Result<String> {
        let out = Command::new("git")
            .args(["-C", self.project_dir.to_string_lossy().as_ref(), "push"])
            .output()
            .map_err(|e| anyhow::anyhow!("git push: {e}"))?;
        // git push writes progress to stderr even on success
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if stdout.is_empty() {
            stderr.clone()
        } else {
            stdout
        };
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

    /// Un nome di tag che si può passare a `git tag` come argomento posizionale.
    ///
    /// git legge le opzioni in ordine: `git tag -d --delete` o `git push origin
    /// --mirror` con un nome scelto dall'utente sarebbero opzioni, non nomi. Le
    /// regole sono quelle di `git check-ref-format --allow-onelevel`, ridotte a
    /// quelle che contano qui: niente trattino iniziale, niente `..`, niente
    /// caratteri che git rifiuta (` ~^:?*[\`), niente controllo, non termina
    /// con `.lock` né con `/`.
    pub fn ref_sicuro(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= 200
            && !name.starts_with('-')
            && !name.starts_with('/')
            && !name.ends_with('/')
            && !name.ends_with(".lock")
            && !name.contains("..")
            && !name.contains("@{")
            && name.chars().all(|c| {
                !c.is_control() && !matches!(c, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
            })
    }

    /// Un URL di remote che non è un'opzione travestita. Il trasporto `ext::`
    /// (esecuzione di un comando locale) è già spento da git per default; qui si
    /// chiude il caso del trattino iniziale, che `git remote add origin` leggerebbe
    /// come flag.
    pub fn url_remote_sicuro(url: &str) -> bool {
        !url.is_empty() && !url.starts_with('-') && !url.chars().any(|c| c.is_control())
    }

    /// Aggancia il progetto a un repository: `git init` (idempotente — non
    /// distrugge la history se il progetto è già un repo) e, se `remote_url`
    /// è fornito, imposta/sostituisce `origin`. Copre sia un progetto mai
    /// versionato sia uno già inizializzato localmente senza remote.
    pub fn init_remote(&self, remote_url: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        run_git(&dir, &["init"])?;
        // Passo 2, 2e: `secrets.yaml` non deve mai entrare nel primo commit.
        assicura_gitignore(&dir)?;
        if let Some(url) = remote_url {
            if !Self::url_remote_sicuro(url) {
                anyhow::bail!("URL del remote non valido");
            }
            // Rimuove l'eventuale remote esistente, ignora l'errore (non c'era).
            let _ = Command::new("git")
                .args(["-C", &dir, "remote", "remove", "origin"])
                .output();
            run_git(&dir, &["remote", "add", "origin", "--", url])?;
        }
        Ok(())
    }

    /// Nomi dei tag esistenti, più recente per prima.
    pub fn list_tags(&self) -> anyhow::Result<Vec<String>> {
        let dir = self.project_dir.to_string_lossy().to_string();
        let out = git_out(&dir, &["tag", "--sort=-creatordate"])?;
        Ok(out
            .lines()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect())
    }

    /// Crea un tag — annotato (`-a -m`) se `message` è fornito, altrimenti
    /// leggero (solo un puntatore, come `git tag <name>`).
    pub fn create_tag(&self, name: &str, message: Option<&str>) -> anyhow::Result<()> {
        if !Self::ref_sicuro(name) {
            anyhow::bail!("nome del tag non valido: «{name}»");
        }
        let dir = self.project_dir.to_string_lossy().to_string();
        match message {
            Some(msg) => run_git(&dir, &["tag", "-a", name, "-m", msg]),
            None => run_git(&dir, &["tag", name]),
        }
    }

    /// `git push origin <name>` — pubblica un tag già esistente localmente.
    pub fn push_tag(&self, name: &str) -> anyhow::Result<String> {
        if !Self::ref_sicuro(name) {
            anyhow::bail!("nome del tag non valido: «{name}»");
        }
        let dir = self.project_dir.to_string_lossy().to_string();
        git_out(&dir, &["push", "origin", name])
    }

    /// Elimina un tag: sempre in locale; anche sul remote se ne è configurato
    /// uno — un fallimento della sola parte remota (es. il tag non era mai
    /// stato pushato) non fa fallire l'operazione, viene solo loggato.
    pub fn delete_tag(&self, name: &str) -> anyhow::Result<()> {
        if !Self::ref_sicuro(name) {
            anyhow::bail!("nome del tag non valido: «{name}»");
        }
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
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("git {}: {e}", args.join(" ")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(anyhow::anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// La riga che tiene `secrets.yaml` fuori dal tracciamento git.
const RIGA_GITIGNORE: &str = "secrets.yaml";

/// Assicura che `<dir>/.gitignore` contenga [`RIGA_GITIGNORE`]: la crea se
/// manca, la aggiunge in coda se il file c'è ma non la contiene già (per
/// riga intera — un prefisso tipo `secrets.yaml.bak` non conta come
/// presenza), non tocca nulla se c'è già. Chiamata sia da
/// [`GitDeploy::init_remote`] (repository nuovo) sia da
/// [`GitDeploy::commit`] (repository già esistente, prima di questa
/// versione — conferma del maintainer, 22-09-2026: «sì, anche negli
/// esistenti»).
fn assicura_gitignore(dir: &str) -> anyhow::Result<()> {
    let path = std::path::Path::new(dir).join(".gitignore");
    let testo = std::fs::read_to_string(&path).unwrap_or_default();
    if testo.lines().any(|r| r.trim() == RIGA_GITIGNORE) {
        return Ok(());
    }
    let separatore = if testo.is_empty() || testo.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let nuovo = format!("{testo}{separatore}{RIGA_GITIGNORE}\n");
    std::fs::write(&path, nuovo)
        .map_err(|e| anyhow::anyhow!("scrittura di {}: {e}", path.display()))
}

/// Vero se `secrets.yaml` è già tracciato (in HEAD o nell'indice) — un
/// repository esistente da prima di questa guardia può averlo committato
/// prima che `.gitignore` lo escludesse. `git ls-files` non fallisce mai per
/// un file assente: una lista vuota e un errore reale si distinguono solo
/// guardando l'esito del comando, non il contenuto — per questo si usa
/// `git_out` e si guarda se ha prodotto qualcosa, non se è andato in errore.
fn secrets_gia_tracciato(dir: &str) -> bool {
    git_out(dir, &["ls-files", "--", "secrets.yaml"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

/// Il messaggio che accompagna il commit quando `secrets.yaml` era tracciato e
/// questo commit lo toglie dall'indice.
const AVVISO_ERA_TRACCIATO: &str = "⚠ secrets.yaml era tracciato in questo repository (da prima \
    di questa versione): con questo commit esce dal tracciamento e non verrà più pubblicato. \
    Resta però nei commit già fatti — la storia non si riscrive. Il rimedio è ruotare le \
    credenziali che quel file porta.";

/// Il messaggio quando il `git rm --cached` non è riuscito: il commit è andato
/// comunque, ma il file è ancora tracciato e il rimedio va dato a mano.
const AVVISO_RIMOZIONE_FALLITA: &str = "⚠ secrets.yaml è tracciato in questo repository e non \
    sono riuscito a toglierlo dall'indice: il commit è stato fatto, ma il file continua a \
    viaggiare. Toglilo a mano con «git rm --cached -- secrets.yaml» e ruota le credenziali che \
    porta.";

/// `git rm --cached -- secrets.yaml`: toglie il file dall'**indice** lasciandolo
/// sul disco (senza `--cached` lo cancellerebbe: il progetto perderebbe le sue
/// credenziali). `--ignore-unmatch` rende la chiamata innocua se nel frattempo
/// non risulta più tracciato. Va fatta **prima** di `git add -A`: dopo, il file
/// sarebbe già rientrato nell'indice.
fn smetti_di_tracciare_secrets(dir: &str) -> anyhow::Result<()> {
    git_out(
        dir,
        &[
            "rm",
            "--cached",
            "--ignore-unmatch",
            "-q",
            "--",
            "secrets.yaml",
        ],
    )
    .map(|_| ())
}

fn run_git(dir: &str, args: &[&str]) -> anyhow::Result<()> {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .map_err(|e| anyhow::anyhow!("git {}: {e}", args.join(" ")))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("git {} failed", args.join(" ")))
    }
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

    /// Un nome che comincia per `-` è un'opzione per `git tag`, `git push` e
    /// `git remote add`: `--delete`, `--mirror`, `--force`. Trovato nella
    /// revisione del 2026-09-09: il nome arrivava dall'URL all'invocazione
    /// senza controlli, e l'unico test era che non fosse vuoto.
    #[test]
    fn i_nomi_dei_tag_che_sarebbero_opzioni_vengono_rifiutati() {
        assert!(GitDeploy::ref_sicuro("v2.6.6"));
        assert!(GitDeploy::ref_sicuro("release/2026-09"));
        assert!(GitDeploy::ref_sicuro("impianto_A-1"));
        assert!(!GitDeploy::ref_sicuro("--delete"));
        assert!(!GitDeploy::ref_sicuro("-d"));
        assert!(!GitDeploy::ref_sicuro("a..b"));
        assert!(!GitDeploy::ref_sicuro("con spazio"));
        assert!(!GitDeploy::ref_sicuro("a:b"));
        assert!(!GitDeploy::ref_sicuro("x.lock"));
        assert!(!GitDeploy::ref_sicuro("dir/"));
        assert!(!GitDeploy::ref_sicuro("a@{1}"));
        assert!(!GitDeploy::ref_sicuro(""));
    }

    #[test]
    fn l_url_del_remote_non_puo_essere_una_flag() {
        assert!(GitDeploy::url_remote_sicuro(
            "git@github.com:soligolab/sws.git"
        ));
        assert!(GitDeploy::url_remote_sicuro("https://example.com/r.git"));
        assert!(!GitDeploy::url_remote_sicuro("--mirror=fetch"));
        assert!(!GitDeploy::url_remote_sicuro(""));
    }

    #[test]
    fn create_tag_rifiuta_prima_di_toccare_git() {
        let tmp = tempfile::tempdir().unwrap();
        run_git(&tmp.path().to_string_lossy(), &["init"]).unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        let err = gd.create_tag("--delete", None).unwrap_err().to_string();
        assert!(err.contains("non valido"), "{err}");
    }

    // ── Passo 2, 2e: secrets.yaml non deve mai finire in git ────────────────

    /// Ogni test di questo blocco vuole un'identità: un repo appena creato in
    /// una CI/sandbox senza `~/.gitconfig` fa fallire `git commit` altrimenti.
    fn repo_di_prova() -> TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        run_git(&dir, &["init"]).unwrap();
        run_git(&dir, &["config", "user.email", "prova@sws.test"]).unwrap();
        run_git(&dir, &["config", "user.name", "Prova"]).unwrap();
        tmp
    }

    #[test]
    fn init_remote_scrive_il_gitignore() {
        let tmp = tempfile::tempdir().unwrap(); // niente `init` qui: lo fa init_remote
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        gd.init_remote(None).unwrap();
        let gi = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert!(gi.lines().any(|r| r.trim() == "secrets.yaml"), "{gi}");
    }

    /// Un `.gitignore` che il maintainer ha già scritto a mano (con altre
    /// righe) non viene sostituito: `secrets.yaml` si aggiunge in coda.
    #[test]
    fn init_remote_aggiunge_alla_coda_un_gitignore_esistente() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "*.log\n").unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        gd.init_remote(None).unwrap();
        let gi = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gi, "*.log\nsecrets.yaml\n");
    }

    /// Idempotente: chiamarla due volte non duplica la riga.
    #[test]
    fn assicura_gitignore_non_duplica_la_riga() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        assicura_gitignore(&dir).unwrap();
        assicura_gitignore(&dir).unwrap();
        let gi = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gi.matches("secrets.yaml").count(), 1, "{gi}");
    }

    /// Il caso normale: un repository nuovo, un commit con un vero
    /// `secrets.yaml` sul disco — non deve entrare nello snapshot.
    #[test]
    fn commit_non_traccia_secrets_yaml() {
        let tmp = repo_di_prova();
        std::fs::write(tmp.path().join("project.yaml"), "meta: {name: p}\n").unwrap();
        std::fs::write(
            tmp.path().join("secrets.yaml"),
            "notifications.telegram.bot_token: x\n",
        )
        .unwrap();

        let gd = GitDeploy::new(tmp.path().to_path_buf());
        let msg = gd.commit("primo commit").unwrap();
        assert!(!msg.contains("già nella storia"), "{msg}");

        assert!(!secrets_gia_tracciato(&tmp.path().to_string_lossy()));
        let tracciati = git_out(&tmp.path().to_string_lossy(), &["ls-files"]).unwrap();
        assert!(!tracciati.contains("secrets.yaml"), "{tracciati}");
        assert!(tracciati.contains("project.yaml"), "{tracciati}");
    }

    /// Un repository esistente **da prima** di questa versione: `secrets.yaml`
    /// è già nella storia. Il `.gitignore` da solo non basterebbe — su un file
    /// già nell'indice git lo ignora, l'ignore — quindi il commit successivo lo
    /// toglie dal tracciamento (senza cancellarlo dal disco) e AVVERTE, perché
    /// nei commit vecchi resta finché nessuno riscrive la storia.
    #[test]
    fn commit_smette_di_tracciare_secrets_yaml_gia_committato() {
        let tmp = repo_di_prova();
        let dir = tmp.path().to_string_lossy().to_string();
        // Simula un repository di prima di 2e: nessun .gitignore, un
        // secrets.yaml committato come un file qualunque.
        std::fs::write(tmp.path().join("secrets.yaml"), "vecchio: si\n").unwrap();
        run_git(&dir, &["add", "-A"]).unwrap();
        run_git(&dir, &["commit", "-m", "prima di 2e"]).unwrap();
        assert!(
            secrets_gia_tracciato(&dir),
            "il caso di prova non è quello giusto"
        );

        std::fs::write(tmp.path().join("project.yaml"), "meta: {name: p}\n").unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        let msg = gd.commit("dopo 2e").unwrap();

        assert!(msg.contains("era tracciato"), "{msg}");
        assert!(msg.contains("ruotare le credenziali"), "{msg}");
        // Fuori dall'indice...
        assert!(!secrets_gia_tracciato(&dir));
        let tracciati = git_out(&dir, &["ls-files"]).unwrap();
        assert!(!tracciati.contains("secrets.yaml"), "{tracciati}");
        // ...ma ancora sul disco, col suo contenuto: `--cached` e non `rm`.
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("secrets.yaml")).unwrap(),
            "vecchio: si\n"
        );
        // E il commit seguente non riavverte: non c'è più niente da togliere.
        std::fs::write(tmp.path().join("project.yaml"), "meta: {name: q}\n").unwrap();
        let msg = gd.commit("terzo").unwrap();
        assert!(!msg.contains("era tracciato"), "{msg}");
    }
}
