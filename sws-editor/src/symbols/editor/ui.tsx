// The small pieces of the symbol editor's panels, shared by the editor and its
// parameter editors (`AnimationProps.tsx`).

import type React from "react";
import { CampoNumero } from "@/components/CampoNumero";

export const C = {
  bg: "var(--brand-bg, #0f172a)",
  surface: "var(--brand-surface, #1e293b)",
  border: "var(--brand-border, #334155)",
  text: "var(--brand-text, #e2e8f0)",
  muted: "var(--brand-text-muted, #94a3b8)",
  subtle: "var(--brand-text-subtle, #64748b)",
  accent: "var(--brand-primary, #3b82f6)",
  danger: "var(--brand-danger, #ef4444)",
  port: "#22d3ee", /* fixed-colour */
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 90, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 4 }}>{children}</span>
    </label>
  );
}

export const input: React.CSSProperties = {
  width: "100%", minWidth: 0, padding: "3px 5px", fontSize: 12, borderRadius: 3,
  border: `1px solid ${C.border}`, background: C.surface, color: C.text,
};

export function Num({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <CampoNumero step={step} style={input} value={Number.isFinite(value) ? value : 0}
    onTesto={(s) => { const v = Number(s); if (s.trim() !== "" && Number.isFinite(v)) onChange(v); }} />;
}
