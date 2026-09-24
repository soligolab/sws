import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, type CreateUserBody, type UpdateUserBody, type UserRole, type UserSummary } from "@/api/client";
import { useAppStore } from "@/store";
import { TRANS_COMP, S } from "@/config/comuni";

// ── Main ConfigView ───────────────────────────────────────────────────────────

// ── USERS tab ─────────────────────────────────────────────────────────────────
// Admin-only CRUD over `/api/auth/users`. Reset-password uses the same PUT
// as a role change — there's no dedicated "reset" endpoint, just a `password`
// field on UpdateUserBody. Non-admins never see this tab (the bar hides it).

const ROLES: UserRole[] = ["Viewer", "Operator", "Supervisor", "Admin"];

export function UsersTab() {
  const { t } = useTranslation();
  const authUser = useAppStore((s) => s.authUser);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  // New-user form state
  const [newUser, setNewUser] = useState<CreateUserBody>({
    username: "", password: "", role: "Operator", must_change_password: true,
  });

  // Per-row "reset password" buffer keyed by username.
  const [resetBuf, setResetBuf] = useState<Record<string, string>>({});

  const refresh = async () => {
    setError(null);
    try {
      const list = await api.listUsers();
      setUsers(list);
      // L'avviso sul ruolo minimo, nel pannello proprietà, dipende da «questo
      // progetto ha utenti»: definire il primo qui lo rende falso subito, non
      // alla prossima apertura del progetto.
      useAppStore.getState().setProgettoHaUtenti(list.length > 0);
    } catch (e: any) {
      setError(t("cfgUi.usersLoadError", { message: String(e?.message ?? e) }));
    }
  };

  useEffect(() => { void refresh(); }, []);

  const fmtDate = (ms: number) => {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleString();
  };

  const onCreate = async () => {
    setError(null);
    if (!newUser.username.trim() || !newUser.password) {
      setError("Username e password sono obbligatori.");
      return;
    }
    setBusy(true);
    try {
      await api.createUser({
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role,
        must_change_password: newUser.must_change_password ?? true,
      });
      setNewUser({ username: "", password: "", role: "Operator", must_change_password: true });
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("primo_utente_non_admin")) {
        // Va prima di `409`, che qui sotto significa tutt'altro. Il dispositivo
        // rifiuta un primo account non-Admin per non nascere con
        // l'autenticazione accesa e nessuno in grado di amministrarlo.
        setError(
          t("cfgUi.theFirstUserOfA") +
          t("cfgUi.couldAdministerThePanelAny")
        );
      } else if (msg.includes("409") || msg.includes("already_exists")) {
        setError(t("cfgUi.userExists", { name: newUser.username }));
      } else {
        setError(t("cfgUi.createError", { message: msg }));
      }
    } finally {
      setBusy(false);
    }
  };

  const onPatch = async (username: string, patch: UpdateUserBody) => {
    setError(null);
    setBusy(true);
    try {
      await api.updateUser(username, patch);
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("409") || msg.includes("last_admin")) {
        setError("Non puoi rimuovere l'ultimo amministratore.");
      } else if (msg.includes("400") || msg.includes("invalid_password")) {
        setError("Password non valida.");
      } else {
        setError(t("cfgUi.updateError", { message: msg }));
      }
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async (username: string) => {
    const pwd = resetBuf[username];
    if (!pwd) return;
    await onPatch(username, { password: pwd, must_change_password: true });
    setResetBuf((prev) => ({ ...prev, [username]: "" }));
  };

  const onDelete = async (username: string) => {
    if (username === authUser) {
      setError(t("cfgUi.youCannotDeleteYourOwn"));
      return;
    }
    if (!confirm(t("cfg.deleteUserConfirm", { username }))) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteUser(username);
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("409") || msg.includes("last_admin")) {
        setError(t("cfgUi.youCannotDeleteTheLast"));
      } else if (msg.includes("cannot_delete_self")) {
        setError(t("cfgUi.youCannotDeleteYourOwn"));
      } else {
        setError(t("cfgUi.deleteError", { message: msg }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={S.section}>
        <div style={S.sectionTitle}>UTENTI</div>
        <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, marginTop: 0 }}>
          <Trans i18nKey="cfgUi.usersSavedIn" components={TRANS_COMP} />
        </p>
        <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, marginTop: 0 }}>
          <Trans i18nKey="cfgUi.usersDeviceNote" components={TRANS_COMP} />
        </p>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", background: "#7f1d1d33", padding: "8px 10px", borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {users === null ? (
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>{t("cfgUi.loading2")}</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{t("cfg.user")}</th>
                <th style={S.th}>{t("cfg.role")}</th>
                <th style={S.th}>{t("cfg.changePwd")}</th>
                <th style={S.th}>{t("cfg.sessionExpiry")}</th>
                <th style={S.th} title={t("cfg.accessibleZones")}>{t("cfg.zones")}</th>
                <th style={S.th}>{t("cfg.updated")}</th>
                <th style={S.th}>{t("cfg.resetPassword")}</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.username === authUser;
                return (
                  <tr key={u.username}>
                    <td style={S.td}>
                      <strong>{u.username}</strong>
                      {isSelf && <span style={{ marginLeft: 6, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>(tu)</span>}
                    </td>
                    <td style={S.td}>
                      <select
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => onPatch(u.username, { role: e.target.value as UserRole })}
                        style={S.input}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={S.td}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={u.must_change_password}
                          disabled={busy}
                          onChange={(e) => onPatch(u.username, { must_change_password: e.target.checked })}
                        />
                        forza
                      </label>
                    </td>
                    <td style={S.td}>
                      <select
                        value={u.session_ttl_secs === null ? "default" : u.session_ttl_secs === 0 ? "never" : String(u.session_ttl_secs)}
                        disabled={busy}
                        style={{ ...S.inputSm, minWidth: 110 }}
                        onChange={(e) => {
                          const v = e.target.value;
                          const ttl: number | null =
                            v === "default" ? null :
                            v === "never"   ? 0    :
                            Number(v);
                          onPatch(u.username, { session_ttl_secs: ttl });
                        }}
                      >
                        <option value="default">{t("cfg.default")}</option>
                        <option value="never">{t("cfg.never")}</option>
                        <option value="1800">30 min</option>
                        <option value="3600">1 ora</option>
                        <option value="7200">2 ore</option>
                        <option value="28800">8 ore</option>
                        <option value="86400">24 ore</option>
                        <option value="604800">7 giorni</option>
                        {/* Preserve custom values not in the list */}
                        {u.session_ttl_secs !== null && u.session_ttl_secs !== 0 &&
                         ![1800, 3600, 7200, 28800, 86400, 604800].includes(u.session_ttl_secs) && (
                          <option value={String(u.session_ttl_secs)}>
                            {Math.round(u.session_ttl_secs / 60)} min
                          </option>
                        )}
                      </select>
                    </td>
                    <td style={S.td}>
                      <input
                        style={{ ...S.inputSm, fontSize: 11, minWidth: 120 }}
                        placeholder={t("cfg.zonesPlaceholder")}
                        title={t("cfg.accessibleZonesHint")}
                        value={(u.allowed_zones ?? []).join(", ")}
                        disabled={busy}
                        onChange={(e) => {
                          const zones = e.target.value ? e.target.value.split(",").map((z) => z.trim()).filter(Boolean) : [];
                          onPatch(u.username, { allowed_zones: zones });
                        }}
                      />
                    </td>
                    <td style={S.td}>
                      <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12 }}>{fmtDate(u.updated_at_ms)}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="password"
                          value={resetBuf[u.username] ?? ""}
                          placeholder={t("cfg.newPasswordPh")}
                          onChange={(e) => setResetBuf((prev) => ({ ...prev, [u.username]: e.target.value }))}
                          style={{ ...S.inputSm, minWidth: 140 }}
                        />
                        <button
                          type="button"
                          disabled={busy || !(resetBuf[u.username] ?? "").length}
                          onClick={() => onResetPassword(u.username)}
                          style={S.btn("primary")}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                    <td style={S.td}>
                      <button
                        type="button"
                        disabled={busy || isSelf}
                        onClick={() => onDelete(u.username)}
                        style={S.btn("danger")}
                        title={isSelf ? t("cfgUi.youCannotDeleteYourOwn2") : t("cfgUi.deleteUser")}
                      >
                        {t("cfgUi.delete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>{t("cfgUi.newUser")}</div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 130px auto",
          gap: 8,
          alignItems: "end",
        }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.username")}</label>
            <input
              type="text"
              value={newUser.username}
              onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
              style={S.input}
              placeholder="es. operatore2"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.initialPassword")}</label>
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
              style={S.input}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>{t("cfg.role")}</label>
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value as UserRole }))}
              style={S.input}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || !newUser.username.trim() || !newUser.password}
            style={S.btn("success")}
          >
            + Crea
          </button>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={newUser.must_change_password ?? true}
            onChange={(e) => setNewUser((s) => ({ ...s, must_change_password: e.target.checked }))}
          />
          Forza cambio password al primo accesso (consigliato)
        </label>
      </div>
    </div>
  );
}
