import type { AlarmSeverity } from "@/types";

/** Single source of truth for severity → color, shared by every alarm-display
 *  widget (alarm_bell, alarm_banner, alarm_viewer). Previously each of the
 *  three defined its own copy; AlarmBanner.tsx/AlarmBellPanel.tsx agreed on
 *  these values, but alarm_viewer's inline `sevColor()` in SvgCanvas.tsx used
 *  a different hex for Warning (#f59e0b vs. this file's #eab308) — a real
 *  visible inconsistency between widgets showing the same severity. */
export const SEV_COLOR: Record<AlarmSeverity, string> = {
  Info:     "var(--brand-primary, #3b82f6)",
  Warning:  "var(--brand-warning, #eab308)",
  Critical: "var(--brand-danger, #ef4444)",
};
