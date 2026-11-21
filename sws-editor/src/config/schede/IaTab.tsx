import { CampoPassword } from "@/components/CampoPassword";
import { ModelSelect } from "@/components/ModelSelect";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { riapriAiStream } from "@/ws/aiStream";
import { apriChat, staccaChat, useComandiChat } from "@/ai/comandiChat";
import { aiErrorOfRequest, aiErrorText } from "@/ai/errorCodes";
import type { AiConfig, AiSpending, AiSpendingMonth, RegoleIa, ScopoIa, ScopoIaCfg } from "@/types";
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

const SCOPI: ScopoIa[] = ["assistente", "simboli", "traduzione", "fields", "sfondi"];

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


/** A provider's name in the IDE's language: the runtime's names are not
 *  translated («OpenAI (immagini)» in an English IDE). */
function providerName(t: (k: string, o?: Record<string, unknown>) => string,
                      id: string | null | undefined, fallback?: string): string {
  if (!id) return "";
  return t(`aiProviders.${id}`, { defaultValue: fallback ?? id });
}

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
              ? t("ia.chat.attiva", { fornitore: providerName(t, eff.effettivo.fornitore), modello: eff.effettivo.modello })
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
      {cfg.fornitori.map((f) => f.id === "local"
        ? <LocalModel key={f.id} f={f} saved={cfg.local ?? null} onChanged={carica} />
        : <Fornitore key={f.id} f={f} onCambiato={carica} />)}
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
    <Box titolo={providerName(t, f.id, f.nome)}>
      <Stato attivo={f.chiave}>
        {f.chiave ? t("ia.fornitori.conChiave") : t("ia.fornitori.senzaChiave")}
        {" · "}{t("ia.fornitori.serve", { scopi: f.scopi.map((s) => t(`ia.scopi.nome.${s}`)).join(", ") })}
      </Stato>
      {/* Which key this project would use (15-11-2026): its own, the key of whoever is looking (cloud), or none. */}
      {f.source !== undefined && (
        <div data-testid={`ia-fonte-${f.id}`} style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: "2px 0 6px" }}>
          {t(f.source === "project" ? "ia.fornitori.usaProgetto" : f.source === "user" ? "ia.fornitori.usaTua" : "ia.fornitori.usaNessuna")}
        </div>
      )}
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

/** The local model (17-11-2026): an OpenAI-compatible server of the customer
 *  (Ollama, vLLM, LM Studio, llama.cpp). Its address and model instead of a
 *  key, which is optional; «Test» lists the models the address serves, before
 *  anything is saved. */
function LocalModel({ f, saved, onChanged }: {
  f: AiConfig["fornitori"][number]; saved: NonNullable<AiConfig["local"]> | null; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(saved?.url ?? "");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(saved?.model ?? "");
  const [seesImages, setSeesImages] = useState(saved?.sees_images ?? false);
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; testo: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = async (action: () => Promise<{ ok: boolean; testo: string }>) => {
    setBusy(true); setOutcome(null);
    try { setOutcome(await action()); } catch (e) {
      setOutcome({ ok: false, testo: aiErrorOfRequest(e) });
    } finally { setBusy(false); setConfirmRemove(false); }
  };
  const test = () => run(async () => {
    const r = await api.provaAiChiave("local", { url: url.trim(), chiave: key.trim() || undefined });
    if (!r.ok) return { ok: false, testo: t("ia.local.testKo", { errore: aiErrorText(r.codice, r.errore ?? "") }) };
    setModels(r.modelli ?? []);
    // One model only: nothing to choose.
    if (!model && r.modelli?.length === 1) setModel(r.modelli[0]);
    return { ok: true, testo: t("ia.local.testOk", { n: r.modelli?.length ?? 0 }) };
  });
  const save = (remove = false) => run(async () => {
    await api.putAiLocal(remove
      ? { url: "", model: "", sees_images: false }
      : { url: url.trim(), model: model.trim(), key: key.trim() || undefined, sees_images: seesImages });
    setKey("");
    if (remove) { setUrl(""); setModel(""); setModels(null); setSeesImages(false); }
    // The purposes' menus list the models of the saved address.
    modelliPerFornitore.delete("local");
    riapriAiStream();
    onChanged();
    return { ok: true, testo: t(remove ? "ia.local.removed" : "ia.local.saved") };
  });
  const list = [...new Set([...(models ?? []), ...(model ? [model] : [])])].sort((a, b) => a.localeCompare(b));

  return (
    <Box titolo={t("aiProviders.local")}>
      <Stato attivo={f.chiave}>
        {f.chiave ? t("ia.local.ready", { modello: saved?.model ?? "" }) : t("ia.local.notReady")}
        {" · "}{t("ia.fornitori.serve", { scopi: f.scopi.map((s) => t(`ia.scopi.nome.${s}`)).join(", ") })}
      </Stato>
      <Nota>{t("ia.local.explain")}</Nota>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        <label style={etichetta}>
          {t("ia.local.url")}
          <input data-testid="ia-url-local" value={url} placeholder="http://localhost:11434/v1"
            onChange={(e) => setUrl(e.target.value)} style={{ ...campo, marginTop: 4 }} />
        </label>
        <label style={etichetta}>
          {t("ia.local.key")}
          <CampoPassword value={key} data-testid="ia-chiave-local"
            placeholder={saved?.has_key ? t("cfgUi.savedLeaveEmptyToKeep") : t("ia.local.keyOptional")}
            onChange={(e) => setKey(e.target.value)} style={{ ...campo, marginTop: 4 }} />
        </label>
        <label style={etichetta}>
          {t("cfgUi.modello")}
          <select value={model} data-testid="ia-modello-local" onChange={(e) => setModel(e.target.value)}
            style={{ ...campo, marginTop: 4 }}>
            <option value="">{t("ia.local.modelPick")}</option>
            {list.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ ...etichetta, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" data-testid="ia-immagini-local" checked={seesImages}
            onChange={(e) => setSeesImages(e.target.checked)} />
          {t("ia.local.seesImages")}
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button style={bottone} data-testid="ia-salva-local" disabled={busy || !url.trim() || !model.trim()}
          onClick={() => void save()}>{t("cfgUi.save")}</button>
        <button style={bottoneChiaro} data-testid="ia-prova-local" disabled={busy || !url.trim()}
          onClick={() => void test()}>{t("ia.local.test")}</button>
        {saved && (confirmRemove
          ? <button style={bottoneRosso} disabled={busy} data-testid="ia-conferma-togli-local"
              onClick={() => void save(true)}>{t("ia.local.confirmRemove")}</button>
          : <button style={bottoneChiaro} disabled={busy} data-testid="ia-togli-local"
              onClick={() => setConfirmRemove(true)}>{t("ia.local.remove")}</button>)}
      </div>
      {outcome && <Esito ok={outcome.ok}>{outcome.testo}</Esito>}
    </Box>
  );
}

// ── Gli scopi ────────────────────────────────────────────────────────────────

/** The models of a provider, asked once per tab (the list is free, but five
 *  rows would ask five times). `null` = no key, or the provider said no. */
const modelliPerFornitore = new Map<string, Promise<string[] | null>>();
function modelliDi(fornitore: string): Promise<string[] | null> {
  let p = modelliPerFornitore.get(fornitore);
  if (!p) {
    p = api.provaAiChiave(fornitore).then((r) => (r.ok ? r.modelli ?? [] : null), () => null);
    modelliPerFornitore.set(fornitore, p);
  }
  return p;
}

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
  const puoEreditare = scopo === "simboli" || scopo === "traduzione" || scopo === "fields";
  const eff = cfg.scopi[scopo];
  // In the cloud, without a choice of the project, what the purpose uses
  // depends on who opens the menu: their preferred provider, their keys.
  // Writing it into the project with a change of the cap alone would impose
  // one person's provider on everybody (review of 17-11-2026): the row stays
  // empty, «as the account prefers», until a provider is chosen on purpose.
  const preferred = scopo === "assistente" ? cfg.preferito_account?.testo
    : scopo === "sfondi" ? cfg.preferito_account?.immagini : null;
  const followsAccount = (scopo === "assistente" || scopo === "sfondi")
    && (!!preferred || adatti.find((f) => f.id === eff.effettivo.fornitore)?.source === "user");
  // Senza una scelta salvata si mostra quello che lo scopo usa davvero (per
  // l'assistente il server prova Anthropic e poi Kimi): mostrare il primo della
  // lista e salvarlo cambiando solo il tetto spegneva la chat di chi ha solo Kimi.
  const fornitore = valore?.fornitore
    ?? (puoEreditare || followsAccount ? "" : eff.effettivo.fornitore ?? adatti[0]?.id ?? "");
  const scelto = adatti.find((f) => f.id === fornitore);
  const conChiave = !!scelto && (scelto.chiave || scelto.source != null);
  const [modelli, setModelli] = useState<string[] | null>(null);
  useEffect(() => {
    setModelli(null);
    if (!fornitore || !conChiave) return;
    let vivo = true;
    void modelliDi(fornitore).then((m) => { if (vivo) setModelli(m); });
    return () => { vivo = false; };
  }, [fornitore, conChiave]);
  const tettoDefault = scopo === "sfondi" ? cfg.tetto_sfondi_default : cfg.tetto_usd_default;
  // A local model off the cloud costs nothing: a cap would never be reached.
  const senzaTetto = !cfg.in_cloud && (fornitore || eff.effettivo.fornitore) === "local";
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
            {followsAccount && <option value="">{t("ia.scopi.followsAccount")}</option>}
            {adatti.map((f) => (
              <option key={f.id} value={f.id}>
                {providerName(t, f.id, f.nome)}{f.chiave ? "" : ` — ${t("ia.fornitori.senzaChiave")}`}</option>
            ))}
          </select>
        </label>
        <label style={etichetta}>
          {t("cfgUi.modello")}
          <ModelSelect value={valore?.modello} models={modelli} disabled={!fornitore}
            defaultModel={scelto?.modello_account ?? scelto?.modello_default}
            testId={`ia-scopo-${scopo}-modello`}
            onChange={(m) => set("modello", m ?? undefined)} style={{ ...campo, marginTop: 4 }} />
        </label>
        {/* The quality is OpenAI's setting: FLUX has none (G5, 16-11-2026). */}
        {scopo === "sfondi" && fornitore === "openai" && (
          <label style={etichetta}>
            {t("ia.scopi.qualita")}
            <select value={valore?.qualita ?? "medium"} data-testid="ia-scopo-sfondi-qualita"
              onChange={(e) => set("qualita", e.target.value)}
              style={{ ...campo, marginTop: 4 }}>
              {["low", "medium", "high"].map((q) => <option key={q} value={q}>{t(`ia.scopi.qualita_${q}`)}</option>)}
            </select>
          </label>
        )}
        {scopo !== "traduzione" && senzaTetto && (
          <div style={{ ...etichetta, alignSelf: "end" }} data-testid={`ia-scopo-${scopo}-senza-tetto`}>
            {t("ia.scopi.localFree")}
          </div>
        )}
        {scopo !== "traduzione" && !senzaTetto && (
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
              fornitore: providerName(t, eff.effettivo.fornitore), modello: eff.effettivo.modello })
          : t("ia.scopi.spento")}
      </Stato>
      <AccountPreference scopo={scopo} cfg={cfg} />
    </Box>
  );
}

/** Where the project chose no provider, the account's preference counts
 *  (cloud, 17-11-2026): the row says so, or says that the preference has no
 *  key and which provider is used instead. Read from what the server will
 *  really use (`effettivo`), not worked out again here. */
function AccountPreference({ scopo, cfg }: { scopo: ScopoIa; cfg: AiConfig }) {
  const { t } = useTranslation();
  if (scopo !== "assistente" && scopo !== "sfondi") return null;
  const eff = cfg.scopi[scopo];
  const preferred = scopo === "assistente" ? cfg.preferito_account?.testo : cfg.preferito_account?.immagini;
  if (!preferred || eff.salvato?.fornitore) return null;
  // The environment wins over the account: the preference is not what decides.
  if (scopo === "assistente" && cfg.da_ambiente.includes("SWS_AI_FORNITORE")) return null;
  const name = (id: string) => t(`aiProviders.${id}`, { defaultValue: id });
  const used = eff.attivo ? eff.effettivo.fornitore : null;
  return (
    <div data-testid={`ia-scopo-${scopo}-preferenza`} style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginTop: 4 }}>
      {used === preferred
        ? t("ia.scopi.accountPreference", { fornitore: name(preferred) })
        : used
          ? t("ia.scopi.accountPreferenceNoKey", { fornitore: name(preferred), usato: name(used) })
          : t("ia.scopi.accountPreferenceNoKeyOff", { fornitore: name(preferred) })}
    </div>
  );
}

// ── Spending ─────────────────────────────────────────────────────────────────

/** Dollars as the tab shows them: two decimals, four under one dollar (a
 *  translation costs a fraction of a cent, and «0,00 $» would hide it). */
export function formatUsd(usd: number, lang: string): string {
  const digits = usd !== 0 && Math.abs(usd) < 1 ? 4 : 2;
  return `${usd.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: digits })} $`;
}

/** `2026-11` → «novembre 2026». */
function monthName(month: string, lang: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString(lang, { month: "long", year: "numeric" });
}

/** Configurazione → IA → Spesa (G5, 16-11-2026): what the AI has cost this
 *  installation, month by month, by purpose and by provider. Read-only: the
 *  runtime adds to it at every paid call (`ai/spending.rs`). */
export function IaSpendingTab() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AiSpending | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "absent" | "error">("loading");
  const [error, setError] = useState("");
  const load = () => {
    setState("loading");
    api.getAiSpending().then(
      (d) => { setData(d); setState("ok"); },
      (e) => {
        const text = e instanceof Error ? e.message : String(e);
        // 404 = not an IDE instance: there is nothing to configure from here.
        setError(text);
        setState(/^API [^:]+: 404\b/.test(text) ? "absent" : "error");
      },
    );
  };
  useEffect(load, []);
  if (useAppStore((s) => s.authRole) !== "Admin") return null;
  if (state === "absent") return <Colonna><NonQui /></Colonna>;
  return (
    <Colonna>
      <Nota>{t("ia.spending.explain")}</Nota>
      <div>
        <button style={bottoneChiaro} data-testid="ia-spending-refresh" disabled={state === "loading"} onClick={load}>
          {t("ia.spending.refresh")}
        </button>
      </div>
      {state === "error" && <Esito ok={false}>{t("ia.spending.error", { error })}</Esito>}
      {data?.months.map((m) => (
        <SpendingMonth key={m.month} month={m} current={m.month === data.current_month} lang={i18n.language} />
      ))}
      {data && (
        <Nota>
          <span data-testid="ia-spending-total">{t("ia.spending.total", { usd: formatUsd(data.total.usd, i18n.language) })}</span>
          {" "}{t("ia.spending.kept", { n: data.kept_months })}
        </Nota>
      )}
    </Colonna>
  );
}

function SpendingMonth({ month, current, lang }: { month: AiSpendingMonth; current: boolean; lang: string }) {
  const { t } = useTranslation();
  const name = monthName(month.month, lang);
  // The purposes in the order of the menu, then whatever else the file holds.
  const order = (p: string) => { const i = (SCOPI as string[]).indexOf(p); return i < 0 ? SCOPI.length : i; };
  const rows = [...month.rows].sort((a, b) =>
    order(a.purpose) - order(b.purpose) || a.purpose.localeCompare(b.purpose) || a.provider.localeCompare(b.provider));
  const byProvider = new Map<string, { usd: number; calls: number }>();
  for (const r of month.rows) {
    const sum = byProvider.get(r.provider) ?? { usd: 0, calls: 0 };
    byProvider.set(r.provider, { usd: sum.usd + r.usd, calls: sum.calls + r.calls });
  }
  const provider = (id: string) => t(`aiProviders.${id}`, { defaultValue: id });
  return (
    <Box titolo={current ? t("ia.spending.currentMonth", { month: name }) : name}>
      <div data-testid={`ia-spending-month-${month.month}`}>
        {rows.length === 0 ? <Nota>{t("ia.spending.none")}</Nota> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>
            <thead>
              <tr>
                <th style={th}>{t("ia.spending.purpose")}</th>
                <th style={th}>{t("ia.spending.provider")}</th>
                <th style={thNum}>{t("ia.spending.calls")}</th>
                <th style={thNum}>{t("ia.spending.spent")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.purpose}/${r.provider}`} data-testid={`ia-spending-row-${month.month}-${r.purpose}-${r.provider}`}>
                  <td style={td}>{t(`ia.scopi.nome.${r.purpose}`, { defaultValue: r.purpose })}</td>
                  <td style={td}>{provider(r.provider)}</td>
                  <td style={tdNum}>{r.calls}</td>
                  <td style={tdNum}>{formatUsd(r.usd, lang)}</td>
                </tr>
              ))}
              {/* The sums by provider, when the month has more than one. */}
              {byProvider.size > 1 && [...byProvider].sort(([a], [b]) => a.localeCompare(b)).map(([id, sum]) => (
                <tr key={`provider/${id}`} data-testid={`ia-spending-provider-${month.month}-${id}`}>
                  <td style={tdSub}>{t("ia.spending.byProvider")}</td>
                  <td style={tdSub}>{provider(id)}</td>
                  <td style={{ ...tdSub, textAlign: "right" }}>{sum.calls}</td>
                  <td style={{ ...tdSub, textAlign: "right" }}>{formatUsd(sum.usd, lang)}</td>
                </tr>
              ))}
              <tr>
                <td style={tdTotal} colSpan={2}>{t("ia.spending.monthTotal")}</td>
                <td style={{ ...tdTotal, textAlign: "right" }}>{month.calls}</td>
                <td style={{ ...tdTotal, textAlign: "right" }} data-testid={`ia-spending-month-total-${month.month}`}>
                  {formatUsd(month.usd, lang)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </Box>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", fontWeight: 500, fontSize: 11, padding: "3px 6px 3px 0",
  color: "var(--brand-text-subtle, #64748b)", borderBottom: "1px solid var(--brand-surface-2, #334155)",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right", padding: "3px 0 3px 6px" };
const td: React.CSSProperties = { padding: "3px 6px 3px 0" };
const tdNum: React.CSSProperties = { padding: "3px 0 3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const tdSub: React.CSSProperties = { ...td, color: "var(--brand-text-muted, #94a3b8)", fontVariantNumeric: "tabular-nums" };
const tdTotal: React.CSSProperties = {
  ...td, fontWeight: 600, borderTop: "1px solid var(--brand-surface-2, #334155)", fontVariantNumeric: "tabular-nums",
};

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
