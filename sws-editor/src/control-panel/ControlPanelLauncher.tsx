// The three ways to the control panel on the web viewer (plan
// docs/plans/2026-11-13-pannello-di-controllo.md):
//
// 1. a button for BOOT_BUTTON_MS when the viewer starts — always, even when
//    the project disabled the panel: it is the way back for a device left
//    without a network;
// 2. a finger held still in the top-right corner (`cornerHold.ts`);
// 3. the synoptic action `open_control_panel`, which fires OPEN_EVENT.
//
// 2 and 3 follow the project (`control_panel.enabled`).

import { useEffect, useRef, useState } from "react";
import { ControlPanel } from "./ControlPanel";
import { usePanelTranslation } from "./language";
import { getStatus } from "./api";
import { holdComplete, holdProgress, startHold, stillHolding, type HoldState } from "./cornerHold";

export const OPEN_EVENT = "sws:open-control-panel";
export const BOOT_BUTTON_MS = 5_000;

/** Opens the panel from anywhere in the viewer (the synoptic action). */
export function openControlPanel() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function ControlPanelLauncher() {
  const { t } = usePanelTranslation();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [bootLeft, setBootLeft] = useState(BOOT_BUTTON_MS);
  const [progress, setProgress] = useState(0);
  const hold = useRef<HoldState | null>(null);
  const swallowNextClick = useRef(false);

  useEffect(() => {
    getStatus().then((s) => setEnabled(s.enabled)).catch(() => { /* runtime down: keep the defaults */ });
  }, []);

  // The boot button counts down and goes away.
  useEffect(() => {
    if (bootLeft <= 0) return;
    const id = window.setTimeout(() => setBootLeft((l) => l - 1_000), 1_000);
    return () => window.clearTimeout(id);
  }, [bootLeft]);

  useEffect(() => {
    const onOpen = () => { if (enabled) setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [enabled]);

  // The corner gesture, listened to in the capture phase so the project
  // cannot stop it.
  useEffect(() => {
    if (!enabled || open) return;
    let timer: number | null = null;
    const stop = () => {
      hold.current = null;
      setProgress(0);
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    };
    const down = (e: PointerEvent) => {
      hold.current = startHold(e.clientX, e.clientY, window.innerWidth, performance.now());
      if (!hold.current) return;
      timer = window.setInterval(() => {
        const h = hold.current;
        if (!h) return;
        const now = performance.now();
        setProgress(holdProgress(h, now));
        if (holdComplete(h, now)) {
          stop();
          swallowNextClick.current = true;
          setOpen(true);
        }
      }, 100);
    };
    const moveEv = (e: PointerEvent) => {
      if (hold.current && !stillHolding(hold.current, e.clientX, e.clientY)) stop();
    };
    const up = (e: PointerEvent) => {
      if (swallowNextClick.current) { e.stopPropagation(); e.preventDefault(); }
      if (hold.current) stop();
    };
    const click = (e: MouseEvent) => {
      if (swallowNextClick.current) { e.stopPropagation(); e.preventDefault(); swallowNextClick.current = false; }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", moveEv, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("click", click, true);
    return () => {
      stop();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", moveEv, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("click", click, true);
    };
  }, [enabled, open]);

  if (open) return <ControlPanel onClose={() => setOpen(false)} />;
  return (<>
    {bootLeft > 0 && (
      <button type="button" data-testid="control-panel-boot" onClick={() => { setBootLeft(0); setOpen(true); }} style={{
        position: "fixed", right: 16, top: 14, zIndex: 9600, display: "flex", alignItems: "center", gap: 10,
        background: "#2c333b", color: "#e6e9ec", border: "1px solid #3a434d", borderRadius: 8, padding: "10px 16px",
        fontSize: 16, boxShadow: "0 2px 10px #0006", cursor: "pointer",
      }}>
        <Ring fraction={bootLeft / BOOT_BUTTON_MS} label={String(Math.ceil(bootLeft / 1_000))} />
        {t("controlPanel.title")}
      </button>
    )}
    {progress > 0 && (
      <div style={{ position: "fixed", right: 10, top: 10, zIndex: 9600, pointerEvents: "none" }}>
        <Ring fraction={progress} size={60} />
      </div>
    )}
  </>);
}

function Ring({ fraction, label, size = 30 }: { fraction: number; label?: string; size?: number }) {
  const r = size / 2 - 3;
  const len = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#3a434d" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#4f9cf0" strokeWidth={4}
        strokeDasharray={`${len * fraction} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {label && <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={12} fill="#9aa5b1">{label}</text>}
    </svg>
  );
}
