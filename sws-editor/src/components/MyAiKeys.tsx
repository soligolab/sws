import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { CampoPassword } from "@/components/CampoPassword";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import type { MyAiKey } from "@/types";

/** The providers the assistant knows (`ai/client.rs`): the id the gateway takes and the name shown. */
const PROVIDERS: { id: string; name: string }[] = [
  { id: "anthropic", name: "Anthropic (Claude)" },
  { id: "kimi", name: "Kimi (Moonshot)" },
];

const button: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer",
};

/**
 * The user's own AI keys, in a window (menu 👤 → «My AI keys»). One row per
 * provider: the key is typed and saved, and from then on only its last four
 * letters are shown. A project that has a key of its own for a provider keeps
 * using it; this one is used where the project has none.
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
      {keys !== null && PROVIDERS.map((p) => (
        <Row key={p.id} provider={p} current={keys.find((k) => k.provider === p.id)} onChanged={load} onError={setError} />
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" style={button} onClick={onClose}>{t("common.close", { defaultValue: "OK" })}</button>
      </div>
    </div>
  );
}

function Row({ provider, current, onChanged, onError }: {
  provider: { id: string; name: string }; current?: MyAiKey; onChanged: () => void; onError: (e: string | null) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // Removing asks for a second tap on the button itself, as «Fornitori e chiavi» does.
  const [confirm, setConfirm] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError(null);
    try { await action(); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setConfirm(false); }
  };
  const save = () => run(async () => { await api.putMyAiKey(provider.id, key.trim()); setKey(""); });
  const remove = () => run(() => api.deleteMyAiKey(provider.id));

  return (
    <div data-testid={`my-ai-key-${provider.id}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {provider.name}
        {current && (
          <span data-testid={`my-ai-key-${provider.id}-state`} style={{ marginLeft: 8, fontSize: 11, fontWeight: 400,
            color: current.readable ? "var(--brand-ok, #46b37a)" : "var(--brand-warn, #e0a43a)" }}>
            {current.readable ? t("myAiKeys.saved", { last4: current.last4 }) : t("myAiKeys.unreadable", { last4: current.last4 })}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <CampoPassword value={key} autoComplete="off" data-testid={`my-ai-key-${provider.id}-input`}
          placeholder={current ? t("myAiKeys.replace") : "sk-…"} style={{ width: 260 }}
          onChange={(e) => setKey(e.target.value)} />
        <button type="button" style={button} disabled={busy || !key.trim()} data-testid={`my-ai-key-${provider.id}-save`} onClick={() => void save()}>
          {t("myAiKeys.save")}
        </button>
        {current && (confirm
          ? <button type="button" style={{ ...button, borderColor: "#7b3633", color: "#f1b0ad" }} disabled={busy}
              data-testid={`my-ai-key-${provider.id}-confirm`} onClick={() => void remove()}>{t("myAiKeys.confirmRemove")}</button>
          : <button type="button" style={button} disabled={busy} data-testid={`my-ai-key-${provider.id}-remove`}
              onClick={() => setConfirm(true)}>{t("myAiKeys.remove")}</button>)}
      </div>
    </div>
  );
}

/** Opens the window from the user menu. */
export function openMyAiKeys(title: string): Promise<null> {
  return modulo<null>({ titolo: title, corpo: (fine) => <MyAiKeys onClose={() => fine(null)} /> }) as Promise<null>;
}
