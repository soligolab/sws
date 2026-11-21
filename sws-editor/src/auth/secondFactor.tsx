// The second factor at login (plan docs/plans/2026-11-21-p6-2fa-e-ldap.md).
//
// A right password (or PIN) of an account with 2FA answers with a challenge
// instead of a session. `api.login` and `api.accediConPin` hand it here, so
// every way in — the login page, the console, «Sessione scaduta», the PIN —
// asks the code the same way, and their callers still get a `LoginOk`.
// With 2FA required and not set up yet, the same window sets it up: the QR,
// the first code, the recovery codes to keep.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { QrCode } from "@/components/QrCode";
import type { LoginOk } from "@/api/client";

/** What the login answers when the code is next. */
export interface SecondFactorAnswer {
  second_factor: "code" | "setup";
  challenge: string;
}

export function isSecondFactor(r: unknown): r is SecondFactorAnswer {
  return !!r && typeof r === "object" && typeof (r as SecondFactorAnswer).second_factor === "string"
    && typeof (r as SecondFactorAnswer).challenge === "string";
}

/** The window was closed without a code. */
export class SecondFactorCancelled extends Error {
  constructor() { super(i18n.t("twoFactor.cancelled")); }
}

/** The calls the window makes: passed in, so this module doesn't import the
 *  client that imports it. */
export interface SecondFactorCalls {
  code: (challenge: string, code: string) => Promise<LoginOk>;
  setup: (challenge: string) => Promise<{ secret: string; uri: string }>;
  setupConfirm: (challenge: string, code: string) => Promise<LoginOk & { recovery_codes?: string[] }>;
}

const input: React.CSSProperties = {
  fontSize: 20, letterSpacing: 4, textAlign: "center", padding: "6px 8px", width: 200,
  background: "var(--brand-surface-2, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
};
const button = (primary: boolean): React.CSSProperties => ({
  padding: "6px 14px", fontSize: 13, borderRadius: 4, cursor: "pointer",
  border: `1px solid ${primary ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)"}`,
  background: primary ? "var(--brand-primary, #3b82f6)" : "transparent",
  color: primary ? "var(--brand-on-primary, #fff)" : "var(--brand-text, #e2e8f0)",
});
const muted: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0 };

/** The recovery codes, shown once, to copy or write down. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid="recovery-codes" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
      <p style={muted}>{t("twoFactor.recoveryHelp")}</p>
      <pre style={{ margin: 0, padding: 10, fontSize: 15, lineHeight: 1.6, background: "var(--brand-surface-2, #0f172a)", borderRadius: 4, columns: 2 }}>
        {codes.join("\n")}
      </pre>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={button(false)} onClick={() => {
          void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true));
        }}>{copied ? t("twoFactor.copied") : t("twoFactor.copy")}</button>
        <button type="button" style={button(true)} data-testid="recovery-codes-done" onClick={onDone}>{t("twoFactor.saved")}</button>
      </div>
    </div>
  );
}

/** The secret as a QR and as text, and the first code. */
export function SetupStep({ secret, uri, busy, error, onCode }: {
  secret: string; uri: string; busy: boolean; error: string | null; onCode: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  return (
    <form style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", maxWidth: 360 }}
      onSubmit={(e) => { e.preventDefault(); if (code.trim()) onCode(code); }}>
      <p style={muted}>{t("twoFactor.setupHelp")}</p>
      <QrCode text={uri} size={180} label={t("twoFactor.qrLabel")} />
      <code style={{ fontSize: 12, wordBreak: "break-all", userSelect: "all" }} data-testid="two-factor-secret">{secret}</code>
      <input style={input} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} maxLength={6}
        placeholder="123456" data-testid="two-factor-code" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      {error && <div role="alert" style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>{error}</div>}
      <button type="submit" style={button(true)} disabled={busy || code.length !== 6}>{t("twoFactor.activate")}</button>
    </form>
  );
}

function CodeWindow({ answer, calls, done }: {
  answer: SecondFactorAnswer; calls: SecondFactorCalls; done: (r: LoginOk | null) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<{ codes: string[]; login: LoginOk } | null>(null);

  useEffect(() => {
    if (answer.second_factor !== "setup") return;
    calls.setup(answer.challenge).then(setSetup, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [answer, calls]);

  const wrong = (e: unknown) => {
    const tooMany = e instanceof Error && /429/.test(e.message);
    setError(t(tooMany ? "twoFactor.tooMany" : "twoFactor.wrong"));
  };

  if (codes) return <RecoveryCodes codes={codes.codes} onDone={() => done(codes.login)} />;
  if (answer.second_factor === "setup") {
    if (!setup) return <p style={muted}>{error ?? "…"}</p>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>{t("twoFactor.required")}</p>
        <SetupStep secret={setup.secret} uri={setup.uri} busy={busy} error={error} onCode={(c) => {
          setBusy(true);
          setError(null);
          calls.setupConfirm(answer.challenge, c).then((r) => {
            const { recovery_codes, ...login } = r;
            setCodes({ codes: recovery_codes ?? [], login });
          }, wrong).finally(() => setBusy(false));
        }} />
      </div>
    );
  }
  return (
    <form data-testid="second-factor" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", maxWidth: 340 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setBusy(true);
        setError(null);
        calls.code(answer.challenge, code).then(done, wrong).finally(() => setBusy(false));
      }}>
      <p style={muted}>{t("twoFactor.codeHelp")}</p>
      <input style={input} autoComplete="one-time-code" autoFocus value={code} maxLength={9}
        placeholder="123456" data-testid="second-factor-code" onChange={(e) => setCode(e.target.value)} />
      {error && <div role="alert" style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>{error}</div>}
      <button type="submit" style={button(true)} disabled={busy || !code.trim()} data-testid="second-factor-go">{t("twoFactor.enter")}</button>
    </form>
  );
}

/** Asks the code (or sets 2FA up) for `answer`: the session, or
 *  `SecondFactorCancelled` if the window is closed. */
export async function askSecondFactor(answer: SecondFactorAnswer, calls: SecondFactorCalls): Promise<LoginOk> {
  const r = await modulo<LoginOk>({
    titolo: i18n.t(answer.second_factor === "setup" ? "twoFactor.setupTitle" : "twoFactor.title"),
    corpo: (fine) => <CodeWindow answer={answer} calls={calls} done={(x) => fine(x)} />,
  });
  if (!r) throw new SecondFactorCancelled();
  return r;
}
