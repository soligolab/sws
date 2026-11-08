// L'editor della logica: funzioni e script in un editor solo (08-11-2026,
// piano `docs/plans/2026-11-04-logica-unificata.md`, sessione L1). Prende il
// posto del sinottico, come faceva l'editor delle funzioni: a sinistra nome,
// descrizione e parametri (funzione) o abilitato e trigger (script), a destra
// il codice. Prima gli script avevano un editor loro in una scheda della
// Configurazione, con un'altra forma e un altro Salva.
//
// Si unisce solo l'interfaccia (decisione del 04-11-2026): `functions[]` e
// `global_scripts[]` restano due cose nel modello, perché lo sono — una
// funzione aspetta di essere chiamata con dei parametri, uno script parte da
// solo per un trigger.
//
// «Controlla» compila senza eseguire (`POST /api/script/check`). «Prova»
// esegue davvero una funzione salvata: sul pannello scrive i tag, e lo dice.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { PythonEditor, type PythonEditorHandle } from "@/components/PythonEditor";
import { TagInput } from "@/components/TagInput";
import { CampoNumero } from "@/components/CampoNumero";
import { conferma } from "@/finestraAvviso/finestraAvviso";
import { scriptCambiati, useAppStore } from "@/store";
import type { FunctionDef, GlobalScriptDef, ScriptTriggerKind } from "@/types";

export type VoceLogica = { tipo: "funzione"; fn: FunctionDef } | { tipo: "script"; script: GlobalScriptDef };

type Esito =
  | { tipo: "controllo"; ok: boolean; sandbox: boolean; rilievi: { riga?: number; messaggio: string; vietato: boolean }[] }
  | { tipo: "prova"; ok: boolean; stdout: string; stderr: string; errore?: string };

export function LogicaEditor({ voce, onClose }: { voce: VoceLogica; onClose: () => void }) {
  const { t } = useTranslation();
  const editorRef = useRef<PythonEditorHandle | null>(null);
  const funzione = voce.tipo === "funzione";
  const chiave = funzione ? voce.fn.id : voce.script.id;
  const codice = funzione ? voce.fn.code : voce.script.code;
  const nome = funzione ? voce.fn.name : voce.script.id;

  const updateFunction = useAppStore((s) => s.updateFunction);
  const renameFunction = useAppStore((s) => s.renameFunction);
  const updateScript = useAppStore((s) => s.updateScript);
  const funzioni = useAppStore((s) => s.project?.functions) ?? [];
  const scripts = useAppStore((s) => s.project?.global_scripts) ?? [];

  // Una funzione: il confronto con com'era all'apertura (le funzioni le scrive
  // anche il Salva unico, sempre). Uno script: con com'è su disco.
  const [salvataFn, setSalvataFn] = useState<string>(() => (funzione ? JSON.stringify(voce.fn) : ""));
  const scriptDiversi = useAppStore((s) => scriptCambiati(s));
  const modificato = funzione ? salvataFn !== JSON.stringify(voce.fn) : scriptDiversi;

  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<Esito | null>(null);
  const [nomeBozza, setNomeBozza] = useState(nome);

  useEffect(() => {
    setNomeBozza(nome);
    setErrore(null);
    setEsito(null);
    if (funzione) setSalvataFn(JSON.stringify(voce.fn));
  // Solo quando si apre un'altra voce: il nome cambia anche rinominando questa.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voce.tipo, funzione ? voce.fn.id : null]);
  useEffect(() => { setNomeBozza(nome); }, [nome]);

  const patch = (p: Partial<FunctionDef> & Partial<GlobalScriptDef>) => {
    if (voce.tipo === "funzione") updateFunction(voce.fn.id, p);
    else updateScript(voce.script.id, p);
  };

  const salva = async () => {
    setSalvando(true); setErrore(null);
    try {
      const st = useAppStore.getState();
      if (funzione) {
        await api.updateFunctions(st.project?.functions ?? []);
        setSalvataFn(JSON.stringify(st.project?.functions?.find((f) => f.id === chiave) ?? voce.fn));
      } else {
        const elenco = st.project?.global_scripts ?? [];
        await api.saveGlobalScripts(elenco);
        useAppStore.setState({ savedGlobalScripts: JSON.stringify(elenco) });
      }
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSalvando(false);
    }
  };

  // Il Salva unico (Ctrl+S, l'indicatore in testata) vede la funzione aperta
  // non salvata. Gli script li vede da sé (`scriptCambiati`).
  const registerPendingSection = useAppStore((s) => s.registerPendingSection);
  const salvaRef = useRef(salva);
  salvaRef.current = salva;
  useEffect(() => {
    if (!funzione) return;
    registerPendingSection("function", modificato ? () => salvaRef.current() : null);
    return () => registerPendingSection("function", null);
  }, [funzione, modificato, registerPendingSection]);

  /** Il nome si applica uscendo dal campo: rinominare una funzione riscrive gli
   *  oggetti che la chiamano, e farlo a ogni tasto li porterebbe attraverso
   *  tutti i nomi intermedi. */
  const applicaNome = () => {
    const nuovo = nomeBozza.trim();
    if (!nuovo || nuovo === nome) { setNomeBozza(nome); return; }
    const preso = funzione ? funzioni.some((f) => f.id !== chiave && f.name === nuovo) : scripts.some((g) => g.id === nuovo);
    if (preso) { setErrore(t("logica.nomeGiaUsato", { nome: nuovo })); setNomeBozza(nome); return; }
    setErrore(null);
    if (voce.tipo === "funzione") renameFunction(voce.fn.id, nuovo);
    else updateScript(voce.script.id, { id: nuovo });
  };

  const controlla = async () => {
    setErrore(null);
    try {
      const r = await api.checkScript(codice);
      setEsito({ tipo: "controllo", ok: r.ok, sandbox: r.sandbox_verificata, rilievi: r.rilievi });
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    }
  };

  const prova = async () => {
    if (voce.tipo !== "funzione") return;
    if (!(await conferma({ titolo: t("logica.provaTitolo"), testo: t("logica.provaTesto", { nome }), si: t("logica.prova") }))) return;
    try {
      if (modificato) await salva();
      const r = await api.runFunction(voce.fn.name);
      setEsito({ tipo: "prova", ok: r.ok, stdout: r.stdout, stderr: r.stderr, errore: r.error });
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    }
  };

  const bottone = (attivo: boolean): React.CSSProperties => ({
    background: "var(--brand-surface-2, #334155)", color: attivo ? "var(--brand-text-2, #cbd5e1)" : "var(--brand-text-muted, #94a3b8)",
    border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px",
    cursor: attivo ? "pointer" : "default", fontSize: 13,
  });

  return (
    <div data-testid="editor-logica" style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "var(--brand-surface, #1e293b)", borderBottom: "1px solid var(--brand-surface-2, #334155)", flexShrink: 0 }}>
        <strong style={{ fontSize: 14, letterSpacing: 0.3 }}>{t(funzione ? "functionEditor.title" : "logica.titoloScript")}</strong>
        <code style={{ color: "var(--brand-success, #22c55e)", fontSize: 12 }}>{nome || t("functionEditor.noName")}</code>
        {modificato && <span style={{ color: "var(--brand-warning-soft, #fbbf24)", fontSize: 11, fontWeight: 600 }}>{t("functionEditor.unsaved")}</span>}
        <div style={{ flex: 1 }} />
        {funzione && (
          <select style={SELECT_STYLE} value="" onChange={(e) => {
            const k = e.target.value as keyof typeof SNIPPETS | "";
            if (k) editorRef.current?.insertAtCursor(SNIPPETS[k]);
            e.target.value = "";
          }}>
            <option value="">{t("functionEditor.snippetPlaceholder")}</option>
            <option value="increment">{t("functionEditor.snippetIncrement")}</option>
            <option value="toggle">{t("functionEditor.snippetToggle")}</option>
            <option value="conditional">{t("functionEditor.snippetConditional")}</option>
            <option value="reset_many">{t("functionEditor.snippetResetMany")}</option>
            <option value="diagnostic">{t("functionEditor.snippetDiagnostic")}</option>
            <option value="skeleton">{t("functionEditor.snippetSkeleton")}</option>
          </select>
        )}
        <button type="button" data-testid="logica-controlla" onClick={() => void controlla()} title={t("logica.controllaAiuto")} style={bottone(true)}>
          {t("logica.controlla")}
        </button>
        {funzione && (
          <button type="button" data-testid="logica-prova" onClick={() => void prova()} title={t("logica.provaAiuto")} style={bottone(true)}>
            {t("logica.prova")}
          </button>
        )}
        <button type="button" data-testid="logica-salva" onClick={() => void salva().catch(() => { /* già mostrato */ })} disabled={salvando || !modificato}
          style={{
            background: modificato ? "var(--brand-success-bg, #166534)" : "var(--brand-surface-2, #334155)",
            color: modificato ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)",
            border: `1px solid ${modificato ? "#15803d" : "var(--brand-border, #475569)"}`,
            borderRadius: 4, padding: "5px 14px", cursor: salvando || !modificato ? "default" : "pointer", fontSize: 13, fontWeight: 600,
          }}>
          {salvando ? t("functionEditor.saving") : t(funzione ? "functionEditor.save" : "logica.salvaScript")}
        </button>
        <button type="button" onClick={onClose} title={t("functionEditor.closeTitle")} style={bottone(true)}>
          {t("functionEditor.close")}
        </button>
      </div>

      {errore && (
        <div style={{ padding: "6px 16px", background: "#7f1d1d33", borderBottom: "1px solid var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>
          {errore}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <aside style={{ width: 280, padding: 14, borderRight: "1px solid var(--brand-surface-2, #334155)", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={LABEL_STYLE}>{t("functionEditor.nameLabel")}</label>
            <input type="text" data-testid="logica-nome" style={INPUT_STYLE} value={nomeBozza} spellCheck={false}
              onChange={(e) => setNomeBozza(e.target.value)}
              onBlur={applicaNome}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNomeBozza(nome); }} />
          </div>
          <div>
            <label style={LABEL_STYLE}>{t("functionEditor.descriptionLabel")}</label>
            <input type="text" style={INPUT_STYLE} value={(funzione ? voce.fn.description : voce.script.description) ?? ""}
              onChange={(e) => patch({ description: e.target.value || undefined })} />
          </div>
          {voce.tipo === "funzione"
            ? <Parametri fn={voce.fn} onPatch={patch} />
            : <ScriptAvvio script={voce.script} onPatch={patch} />}
          <p style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "8px 0 0" }}>
            {t("logica.nomiForniti")} <code>tags.read(id)</code>, <code>tags.write(id, value)</code>, <code>print(...)</code>,{" "}
            <code>send_telegram(msg)</code>, <code>now_ms()</code>/<code>uptime_ms()</code>/<code>delta_ms()</code>,{" "}
            <code>state.get(k, default)</code>/<code>state.set(k, v)</code>, <code>functions.run(nome, **kwargs)</code>, <code>tr(key)</code>.
            {funzione && <>{" "}{t("functionEditor.bindingsParams")}<code>on_press_args</code>{t("functionEditor.bindingsOrRest")}<code>POST /api/script/run/:name</code>{t("functionEditor.bindingsOrScript")}<code>functions.run(nome, **kwargs)</code>{t("functionEditor.bindingsHowto")}</>}
          </p>
        </aside>

        <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", minWidth: 0, gap: 8 }}>
          <label style={{ ...LABEL_STYLE, marginBottom: 0 }}>{t("functionEditor.codeLabel")}</label>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PythonEditor ref={editorRef} value={codice} onChange={(next) => patch({ code: next })} />
          </div>
          {esito && <PannelloEsito esito={esito} onRiga={(r) => editorRef.current?.vaiARiga(r)} onChiudi={() => setEsito(null)} />}
        </div>
      </div>
    </div>
  );
}

function Parametri({ fn, onPatch }: { fn: FunctionDef; onPatch: (p: Partial<FunctionDef>) => void }) {
  const { t } = useTranslation();
  const setParam = (idx: number, p: Partial<{ name: string; default: string | number | boolean | undefined }>) =>
    onPatch({ params: fn.params.map((x, i) => (i === idx ? { ...x, ...p } : x)) });
  return (
    <>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--brand-text-subtle, #64748b)", fontWeight: 700, letterSpacing: 0.5 }}>
        {t("functionEditor.paramsHeading")}
      </div>
      {fn.params.length === 0 && <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>{t("functionEditor.noParams")}</p>}
      {fn.params.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 4 }}>
          <input type="text" placeholder={t("functionEditor.paramNamePlaceholder")} style={{ ...INPUT_STYLE, fontSize: 12 }}
            value={p.name} spellCheck={false} onChange={(e) => setParam(i, { name: e.target.value })} />
          <input type="text" placeholder={t("functionEditor.paramDefaultPlaceholder")} style={{ ...INPUT_STYLE, fontSize: 12 }}
            value={p.default === undefined ? "" : String(p.default)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") { setParam(i, { default: undefined }); return; }
              const v: string | number | boolean =
                raw === "true" ? true : raw === "false" ? false : raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
              setParam(i, { default: v });
            }} />
          <button style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
            onClick={() => onPatch({ params: fn.params.filter((_, j) => j !== i) })} title={t("functionEditor.removeParamTitle")}>×</button>
        </div>
      ))}
      <button style={{ ...INPUT_STYLE, cursor: "pointer", color: "var(--brand-text-subtle, #64748b)", borderStyle: "dashed", textAlign: "left" }}
        onClick={() => onPatch({ params: [...fn.params, { name: `arg${fn.params.length + 1}` }] })}>
        {t("functionEditor.addParam")}
      </button>
    </>
  );
}

/** Abilitato e trigger di uno script: erano nella scheda Python della
 *  Configurazione, si sono spostati qui senza cambiare (08-11-2026). */
function ScriptAvvio({ script, onPatch }: { script: GlobalScriptDef; onPatch: (p: Partial<GlobalScriptDef>) => void }) {
  const { t } = useTranslation();
  const trig = script.trigger;
  const aggiorna = (p: Partial<ScriptTriggerKind>) => onPatch({ trigger: { ...trig, ...p } as ScriptTriggerKind });
  return (
    <>
      <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input type="checkbox" data-testid="logica-abilitato" checked={script.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} />
        {t("cfgUi.abilitato")}
      </label>
      <div>
        <label style={LABEL_STYLE}>{t("cfg.trigger")}</label>
        <select style={{ ...INPUT_STYLE, cursor: "pointer" }} value={trig.kind}
          onChange={(e) => {
            const kind = e.target.value as ScriptTriggerKind["kind"];
            onPatch({ trigger:
              kind === "startup" ? { kind } :
              kind === "interval" ? { kind, interval_s: 60 } :
              kind === "cron" ? { kind, schedule: "0 * * * *" } :
              { kind, tag: "", edge: "any" } });
          }}>
          <option value="startup">{t("cfg.projectStart")}</option>
          <option value="interval">{t("cfgUi.intervalloSecondi")}</option>
          <option value="cron">{t("cfgUi.cronCinqueCampi")}</option>
          <option value="tag_change">{t("cfg.tagChange")}</option>
        </select>
      </div>
      {trig.kind === "interval" && (
        <>
          <CampoNumero min={1} value={trig.interval_s} style={INPUT_STYLE} onTesto={(e) => aggiorna({ interval_s: Number(e) })} />
          {/* T-69 fase B: vuoto = assente, non 0 (uno 0 esplicito fallirebbe la validazione). */}
          <CampoNumero min={50} placeholder={t("cfgUi.msOptionalTakesPrecedence")} value={trig.interval_ms ?? ""} style={INPUT_STYLE}
            onTesto={(e) => aggiorna({ interval_ms: e === "" ? undefined : Number(e) })} />
        </>
      )}
      {trig.kind === "cron" && (
        // Q34: la sintassi accettata la dice il campo.
        <input value={trig.schedule} placeholder="0 * * * *" style={INPUT_STYLE}
          title={t("cfgUi.cronCampi") + "\n\n" + t("cfgUi.everyValue") + t("cfgUi.cronAiuto")}
          onChange={(e) => aggiorna({ schedule: e.target.value })} />
      )}
      {trig.kind === "tag_change" && (
        <>
          <TagInput value={trig.tag} onChange={(v) => aggiorna({ tag: v })} placeholder="es. pump1.running" style={INPUT_STYLE} />
          <select style={{ ...INPUT_STYLE, cursor: "pointer" }} value={trig.edge} onChange={(e) => aggiorna({ edge: e.target.value as "rising" | "falling" | "any" })}>
            <option value="any">{t("cfg.any")}</option>
            <option value="rising">Rising (0→1)</option>
            <option value="falling">Falling (1→0)</option>
          </select>
        </>
      )}
    </>
  );
}

function PannelloEsito({ esito, onRiga, onChiudi }: { esito: Esito; onRiga: (r: number) => void; onChiudi: () => void }) {
  const { t } = useTranslation();
  const verde = esito.ok;
  return (
    <div data-testid="logica-esito" style={{ maxHeight: 180, overflowY: "auto", fontSize: 12, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: 8,
      background: "var(--brand-surface, #1e293b)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <strong style={{ color: verde ? "var(--brand-success, #22c55e)" : "var(--brand-danger-soft, #fca5a5)" }}>
          {esito.tipo === "controllo" ? t(verde ? "logica.controlloOk" : "logica.controlloKo") : t(verde ? "logica.provaOk" : "logica.provaKo")}
        </strong>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onChiudi} style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>✕</button>
      </div>
      {esito.tipo === "controllo" && (
        <>
          {!esito.sandbox && <div style={{ color: "var(--brand-warning-soft, #fbbf24)" }}>{t("logica.senzaSandbox")}</div>}
          {esito.rilievi.map((r, i) => (
            <div key={i} data-testid="logica-rilievo"
              onClick={() => r.riga && onRiga(r.riga)}
              style={{ cursor: r.riga ? "pointer" : "default", padding: "2px 0", color: "var(--brand-text-2, #cbd5e1)" }}>
              {r.riga ? <code>{t("logica.riga", { n: r.riga })}</code> : null} {r.vietato ? `${t("logica.vietato")} ` : ""}{r.messaggio}
            </div>
          ))}
        </>
      )}
      {esito.tipo === "prova" && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
          {[esito.stdout, esito.stderr, esito.errore].filter(Boolean).join("\n") || t("logica.nessunaUscita")}
        </pre>
      )}
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 };
const INPUT_STYLE: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
};
const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, width: "auto", padding: "4px 8px", cursor: "pointer", fontSize: 12 };

/** Frammenti da inserire al cursore, per le funzioni. Li sostituiscono i
 *  modelli coi tag del progetto nella sessione L3. */
const SNIPPETS = {
  increment:
`# Increment a numeric tag by 1.
v = tags.read("counter") or 0
tags.write("counter", v + 1)
`,
  toggle:
`# Toggle a boolean tag.
tags.write("light", not (tags.read("light") or False))
`,
  conditional:
`# Write B only when A is over the threshold.
a = tags.read("input_a") or 0
if a > 50:
    tags.write("alarm_active", True)
else:
    tags.write("alarm_active", False)
`,
  reset_many:
`# Reset a list of tags to 0.
for t in ("counter", "errors", "downtime_min"):
    tags.write(t, 0)
`,
  diagnostic:
`# Diagnostic: print current values to the runtime stdout / browser console.
for t in ("counter", "pump.running"):
    print(t, "=", tags.read(t))
`,
  skeleton:
`# Function skeleton with declared parameters.
# Declare params in the left panel (e.g. tag="counter", step=1) and they
# show up as plain Python globals here.
v = tags.read(tag) or 0
tags.write(tag, v + step)
print(f"{tag}: {v} -> {v + step}")
`,
};
