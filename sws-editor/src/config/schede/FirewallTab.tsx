// Device → Firewall (26-11-2026): the firewalld rules of the connected panel,
// through the IDE's proxy, so the same from the LAN and from the cloud. Plan
// docs/plans/2026-11-26-firewall-dei-dispositivi.md.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import type { FirewallApi } from "@/firewall/core";
import { FirewallEditor, type FirewallSkin } from "@/firewall/FirewallEditor";

const SKIN: FirewallSkin = {
  text: "var(--brand-text, #e2e8f0)",
  muted: "var(--brand-text-subtle, #64748b)",
  line: "var(--brand-surface-2, #334155)",
  accent: "var(--sws-accent, #1d4ed8)",
  ok: "var(--brand-success, #16a34a)",
  warn: "var(--brand-warning, #f59e0b)",
  bad: "var(--sws-danger-text, #dc2626)",
  panel: "var(--brand-surface, #1e293b)",
  bg: "var(--brand-bg, #0f172a)",
  barBg: "var(--brand-warning-bg, #422006)",
  barText: "var(--brand-warning-soft, #fcd34d)",
  btn: S.btn("ghost"),
  btnPrimary: S.btn("primary"),
  btnDanger: S.btn("danger"),
  card: { ...S.card, overflow: "visible", padding: "12px 16px" },
  input: { ...S.input, width: "auto" },
};

export function FirewallTab() {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  // `undefined` while reading, `false` where firewalld does not run.
  const [has, setHas] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!remoteConnected) return;
    let live = true;
    api.remoteGetSystemStatus()
      .then((s) => live && setHas(s.firewall === true))
      .catch(() => live && setHas(false));
    return () => { live = false; };
  }, [remoteConnected]);

  const fw: FirewallApi = useMemo(() => ({
    get: () => api.remoteFirewall(),
    apply: (ops) => api.remoteFirewallApply(ops),
    confirmChange: () => api.remoteFirewallConfirm(),
    rollbackChange: () => api.remoteFirewallRollback(),
  }), []);

  let body;
  if (!remoteConnected) body = <div style={{ color: SKIN.muted }} data-testid="firewall-not-connected">{t("firewall.notConnected")}</div>;
  else if (has === undefined) body = <div style={{ color: SKIN.muted }}>{t("firewall.loading")}</div>;
  else if (!has) body = <div style={{ color: SKIN.muted }} data-testid="firewall-unavailable">{t("firewall.unavailable")}</div>;
  else body = <FirewallEditor api={fw} t={t} skin={SKIN} />;
  return <div style={{ maxWidth: 980 }}>{body}</div>;
}
