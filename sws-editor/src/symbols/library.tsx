// Built-in SCADA symbol library. Each entry produces an SVG fragment to
// render inside the synoptic canvas. Symbols are drawn in a 100×100
// design space and scaled via the object's width/height; the renderer
// transforms the group accordingly.
//
// Each render() takes the resolved state ("off" | "on" | "alarm") and
// the resolved colours, returning JSX. Keeping these pure JSX (no DOM
// outside React) lets SvgCanvas treat them like any other primitive.
import type { ReactElement } from "react";
import type { SymbolId } from "@/types";

export type SymbolState = "off" | "on" | "alarm";

export interface SymbolRenderProps {
  state: SymbolState;
  /** "off" colour — also used as outline when the body fill is something else. */
  off:   string;
  /** "on" / running colour. */
  on:    string;
  /** Alarm colour (red by default). */
  alarm: string;
}

export interface SymbolMeta {
  id: SymbolId;
  label: string;
  /** Default natural size for the design space (px). Used when adding
   *  a fresh symbol to the canvas. */
  defaultWidth:  number;
  defaultHeight: number;
  render: (p: SymbolRenderProps) => ReactElement;
}

const stateFill = (p: SymbolRenderProps): string =>
  p.state === "alarm" ? p.alarm : p.state === "on" ? p.on : p.off;

// ── Pump ────────────────────────────────────────────────────────────────
// Circle body + a triangular rotor inside + nozzle on the right.
function pumpSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* body */}
      <circle cx={50} cy={50} r={36} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* rotor (impeller stylised) */}
      <path d="M50 24 L66 56 L34 56 Z" fill="#0f172a" opacity={0.35} />
      {/* outlet nozzle */}
      <rect x={84} y={42} width={14} height={16} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* base / feet */}
      <rect x={20} y={86} width={60} height={6} fill="#0f172a" />
      {p.state === "on" && (
        <circle cx={50} cy={50} r={4} fill="#fff" opacity={0.6} />
      )}
    </g>
  );
}

// ── Valve ──────────────────────────────────────────────────────────────
// Two facing triangles with a stem on top.
function valveSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* left triangle */}
      <path d="M10 30 L50 50 L10 70 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* right triangle */}
      <path d="M90 30 L50 50 L90 70 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* stem */}
      <rect x={46} y={6} width={8} height={26} fill="#0f172a" />
      {/* handwheel */}
      <ellipse cx={50} cy={10} rx={18} ry={5} fill="none" stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

// ── Motor ──────────────────────────────────────────────────────────────
// Circle with "M" letter; armature stub on the right.
function motorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <circle cx={45} cy={50} r={36} fill={c} stroke="#0f172a" strokeWidth={2} />
      <text x={45} y={58} textAnchor="middle" fontSize={28} fontWeight={700} fill="#0f172a"
            fontFamily="system-ui, sans-serif">M</text>
      <rect x={80} y={42} width={16} height={16} fill={c} stroke="#0f172a" strokeWidth={2} />
      {p.state === "on" && (
        <circle cx={45} cy={50} r={40} fill="none" stroke={p.on} strokeWidth={2} opacity={0.4} />
      )}
    </g>
  );
}

// ── Tank ───────────────────────────────────────────────────────────────
// A rounded vessel with a fill level. "on" state fills 70%, "off" 20%.
function tankSymbol(p: SymbolRenderProps): ReactElement {
  const fillRatio = p.state === "on" ? 0.7 : p.state === "alarm" ? 0.9 : 0.2;
  const liquidColor = stateFill(p);
  const yTop = 14;
  const yBottom = 90;
  const h = yBottom - yTop;
  const liquidH = h * fillRatio;
  const liquidY = yBottom - liquidH;
  return (
    <g>
      {/* tank outline */}
      <rect x={20} y={yTop} width={60} height={h} rx={8} ry={8}
        fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {/* liquid */}
      <rect x={22} y={liquidY} width={56} height={liquidH - 2} rx={6} ry={6}
        fill={liquidColor} opacity={0.85} />
      {/* nozzle */}
      <rect x={48} y={6} width={4} height={10} fill="#cbd5e1" />
    </g>
  );
}

// ── Fan ────────────────────────────────────────────────────────────────
// Three-blade fan inside a square frame. The CSS spin animation kicks in
// when state === "on" (rotor turns), idle otherwise.
function fanSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const spinning = p.state === "on";
  return (
    <g>
      {/* frame */}
      <rect x={6} y={6} width={88} height={88} rx={8} ry={8}
        fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {/* hub + blades */}
      <g style={spinning ? {
        transformOrigin: "50px 50px",
        animation: "sws-fan-spin 1.5s linear infinite",
      } : { transformOrigin: "50px 50px" }}>
        <circle cx={50} cy={50} r={6} fill={c} />
        {[0, 120, 240].map((deg) => (
          <path key={deg}
            d="M50 50 Q50 22 60 18 Q66 28 56 48 Z"
            fill={c}
            transform={`rotate(${deg} 50 50)`} />
        ))}
      </g>
    </g>
  );
}

export const SYMBOLS: Record<SymbolId, SymbolMeta> = {
  pump:  { id: "pump",  label: "Pompa",      defaultWidth: 80, defaultHeight: 80, render: pumpSymbol },
  valve: { id: "valve", label: "Valvola",    defaultWidth: 80, defaultHeight: 80, render: valveSymbol },
  motor: { id: "motor", label: "Motore",     defaultWidth: 80, defaultHeight: 80, render: motorSymbol },
  tank:  { id: "tank",  label: "Serbatoio",  defaultWidth: 70, defaultHeight: 100, render: tankSymbol },
  fan:   { id: "fan",   label: "Ventola",    defaultWidth: 80, defaultHeight: 80, render: fanSymbol },
};

export const SYMBOL_LIST: SymbolMeta[] = Object.values(SYMBOLS);
