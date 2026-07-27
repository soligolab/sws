import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { HDR_BTN } from "@/components/headerStyles";
import { canConfigureProject } from "@/auth/permissions";
import { useAppStore } from "@/store";

/**
 * Runtime state in the header: acquisition dot + Start/Stop, plus the
 * "project saved by an older version" migration prompt.
 *
 * Reboot deliberately lives in the ☰ menu instead: it is rare and disruptive,
 * and it does not belong next to a control used several times per session.
 */
export function RuntimeCtrl() {
  const { t } = useTranslation();
  const authRole              = useAppStore((s) => s.authRole);
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy]       = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string>("");
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api.getSystemStatus();
        if (alive) {
          setRunning(s.sources_running);
          setNeedsUpdate(s.project_needs_update);
          setSavedBy(s.project_saved_by);
          setRuntimeVersion(s.runtime_version);
        }
      } catch { /* ignore — runtime may be restarting */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!canConfigureProject(authRole)) return null;

  const handleMigrate = async () => {
    if (!confirm(t("header.migrateConfirm", { savedBy: savedBy ?? t("header.unknownVersion"), runtime: runtimeVersion }))) return;
    setMigrating(true);
    try {
      await api.migrateProject();
      setNeedsUpdate(false);
    } catch { /* ignore — banner stays until next poll */ }
    finally { setMigrating(false); }
  };

  const handleToggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (running) await api.systemStop();
      else         await api.systemStart();
      const s = await api.getSystemStatus();
      setRunning(s.sources_running);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  const dotColor = running === null ? "var(--brand-text-subtle, #64748b)" : running ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)";
  const dotTitle = running === null ? t("header.acqUnknown") : running ? t("header.acqRunning") : t("header.acqStopped");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {needsUpdate && (
        <button
          style={{ ...HDR_BTN, background: "var(--brand-warning-bg, #78350f)", border: "1px solid var(--brand-warning, #f59e0b)", color: "#fde68a", opacity: migrating ? 0.6 : 1 }}
          disabled={migrating}
          onClick={handleMigrate}
          title={t("header.updateProjectTitle", { savedBy: savedBy ?? t("header.unknownVersion"), runtime: runtimeVersion })}
        >
          {migrating ? t("header.updating") : t("header.updateProjectBtn")}
        </button>
      )}
      <span
        title={dotTitle}
        style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }}
      />
      <button
        style={{ ...HDR_BTN, opacity: busy ? 0.6 : 1 }}
        disabled={busy || running === null}
        onClick={handleToggle}
        title={running ? t("header.stopTitle") : t("header.startTitle")}
      >
        {busy ? "…" : running ? t("header.stop") : t("header.start")}
      </button>
    </div>
  );
}
