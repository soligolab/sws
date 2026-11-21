// Two-factor authentication in the console (plan docs/plans/2026-11-21-p6-2fa-e-ldap.md):
// a company requires it of its members, the platform of every account, and a
// reset for someone who lost the phone. Each saved at once, with a question
// first where it closes sessions or takes a protection away.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { avviso, conferma } from "@/finestraAvviso/finestraAvviso";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Switch({ load, save, label, confirmOn }: {
  load: () => Promise<{ on: boolean }>; save: (on: boolean) => Promise<void>; label: string; confirmOn: string;
}) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { load().then((r) => setOn(r.on), () => setOn(null)); }, [load]);
  if (on === null) return null;
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
      <input type="checkbox" checked={on} data-testid="require-2fa" onChange={async (e) => {
        const next = e.target.checked;
        if (next && !(await conferma({ testo: confirmOn }))) return;
        try { await save(next); setOn(next); } catch (x) { void avviso({ livello: "errore", testo: err(x) }); }
      }} />
      {label}
    </label>
  );
}

export function CompanyRequires2fa({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  return <Switch key={companyId} load={() => api.companyRequires2fa(companyId)} save={(on) => api.setCompanyRequires2fa(companyId, on)}
    label={t("twoFactor.console.company")} confirmOn={t("twoFactor.console.companyConfirm")} />;
}

export function PlatformRequires2fa() {
  const { t } = useTranslation();
  return <Switch load={api.platformRequires2fa} save={api.setPlatformRequires2fa}
    label={t("twoFactor.console.platform")} confirmOn={t("twoFactor.console.platformConfirm")} />;
}

export function ResetUser2fa({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  return (
    <button type="button" data-testid="reset-2fa" style={{
      background: "transparent", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)",
      borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer", marginBottom: 12,
    }} onClick={async () => {
      if (!(await conferma({ testo: t("twoFactor.console.resetConfirm", { name }), pericolo: true }))) return;
      try {
        await api.resetUser2fa(userId);
        void avviso({ testo: t("twoFactor.console.resetDone", { name }) });
      } catch (e) { void avviso({ livello: "errore", testo: err(e) }); }
    }}>{t("twoFactor.console.reset")}</button>
  );
}
