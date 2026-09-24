import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { TagInput } from "@/components/TagInput";
import { PythonEditor, type PythonEditorHandle } from "@/components/PythonEditor";
import type { GlobalScriptDef, ScriptTriggerKind } from "@/types";
import { useAppStore } from "@/store";
import { useFocus, usePubblicaElenco } from "@/config/fogliaConfig";
import i18n from "@/i18n";
import { SaveBar } from "@/config/comuni";

// ── GlobalScriptsTab ──────────────────────────────────────────────────────────

function newScript(): GlobalScriptDef {
  return {
    id: `script_${Date.now()}`,
    trigger: { kind: "startup" },
    code: i18n.t("cfgUi.scriptThatRunsWhenThe"),
    enabled: true,
  };
}

function triggerLabel(t: ScriptTriggerKind): string {
  switch (t.kind) {
    case "startup":    return i18n.t("cfgUi.startup");
    case "interval":   return t.interval_ms ? `Ogni ${t.interval_ms}ms` : `Ogni ${t.interval_s}s`;
    case "cron":       return `Cron: ${t.schedule}`;
    case "tag_change": return `Tag: ${t.tag}`;
  }
}

/// Le FUNZIONI del progetto, elencate accanto agli script (Q21).
///
/// Solo elenco, non un secondo editor: le funzioni si modificano nell'editor a
/// schermo intero, che ha anche i parametri e gli snippet. Duplicare qui quella
/// interfaccia significherebbe mantenerne due, e farle divergere.
///
/// Quello che si guadagna è la risposta alla domanda «dov'è tutto il Python di
/// questo progetto»: prima erano due posti e nessuno dei due lo diceva.
function FunctionsInventory() {
  const { t } = useTranslation();
  const functions = useAppStore((s) => s.project?.functions) ?? [];
  const selectFunction = useAppStore((s) => s.selectFunction);
  const setAppMode = useAppStore((s) => s.setAppMode);

  const apri = (id: string) => {
    selectFunction(id);
    setAppMode("edit");
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>FUNZIONI</span>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{functions.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflow: "auto" }}>
        {functions.length === 0 && (
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: "6px 8px" }}>
            {t("cfgUi.noFunctions")}
          </div>
        )}
        {functions.map((f) => (
          <div
            key={f.id}
            onClick={() => apri(f.id)}
            title={t("cfg.openFunctionEditorTitle")}
            style={{
              padding: "6px 10px", borderRadius: 6, cursor: "pointer",
              background: "var(--brand-surface, #1e293b)",
              border: "1px solid var(--brand-surface-2, #334155)",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>{f.name || "(senza nome)"}</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>
              chiamata da un oggetto{f.params.length > 0 ? ` · ${f.params.length} parametri` : ""}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.4 }}>
        {t("cfgUi.functionsAreEditedInThe")}
      </div>
    </>
  );
}

export function GlobalScriptsTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const [scripts, setScripts] = useState<GlobalScriptDef[]>(
    () => project?.global_scripts ?? []
  );
  const [selected, setSelected] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Intenzione dell'utente, non confronto strutturale (vedi TagsTab).
  const [touched, setTouched] = useState(false);
  const editorRef = useRef<PythonEditorHandle | null>(null);

  // Sync when project reloads
  useEffect(() => {
    setScripts(project?.global_scripts ?? []);
  }, [project]);

  const cur = scripts[selected] ?? null;

  // Il secondo livello dell'albero ⚙ (24-09-2026): una foglia per script. La
  // foglia sceglie lo script, e un clic nell'elenco qui sotto aggiorna la
  // foglia evidenziata — le due selezioni non devono mai dire cose diverse.
  usePubblicaElenco("scripts", scripts.map((x) => ({ id: x.id, etichetta: x.id })));
  const focus = useFocus("scripts", scripts.map((x) => x.id));
  const setConfigFocus = useAppStore((s) => s.setConfigFocus);
  useEffect(() => {
    if (focus === null) return;
    const i = scripts.findIndex((x) => x.id === focus);
    if (i >= 0) setSelected(i);
  }, [focus]);
  function scegli(idx: number) {
    setSelected(idx);
    if (scripts[idx]) setConfigFocus(scripts[idx].id);
  }

  function update(idx: number, patch: Partial<GlobalScriptDef>) {
    if (patch.id !== undefined && scripts[idx]?.id === focus) setConfigFocus(patch.id);
    setTouched(true);
    setScripts((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function updateTrigger(idx: number, patch: Partial<ScriptTriggerKind>) {
    const s = scripts[idx];
    if (!s) return;
    update(idx, { trigger: { ...s.trigger, ...patch } as ScriptTriggerKind });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await api.saveGlobalScripts(scripts);
      setTouched(false);
      setMsg(t("cfgUi.saved"));
    } catch (e) {
      setMsg(t("cfgUi.errorMsg", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  function addScript() {
    const s = newScript();
    setTouched(true);
    setScripts((prev) => [...prev, s]);
    setSelected(scripts.length);
    setConfigFocus(s.id);
  }

  function removeScript(idx: number) {
    setTouched(true);
    setScripts((prev) => prev.filter((_, i) => i !== idx));
    setSelected((prev) => Math.max(0, prev > idx ? prev - 1 : prev));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
      <SaveBar onSave={handleSave} saving={saving} saved={false} notice={msg} section="global_scripts" dirty={touched} />
      <div style={{ display: "flex", gap: 16, flex: 1, overflow: "hidden" }}>
      {/* Colonna sinistra: TUTTO il Python del progetto (Q21).
          Funzioni e script restano tipi distinti nel modello — una funzione non
          ha trigger, aspetta di essere chiamata — ma smettono di stare in due
          punti lontani dell'interfaccia. Ogni voce dice come parte. */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <FunctionsInventory />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>SCRIPT</span>
          <button
            onClick={addScript}
            style={{ background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}
          >{t("cfgUi.new")}</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {scripts.length === 0 && (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 8 }}>{t("cfgUi.noScripts")}</div>
          )}
          {scripts.map((s, idx) => (
            <div
              key={s.id}
              onClick={() => scegli(idx)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: selected === idx ? "#1e40af" : "var(--brand-surface, #1e293b)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeScript(idx); }}
                  style={{ background: "none", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
                >✕</button>
              </div>
              <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{triggerLabel(s.trigger)}</span>
              <span style={{ fontSize: 11, color: s.enabled ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)" }}>{s.enabled ? "Abilitato" : "Disabilitato"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: editor */}
      {cur ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          {/* ID + enabled */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>ID</label>
            <input
              value={cur.id}
              onChange={(e) => update(selected, { id: e.target.value })}
              style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 200 }}
            />
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={cur.enabled}
                onChange={(e) => update(selected, { enabled: e.target.checked })}
              />
              Abilitato
            </label>
          </div>

          {/* Trigger type */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.trigger")}</label>
            <select
              value={cur.trigger.kind}
              onChange={(e) => {
                const kind = e.target.value as ScriptTriggerKind["kind"];
                const base: ScriptTriggerKind =
                  kind === "startup"    ? { kind } :
                  kind === "interval"   ? { kind, interval_s: 60 } :
                  kind === "cron"       ? { kind, schedule: "0 * * * *" } :
                  /* tag_change */        { kind, tag: "", edge: "any" };
                update(selected, { trigger: base });
              }}
              style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13 }}
            >
              <option value="startup">{t("cfg.projectStart")}</option>
              <option value="interval">Intervallo (secondi)</option>
              <option value="cron">Cron (5 campi)</option>
              <option value="tag_change">{t("cfg.tagChange")}</option>
            </select>

            {cur.trigger.kind === "interval" && (
              <>
                <input
                  type="number"
                  min={1}
                  value={cur.trigger.interval_s}
                  onChange={(e) => updateTrigger(selected, { interval_s: Number(e.target.value) })}
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 80 }}
                />
                {/* T-69 fase B: additivo — quando valorizzato vince su
                    interval_s. Vuoto = assente (undefined), non 0: uno 0
                    esplicito fallirebbe la validazione server, invece
                    "niente qui" deve tornare al comportamento di sempre. */}
                <input
                  type="number"
                  min={50}
                  placeholder={t("cfgUi.msOptionalTakesPrecedence")}
                  value={cur.trigger.interval_ms ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateTrigger(selected, {
                      interval_ms: raw === "" ? undefined : Number(raw),
                    });
                  }}
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 170 }}
                />
              </>
            )}
            {cur.trigger.kind === "cron" && (
              <input
                value={cur.trigger.schedule}
                onChange={(e) => updateTrigger(selected, { schedule: e.target.value })}
                placeholder="0 * * * *"
                /* Q34: la sintassi accettata non era scritta da nessuna parte,
                   né qui né nel manuale, e chi scriveva un passo (asterisco,
                   barra, 5) si ritrovava uno script che non partiva mai senza
                   dirlo. Ora i passi funzionano, e il campo lo dice. */
                title={"minuto ora giorno mese giorno-settimana\n\n"
                  + t("cfgUi.everyValue")
                  + "*/5      ogni 5 (passo)\n"
                  + "9-17     da 9 a 17 (intervallo)\n"
                  + "9-17/2   da 9 a 17, ogni 2\n"
                  + "0,30     elenco\n\n"
                  + "Esempi: */5 * * * * = ogni 5 minuti; 30 4 * * * = ogni giorno alle 4:30"}
                style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 160 }}
              />
            )}
            {cur.trigger.kind === "tag_change" && (
              <>
                <TagInput
                  value={cur.trigger.tag}
                  onChange={(v) => updateTrigger(selected, { tag: v })}
                  placeholder="es. pump1.running"
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 200 }}
                />
                <select
                  value={cur.trigger.edge}
                  onChange={(e) => updateTrigger(selected, { edge: e.target.value as "rising" | "falling" | "any" })}
                  style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13 }}
                >
                  <option value="any">{t("cfg.any")}</option>
                  <option value="rising">Rising (0→1)</option>
                  <option value="falling">Falling (1→0)</option>
                </select>
              </>
            )}
          </div>

          {/* Code editor */}
          <div style={{ flex: 1, minHeight: 0, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, overflow: "hidden" }}>
            <PythonEditor
              ref={editorRef}
              value={cur.code}
              onChange={(code) => update(selected, { code })}
              height="100%"
            />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-text-subtle, #64748b)", fontSize: 14 }}>
          {t("cfgUi.selectOrCreateAScript")}
        </div>
      )}
      </div>
    </div>
  );
}
