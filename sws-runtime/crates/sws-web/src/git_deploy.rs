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
    /// La chiave SSH che il repository usa per parlare col remote: il nome del
    /// file in `~/.ssh` se l'ha impostata l'IDE, il comando intero se
    /// `core.sshCommand` l'ha scritto qualcun altro, `None` = quella di ssh.
    pub ssh_key: Option<String>,
    /// Chi firma i commit: `user.name`/`user.email` come li vede git (prima il
    /// `.git/config` del progetto, poi la configurazione globale).
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    /// Vero se nome o email sono impostati **per questo repository** e non
    /// vengono dalla configurazione globale.
    pub identita_locale: bool,
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

        // Un repository appena agganciato non ha commit: `git log` fallisce, e
        // prima quell'errore diventava un 500 che lasciava il pannello senza
        // bottoni — proprio senza «Commit», l'unico che serviva. Senza commit
        // i quattro campi restano vuoti e l'IDE lo dice.
        let ha_commit = git_out(&dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
        let (sha, author, message, commit_date) = if ha_commit {
            (
                git_out(&dir, &["log", "-1", "--format=%h"])?,
                git_out(&dir, &["log", "-1", "--format=%an"])?,
                git_out(&dir, &["log", "-1", "--format=%s"])?,
                git_out(&dir, &["log", "-1", "--format=%cI"])?,
            )
        } else {
            Default::default()
        };
        // `symbolic-ref` risponde anche su un ramo ancora senza commit, dove
        // `rev-parse --abbrev-ref HEAD` fallisce.
        let branch = git_out(&dir, &["symbolic-ref", "--short", "-q", "HEAD"])
            .or_else(|_| git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]))
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
            ssh_key: self.chiave_ssh(),
            author_name: git_out(&dir, &["config", "user.name"]).ok().filter(|s| !s.is_empty()),
            author_email: git_out(&dir, &["config", "user.email"]).ok().filter(|s| !s.is_empty()),
            identita_locale: git_out(&dir, &["config", "--local", "user.name"]).is_ok()
                || git_out(&dir, &["config", "--local", "user.email"]).is_ok(),
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
        // Stessa mossa per lo storico e i backup, se un commit di prima del
        // `.gitignore` completo li ha già presi (CasaDomotica, 26-09-2026).
        let dati = file_di_dati_tracciati(&dir);
        let avviso_dati = if dati.is_empty() {
            None
        } else {
            let mut args = vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"];
            args.extend(dati.iter().map(String::as_str));
            git_out(&dir, &args)?;
            warn!(dir = %self.project_dir.display(), n = dati.len(), "file di dati tracciati in git: tolti dall'indice con questo commit");
            Some(format!(
                "⚠ {} file di dati (storico *.db, backups/) erano tracciati in questo repository: con \
                 questo commit escono dal tracciamento. Restano però nei commit già fatti, e se uno \
                 supera i 100 MB GitHub rifiuterà il push. Se il repository non è mai stato \
                 pubblicato, la via pulita è ricrearlo: cancella la cartella .git e riaggancialo.",
                dati.len()
            ))
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
        // Ultima rete: un file enorme che nessuna riga del `.gitignore` conosce
        // (un export, un video, un database con un'estensione diversa) esce
        // dallo staging e il commit **non si fa**. Una volta dentro un commit
        // non lo toglie più nessun commit successivo.
        let grossi = file_in_staging_troppo_grandi(&dir, &self.project_dir);
        if !grossi.is_empty() {
            let nomi: Vec<&str> = grossi.iter().map(|(n, _)| n.as_str()).collect();
            let ha_commit = git_out(&dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
            let mut args = if ha_commit {
                vec!["reset", "-q", "--"]
            } else {
                vec!["rm", "--cached", "-q", "--"]
            };
            args.extend(nomi.iter().copied());
            let _ = git_out(&dir, &args);
            anyhow::bail!(
                "commit fermato: {} troppo grand{} per un repository git (oltre {} MB): {}. \
                 Aggiungil{} al .gitignore del progetto, oppure spostal{} fuori dalla cartella, e \
                 riprova.",
                if grossi.len() == 1 { "un file è" } else { "alcuni file sono" },
                if grossi.len() == 1 { "e" } else { "i" },
                LIMITE_FILE_MB,
                grossi
                    .iter()
                    .map(|(n, b)| format!("{n} ({} MB)", b / (1024 * 1024)))
                    .collect::<Vec<_>>()
                    .join(", "),
                if grossi.len() == 1 { "o" } else { "i" },
                if grossi.len() == 1 { "o" } else { "i" },
            );
        }

        let out = Command::new("git")
            .args(["-C", &dir, "commit", "-m", message])
            .output()
            .map_err(|e| anyhow::anyhow!("git commit: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            info!(dir = %self.project_dir.display(), "git commit: {stdout}");
            if avviso.is_some() {
                warn!(dir = %self.project_dir.display(), "secrets.yaml era tracciato in git: tolto dall'indice con questo commit");
            }
            Ok(std::iter::once(stdout)
                .chain(avviso)
                .chain(avviso_dati)
                .collect::<Vec<_>>()
                .join("\n\n"))
        } else {
            Err(anyhow::anyhow!("git commit failed: {stderr}"))
        }
    }

    /// `git push` — push to the default remote/branch from git config.
    pub fn push(&self) -> anyhow::Result<String> {
        // Prima di caricare centinaia di MB per sentirsi dire di no: GitHub
        // rifiuta ogni file sopra i 100 MB, in **qualunque** commit spinto.
        let enormi = blob_enormi_da_pubblicare(&self.project_dir.to_string_lossy());
        if !enormi.is_empty() {
            anyhow::bail!(
                "push fermato: i commit da pubblicare contengono file oltre i {LIMITE_PUSH_MB} MB, che \
                 GitHub rifiuta: {}. Toglierli con un commit nuovo non basta, restano nella storia. \
                 Se il repository non è mai stato pubblicato, la via pulita è ricrearlo: cancella la \
                 cartella .git del progetto e riaggancialo (il .gitignore dell'IDE ora li esclude).",
                enormi
                    .iter()
                    .map(|(n, b)| format!("{n} ({} MB)", b / (1024 * 1024)))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        // Il primo push di un ramo non ha upstream, e `git push` nudo si ferma
        // a «has no upstream branch» (26-09-2026, primo push di CasaDomotica):
        // dall'IDE non c'era modo di dargli `--set-upstream`. Allora lo si fa
        // qui, verso `origin`, con il nome del ramo corrente.
        let dir = self.project_dir.to_string_lossy().to_string();
        let senza_upstream = git_out(&dir, &["rev-parse", "--verify", "-q", "@{upstream}"]).is_err();
        let mut args = vec!["-C", dir.as_str(), "push"];
        if senza_upstream {
            args.extend(["--set-upstream", "origin", "HEAD"]);
        }
        let out = Command::new("git")
            .args(&args)
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
    pub fn init_remote(&self, remote_url: Option<&str>, ssh_key: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        // La chiave si valida prima di `git init`: un nome sbagliato non deve
        // lasciare dietro di sé un repository mezzo agganciato.
        let comando_ssh = ssh_key.map(comando_ssh_per).transpose()?;
        if let (Some(_), Some(url)) = (ssh_key, remote_url) {
            controlla_url_per_ssh(url)?;
        }
        // `main`, il nome che GitHub dà ai repository nuovi: senza, il ramo
        // prende `init.defaultBranch` della macchina, spesso ancora `master`.
        // Su un repository che esiste già `-b` non rinomina niente.
        run_git(&dir, &["init", "-b", "main"])?;
        if let Some(cmd) = comando_ssh {
            run_git(&dir, &["config", "core.sshCommand", &cmd])?;
        }
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

    /// Sceglie la chiave SSH con cui questo repository parla col remote,
    /// scrivendo `core.sshCommand` nel **suo** `.git/config`: vale per pull,
    /// push e tag, dall'IDE come da riga di comando, e non tocca né
    /// `~/.ssh/config` né gli altri repository. `None` torna alla chiave che
    /// ssh sceglierebbe da solo.
    ///
    /// Perché serve: un repository GitHub raggiunto con una deploy key vuole
    /// **quella** chiave, e ssh senza istruzioni prova le sue predefinite e si
    /// ferma a «Permission denied (publickey)». Prima di questo l'unico
    /// rimedio era `GIT_SSH_COMMAND` in un terminale, fuori dall'IDE.
    pub fn imposta_chiave_ssh(&self, ssh_key: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        match ssh_key {
            Some(nome) => {
                let cmd = comando_ssh_per(nome)?;
                if let Ok(url) = git_out(&dir, &["remote", "get-url", "origin"]) {
                    controlla_url_per_ssh(&url)?;
                }
                run_git(&dir, &["config", "core.sshCommand", &cmd])
            }
            None => {
                // `--unset` esce con 5 se la chiave non c'era: già a posto.
                let _ = Command::new("git")
                    .args(["-C", &dir, "config", "--unset", "core.sshCommand"])
                    .output();
                Ok(())
            }
        }
    }

    /// Chi firma i commit di **questo** repository: `user.name`/`user.email`
    /// nel suo `.git/config`. Vuoto = si torna a quelli globali di git. Serve
    /// perché la stessa macchina firma progetti diversi — il 26-09-2026 il
    /// primo commit di un progetto di casa è uscito con l'identità di lavoro.
    pub fn imposta_identita(&self, name: Option<&str>, email: Option<&str>) -> anyhow::Result<()> {
        let dir = self.project_dir.to_string_lossy().to_string();
        for (chiave, valore) in [("user.name", name), ("user.email", email)] {
            match valore.map(str::trim).filter(|v| !v.is_empty()) {
                Some(v) => {
                    if !identita_sicura(v) || (chiave == "user.email" && !v.contains('@')) {
                        anyhow::bail!("valore non valido per {chiave}: «{v}»");
                    }
                    run_git(&dir, &["config", "--local", chiave, v])?;
                }
                None => {
                    // Esce con 5 se non c'era: già a posto.
                    let _ = Command::new("git")
                        .args(["-C", &dir, "config", "--local", "--unset", chiave])
                        .output();
                }
            }
        }
        Ok(())
    }

    /// La chiave impostata: il nome del file se il comando è quello scritto
    /// da [`Self::imposta_chiave_ssh`], altrimenti il comando così com'è.
    pub fn chiave_ssh(&self) -> Option<String> {
        let dir = self.project_dir.to_string_lossy().to_string();
        let cmd = git_out(&dir, &["config", "--get", "core.sshCommand"]).ok()?;
        if cmd.is_empty() {
            return None;
        }
        Some(
            cmd.strip_prefix("ssh -i '")
                .and_then(|r| r.strip_suffix(SUFFISSO_SSH))
                .and_then(|p| std::path::Path::new(p).file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or(cmd),
        )
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

/// Oltre questa misura un file non entra in un commit: è la soglia a cui
/// GitHub comincia ad avvisare, e un progetto SWS vero sta sotto il MB.
const LIMITE_FILE_MB: u64 = 50;
/// Oltre questa GitHub rifiuta il push.
const LIMITE_PUSH_MB: u64 = 100;

/// I percorsi tracciati che sono dati del runtime e non progetto — gli stessi
/// che [`RIGHE_GITIGNORE_DATI`] esclude.
fn e_file_di_dati(percorso: &str) -> bool {
    percorso.starts_with("backups/")
        || [".db", ".db-wal", ".db-shm", ".db-journal"]
            .iter()
            .any(|e| percorso.ends_with(e))
}

/// Lista `-z` di git → percorsi. `-z` e non righe: senza, git mette fra
/// virgolette i nomi con caratteri non ASCII e il confronto non torna.
fn percorsi_z(dir: &str, args: &[&str]) -> Vec<String> {
    let Ok(out) = Command::new("git").arg("-C").arg(dir).args(args).output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

fn file_di_dati_tracciati(dir: &str) -> Vec<String> {
    percorsi_z(dir, &["ls-files", "-z"])
        .into_iter()
        .filter(|p| e_file_di_dati(p))
        .collect()
}

/// I file in staging più grandi di [`LIMITE_FILE_MB`], con la loro misura. Si
/// misura il file sul disco: subito dopo `git add -A` è quello che è in staging.
fn file_in_staging_troppo_grandi(dir: &str, base: &std::path::Path) -> Vec<(String, u64)> {
    percorsi_z(dir, &["diff", "--cached", "--name-only", "--diff-filter=AM", "-z"])
        .into_iter()
        .filter_map(|p| {
            let b = std::fs::metadata(base.join(&p)).ok()?.len();
            (b > LIMITE_FILE_MB * 1024 * 1024).then_some((p, b))
        })
        .collect()
}

/// I blob oltre [`LIMITE_PUSH_MB`] nei commit che il push manderebbe: quelli
/// non ancora sull'upstream, o tutta la storia se l'upstream non c'è ancora.
fn blob_enormi_da_pubblicare(dir: &str) -> Vec<(String, u64)> {
    use std::io::Write;
    let range = if git_out(dir, &["rev-parse", "--verify", "-q", "@{upstream}"]).is_ok() {
        "@{upstream}..HEAD"
    } else {
        "HEAD"
    };
    let Ok(oggetti) = git_out(dir, &["rev-list", "--objects", range]) else {
        return Vec::new();
    };
    // `sha percorso` per ogni blob e albero; i commit non hanno percorso.
    let voci: Vec<(&str, &str)> = oggetti
        .lines()
        .filter_map(|r| r.split_once(' '))
        .collect();
    let Ok(mut figlio) = Command::new("git")
        .args(["-C", dir, "cat-file", "--batch-check=%(objecttype) %(objectsize)"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
    else {
        return Vec::new();
    };
    if let Some(mut stdin) = figlio.stdin.take() {
        let elenco: String = voci.iter().map(|(sha, _)| format!("{sha}\n")).collect();
        let _ = stdin.write_all(elenco.as_bytes());
    }
    let Ok(out) = figlio.wait_with_output() else {
        return Vec::new();
    };
    let mut enormi: Vec<(String, u64)> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .zip(voci.iter())
        .filter_map(|(r, (_, percorso))| {
            let (tipo, misura) = r.split_once(' ')?;
            let b: u64 = misura.parse().ok()?;
            (tipo == "blob" && b > LIMITE_PUSH_MB * 1024 * 1024).then(|| (percorso.to_string(), b))
        })
        .collect();
    enormi.sort();
    enormi.dedup();
    enormi
}

/// Un nome o un'email da scrivere in `git config`: niente caratteri di
/// controllo, niente trattino iniziale (git lo leggerebbe come opzione).
fn identita_sicura(v: &str) -> bool {
    !v.is_empty() && v.len() <= 200 && !v.starts_with('-') && !v.chars().any(|c| c.is_control())
}

/// Coda del comando scritto in `core.sshCommand`. `IdentitiesOnly` impedisce a
/// ssh di provare prima le chiavi dell'agente o quelle predefinite: con GitHub
/// la prima chiave accettata decide l'account, e potrebbe non essere questa.
const SUFFISSO_SSH: &str = "' -o IdentitiesOnly=yes";

/// Una chiave SSH con un URL `http(s)://` non serve a niente: git parla HTTPS,
/// ignora `core.sshCommand` e chiede utente e password — che dall'IDE nessuno
/// può digitare. Successo il 26-09-2026 al primo aggancio vero: chiave giusta,
/// URL copiato dal browser. Si ferma qui, suggerendo la forma SSH.
fn controlla_url_per_ssh(url: &str) -> anyhow::Result<()> {
    let Some(resto) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    else {
        return Ok(());
    };
    let (host, percorso) = resto.split_once('/').unwrap_or((resto, ""));
    let percorso = percorso.trim_end_matches('/');
    let suggerito = if percorso.is_empty() {
        format!("git@{host}:<utente>/<repository>.git")
    } else if percorso.ends_with(".git") {
        format!("git@{host}:{percorso}")
    } else {
        format!("git@{host}:{percorso}.git")
    };
    anyhow::bail!(
        "hai scelto una chiave SSH ma l'URL è HTTPS, e con HTTPS git non usa la chiave. \
         Usa l'URL SSH: {suggerito}"
    )
}

/// `~/.ssh` dell'utente che fa girare il runtime — le chiavi stanno sulla
/// macchina che esegue git, non su quella del browser.
fn cartella_ssh() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".ssh"))
}

/// Un nome di file che si può mettere in un comando di shell senza sorprese:
/// `core.sshCommand` lo esegue la shell, quindi niente apici, spazi o `/`.
fn nome_chiave_sicuro(nome: &str) -> bool {
    !nome.is_empty()
        && !nome.starts_with('.')
        && nome
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Le chiavi private in `~/.ssh`: ogni file che ha accanto il suo `.pub`
/// (così `known_hosts`, `config` e `authorized_keys` restano fuori senza un
/// elenco di esclusioni). Solo i nomi, in ordine alfabetico.
pub fn chiavi_ssh_disponibili() -> Vec<String> {
    let Some(dir) = cartella_ssh() else {
        return Vec::new();
    };
    let Ok(voci) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut nomi: Vec<String> = voci
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| nome_chiave_sicuro(n) && !n.ends_with(".pub"))
        .filter(|n| dir.join(n).is_file() && dir.join(format!("{n}.pub")).is_file())
        .collect();
    nomi.sort();
    nomi
}

/// Il valore di `core.sshCommand` per la chiave `nome`, che deve essere una
/// di [`chiavi_ssh_disponibili`]: il browser sceglie da un elenco, non scrive
/// un percorso, quindi niente file arbitrari passati a `ssh -i`.
fn comando_ssh_per(nome: &str) -> anyhow::Result<String> {
    if !nome_chiave_sicuro(nome) || !chiavi_ssh_disponibili().iter().any(|n| n == nome) {
        anyhow::bail!("chiave SSH non trovata in ~/.ssh: «{nome}»");
    }
    let percorso = cartella_ssh()
        .map(|d| d.join(nome).to_string_lossy().to_string())
        .unwrap_or_default();
    if percorso.contains('\'') {
        anyhow::bail!("percorso della chiave SSH non utilizzabile: {percorso}");
    }
    Ok(format!("ssh -i '{percorso}{SUFFISSO_SSH}"))
}

/// La riga che tiene `secrets.yaml` fuori dal tracciamento git.
const RIGA_GITIGNORE: &str = "secrets.yaml";

/// Le righe che tengono fuori da git quello che il runtime **produce** nella
/// cartella del progetto, e che non è progetto: lo storico SQLite (ovunque il
/// datastore lo metta, per questo `*.db` e non `history/`) e i backup, che ne
/// portano una copia ciascuno. Il 26-09-2026, al primo aggancio vero,
/// CasaDomotica era 100 KB di progetto e 3,8 GB di questi: `git add -A` li
/// prendeva tutti, e GitHub rifiuta ogni file sopra i 100 MB.
const RIGHE_GITIGNORE_DATI: &[&str] = &[
    "backups/",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    "*.db-journal",
];

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
    let mancanti: Vec<&str> = std::iter::once(RIGA_GITIGNORE)
        .chain(RIGHE_GITIGNORE_DATI.iter().copied())
        .filter(|riga| !testo.lines().any(|r| r.trim() == *riga))
        .collect();
    if mancanti.is_empty() {
        return Ok(());
    }
    let separatore = if testo.is_empty() || testo.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let nuovo = format!("{testo}{separatore}{}\n", mancanti.join("\n"));
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
        gd.init_remote(None, None).unwrap();
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
        gd.init_remote(None, None).unwrap();
        let gi = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(
            gi,
            "*.log\nsecrets.yaml\nbackups/\n*.db\n*.db-wal\n*.db-shm\n*.db-journal\n"
        );
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

    // ── Chiave SSH per repository ───────────────────────────────────────────

    /// `core.sshCommand` va in pasto alla shell: il nome della chiave non deve
    /// poter chiudere l'apice né diventare un percorso.
    #[test]
    fn nome_chiave_sicuro_rifiuta_quello_che_la_shell_leggerebbe() {
        assert!(nome_chiave_sicuro("id_ed25519_sws_domotica"));
        assert!(nome_chiave_sicuro("id-rsa.work"));
        for cattivo in ["", ".ssh", "../id_rsa", "a b", "x'; rm -rf ~; '", "a/b", "k$(id)"] {
            assert!(!nome_chiave_sicuro(cattivo), "{cattivo}");
        }
    }

    /// Una chiave che non sta in `~/.ssh` non si imposta, e prima di `git
    /// init`: niente repository mezzo agganciato dietro un errore.
    #[test]
    fn init_remote_con_chiave_inesistente_non_crea_il_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        assert!(gd.init_remote(None, Some("chiave_che_non_esiste_xyz")).is_err());
        assert!(!tmp.path().join(".git").exists());
    }

    /// Un `core.sshCommand` scritto a mano si mostra com'è; togliere la
    /// chiave lo cancella; senza, `chiave_ssh` è `None`.
    #[test]
    fn chiave_ssh_legge_e_toglie_core_sshcommand() {
        let tmp = repo_di_prova();
        let dir = tmp.path().to_string_lossy().to_string();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        assert_eq!(gd.chiave_ssh(), None);

        run_git(&dir, &["config", "core.sshCommand", "ssh -i '/k/id_x' -o IdentitiesOnly=yes"]).unwrap();
        assert_eq!(gd.chiave_ssh().as_deref(), Some("id_x"));

        run_git(&dir, &["config", "core.sshCommand", "ssh -p 2222"]).unwrap();
        assert_eq!(gd.chiave_ssh().as_deref(), Some("ssh -p 2222"));

        gd.imposta_chiave_ssh(None).unwrap();
        assert_eq!(gd.chiave_ssh(), None);
        gd.imposta_chiave_ssh(None).unwrap(); // già tolta: nessun errore
    }

    /// Chiave + URL HTTPS: rifiutato, con la forma SSH già pronta.
    #[test]
    fn url_https_con_chiave_suggerisce_la_forma_ssh() {
        let e = controlla_url_per_ssh("https://github.com/soligolab/sws_domotica").unwrap_err();
        assert!(e.to_string().contains("git@github.com:soligolab/sws_domotica.git"), "{e}");
        let e = controlla_url_per_ssh("https://github.com/a/b.git").unwrap_err();
        assert!(e.to_string().contains("git@github.com:a/b.git"), "{e}");
        assert!(controlla_url_per_ssh("git@github.com:a/b.git").is_ok());
        assert!(controlla_url_per_ssh("ssh://git@host/a/b.git").is_ok());
    }

    /// Un repository appena creato, senza commit: lo stato risponde, non
    /// fallisce, e dice il ramo.
    #[test]
    fn status_di_un_repo_senza_commit() {
        let tmp = repo_di_prova();
        let st = GitDeploy::new(tmp.path().to_path_buf()).status().unwrap();
        assert!(st.sha.is_empty());
        assert!(!st.branch.is_empty() && st.branch != "unknown", "{}", st.branch);
    }

    /// Lo storico e i backup non entrano nel commit; il progetto sì.
    #[test]
    fn commit_lascia_fuori_storico_e_backup() {
        let tmp = repo_di_prova();
        let p = tmp.path();
        std::fs::write(p.join("project.yaml"), "meta: {name: p}\n").unwrap();
        std::fs::create_dir_all(p.join("history")).unwrap();
        std::fs::write(p.join("history/historian.db"), "x").unwrap();
        std::fs::write(p.join("history/historian.db-wal"), "x").unwrap();
        std::fs::create_dir_all(p.join("backups/2026-09-26T06-34-51Z")).unwrap();
        std::fs::write(p.join("backups/2026-09-26T06-34-51Z/project.yaml"), "x").unwrap();

        GitDeploy::new(p.to_path_buf()).commit("primo").unwrap();
        let dir = p.to_string_lossy().to_string();
        let tracciati = git_out(&dir, &["ls-files"]).unwrap();
        assert_eq!(tracciati, ".gitignore\nproject.yaml", "{tracciati}");
    }

    /// Un repository nato prima del `.gitignore` completo: il commit successivo
    /// toglie storico e backup dall'indice, e lo dice.
    #[test]
    fn commit_smette_di_tracciare_i_dati_gia_committati() {
        let tmp = repo_di_prova();
        let p = tmp.path();
        let dir = p.to_string_lossy().to_string();
        std::fs::write(p.join("project.yaml"), "meta: {name: p}\n").unwrap();
        std::fs::create_dir_all(p.join("history")).unwrap();
        std::fs::write(p.join("history/historian.db"), "x").unwrap();
        run_git(&dir, &["add", "-A"]).unwrap();
        run_git(&dir, &["commit", "-q", "-m", "vecchio"]).unwrap();

        let msg = GitDeploy::new(p.to_path_buf()).commit("secondo").unwrap();
        assert!(msg.contains("file di dati"), "{msg}");
        let tracciati = git_out(&dir, &["ls-files"]).unwrap();
        assert!(!tracciati.contains("historian.db"), "{tracciati}");
        assert!(p.join("history/historian.db").exists(), "il file resta sul disco");
    }

    /// Un file oltre il limite, che nessuna riga del `.gitignore` conosce: il
    /// commit non si fa e il file esce dallo staging.
    #[test]
    fn commit_si_ferma_su_un_file_troppo_grande() {
        let tmp = repo_di_prova();
        let p = tmp.path();
        let dir = p.to_string_lossy().to_string();
        std::fs::write(p.join("project.yaml"), "meta: {name: p}\n").unwrap();
        let f = std::fs::File::create(p.join("export.bin")).unwrap();
        f.set_len((LIMITE_FILE_MB + 1) * 1024 * 1024).unwrap(); // sparso: niente scrittura vera

        let e = GitDeploy::new(p.to_path_buf()).commit("primo").unwrap_err();
        assert!(e.to_string().contains("export.bin"), "{e}");
        assert!(git_out(&dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_err(), "nessun commit");
        let staging = git_out(&dir, &["diff", "--cached", "--name-only"]).unwrap();
        assert!(!staging.contains("export.bin"), "{staging}");
    }

    #[test]
    fn e_file_di_dati_riconosce_storico_e_backup() {
        assert!(e_file_di_dati("history/historian.db"));
        assert!(e_file_di_dati(".history/historian.db-wal"));
        assert!(e_file_di_dati("backups/2026-09-26T06-34-51Z/project.yaml"));
        assert!(!e_file_di_dati("project.yaml"));
        assert!(!e_file_di_dati("synoptics/db.yaml"));
    }

    /// L'identità del repository: si imposta, si legge nello stato, si toglie
    /// tornando a quella globale; i valori che git leggerebbe come opzioni no.
    #[test]
    fn identita_per_repository() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        run_git(&dir, &["init", "-q"]).unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());

        gd.imposta_identita(Some("Mauro Soligo"), Some("mauro@example.org")).unwrap();
        assert_eq!(git_out(&dir, &["config", "--local", "user.name"]).unwrap(), "Mauro Soligo");
        let st = gd.status().unwrap();
        assert_eq!(st.author_email.as_deref(), Some("mauro@example.org"));
        assert!(st.identita_locale);

        gd.imposta_identita(None, None).unwrap();
        assert!(git_out(&dir, &["config", "--local", "user.name"]).is_err());
        assert!(!gd.status().unwrap().identita_locale);

        assert!(gd.imposta_identita(Some("--global"), None).is_err());
        assert!(gd.imposta_identita(None, Some("senza-chiocciola")).is_err());
    }

    /// Un commit che porta un file oltre i 100 MB (fatto fuori dall'IDE, o da
    /// una versione di prima delle guardie): il push si ferma e lo nomina.
    #[test]
    fn blob_enormi_da_pubblicare_li_trova() {
        let tmp = repo_di_prova();
        let p = tmp.path();
        let dir = p.to_string_lossy().to_string();
        std::fs::write(p.join("project.yaml"), "meta: {name: p}\n").unwrap();
        run_git(&dir, &["add", "-A"]).unwrap();
        run_git(&dir, &["commit", "-q", "-m", "piccolo"]).unwrap();
        assert!(blob_enormi_da_pubblicare(&dir).is_empty());

        let f = std::fs::File::create(p.join("storico.db")).unwrap();
        f.set_len((LIMITE_PUSH_MB + 1) * 1024 * 1024).unwrap();
        run_git(&dir, &["add", "-f", "storico.db"]).unwrap();
        run_git(&dir, &["commit", "-q", "-m", "enorme"]).unwrap();
        let e = blob_enormi_da_pubblicare(&dir);
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!(e[0].0, "storico.db");
    }

    /// Un repository nuovo nasce su `main`.
    #[test]
    fn init_remote_nasce_su_main() {
        let tmp = tempfile::tempdir().unwrap();
        let gd = GitDeploy::new(tmp.path().to_path_buf());
        gd.init_remote(None, None).unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        assert_eq!(git_out(&dir, &["symbolic-ref", "--short", "HEAD"]).unwrap(), "main");
    }

    /// Primo push di un ramo senza upstream: va, e da lì l'upstream c'è.
    /// Il remote è un repository nudo locale, niente rete.
    #[test]
    fn push_imposta_l_upstream_al_primo_invio() {
        let remoto = tempfile::tempdir().unwrap();
        let r = remoto.path().to_string_lossy().to_string();
        run_git(&r, &["init", "-q", "--bare"]).unwrap();

        let tmp = repo_di_prova();
        let p = tmp.path();
        let dir = p.to_string_lossy().to_string();
        run_git(&dir, &["remote", "add", "origin", &r]).unwrap();
        std::fs::write(p.join("project.yaml"), "meta: {name: p}\n").unwrap();
        let gd = GitDeploy::new(p.to_path_buf());
        gd.commit("primo").unwrap();
        gd.push().unwrap();
        assert!(git_out(&dir, &["rev-parse", "--verify", "-q", "@{upstream}"]).is_ok());
        assert_eq!(gd.unpushed_count(), 0);
        gd.push().unwrap(); // il secondo usa l'upstream già impostato
    }
}
