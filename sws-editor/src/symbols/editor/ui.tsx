// The small pieces of the symbol editor's panels, shared by the editor and its
// parameter editors (`AnimationProps.tsx`).
//
// Since 21-11-2026 they are the IDE's own (`editor/stilePannelli.tsx`, the
// properties panel's `INPUT`): the maintainer found the editor's panels «fissi e
// in uno stile diverso dall'IDE principale». Sections open and close like the
// properties panel's, and remember it; fields and buttons look the same.

import type React from "react";
import { CampoNumero } from "@/components/CampoNumero";
import { IntestazioneSezione, SPAZIO, TESTO, useSezioneAperta } from "@/editor/stilePannelli";

export const C = {
  bg: "var(--brand-bg, #0f172a)",
  surface: "var(--brand-surface, #1e293b)",
  surface2: "var(--brand-surface-2, #334155)",
  border: "var(--brand-border, #334155)",
  text: "var(--brand-text, #e2e8f0)",
  muted: "var(--brand-text-muted, #94a3b8)",
  subtle: "var(--brand-text-subtle, #64748b)",
  accent: "var(--brand-primary, #3b82f6)",
  danger: "var(--brand-danger, #ef4444)",
  port: "#22d3ee", /* fixed-colour */
};

/** The height of the three bars on top of the columns (layers, canvas tools,
 *  tabs): one line across the editor, where before there were three. The IDE's
 *  toolbar height (`EditorToolbar`), since 22-11-2026. */
export const BAR_HEIGHT = 32;

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: SPAZIO.s }}>
      <span style={{ width: 92, color: C.muted, fontSize: TESTO.etichetta, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", gap: SPAZIO.xs }}>{children}</span>
    </label>
  );
}

/** A field, as in the properties panel. */
export const input: React.CSSProperties = {
  width: "100%", minWidth: 0, boxSizing: "border-box", padding: "3px 6px", fontSize: 12, fontFamily: "inherit",
  borderRadius: 4, border: `1px solid ${C.surface2}`, background: C.bg, color: C.text,
};

/** A command button of a panel, as in the properties panel. */
export const button: React.CSSProperties = {
  background: C.bg, border: `1px solid ${C.surface2}`, color: C.muted, borderRadius: 3,
  cursor: "pointer", fontSize: 11, padding: "3px 8px", fontFamily: "inherit",
};

/** A note under a field or a section. */
export const note: React.CSSProperties = { margin: 0, color: C.subtle, fontSize: TESTO.nota + 1 };

export function Num({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <CampoNumero step={step} style={input} value={Number.isFinite(value) ? value : 0}
    onTesto={(s) => { const v = Number(s); if (s.trim() !== "" && Number.isFinite(v)) onChange(v); }} />;
}

/** A section of a panel: the properties panel's header, open or closed as it
 *  was left (`sws.pannelli.simboli.<id>`). */
export function Section({ id, title, count, action, defaultOpen = true, children }: {
  id: string; title: string; count?: number; action?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, toggle] = useSezioneAperta(`simboli.${id}`, defaultOpen);
  return (
    <div data-testid={`symbol-section-${id}`} style={{ borderTop: `1px solid ${C.surface2}`, padding: `${SPAZIO.xs}px ${SPAZIO.m}px 0` }}>
      <IntestazioneSezione titolo={title} aperta={open} onToggle={toggle} contatore={count} azione={action} />
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: SPAZIO.s, padding: `${SPAZIO.xs}px 0 ${SPAZIO.m}px ${SPAZIO.xs}px` }}>
          {children}
        </div>
      )}
    </div>
  );
}
