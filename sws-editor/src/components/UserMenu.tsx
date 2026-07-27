import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DROP_LABEL, DROP_ITEM, DROP_PANEL, DROP_SEP, HDR_BTN, useOutsideClose } from "@/components/headerStyles";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { useAppStore, type Role } from "@/store";

/** Role pill colours. The three dark ones keep a fixed light text; Viewer uses
 *  the themed surface and therefore the themed text colour. */
function roleStyle(role: Role): React.CSSProperties {
  return {
    padding: "1px 6px",
    borderRadius: 3,
    background: role === "Admin" ? "#7c2d12"
      : role === "Supervisor" ? "#7e22ce"
      : role === "Operator" ? "#1e3a8a" : "var(--brand-surface-2, #334155)",
    color: role === "Viewer" ? "var(--brand-text, #e2e8f0)" : "#f8fafc",
    fontSize: 11,
    fontWeight: 600,
  };
}

/**
 * 👤 menu: who you are, plus the two preferences that are set once and then
 * forgotten (interface language, theme), and the way out.
 *
 * Deliberately contains no privileged action — it is identical for every role,
 * so nothing here needs a permission check.
 */
export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const authUser        = useAppStore((s) => s.authUser);
  const authRole        = useAppStore((s) => s.authRole);

  useOutsideClose(ref, open, () => setOpen(false));

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, padding: "5px 14px", fontSize: 12,
    color: "var(--brand-text-muted, #94a3b8)",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        style={HDR_BTN}
        onClick={() => setOpen((v) => !v)}
        title={t("header.userMenuTitle", { user: authUser ?? "—" })}
      >
        👤 {authUser ?? "—"} ▾
      </button>
      {open && (
        <div style={DROP_PANEL}>
          <div style={{ ...row, color: "var(--brand-text-2, #cbd5e1)" }}>
            <span>{authUser ?? "—"}</span>
            {authRole && <span style={roleStyle(authRole)}>{authRole}</span>}
          </div>
          <div style={DROP_SEP} />
          <div style={DROP_LABEL}>{t("header.preferences")}</div>
          <div style={row}>
            <span>{t("uiLang.label")}</span>
            <UiLangSelect compact />
          </div>
          <div style={row}>
            <span>{t("theme.label")}</span>
            <ThemeToggle compact />
          </div>
          <div style={DROP_SEP} />
          <button style={DROP_ITEM} onClick={() => { onLogout(); setOpen(false); }}>
            {t("menu.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
