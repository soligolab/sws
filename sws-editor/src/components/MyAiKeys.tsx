import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { AI_PROVIDERS } from "@/ai/providers";
import { CampoPassword } from "@/components/CampoPassword";
import { ModelSelect } from "@/components/ModelSelect";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import type { MyAiKey } from "@/types";

const button: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer",
};

/**
 * The user's own AI keys, in a window (menu 👤 → «My AI keys»). One row per
 * provider: the key is typed and saved, and from then on only its last four
 * letters are shown. A project that has a key of its own for a provider keeps
 * using it; this one is used where the project has none. Since 16-11-2026 all
 * the providers of the AI menu (OpenAI too), «Test the key», and the model
 * preferred for each, used where the project chose none.
 */
export function MyAiKeys({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<MyAiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getMyAiKeys().then(setKeys, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <div data-testid="my-ai-keys" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 380 }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("myAiKeys.help")}</p>
      {error && <div role="alert" style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>{error}</div>}
      {keys === null && !error && <div style={{ fontSize: 12 }}>…</div>}
      {keys !== null && AI_PROVIDERS.map((id) => (
        <Row key={id} provider={id} current={keys.find((k) => k.provider === id)} onChanged={load} onError={setError} />
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" style={button} onClick={onClose}>{t("common.close", { defaultValue: "OK" })}</button>
      </div>
    </div>
  );
}

function Row({ provider, current, onChanged, onError }: {
  provider: string; current?: MyAiKey; onChanged: () => void; onError: (e: string | null) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // Removing asks for a second tap on the button itself, as «Fornitori e chiavi» does.
  const [confirm, setConfirm] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const hasKey = current?.last4 != null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError(null);
    try { await action(); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setConfirm(false); }
  };
  const save = () => run(async () => { await api.putMyAiKey(provider, key.trim()); setKey(""); setModels(null); setTest(null); });
  const remove = () => run(async () => { await api.deleteMyAiKey(provider); setModels(null); setTest(null); });
  const setModel = (model: string | null) => run(() => api.putMyAiModel(provider, model));
  const runTest = useCallback(async (quiet: boolean) => {
    try {
      const r = await api.testMyAiKey(provider);
      if (r.ok) { setModels(r.models ?? []); if (!quiet) setTest({ ok: true, text: t("myAiKeys.testOk", { n: r.models?.length ?? 0 }) }); }
      else setTest({ ok: false, text: t("myAiKeys.testKo", { error: r.error ?? "" }) });
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, [provider, t]);
  // The models are asked as soon as there is a key: the list is free, and the
  // menu below needs it.
  useEffect(() => { if (hasKey && current?.readable) void runTest(true); }, [hasKey, current?.readable, current?.last4, runTest]);

  return (
    <div data-testid={`my-ai-key-${provider}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {t(`aiProviders.${provider}`)}
        {hasKey && (
          <span data-testid={`my-ai-key-${provider}-state`} style={{ marginLeft: 8, fontSize: 11, fontWeight: 400,
            color: current!.readable ? "var(--brand-ok, #46b37a)" : "var(--brand-warn, #e0a43a)" }}>
            {current!.readable ? t("myAiKeys.saved", { last4: current!.last4 }) : t("myAiKeys.unreadable", { last4: current!.last4 })}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <CampoPassword value={key} autoComplete="off" data-testid={`my-ai-key-${provider}-input`}
          placeholder={hasKey ? t("myAiKeys.replace") : "sk-…"} style={{ width: 260 }}
          onChange={(e) => setKey(e.target.value)} />
        <button type="button" style={button} disabled={busy || !key.trim()} data-testid={`my-ai-key-${provider}-save`} onClick={() => void save()}>
          {t("myAiKeys.save")}
        </button>
        {hasKey && (
          <button type="button" style={button} disabled={busy} data-testid={`my-ai-key-${provider}-test`} onClick={() => void runTest(false)}>
            {t("myAiKeys.test")}
          </button>
        )}
        {hasKey && (confirm
          ? <button type="button" style={{ ...button, borderColor: "var(--sws-danger-border, #7b3633)", color: "var(--sws-danger-text, #f1b0ad)" }} disabled={busy}
              data-testid={`my-ai-key-${provider}-confirm`} onClick={() => void remove()}>{t("myAiKeys.confirmRemove")}</button>
          : <button type="button" style={button} disabled={busy} data-testid={`my-ai-key-${provider}-remove`}
              onClick={() => setConfirm(true)}>{t("myAiKeys.remove")}</button>)}
      </div>
      {test && <div data-testid={`my-ai-key-${provider}-test-result`} style={{ fontSize: 12,
        color: test.ok ? "var(--brand-ok, #46b37a)" : "var(--brand-danger-soft, #fca5a5)" }}>{test.text}</div>}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
        {t("myAiKeys.model")}
        <ModelSelect value={current?.model} models={models} onChange={(m) => void setModel(m)} disabled={busy}
          testId={`my-ai-key-${provider}-model`} style={{ minWidth: 220 }} />
      </label>
    </div>
  );
}

/** Opens the window from the user menu. */
export function openMyAiKeys(title: string): Promise<null> {
  return modulo<null>({ titolo: title, corpo: (fine) => <MyAiKeys onClose={() => fine(null)} /> }) as Promise<null>;
}
