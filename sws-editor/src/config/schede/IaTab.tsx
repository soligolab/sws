import { CampoPassword } from "@/components/CampoPassword";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { riapriAiStream } from "@/ws/aiStream";
import { apriChat, staccaChat, useComandiChat } from "@/ai/comandiChat";
import type { AiConfig, RegoleIa, ScopoIa, ScopoIaCfg } from "@/types";
import { S, SaveBar } from "@/config/comuni";

// ── Il menù IA (04-11-2026) ──────────────────────────────────────────────────
//
// Piano docs/archive/2026-11-04-un-modello-per-ogni-scopo.md. Tre schede del ramo
// «IA» del pannello laterale: la chat, i fornitori con le loro chiavi, un
// modello per ogni scopo. Prima c'era una sezione sola nelle Preferenze IDE
// (fornitore, modello, chiave, tetto dell'assistente) e le due voci della chat
// nel menu ☰: tutto è passato qui, e lì non c'è più (regola «una sezione per
// dato»).
//
// Tutto questo vive **nel runtime locale** (config_dir), non nel progetto e non
// nel browser. Le rotte esistono solo sull'istanza IDE: altrove rispondono 404,
// e qui il 404 si legge come «non si configura da questa macchina».

const SCOPI: ScopoIa[] = ["assistente", "simboli", "traduzione", "sfondi"];

/** La configurazione IA, ricaricabile. `assente` = 404 (non è un'istanza IDE). */
function useConfigIa() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [assente, setAssente] = useState(false);
  const carica = () => {
    api.getAiConfig()
      .then((c) => { setCfg(c); setAssente(false); })
      .catch(() => setAssente(true));
  };
  useEffect(carica, []);
  return { cfg, assente, carica };
}

function NonQui() {
  const { t } = useTranslation();
  return <Nota>{t("cfgUi.assistenteNonQui")}</Nota>;
}

// ── La chat ──────────────────────────────────────────────────────────────────

export function IaAssistenteTab() {
  const { t } = useTranslation();
  const { cfg, assente } = useConfigIa();
  const chat = useComandiChat();
  if (useAppStore((s) => s.authRole) !== "Admin") return null;
  const eff = cfg?.scopi.assistente;
  return (
    <Colonna>
      <Box titolo={t("ia.chat.titolo")}>
        <Nota>{t("ia.chat.spiega")}</Nota>
        {assente ? <NonQui /> : eff && (
          <Stato attivo={eff.attivo}>
            {eff.attivo
              ? t("ia.chat.attiva", { fornitore: eff.effettivo.fornitore, modello: eff.effettivo.modello })
              : t("ia.chat.spenta")}
          </Stato>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button data-testid="ia-apri-chat" style={bottone} onClick={() => apriChat()}>
            {t("ia.chat.apri")}
          </button>
          <button data-testid="ia-stacca-chat" style={bottoneChiaro}
            disabled={chat?.staccata} onClick={() => staccaChat()}>
            {t("ia.chat.stacca")} ↗
          </button>
        </div>
        {chat?.staccata && <Nota>{t("menu.chatDetachedHint")}</Nota>}
      </Box>
    </Colonna>
  );
}

// ── Fornitori e chiavi ───────────────────────────────────────────────────────

export function IaFornitoriTab() {
  const { t } = useTranslation();
  const { cfg, assente, carica } = useConfigIa();
  if (useAppStore((s) => s.authRole) !== "Admin") return null;
  if (assente) return <Colonna><NonQui /></Colonna>;
  if (!cfg) return <Colonna><Nota>…</Nota></Colonna>;
  return (
    <Colonna>
      <Nota>{t("ia.fornitori.spiega")}</Nota>
      {cfg.da_ambiente.length > 0 && (
        <Avviso>{t("cfgUi.varAmbienteScavalcano", { elenco: cfg.da_ambiente.join(", ") })}</Avviso>
      )}
      {cfg.fornitori.map((f) => <Fornitore key={f.id} f={f} onCambiato={carica} />)}
    </Colonna>
  );
}

function Fornitore({ f, onCambiato }: { f: AiConfig["fornitori"][number]; onCambiato: () => void }) {
  const { t } = useTranslation();
  const [chiave, setChiave] = useState("");
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  // Cancellare chiede una seconda conferma sul bottone stesso, non un pop-up
  // del browser (seme «Finestra di avviso», 04-11-2026).
  const [confermaCancella, setConfermaCancella] = useState(false);

  const fai = async (azione: () => Promise<{ ok: boolean; testo: string }>) => {
    setBusy(true); setEsito(null);
    try { setEsito(await azione()); } catch (e) {
      setEsito({ ok: false, testo: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); setConfermaCancella(false); }
  };
  const salva = () => fai(async () => {
    await api.putAiChiave(f.id, chiave.trim());
    setChiave("");
    // La chiave si legge all'apertura della sessione della chat.
    riapriAiStream();
    onCambiato();
    return { ok: true, testo: t("ia.fornitori.salvata") };
  });
  const prova = () => fai(async () => {
    const r = await api.provaAiChiave(f.id);
    return r.ok
      ? { ok: true, testo: t("ia.fornitori.provaOk", { n: r.modelli?.length ?? 0 }) }
      : { ok: false, testo: t("ia.fornitori.provaKo", { errore: r.errore ?? "" }) };
  });
  const cancella = () => fai(async () => {
    const r = await api.deleteAiChiave(f.id);
    riapriAiStream();
    onCambiato();
    return { ok: true, testo: r.cera ? t("cfgUi.keyDeleted") : t("cfgUi.thereWasNoKeyTo") };
  });

  return (
    <Box titolo={f.nome}>
      <Stato attivo={f.chiave}>
        {f.chiave ? t("ia.fornitori.conChiave") : t("ia.fornitori.senzaChiave")}
        {" · "}{t("ia.fornitori.serve", { scopi: f.scopi.map((s) => t(`ia.scopi.nome.${s}`)).join(", ") })}
      </Stato>
      <label style={etichetta}>
        {t("cfgUi.apiKey")}
        <CampoPassword value={chiave} data-testid={`ia-chiave-${f.id}`}
          placeholder={f.chiave ? t("cfgUi.savedLeaveEmptyToKeep") : "sk-…"}
          onChange={(e) => setChiave(e.target.value)} style={{ ...campo, marginTop: 4 }} />
        <span style={{ display: "block", marginTop: 2 }}>{t("cfgUi.itNeverEntersTheProject")}</span>
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button style={bottone} disabled={busy || !chiave.trim()} onClick={salva}>{t("cfgUi.save")}</button>
        <button style={bottoneChiaro} disabled={busy || !f.chiave} onClick={prova}>{t("ia.fornitori.prova")}</button>
        {f.chiave && (confermaCancella
          ? <button style={bottoneRosso} disabled={busy} onClick={cancella}>{t("ia.fornitori.confermaCancella")}</button>
          : <button style={bottoneChiaro} disabled={busy} onClick={() => setConfermaCancella(true)}>{t("cfgUi.deleteKey")}</button>)}
      </div>
      {esito && <Esito ok={esito.ok}>{esito.testo}</Esito>}
    </Box>
  );
}

// ── Gli scopi ────────────────────────────────────────────────────────────────

export function IaScopiTab() {
  const { t } = useTranslation();
  const { cfg, assente, carica } = useConfigIa();
  const [bozza, setBozza] = useState<Record<ScopoIa, ScopoIaCfg | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  useEffect(() => {
    if (!cfg) return;
    const salvati = {} as Record<ScopoIa, ScopoIaCfg | null>;
    for (const s of SCOPI) salvati[s] = cfg.scopi[s].salvato;
    setBozza(salvati);
  }, [cfg]);
  if (useAppStore((s) => s.authRole) !== "Admin") return null;
  if (assente) return <Colonna><NonQui /></Colonna>;
  if (!cfg || !bozza) return <Colonna><Nota>…</Nota></Colonna>;

  const cambia = (s: ScopoIa, v: ScopoIaCfg | null) => setBozza({ ...bozza, [s]: v });
  const salva = async () => {
    setBusy(true); setEsito(null);
    try {
      await api.putAiScopi(bozza);
      riapriAiStream();
      carica();
      setEsito({ ok: true, testo: t("ia.scopi.salvati") });
    } catch (e) {
      setEsito({ ok: false, testo: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  return (
    <Colonna>
      <Nota>{t("ia.scopi.spiega")}</Nota>
      {cfg.da_ambiente.some((v) => v.startsWith("SWS_AI_")) && (
        <Avviso>{t("cfgUi.varAmbienteScavalcano", { elenco: cfg.da_ambiente.join(", ") })}</Avviso>
      )}
      {SCOPI.map((s) => (
        <RigaScopo key={s} scopo={s} cfg={cfg} valore={bozza[s]} onCambia={(v) => cambia(s, v)} />
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={bottone} data-testid="ia-scopi-salva" disabled={busy} onClick={salva}>{t("cfgUi.save")}</button>
        {esito && <Esito ok={esito.ok}>{esito.testo}</Esito>}
      </div>
    </Colonna>
  );
}

function RigaScopo({ scopo, cfg, valore, onCambia }: {
  scopo: ScopoIa; cfg: AiConfig; valore: ScopoIaCfg | null; onCambia: (v: ScopoIaCfg | null) => void;
}) {
  const { t } = useTranslation();
  const adatti = cfg.fornitori.filter((f) => f.scopi.includes(scopo));
  // Simboli e traduzione possono «fare come l'assistente»: è il valore vuoto.
  const puoEreditare = scopo === "simboli" || scopo === "traduzione";
  const eff = cfg.scopi[scopo];
  // Senza una scelta salvata si mostra quello che lo scopo usa davvero (per
  // l'assistente il server prova Anthropic e poi Kimi): mostrare il primo della
  // lista e salvarlo cambiando solo il tetto spegneva la chat di chi ha solo Kimi.
  const fornitore = valore?.fornitore
    ?? (puoEreditare ? "" : eff.effettivo.fornitore ?? adatti[0]?.id ?? "");
  const scelto = adatti.find((f) => f.id === fornitore);
  const tettoDefault = scopo === "sfondi" ? cfg.tetto_sfondi_default : cfg.tetto_usd_default;
  const [tettoTesto, setTettoTesto] = useState(() => valore?.tetto_usd != null ? String(valore.tetto_usd) : "");
  const set = (campo: keyof ScopoIaCfg, v: string | number | undefined) => {
    const prossimo: ScopoIaCfg = { ...(valore ?? {}), fornitore: fornitore || undefined, [campo]: v };
    onCambia(prossimo);
  };

  return (
    <Box titolo={t(`ia.scopi.nome.${scopo}`)}>
      <Nota>{t(`ia.scopi.spiega_${scopo}`)}</Nota>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
        <label style={etichetta}>
          {t("cfgUi.provider")}
          <select value={fornitore} data-testid={`ia-scopo-${scopo}-fornitore`}
            onChange={(e) => onCambia(e.target.value ? { ...(valore ?? {}), fornitore: e.target.value, modello: undefined } : null)}
            style={{ ...campo, marginTop: 4 }}>
            {puoEreditare && <option value="">{t("ia.scopi.comeAssistente")}</option>}
            {adatti.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}{f.chiave ? "" : ` — ${t("ia.fornitori.senzaChiave")}`}</option>
            ))}
          </select>
        </label>
        <label style={etichetta}>
          {t("cfgUi.modello")}
          <input value={valore?.modello ?? ""} disabled={!fornitore}
            placeholder={scelto?.modello_default ?? ""}
            onChange={(e) => set("modello", e.target.value || undefined)} style={{ ...campo, marginTop: 4 }} />
        </label>
        {scopo === "sfondi" && (
          <label style={etichetta}>
            {t("ia.scopi.qualita")}
            <select value={valore?.qualita ?? "medium"} onChange={(e) => set("qualita", e.target.value)}
              style={{ ...campo, marginTop: 4 }}>
              {["low", "medium", "high"].map((q) => <option key={q} value={q}>{t(`ia.scopi.qualita_${q}`)}</option>)}
            </select>
          </label>
        )}
        {scopo !== "traduzione" && (
          <label style={etichetta}>
            {t("ia.scopi.tetto")}
            {/* Il testo resta quello scritto («0.», «2,5»): convertirlo a ogni
                tasto mangiava la virgola, e «0.5» diventava 5. */}
            <input inputMode="decimal" value={tettoTesto} disabled={!fornitore}
              data-testid={`ia-scopo-${scopo}-tetto`}
              placeholder={String(tettoDefault)}
              onChange={(e) => {
                setTettoTesto(e.target.value);
                const n = Number(e.target.value.replace(",", "."));
                set("tetto_usd", e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined);
              }} style={{ ...campo, marginTop: 4 }} />
          </label>
        )}
      </div>
      <Stato attivo={eff.attivo}>
        {eff.attivo
          ? t(eff.eredita ? "ia.scopi.usaAssistente" : "ia.scopi.usa", {
              fornitore: eff.effettivo.fornitore, modello: eff.effettivo.modello })
          : t("ia.scopi.spento")}
      </Stato>
    </Box>
  );
}

// ── Le regole del progetto ───────────────────────────────────────────────────

/** Toglie i campi vuoti: nel file restano solo le regole scritte. */
function regolePulite(r: RegoleIa): RegoleIa | null {
  const out: RegoleIa = {};
  if (r.impianto?.trim()) out.impianto = r.impianto.trim();
  const regole = Object.fromEntries(Object.entries(r.regole ?? {}).filter(([, v]) => v?.trim()));
  if (Object.keys(regole).length) out.regole = regole;
  return Object.keys(out).length ? out : null;
}

const MAX_REGOLA = 4000;
const CAMPI_REGOLE = ["generali", ...SCOPI] as const;

/** Configurazione → IA → Regole del progetto (F3). Diversamente dalle altre
 *  schede del ramo, queste stanno **nel progetto**: viaggiano con l'export, il
 *  deploy e un template, e chi riceve il progetto le eredita. */
export function IaRegoleTab() {
  const { t } = useTranslation();
  const salvato = useAppStore((s) => s.project?.ai);
  const progetto = useAppStore((s) => s.project);
  const setProject = useAppStore((s) => s.setProject);
  const [bozza, setBozza] = useState<RegoleIa>(() => salvato ?? {});
  const [toccato, setToccato] = useState(false);
  useEffect(() => { if (!toccato) setBozza(salvato ?? {}); }, [salvato, toccato]);

  const metti = (campo: (typeof CAMPI_REGOLE)[number], v: string) => {
    setToccato(true);
    setBozza((b) => ({ ...b, regole: { ...(b.regole ?? {}), [campo]: v } }));
  };
  const salva = async () => {
    const corpo = regolePulite(bozza);
    await api.updateProjectAi(corpo);
    if (progetto) setProject({ ...progetto, ai: corpo ?? undefined });
    setToccato(false);
  };
  const troppo = (v: string | undefined) => (v?.length ?? 0) > MAX_REGOLA;

  return (
    <div style={S.page}>
      <SaveBar onSave={salva} section="ai" dirty={toccato} />
      <Colonna>
        <Nota>{t("ia.regole.spiega")}</Nota>
        <label style={etichetta}>
          {t("ia.regole.impianto")}
          <input data-testid="ia-regole-impianto" value={bozza.impianto ?? ""}
            placeholder={t("ia.regole.impiantoEsempio")}
            onChange={(e) => { setToccato(true); setBozza((b) => ({ ...b, impianto: e.target.value })); }}
            style={{ ...campo, marginTop: 4 }} />
        </label>
        {CAMPI_REGOLE.map((c) => {
          const v = bozza.regole?.[c] ?? "";
          return (
            <label key={c} style={etichetta}>
              {c === "generali" ? t("ia.regole.generali") : t(`ia.scopi.nome.${c}`)}
              <textarea data-testid={`ia-regole-${c}`} value={v} rows={c === "generali" || c === "assistente" ? 5 : 3}
                placeholder={t(`ia.regole.esempio_${c}`)}
                onChange={(e) => metti(c, e.target.value)}
                style={{ ...campo, marginTop: 4, resize: "vertical", fontFamily: "inherit",
                         borderColor: troppo(v) ? "var(--brand-danger, #ef4444)" : undefined }} />
              <span style={{ display: "block", marginTop: 2,
                color: troppo(v) ? "var(--brand-danger, #ef4444)" : undefined }}>
                {t("ia.regole.lunghezza", { n: v.length, max: MAX_REGOLA })}
              </span>
            </label>
          );
        })}
        <Nota>{t("ia.regole.nonScavalcano")}</Nota>
      </Colonna>
    </div>
  );
}

// ── Mattoni ──────────────────────────────────────────────────────────────────

function Colonna({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>{children}</div>;
}

function Box({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)",
      borderRadius: 6, padding: "10px 14px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>{titolo}</div>
      {children}
    </div>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--brand-text-muted, #94a3b8)" }}>{children}</div>;
}

function Avviso({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--brand-warning, #f59e0b)" }}>{children}</div>;
}

function Stato({ attivo, children }: { attivo: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0,
        background: attivo ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)" }} />
      <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{children}</span>
    </div>
  );
}

function Esito({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <div style={{ fontSize: 11, marginTop: 8,
    color: ok ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>{children}</div>;
}

const etichetta: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)" };

const campo: React.CSSProperties = {
  width: "100%", background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text, #f1f5f9)",
  borderRadius: 4, padding: "4px 7px", fontSize: 12, boxSizing: "border-box",
};

const bottone: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, cursor: "pointer", borderRadius: 4,
  color: "var(--brand-on-primary, #f8fafc)", background: "var(--brand-primary, #3b82f6)",
  border: "1px solid var(--brand-primary, #3b82f6)",
};

const bottoneChiaro: React.CSSProperties = {
  ...bottone, background: "transparent", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
};

const bottoneRosso: React.CSSProperties = {
  ...bottone, background: "var(--brand-danger, #ef4444)", border: "1px solid var(--brand-danger, #ef4444)",
};
