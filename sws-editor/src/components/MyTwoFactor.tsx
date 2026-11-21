// The account's own two-factor authentication, in a window (menu 👤 →
// «Two-factor authentication»; plan docs/plans/2026-11-21-p6-2fa-e-ldap.md):
// on with the QR and the first code, the recovery codes shown once; off with
// the password and a code (not while a company or the platform requires it);
// ten new codes with a code.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type TwoFactorStatus } from "@/api/client";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { RecoveryCodes, SetupStep } from "@/auth/secondFactor";
import { CampoPassword } from "@/components/CampoPassword";

const button: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer",
};
const field: React.CSSProperties = {
  background: "var(--brand-surface-2, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 8px", fontSize: 13,
};
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MyTwoFactor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [st, setSt] = useState<TwoFactorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "disable" | "codes">("none");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const load = useCallback(() => {
    api.twoFactorStatus().then(setSt, (e) => setError(/404/.test(err(e)) ? t("twoFactor.unavailable") : err(e)));
  }, [t]);
  useEffect(load, [load]);

  const run = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    p.catch((e) => setError(err(e))).finally(() => setBusy(false));
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); setMode("none"); setCode(""); setPassword(""); load(); }} />;
  return (
    <div data-testid="my-two-factor" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 340, maxWidth: 420 }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("twoFactor.help")}</p>
      {error && <div role="alert" style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>{error}</div>}
      {st && !st.enabled && !setup && (
        <>
          <div style={{ fontSize: 13 }}>{t(st.required ? "twoFactor.offRequired" : "twoFactor.off")}</div>
          <button type="button" style={button} disabled={busy} data-testid="two-factor-start"
            onClick={() => run(api.twoFactorStart().then(setSetup))}>{t("twoFactor.turnOn")}</button>
        </>
      )}
      {setup && (
        <SetupStep secret={setup.secret} uri={setup.uri} busy={busy} error={null}
          onCode={(c) => run(api.twoFactorConfirm(c).then((r) => { setSetup(null); setCodes(r.recovery_codes); }))} />
      )}
      {st?.enabled && (
        <>
          <div style={{ fontSize: 13 }}>{t("twoFactor.on", { n: st.recovery_left })}</div>
          {st.required && <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("twoFactor.requiredNote")}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={button} onClick={() => setMode("codes")}>{t("twoFactor.newCodes")}</button>
            {!st.required && <button type="button" style={button} onClick={() => setMode("disable")}>{t("twoFactor.turnOff")}</button>}
          </div>
          {mode !== "none" && (
            <form style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => {
              e.preventDefault();
              if (mode === "disable") run(api.twoFactorDisable(password, code).then(() => { setMode("none"); setCode(""); setPassword(""); load(); }));
              else run(api.twoFactorNewCodes(code).then((r) => setCodes(r.recovery_codes)));
            }}>
              {mode === "disable" && <CampoPassword value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("twoFactor.password")} />}
              <input style={field} value={code} autoComplete="one-time-code" placeholder={t("twoFactor.codePlaceholder")}
                onChange={(e) => setCode(e.target.value)} />
              <button type="submit" style={button} disabled={busy || !code.trim() || (mode === "disable" && !password)}>
                {t(mode === "disable" ? "twoFactor.turnOff" : "twoFactor.newCodes")}
              </button>
            </form>
          )}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" style={button} onClick={onClose}>{t("common.close", { defaultValue: "OK" })}</button>
      </div>
    </div>
  );
}

export function openMyTwoFactor(title: string): Promise<null> {
  return modulo<null>({ titolo: title, corpo: (fine) => <MyTwoFactor onClose={() => fine(null)} /> }) as Promise<null>;
}
