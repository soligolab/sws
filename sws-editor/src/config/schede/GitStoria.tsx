// La storia del repository del progetto, nella scheda Git (piano
// `docs/archive/2026-09-26-gestore-repository-progetto.md`, Fase 1): i commit,
// cosa ha cambiato ognuno, e il diff — delle modifiche non ancora committate,
// di un commit contro il precedente, o fra due commit qualsiasi. Solo lettura:
// tornare a un commit vecchio è la Fase 2.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type CommitInfo, type FileCambiato } from "@/api/client";
import { selectIsDirty, useAppStore } from "@/store";

/** Cosa si sta guardando. */
type Scelta =
  | { kind: "wip" }
  | { kind: "commit"; sha: string }
  | { kind: "range"; from: string; to: string };

const PAGINA = 30;

const estremi = (s: Scelta): { from?: string; to?: string } =>
  s.kind === "wip" ? {} : s.kind === "commit" ? { to: s.sha } : { from: s.from, to: s.to };

/** La chiave i18n dello stato di un file: le lettere comuni, «nuovo» per un
 *  file mai aggiunto, «altro» per il resto (T, U, X…). */
const chiaveStato = (s: string) => (s === "?" ? "nuovo" : ["A", "M", "D"].includes(s) ? s : "altro");

const stessa = (a: Scelta | null, b: Scelta) => JSON.stringify(a) === JSON.stringify(b);

const COLORE_STATO: Record<string, string> = {
  A: "#34d399", "?": "#34d399", M: "#fbbf24", D: "var(--brand-danger-soft, #fca5a5)",
};

/** Il diff unificato, riga per riga, colorato come in un terminale. */
export function VistaDiff({ testo }: { testo: string }) {
  const { t } = useTranslation();
  if (!testo.trim()) return <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>{t("gitStoria.diffVuoto")}</div>;
  return (
    <pre style={{
      margin: 0, maxHeight: 460, overflow: "auto", fontSize: 11, lineHeight: 1.45,
      background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "6px 0",
    }}>
      {testo.split("\n").map((riga, i) => {
        const testata = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(riga);
        const colore = testata ? "var(--brand-text-subtle, #64748b)"
          : riga.startsWith("@@") ? "#93c5fd"
          : riga.startsWith("+") ? "#34d399"
          : riga.startsWith("-") ? "var(--brand-danger-soft, #fca5a5)"
          : "var(--brand-text-muted, #94a3b8)";
        const sfondo = testata ? undefined
          : riga.startsWith("+") ? "rgba(52,211,153,0.08)"
          : riga.startsWith("-") ? "rgba(248,113,113,0.08)"
          : undefined;
        return <div key={i} style={{ color: colore, background: sfondo, padding: "0 8px", whiteSpace: "pre" }}>{riga || " "}</div>;
      })}
    </pre>
  );
}

/** `versione` cambia quando cambia il repository (sha o albero pulito/sporco):
 *  la storia si ricarica dopo un Commit, un Deploy, un Rollback. */
export function GitStoria({ versione, pulito, inProva }: { versione: string; pulito: boolean; inProva: boolean }) {
  const { t } = useTranslation();
  const bozze = useAppStore(selectIsDirty);
  const [provaErr, setProvaErr] = useState<string | null>(null);
  // Fork (Fase 3): un progetto nuovo da questo commit.
  const [forkAperto, setForkAperto] = useState(false);
  const [forkNome, setForkNome] = useState("");
  // Credenziali nel fork: una scelta esplicita, ricordata fra un fork e
  // l'altro (26-09-2026, maintainer: «alle volte serve il fork per impianti
  // simili con credenziali uguali»). Nel browser e non nel progetto: è
  // un'abitudine di chi lavora, non un dato dell'impianto.
  const [forkSegreti, setForkSegretiStato] = useState<boolean>(() => {
    try { return localStorage.getItem("sws.git.forkSegreti") === "1"; } catch { return false; }
  });
  const setForkSegreti = (v: boolean) => {
    setForkSegretiStato(v);
    try { localStorage.setItem("sws.git.forkSegreti", v ? "1" : "0"); } catch { /* storage non disponibile */ }
  };
  const [forkEsito, setForkEsito] = useState<{ ok: boolean; testo: string; nome?: string } | null>(null);
  const [forkOccupato, setForkOccupato] = useState(false);

  const creaFork = async (c: CommitInfo) => {
    setForkOccupato(true); setForkEsito(null);
    try {
      const r = await api.gitFork(c.sha, forkNome.trim(), forkSegreti);
      setForkEsito({ ok: true, testo: t("gitFork.creato", { nome: r.name, short: c.short }), nome: r.name });
      setForkAperto(false); setForkNome("");
    } catch (e: any) {
      setForkEsito({ ok: false, testo: String(e?.message ?? e) });
    } finally {
      setForkOccupato(false);
    }
  };

  /** Aprire il fork lascia questo progetto: con bozze non salvate si chiede. */
  const apriFork = async (nome: string) => {
    if (bozze && !window.confirm(t("gitFork.bozzePerse"))) return;
    try {
      await api.openProject(nome);
      window.location.reload();
    } catch (e: any) {
      setForkEsito({ ok: false, testo: String(e?.message ?? e) });
    }
  };

  /** Entrare in prova: con modifiche non salvate nell'editor, o salvate e non
   *  committate, si perderebbero (o si mescolerebbero) — si chiede prima. */
  const prova = async (c: CommitInfo) => {
    setProvaErr(null);
    if (bozze) { setProvaErr(t("gitProva.primaSalva")); return; }
    if (!pulito) { setProvaErr(t("gitProva.primaCommit")); return; }
    if (!window.confirm(t("gitProva.conferma", { short: c.short, message: c.message }))) return;
    try {
      await api.gitProva(c.sha);
      window.location.reload();
    } catch (e: any) {
      setProvaErr(String(e?.message ?? e));
    }
  };
  const [commit, setCommit] = useState<CommitInfo[]>([]);
  const [finiti, setFiniti] = useState(false);
  const [scelta, setScelta] = useState<Scelta | null>(null);
  const [file, setFile] = useState<FileCambiato[] | null>(null);
  const [fileScelto, setFileScelto] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [da, setDa] = useState("");
  const [a, setA] = useState("");

  const carica = async (skip: number) => {
    try {
      const pagina = await api.gitLog(PAGINA, skip);
      setCommit((prima) => (skip === 0 ? pagina : [...prima, ...pagina]));
      setFiniti(pagina.length < PAGINA);
      setErrore(null);
    } catch (e: any) {
      setErrore(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    void carica(0);
    // Il repository è cambiato: quello che si guardava può non esistere più.
    setScelta(null); setFile(null); setFileScelto(null); setDiff(null);
  }, [versione]);

  const scegli = async (s: Scelta) => {
    setScelta(s); setFile(null); setFileScelto(null); setDiff(null); setErrore(null);
    try {
      setFile(await api.gitChanges(estremi(s)));
    } catch (e: any) {
      setErrore(String(e?.message ?? e));
    }
  };

  const apriFile = async (path: string | null) => {
    if (!scelta) return;
    setFileScelto(path); setDiff(null);
    try {
      setDiff((await api.gitDiff({ ...estremi(scelta), path: path ?? undefined })).diff);
    } catch (e: any) {
      setErrore(String(e?.message ?? e));
    }
  };

  const data = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  const riga = (attiva: boolean): React.CSSProperties => ({
    display: "flex", gap: 8, alignItems: "baseline", padding: "4px 6px", borderRadius: 4, cursor: "pointer",
    background: attiva ? "var(--brand-surface-2, #334155)" : "transparent", fontSize: 12,
  });
  const selectStile: React.CSSProperties = {
    flex: 1, minWidth: 0, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 6px", fontSize: 11,
  };
  const etichetta = (c: CommitInfo) => `${c.short} · ${data(c.date)} · ${c.message}`;

  return (
    <div style={{ marginTop: 10, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1 }}>{t("gitStoria.titolo")}</span>
      {errore && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", whiteSpace: "pre-wrap" }}>{errore}</div>}

      <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        {!pulito && (
          <div data-testid="git-storia-wip" style={riga(stessa(scelta, { kind: "wip" }))} onClick={() => void scegli({ kind: "wip" })}>
            <span style={{ color: "#fb923c", fontWeight: 600 }}>● {t("gitStoria.nonCommittate")}</span>
          </div>
        )}
        {commit.map((c) => (
          <div key={c.sha} style={riga(stessa(scelta, { kind: "commit", sha: c.sha }))} onClick={() => void scegli({ kind: "commit", sha: c.sha })} title={`${c.sha}\n${c.author} <${c.email}>`}>
            <code style={{ color: "#93c5fd", flexShrink: 0 }}>{c.short}</code>
            <span style={{ color: "var(--brand-text-subtle, #64748b)", flexShrink: 0 }}>{data(c.date)}</span>
            <span style={{ color: "var(--brand-text, #e2e8f0)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
            <span style={{ color: "var(--brand-text-subtle, #64748b)", flexShrink: 0 }}>{c.author}</span>
            <span style={{ color: "var(--brand-text-subtle, #64748b)", flexShrink: 0, fontSize: 11 }}>{t("gitStoria.nFile", { n: c.files })}</span>
          </div>
        ))}
        {commit.length === 0 && pulito && <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>{t("gitStoria.nessunCommit")}</div>}
        {!finiti && commit.length > 0 && (
          <button type="button" onClick={() => void carica(commit.length)} style={{ alignSelf: "flex-start", marginTop: 4, padding: "3px 10px", background: "transparent", color: "var(--brand-text-subtle, #64748b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
            {t("gitStoria.altri")}
          </button>
        )}
      </div>

      {commit.length > 1 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
          <span>{t("gitStoria.confronta")}</span>
          <select value={da} onChange={(e) => setDa(e.target.value)} style={selectStile} aria-label={t("gitStoria.da")}>
            <option value="">{t("gitStoria.da")}…</option>
            {commit.map((c) => <option key={c.sha} value={c.sha}>{etichetta(c)}</option>)}
          </select>
          <span>→</span>
          <select value={a} onChange={(e) => setA(e.target.value)} style={selectStile} aria-label={t("gitStoria.a")}>
            <option value="">{t("gitStoria.a")}…</option>
            {commit.map((c) => <option key={c.sha} value={c.sha}>{etichetta(c)}</option>)}
          </select>
          <button
            type="button"
            disabled={!da || !a || da === a}
            onClick={() => void scegli({ kind: "range", from: da, to: a })}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >
            {t("gitStoria.vai")}
          </button>
        </div>
      )}

      {scelta?.kind === "commit" && commit.length > 0 && (() => {
        const c = commit.find((x) => x.sha === scelta.sha);
        if (!c) return null;
        const vecchio = c.sha !== commit[0].sha;
        const bottone: React.CSSProperties = { padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" };
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {vecchio && !inProva && <button
              type="button"
              data-testid="git-prova-questa"
              onClick={() => void prova(c)}
              style={{ padding: "4px 10px", background: "#4c1d95", color: "#ede9fe", border: "1px solid #7c3aed", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
              title={t("gitProva.hint")}
            >
              🧪 {t("gitProva.provaQuesta", { short: c.short })}
            </button>}
            <button
              type="button"
              data-testid="git-fork-apri"
              onClick={() => { setForkAperto((v) => !v); setForkEsito(null); }}
              style={{ ...bottone, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)" }}
              title={t("gitFork.hint")}
            >
              ⑂ {t("gitFork.daQui", { short: c.short })}
            </button>
            {provaErr && <span style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{provaErr}</span>}
          </div>
          {forkAperto && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
              <input
                value={forkNome}
                onChange={(e) => setForkNome(e.target.value)}
                placeholder={t("gitFork.nome")}
                autoFocus
                style={{ flex: 1, minWidth: 160, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}
              />
              <span style={{ display: "flex", alignItems: "center", gap: 10 }} title={t("gitFork.segretiHint")} role="radiogroup" aria-label={t("gitFork.credenziali")}>
                <span>{t("gitFork.credenziali")}:</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="radio" name="fork-segreti" checked={!forkSegreti} onChange={() => setForkSegreti(false)} />
                  {t("gitFork.segretiNuove")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="radio" name="fork-segreti" checked={forkSegreti} onChange={() => setForkSegreti(true)} />
                  {t("gitFork.segretiUguali")}
                </label>
              </span>
              <button
                type="button"
                disabled={forkOccupato || !forkNome.trim()}
                onClick={() => void creaFork(c)}
                style={{ ...bottone, background: "var(--brand-success, #22c55e)", color: "var(--brand-on-success, #fff)", border: "none" }}
              >
                {t("gitFork.crea")}
              </button>
            </div>
          )}
          {forkEsito && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: forkEsito.ok ? "#34d399" : "var(--brand-danger-soft, #fca5a5)" }}>
              <span style={{ whiteSpace: "pre-wrap" }}>{forkEsito.testo}</span>
              {forkEsito.ok && forkEsito.nome && (
                <button type="button" onClick={() => void apriFork(forkEsito.nome!)} style={{ ...bottone, background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none" }}>
                  {t("gitFork.apri")}
                </button>
              )}
            </div>
          )}
          </div>
        );
      })()}

      {scelta && file && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {file.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>{t("gitStoria.nessunFile")}</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <button type="button" onClick={() => void apriFile(null)} style={{ ...riga(fileScelto === null && diff !== null), border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)", fontSize: 11 }}>
                {t("gitStoria.tutti", { n: file.length })}
              </button>
              {file.map((f) => (
                <button key={f.path} type="button" onClick={() => void apriFile(f.path)} style={{ ...riga(fileScelto === f.path), border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)", fontSize: 11 }} title={t(`gitStoria.stato.${chiaveStato(f.status)}`)}>
                  <b style={{ color: COLORE_STATO[f.status] ?? "var(--brand-text-subtle, #64748b)" }}>{f.status}</b> {f.path}
                </button>
              ))}
            </div>
          )}
          {diff !== null && <VistaDiff testo={diff} />}
        </div>
      )}
    </div>
  );
}
