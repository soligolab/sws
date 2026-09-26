import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { TRANS_COMP } from "@/config/comuni";

/** Il versionamento git del **progetto**, foglia «Git» del ramo Progetto
 *  (26-09-2026: prima stava in fondo a Istanza → Device → Stato, fra CPU e
 *  disco, e chi lo cercava non lo trovava). */
export function GitTab() {
  const { t } = useTranslation();
  const [gitStatus, setGitStatus] = useState<import("@/types").GitStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opMsg, setOpMsg] = useState<string | null>(null);
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  // Progetto non ancora agganciato a un repository: prima non c'era alcun
  // percorso per iniziare da qui (il pannello restava vuoto). `checkedRepo`
  // distingue "non ancora controllato" da "controllato, non è un repo" così
  // non si mostra il form di aggancio per uno sfarfallio durante il primo
  // caricamento.
  const [checkedRepo, setCheckedRepo] = useState(false);
  const [attachUrl, setAttachUrl] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  // Chiave SSH: con una deploy key GitHub vuole *quella* chiave, e ssh da solo
  // prova le sue predefinite. Si sceglie da un elenco (le chiavi in ~/.ssh
  // della macchina del runtime), mai scrivendo un percorso.
  const [sshKeys, setSshKeys] = useState<string[]>([]);
  const [attachKey, setAttachKey] = useState("");
  useEffect(() => { api.listGitSshKeys().then(setSshKeys).catch(() => setSshKeys([])); }, []);

  // Tag — elenco/crea/push/elimina, assente prima d'ora sia lato backend sia UI.
  const [tags, setTags] = useState<string[] | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMsg, setNewTagMsg] = useState("");

  const fetchGitStatus = async () => {
    try {
      const gs = await api.getGitStatus();
      setGitStatus(gs);
      setGitError(null);
    } catch (e: any) {
      if (e?.status === 404 || String(e?.message).includes("404")) {
        setGitStatus(null);
        setGitError(null);
      } else {
        setGitError(String(e?.message ?? e));
      }
    } finally {
      setCheckedRepo(true);
    }
  };

  useEffect(() => { void fetchGitStatus(); }, []);

  const fetchTags = async () => {
    try {
      setTags(await api.listGitTags());
      setTagErr(null);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    if (gitStatus) void fetchTags(); else setTags(null);
  }, [gitStatus]);

  const runOp = async (op: () => Promise<{ message: string }>, label: string) => {
    setBusy(true);
    setOpMsg(null);
    try {
      const r = await op();
      setOpMsg(`${label}: ${r.message || "ok"}`);
      await fetchGitStatus();
    } catch (e: any) {
      setOpMsg(t("cfgUi.errorLabel", { label, message: String(e?.message ?? e) }));
    } finally {
      setBusy(false);
    }
  };

  const attachRepo = async () => {
    setAttaching(true);
    setAttachErr(null);
    try {
      await api.initProjectGit(attachUrl.trim() || undefined, attachKey || undefined);
      setAttachUrl("");
      setAttachKey("");
      await fetchGitStatus();
    } catch (e: any) {
      setAttachErr(String(e?.message ?? e));
    } finally {
      setAttaching(false);
    }
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.createGitTag(name, newTagMsg.trim() || undefined);
      setShowTagForm(false);
      setNewTagName("");
      setNewTagMsg("");
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const pushTag = async (name: string) => {
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.pushGitTag(name);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const deleteTag = async (name: string) => {
    if (!window.confirm(t("cfg.deleteTagConfirm", { name }))) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.deleteGitTag(name);
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  // L'URL si cambia anche dopo l'aggancio: prima no, e un URL sbagliato (un
  // https copiato dal browser al posto del git@…) voleva dire rifare da zero.
  const [remoteDraft, setRemoteDraft] = useState("");
  useEffect(() => { setRemoteDraft(gitStatus?.remote_url ?? ""); }, [gitStatus?.remote_url]);
  const cambiaRemote = () =>
    runOp(async () => {
      const chiave = gitStatus?.ssh_key && sshKeys.includes(gitStatus.ssh_key) ? gitStatus.ssh_key : undefined;
      await api.initProjectGit(remoteDraft.trim(), chiave);
      return { message: remoteDraft.trim() };
    }, "Remote");

  // Chi firma i commit di questo progetto (26-09-2026: il primo commit di un
  // progetto di casa era uscito con l'identità globale, quella di lavoro).
  const [nomeAutore, setNomeAutore] = useState("");
  const [emailAutore, setEmailAutore] = useState("");
  useEffect(() => {
    setNomeAutore(gitStatus?.identita_locale ? gitStatus.author_name ?? "" : "");
    setEmailAutore(gitStatus?.identita_locale ? gitStatus.author_email ?? "" : "");
  }, [gitStatus?.identita_locale, gitStatus?.author_name, gitStatus?.author_email]);
  const salvaAutore = () =>
    runOp(async () => {
      await api.setGitIdentity(nomeAutore, emailAutore);
      return { message: nomeAutore.trim() || emailAutore.trim() ? `${nomeAutore.trim()} <${emailAutore.trim()}>` : t("cfgUi.gitIdentityGlobal") };
    }, t("cfgUi.gitIdentity"));

  const cambiaChiave = (k: string) =>
    runOp(async () => { await api.setGitSshKey(k || null); return { message: k || t("cfgUi.sshKeyDefault") }; }, t("cfgUi.sshKey"));

  /** Il menu della chiave. `attuale` fuori elenco (un `core.sshCommand` scritto
   *  a mano) resta visibile come voce a sé, così il menu non mente. */
  const selettoreChiave = (attuale: string, onChange: (k: string) => void, disabled: boolean) => (
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }} title={t("cfgUi.sshKeyHint")}>
      {t("cfgUi.sshKey")}:
      <select
        value={attuale}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 6px", fontSize: 12 }}
      >
        <option value="">{t("cfgUi.sshKeyDefault")}</option>
        {attuale && !sshKeys.includes(attuale) && <option value={attuale}>{attuale}</option>}
        {sshKeys.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  );

  const header = (
    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 6 }}>
      {t("cfgUi.projectVersioning")}
    </div>
  );
  const intro = (
    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 10, lineHeight: 1.5 }}>
      <Trans i18nKey="cfgUi.versioningIntro" components={TRANS_COMP} />
    </div>
  );

  if (gitError) {
    return (
      <div>{header}{intro}<div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>Git: {gitError}</div></div>
    );
  }

  if (!gitStatus) {
    if (!checkedRepo) return null; // primo caricamento, non ancora sappiamo
    return (
      <div>
        {header}
        {intro}
        <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
            {t("cfgUi.thisProjectIsNotYet")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
              placeholder={t("cfgUi.repositoryUrlOptionalEmptyFor")}
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={attaching}
              onClick={attachRepo}
              style={{ padding: "5px 12px", background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4, color: "var(--brand-on-primary, #fff)", fontSize: 12, cursor: attaching ? "wait" : "pointer" }}
            >
              Aggancia a un repository
            </button>
          </div>
          {selettoreChiave(attachKey, setAttachKey, attaching)}
          {attachErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{attachErr}</div>}
        </div>
      </div>
    );
  }

  const dateStr = gitStatus.commit_date
    ? new Date(gitStatus.commit_date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "—";

  return (
    <div>
      {header}
      {intro}
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>Branch:</span>
          <span style={{ color: "#93c5fd", fontWeight: 700 }}>{gitStatus.branch}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>SHA:</span>
          <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace" }}>{gitStatus.sha}</span>
          <span style={{ color: gitStatus.clean ? "#34d399" : "#fb923c" }}>
            {gitStatus.clean ? "✓ clean" : t("cfgUi.modified")}
          </span>
        </div>
        {gitStatus.sha ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
            <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{dateStr} — </span>
            {gitStatus.author}: {gitStatus.message}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#fb923c" }}>{t("cfgUi.gitNoCommits")}</div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={remoteDraft}
            onChange={(e) => setRemoteDraft(e.target.value)}
            placeholder={t("cfgUi.repositoryUrlOptionalEmptyFor")}
            style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "monospace" }}
          />
          <button
            disabled={busy || !remoteDraft.trim() || remoteDraft.trim() === (gitStatus.remote_url ?? "")}
            onClick={cambiaRemote}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 11, cursor: busy ? "wait" : "pointer" }}
          >
            {t("cfgUi.gitSetRemote")}
          </button>
        </div>
        {selettoreChiave(gitStatus.ssh_key ?? "", cambiaChiave, busy)}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
          <span title={t("cfgUi.gitIdentityHint")}>{t("cfgUi.gitIdentity")}:</span>
          <input
            value={nomeAutore}
            onChange={(e) => setNomeAutore(e.target.value)}
            placeholder={gitStatus.identita_locale ? t("cfgUi.gitIdentityName") : (gitStatus.author_name ?? t("cfgUi.gitIdentityName"))}
            style={{ flex: 1, minWidth: 120, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}
          />
          <input
            value={emailAutore}
            onChange={(e) => setEmailAutore(e.target.value)}
            placeholder={gitStatus.identita_locale ? "email" : (gitStatus.author_email ?? "email")}
            style={{ flex: 1, minWidth: 160, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}
          />
          <button
            disabled={busy}
            onClick={salvaAutore}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 11, cursor: busy ? "wait" : "pointer" }}
          >
            {t("common.save")}
          </button>
          {!gitStatus.identita_locale && (
            <span style={{ width: "100%", fontSize: 11 }}>
              {t("cfgUi.gitIdentityInherited", { who: `${gitStatus.author_name ?? "?"} <${gitStatus.author_email ?? "?"}>` })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <button
            disabled={busy}
            onClick={() => runOp(() => api.triggerDeploy(), "Deploy")}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#1e40af", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↑ Deploy (git pull)
          </button>
          {gitStatus.sha && <button
            disabled={busy}
            onClick={() => { if (confirm(t("cfg.gitResetConfirm"))) runOp(() => api.triggerRollback(), "Rollback"); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-danger, #ef4444)", border: "none", borderRadius: 4, color: "var(--brand-on-danger, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↓ Rollback (HEAD~1)
          </button>}
          <button
            disabled={busy}
            onClick={() => { setShowCommitForm((v) => !v); setOpMsg(null); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            💾 Commit
          </button>
          {gitStatus?.remote_url && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm(t("cfg.gitPushConfirm"))) {
                  runOp(() => api.pushProject(), "Push");
                }
              }}
              style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#7c3aed", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              ↑ Push{gitStatus.unpushed_commits > 0 ? ` (${gitStatus.unpushed_commits})` : ""}
            </button>
          )}
        </div>
        {showCommitForm && (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commitMsg.trim()) {
                  setShowCommitForm(false);
                  runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                  setCommitMsg("");
                }
              }}
              placeholder={t("cfg.commitMessage")}
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
              autoFocus
            />
            <button
              disabled={busy || !commitMsg.trim()}
              onClick={() => {
                setShowCommitForm(false);
                runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                setCommitMsg("");
              }}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowCommitForm(false); setCommitMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {opMsg && (
          <div style={{ fontSize: 11, color: opMsg.startsWith(t("cfgUi.error")) ? "var(--brand-danger-soft, #fca5a5)" : "#34d399", marginTop: 2, whiteSpace: "pre-wrap" }}>
            {opMsg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, flex: 1 }}>TAG</span>
          <button
            disabled={tagBusy}
            onClick={() => setShowTagForm((v) => !v)}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, cursor: tagBusy ? "wait" : "pointer", fontSize: 12 }}
          >
            {t("cfgUi.newTag")}
          </button>
        </div>
        {showTagForm && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="nome (es. v1.2.0)"
              style={{ flex: 1, minWidth: 120, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <input
              value={newTagMsg}
              onChange={(e) => setNewTagMsg(e.target.value)}
              placeholder="messaggio (opzionale)"
              style={{ flex: 2, minWidth: 160, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={tagBusy || !newTagName.trim()}
              onClick={createTag}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowTagForm(false); setNewTagName(""); setNewTagMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {tagErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{tagErr}</div>}
        {tags === null ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.loading2")}</div>
        ) : tags.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>{t("cfgUi.noTags")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tags.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>{name}</code>
                {gitStatus.remote_url && (
                  <button
                    disabled={tagBusy}
                    onClick={() => pushTag(name)}
                    style={{ padding: "3px 10px", background: "#7c3aed", border: "none", borderRadius: 3, color: "#fff", fontSize: 11, cursor: tagBusy ? "wait" : "pointer" }}
                  >↑ Push</button>
                )}
                <button
                  disabled={tagBusy}
                  onClick={() => deleteTag(name)}
                  style={{ padding: "3px 10px", background: "transparent", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 3, cursor: tagBusy ? "wait" : "pointer", fontSize: 11 }}
                >{t("common.delete")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
