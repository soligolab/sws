import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { avviso, campo, errore as stileErrore, pulsante, scheda, titoletto } from "@/ui/base";
import type { AiModelPrice, AiPriceList } from "@/types";

/**
 * The AI price list of the platform (plan 2026-11-17-ia-a-scelta-del-cliente,
 * F2). The gateway resolves it — manual rows, then models.dev, then the
 * built-in table — and pushes it into the project containers.
 *
 * The prices in effect are read-only; what can be edited are the manual rows,
 * as one JSON text saved by a button. A third of the work of a table editor,
 * and the server checks every number anyway: a 0 typed by mistake would switch
 * the spending cap off, so a wrong row refuses the whole save.
 */

/** The shape of the manual rows, shown under an empty text. */
const EXAMPLE = `{
  "models": { "mistral": { "mistral-large-latest": { "input": 0.5, "output": 1.5 } } },
  "images": { "openai": { "high": 0.17 } }
}`;

/** `models.dev` is not a valid i18n key (the dot nests). */
const ORIGIN_KEY: Record<AiModelPrice["origin"], string> = {
  manual: "manual", "models.dev": "modelsDev", builtin: "builtin",
};

/** The server's own words: `request` wraps them in `API …: 400 … — {json}`. */
function serverError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const at = msg.indexOf("{");
  if (at >= 0) {
    try {
      const body = JSON.parse(msg.slice(at)) as { error?: string; detail?: string };
      if (body.detail) return body.detail;
      if (body.error) return body.error;
    } catch { /* not JSON: the message as it is */ }
  }
  return msg;
}

export function AiPrices() {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<AiPriceList | null>(null);
  const [manual, setManual] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (withManual: boolean) => {
    try {
      const r = await api.getAiPrices();
      setList(r.resolved);
      if (withManual) {
        const empty = !r.manual || (typeof r.manual === "object" && Object.keys(r.manual).length === 0);
        setManual(empty ? "" : JSON.stringify(r.manual, null, 2));
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(serverError(e));
    }
  }, []);
  useEffect(() => { void load(true); }, [load]);

  const refresh = async () => {
    setBusy(true); setRefreshError(null);
    try {
      setList(await api.refreshAiPrices());
    } catch {
      // A failed download answers 502, which the client reads as «runtime
      // unreachable»: the reason is in the file, written by the server.
      setRefreshError(t("console.aiPrices.refreshFailed"));
      await load(false);
    } finally { setBusy(false); }
  };

  const salva = async () => {
    setSaveError(null); setSaved(false);
    let rows: unknown;
    try {
      rows = manual.trim() ? JSON.parse(manual) : {};
    } catch (e) {
      setSaveError(t("console.aiPrices.badJson", { error: e instanceof Error ? e.message : String(e) }));
      return;
    }
    setBusy(true);
    try {
      setList(await api.putAiPrices(rows));
      setSaved(true);
    } catch (e) {
      setSaveError(serverError(e));
    } finally { setBusy(false); }
  };

  const num = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 4 });
  const provider = (id: string) => t(`aiProviders.${id}`, { defaultValue: id });

  return (
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={scheda}>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.5 }}>
          {t("console.aiPrices.explain")}
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span data-testid="ai-prices-updated" style={{ fontSize: 13 }}>
            {list?.at_ms
              ? t("console.aiPrices.updated", { date: new Date(list.at_ms).toLocaleString(i18n.language) })
              : t("console.aiPrices.never")}
          </span>
          <div style={{ flex: 1 }} />
          <button data-testid="ai-prices-refresh" onClick={() => void refresh()} disabled={busy} style={pulsante(!busy)}>
            {t("console.aiPrices.refresh")}
          </button>
        </div>
        {list?.last_error && (
          <div data-testid="ai-prices-last-error" style={{ ...stileErrore, marginTop: 10 }}>
            {t("console.aiPrices.lastError", { error: list.last_error })}
          </div>
        )}
        {refreshError && <div style={{ ...avviso, marginTop: 10 }}>{refreshError}</div>}
      </div>

      {loadError && <div style={stileErrore}>{loadError}</div>}

      {list && (
        <div style={scheda}>
          <div style={titoletto}>{t("console.aiPrices.textTitle")}</div>
          <table data-testid="ai-prices-models" style={tabella}>
            <thead>
              <tr>
                <th style={th}>{t("console.aiPrices.provider")}</th>
                <th style={th}>{t("console.aiPrices.model")}</th>
                <th style={thNum}>{t("console.aiPrices.input")}</th>
                <th style={thNum}>{t("console.aiPrices.output")}</th>
                <th style={thNum}>{t("console.aiPrices.cacheRead")}</th>
                <th style={thNum}>{t("console.aiPrices.cacheWrite")}</th>
                <th style={th}>{t("console.aiPrices.origin.title")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(list.models).flatMap(([p, models]) =>
                Object.entries(models).flatMap(([id, m]) => [
                  <tr key={`${p}/${id}`} data-testid={`ai-price-${p}-${id}`}>
                    <td style={td}>{provider(p)}</td>
                    <td style={td}>{id}</td>
                    <td style={tdNum}>{num(m.input)}</td>
                    <td style={tdNum}>{num(m.output)}</td>
                    <td style={tdNum}>{num(m.cache_read)}</td>
                    <td style={tdNum}>{num(m.cache_write)}</td>
                    <td style={td}>{t(`console.aiPrices.origin.${ORIGIN_KEY[m.origin] ?? "builtin"}`)}</td>
                  </tr>,
                  ...(m.tiers ?? []).map((tier) => (
                    <tr key={`${p}/${id}/tier/${tier.above_tokens}`} data-testid={`ai-price-${p}-${id}-tier-${tier.above_tokens}`}>
                      <td style={td} />
                      <td style={{ ...td, ...tdSub }}>{t("console.aiPrices.tier", { n: tier.above_tokens.toLocaleString(i18n.language) })}</td>
                      <td style={{ ...tdNum, ...tdSub }}>{num(tier.input)}</td>
                      <td style={{ ...tdNum, ...tdSub }}>{num(tier.output)}</td>
                      <td style={{ ...tdNum, ...tdSub }}>{num(tier.cache_read)}</td>
                      <td style={{ ...tdNum, ...tdSub }}>{num(tier.cache_write)}</td>
                      <td style={td} />
                    </tr>
                  )),
                ]))}
            </tbody>
          </table>
          <p style={nota}>{t("console.aiPrices.unit")}</p>
        </div>
      )}

      {list && (
        <div style={scheda}>
          <div style={titoletto}>{t("console.aiPrices.imagesTitle")}</div>
          <table data-testid="ai-prices-images" style={tabella}>
            <thead>
              <tr>
                <th style={th}>{t("console.aiPrices.provider")}</th>
                <th style={th}>{t("console.aiPrices.model")}</th>
                <th style={th}>{t("console.aiPrices.imagePrice")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(list.images.openai).map(([q, usd]) => (
                <tr key={`openai/${q}`} data-testid={`ai-price-image-openai-${q}`}>
                  <td style={td}>{provider("openai")}</td>
                  <td style={td}>{t(`ia.scopi.qualita_${q}`, { defaultValue: q })}</td>
                  <td style={td}>{t("console.aiPrices.perImage", { usd: num(usd) })}</td>
                </tr>
              ))}
              {Object.entries(list.images.bfl).map(([model, p]) => (
                <tr key={`bfl/${model}`} data-testid={`ai-price-image-bfl-${model}`}>
                  <td style={td}>{provider("bfl")}</td>
                  <td style={td}>{model}</td>
                  <td style={td}>
                    {t("console.aiPrices.perMegapixel", { first: num(p.first), next: num(p.next), input: num(p.input) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={scheda}>
        <div style={titoletto}>{t("console.aiPrices.manualTitle")}</div>
        <p style={nota}>{t("console.aiPrices.manualExplain")}</p>
        <textarea data-testid="ai-prices-manual" value={manual} rows={10} spellCheck={false}
          placeholder={EXAMPLE}
          onChange={(e) => { setManual(e.target.value); setSaved(false); }}
          style={{ ...campo, fontFamily: "monospace", fontSize: 12, resize: "vertical", marginTop: 6 }} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
          <button data-testid="ai-prices-save" onClick={() => void salva()} disabled={busy} style={pulsante(!busy)}>
            {t("console.aiPrices.save")}
          </button>
          {saved && (
            <span data-testid="ai-prices-saved" style={{ fontSize: 12, color: "var(--brand-success-soft, #86efac)" }}>
              {t("console.aiPrices.saved")}
            </span>
          )}
        </div>
        {saveError && <div data-testid="ai-prices-save-error" style={{ ...stileErrore, marginTop: 8 }}>{saveError}</div>}
      </div>
    </div>
  );
}

const nota: React.CSSProperties = {
  margin: "6px 0 0", fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.4,
};
const tabella: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: React.CSSProperties = {
  textAlign: "left", fontWeight: 500, fontSize: 11, padding: "4px 8px 4px 0",
  color: "var(--brand-text-subtle, #64748b)", borderBottom: "1px solid var(--brand-surface-2, #334155)",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right", padding: "4px 0 4px 8px" };
const td: React.CSSProperties = { padding: "3px 8px 3px 0" };
const tdNum: React.CSSProperties = { padding: "3px 0 3px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const tdSub: React.CSSProperties = { color: "var(--brand-text-muted, #94a3b8)" };
