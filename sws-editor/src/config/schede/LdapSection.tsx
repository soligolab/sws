// «Dominio (LDAP)» in the Users tab (plan docs/plans/2026-11-21-p6-2fa-e-ldap.md):
// the panel's operators sign in with their domain account, the role from their
// group. The local users above stay, and win on the same name. The service
// account's password goes to the project's secrets, like every other.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type LdapConfig, type LdapGroup } from "@/api/client";
import { CampoPassword } from "@/components/CampoPassword";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";

const ROLES = ["viewer", "operator", "supervisor", "admin"] as const;

const EMPTY: LdapConfig = {
  enabled: true, url: "ldaps://", starttls: false, user_base: "", user_filter: "(sAMAccountName={user})",
  groups: [], timeout_ms: 5000,
};

export function LdapSection() {
  const { t } = useTranslation();
  const saved = useAppStore((s) => s.project?.ldap);
  const setLdap = useAppStore((s) => s.updateProjectLdap);
  const [draft, setDraft] = useState<LdapConfig | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [probe, setProbe] = useState({ user: "", password: "" });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? null);
  const set = (patch: Partial<LdapConfig>) => setDraft((d) => ({ ...(d ?? EMPTY), ...patch }));
  const setGroup = (i: number, patch: Partial<LdapGroup>) =>
    set({ groups: (draft?.groups ?? []).map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  const run = async (p: Promise<void>) => {
    setBusy(true);
    setNote(null);
    try { await p; } catch (e) { setNote({ error: true, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginBottom: 6 };
  const label: React.CSSProperties = { width: 170, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", flexShrink: 0 };

  return (
    <div style={S.section} data-testid="ldap-section">
      <div style={S.sectionTitle}>{t("ldap.title")}</div>
      <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, marginTop: 0 }}>{t("ldap.help")}</p>
      {!draft ? (
        <button type="button" style={S.btn("primary")} onClick={() => setDraft(EMPTY)} data-testid="ldap-add">{t("ldap.add")}</button>
      ) : (
        <>
          <label style={{ ...row, fontSize: 13 }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            {t("ldap.enabled")}
          </label>
          <div style={row}><span style={label}>{t("ldap.url")}</span>
            <input style={{ ...S.input, flex: 1 }} value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder={t("ldap.urlExample")} /></div>
          <label style={{ ...row, fontSize: 12 }}>
            <input type="checkbox" checked={draft.starttls} onChange={(e) => set({ starttls: e.target.checked })} />
            {t("ldap.starttls")}
          </label>
          <div style={row}><span style={label}>{t("ldap.bindDn")}</span>
            <input style={{ ...S.input, flex: 1 }} value={draft.bind_dn ?? ""} placeholder={t("ldap.bindDnExample")}
              onChange={(e) => set({ bind_dn: e.target.value || undefined })} /></div>
          <div style={row}><span style={label}>{t("ldap.bindPassword")}</span>
            <CampoPassword style={{ ...S.input, flex: 1 }} value={draft.bind_password ?? ""}
              onChange={(e) => set({ bind_password: e.target.value || undefined })} /></div>
          <div style={row}><span style={label}>{t("ldap.userBase")}</span>
            <input style={{ ...S.input, flex: 1 }} value={draft.user_base} placeholder={t("ldap.userBaseExample")}
              onChange={(e) => set({ user_base: e.target.value })} /></div>
          <div style={row}><span style={label}>{t("ldap.userFilter")}</span>
            <input style={{ ...S.input, flex: 1 }} value={draft.user_filter} onChange={(e) => set({ user_filter: e.target.value })} /></div>
          <div style={row}><span style={label}>{t("ldap.nameAttribute")}</span>
            <input style={{ ...S.input, flex: 1 }} value={draft.name_attribute ?? ""} placeholder="displayName, givenName"
              onChange={(e) => set({ name_attribute: e.target.value.trim() || undefined })} /></div>

          <div style={{ fontSize: 12, margin: "10px 0 4px" }}>{t("ldap.groups")}</div>
          {draft.groups.map((g, i) => (
            <div key={i} style={row}>
              <input style={{ ...S.input, flex: 2 }} value={g.dn} placeholder={t("ldap.groupExample")}
                onChange={(e) => setGroup(i, { dn: e.target.value })} />
              <select style={S.input} value={g.role} onChange={(e) => setGroup(i, { role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input style={{ ...S.input, flex: 1 }} value={(g.zones ?? []).join(", ")} placeholder={t("ldap.allZones")}
                onChange={(e) => setGroup(i, { zones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) })} />
              <button type="button" style={S.btn("danger")} onClick={() => set({ groups: draft.groups.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" style={S.btn("primary")} onClick={() => set({ groups: [...draft.groups, { dn: "", role: "operator", zones: [] }] })}>
            + {t("ldap.addGroup")}
          </button>

          <div style={{ ...row, marginTop: 12 }}>
            <button type="button" style={S.btn("success")} disabled={busy || !dirty} data-testid="ldap-save"
              onClick={() => void run(api.saveLdap(draft).then(() => { setLdap(draft); setNote({ error: false, text: t("ldap.saved") }); }))}>
              {t("ldap.save")}
            </button>
            <button type="button" style={S.btn("danger")} disabled={busy}
              onClick={() => void run(api.saveLdap(null).then(() => { setLdap(null); setDraft(null); }))}>{t("ldap.remove")}</button>
          </div>

          <div style={{ fontSize: 12, margin: "12px 0 4px" }}>{t("ldap.testTitle")}</div>
          <div style={row}>
            <input style={S.input} value={probe.user} placeholder={t("ldap.testUser")} onChange={(e) => setProbe({ ...probe, user: e.target.value })} />
            <CampoPassword style={S.input} value={probe.password} placeholder={t("ldap.testPassword")}
              onChange={(e) => setProbe({ ...probe, password: e.target.value })} />
            <button type="button" style={S.btn("primary")} disabled={busy} data-testid="ldap-test"
              onClick={() => void run(api.testLdap(draft, probe.user || undefined, probe.password || undefined).then((r) => {
                setNote(r.ok
                  ? { error: false, text: r.role ? t("ldap.testUserOk", { role: r.role, zones: r.zones?.length ? r.zones.join(", ") : t("ldap.allZones") }) : t("ldap.testOk") }
                  : { error: true, text: r.code === "refused" ? t("ldap.testRefused") : t("ldap.testUnreachable", { message: r.message ?? "" }) });
              }))}>{t("ldap.test")}</button>
          </div>
        </>
      )}
      {note && <div role={note.error ? "alert" : undefined} style={{ fontSize: 12, marginTop: 6, color: note.error ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-success, #22c55e)" }}>{note.text}</div>}
    </div>
  );
}
