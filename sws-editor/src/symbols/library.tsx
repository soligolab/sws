// Built-in SCADA symbol library. Each entry produces an SVG fragment to
// render inside the synoptic canvas. Symbols are drawn in a 100×100
// design space and scaled via the object's width/height; the renderer
// transforms the group accordingly.
//
// Each render() takes the resolved state ("off" | "on" | "alarm") and
// the resolved colours, returning JSX. Keeping these pure JSX (no DOM
// outside React) lets SvgCanvas treat them like any other primitive.
import type { ReactElement } from "react";
import type { SymbolId, SymbolKind } from "@/types";

export type SymbolState = "off" | "on" | "alarm";

export interface SymbolRenderProps {
  state: SymbolState;
  /** "off" colour — also used as outline when the body fill is something else. */
  off:   string;
  /** "on" / running colour. */
  on:    string;
  /** Alarm colour (red by default). */
  alarm: string;
  /** F6.7: livello continuo 0..1 (tank e simboli "a livello"). Quando
   *  presente sostituisce il riempimento fisso derivato dallo stato. */
  level?: number;
}

/**
 * Library entry. Two flavours:
 * - `kind: "builtin"` carries a `render(props) → JSX` that paints inside
 *   a 100×100 viewBox. The renderer uses state colours directly.
 * - `kind: "vendored"` carries a `path` under /symbols/. The canvas
 *   loads it via `<image href>` and overlays a coloured state badge top-right.
 */
export interface SymbolMeta {
  id: SymbolId;
  label: string;
  kind: SymbolKind;
  /** Default natural size for the design space (px). Used when adding
   *  a fresh symbol to the canvas. */
  defaultWidth:  number;
  defaultHeight: number;
  /** Required when kind === "builtin". */
  render?: (p: SymbolRenderProps) => ReactElement;
  /** Required when kind === "vendored". Served from /symbols/<file>.svg. */
  path?: string;
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
  // F6.7: livello reale dal tag quando fornito; altrimenti il vecchio
  // riempimento fisso per stato (70% on / 20% off / 90% alarm).
  const fillRatio = p.level !== undefined
    ? Math.min(1, Math.max(0, p.level))
    : p.state === "on" ? 0.7 : p.state === "alarm" ? 0.9 : 0.2;
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

// ── Compressor ─────────────────────────────────────────────────────────
// Triangle wedge + circular discharge nozzle on the right. ISA-5.1-ish.
function compressorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M10 22 L80 50 L10 78 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <circle cx={84} cy={50} r={10} fill={c} stroke="#0f172a" strokeWidth={2} />
      {p.state === "on" && (
        <circle cx={84} cy={50} r={14} fill="none" stroke={p.on} strokeWidth={2} opacity={0.4} />
      )}
    </g>
  );
}

// ── Level sensor ───────────────────────────────────────────────────────
// Vertical rod inside a tank silhouette with a "LT" tag.
function levelSensorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* tank outline (transparent body so the rod reads cleanly) */}
      <rect x={28} y={12} width={44} height={76} rx={6}
        fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {/* rod */}
      <line x1={50} y1={14} x2={50} y2={84} stroke={c} strokeWidth={4} />
      {/* float */}
      <circle cx={50} cy={p.state === "on" ? 32 : p.state === "alarm" ? 20 : 68}
        r={6} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* tag balloon */}
      <circle cx={78} cy={20} r={12} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.5} />
      <text x={78} y={24} textAnchor="middle" fontSize={11} fontWeight={700}
        fill="#cbd5e1" fontFamily="system-ui, sans-serif">LT</text>
    </g>
  );
}

// ── Flow meter ─────────────────────────────────────────────────────────
// Inline circle with a chevron pointing right, "FT" tag bubble on top.
function flowMeterSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* pipe stubs */}
      <line x1={4}  y1={50} x2={28} y2={50} stroke="#cbd5e1" strokeWidth={4} />
      <line x1={72} y1={50} x2={96} y2={50} stroke="#cbd5e1" strokeWidth={4} />
      {/* meter body */}
      <circle cx={50} cy={50} r={22} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* arrow inside */}
      <path d="M38 50 L60 50 M52 42 L60 50 L52 58" fill="none"
        stroke="#0f172a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {/* tag bubble */}
      <circle cx={50} cy={18} r={12} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.5} />
      <text x={50} y={22} textAnchor="middle" fontSize={11} fontWeight={700}
        fill="#cbd5e1" fontFamily="system-ui, sans-serif">FT</text>
    </g>
  );
}

// ── Pressure indicator ─────────────────────────────────────────────────
// Gauge dial with a needle that swings with state.
function pressureIndicatorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  // Needle angle: -110° at "off", 0° at "on", +110° at "alarm".
  const needleDeg = p.state === "alarm" ? 70 : p.state === "on" ? 0 : -70;
  return (
    <g>
      {/* outer rim */}
      <circle cx={50} cy={50} r={40} fill="#1e293b" stroke={c} strokeWidth={3} />
      {/* scale tick marks */}
      {[-90, -45, 0, 45, 90].map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r1 = 32, r2 = 38;
        return (
          <line key={deg}
            x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)}
            x2={50 + r2 * Math.sin(a)} y2={50 - r2 * Math.cos(a)}
            stroke="#cbd5e1" strokeWidth={2} />
        );
      })}
      {/* needle */}
      <line x1={50} y1={50} x2={50} y2={18} stroke={c} strokeWidth={3}
        strokeLinecap="round" transform={`rotate(${needleDeg} 50 50)`} />
      <circle cx={50} cy={50} r={4} fill={c} />
      {/* PI label */}
      <text x={50} y={84} textAnchor="middle" fontSize={11} fontWeight={700}
        fill="#cbd5e1" fontFamily="system-ui, sans-serif">PI</text>
    </g>
  );
}

// ── Breaker ────────────────────────────────────────────────────────────
// Two stubs + a tilted contact arm. Open (off) vs closed (on).
function breakerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const closed = p.state === "on";
  return (
    <g>
      {/* terminals */}
      <circle cx={18} cy={50} r={6} fill="#0f172a" stroke={c} strokeWidth={3} />
      <circle cx={82} cy={50} r={6} fill="#0f172a" stroke={c} strokeWidth={3} />
      {/* contact arm */}
      <line x1={18} y1={50} x2={closed ? 82 : 70} y2={closed ? 50 : 18}
        stroke={c} strokeWidth={4} strokeLinecap="round" />
      {/* fixed stub */}
      <line x1={82} y1={50} x2={70} y2={50} stroke={c} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

// ── Heat exchanger (basic) — already vendored, JSX variant not needed ──

// ── Heat pump ──────────────────────────────────────────────────────────
// Two coil sections (hot / cold) with a compressor circle in between.
function heatPumpSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* hot coil (top) */}
      <path d="M18 18 Q28 8 38 18 Q48 28 58 18 Q68 8 82 18" fill="none" stroke={c} strokeWidth={3} strokeLinecap="round" />
      <path d="M18 28 Q28 18 38 28 Q48 38 58 28 Q68 18 82 28" fill="none" stroke={c} strokeWidth={3} strokeLinecap="round" />
      {/* compressor */}
      <circle cx={50} cy={50} r={13} fill={c} stroke="#0f172a" strokeWidth={2} />
      <text x={50} y={55} textAnchor="middle" fontSize={9} fontWeight={700}
        fill="#0f172a" fontFamily="system-ui, sans-serif">CMP</text>
      {/* cold coil (bottom) */}
      <path d="M18 72 Q28 62 38 72 Q48 82 58 72 Q68 62 82 72" fill="none" stroke="#64748b" strokeWidth={3} strokeLinecap="round" />
      <path d="M18 82 Q28 72 38 82 Q48 92 58 82 Q68 72 82 82" fill="none" stroke="#64748b" strokeWidth={3} strokeLinecap="round" />
      {/* side connections */}
      <line x1={18} y1={28} x2={18} y2={72} stroke={c} strokeWidth={2} />
      <line x1={82} y1={28} x2={82} y2={72} stroke="#64748b" strokeWidth={2} />
    </g>
  );
}

// ── Temperature sensor ──────────────────────────────────────────────────
// Circular body with an inline thermometer + "TT" tag bubble.
function temperatureSensorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const fillH = p.state === "alarm" ? 34 : p.state === "on" ? 22 : 10;
  return (
    <g>
      {/* mounting pipe stub */}
      <line x1={50} y1={4} x2={50} y2={24} stroke="#cbd5e1" strokeWidth={4} />
      {/* sensor body */}
      <circle cx={50} cy={50} r={24} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* thermometer shaft */}
      <rect x={46} y={32} width={8} height={26} rx={4} fill="#0f172a" opacity={0.5} />
      {/* mercury fill */}
      <rect x={47} y={58 - fillH} width={6} height={fillH} rx={3} fill="#0f172a" />
      {/* bulb */}
      <circle cx={50} cy={64} r={7} fill="#0f172a" opacity={0.6} />
      {/* TT tag bubble */}
      <circle cx={50} cy={88} r={10} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.5} />
      <text x={50} y={92} textAnchor="middle" fontSize={10} fontWeight={700}
        fill="#cbd5e1" fontFamily="system-ui, sans-serif">TT</text>
    </g>
  );
}

// ── Boiler ─────────────────────────────────────────────────────────────
// Cylindrical vessel with a flame at the bottom.
function boilerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* steam outlet */}
      <rect x={46} y={2} width={8} height={12} fill="#cbd5e1" />
      {/* vessel body */}
      <rect x={22} y={12} width={56} height={58} rx={8} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* water level */}
      <rect x={23} y={48} width={54} height={21} rx={6} fill="#0f172a" />
      {/* flame */}
      <path d="M34 90 Q32 80 38 76 Q36 84 42 80 Q40 88 50 82 Q48 90 56 86 Q54 94 62 90 Q58 96 50 94 Q40 98 34 90 Z"
        fill={c} />
      {/* burner base */}
      <rect x={24} y={70} width={52} height={6} rx={2} fill="#475569" />
    </g>
  );
}

// ── Agitator ───────────────────────────────────────────────────────────
// Vessel with a side-entering shaft + cross impeller. Spins when on.
function agitatorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const spinning = p.state === "on";
  return (
    <g>
      {/* vessel */}
      <rect x={30} y={8} width={58} height={84} rx={6} fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {/* drive motor (left side) */}
      <rect x={4} y={40} width={20} height={20} rx={4} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* shaft */}
      <line x1={24} y1={50} x2={58} y2={50} stroke="#cbd5e1" strokeWidth={3} />
      {/* impeller (cross blades, spins when on) */}
      <g style={spinning ? {
        transformOrigin: "58px 50px",
        animation: "sws-fan-spin 2s linear infinite",
      } : { transformOrigin: "58px 50px" }}>
        <line x1={58} y1={32} x2={58} y2={68} stroke={c} strokeWidth={4} strokeLinecap="round" />
        <line x1={40} y1={50} x2={76} y2={50} stroke={c} strokeWidth={4} strokeLinecap="round" />
      </g>
    </g>
  );
}

// ── Cooling tower ──────────────────────────────────────────────────────
// Hyperbolic outline (approximated), fan at top, water drops.
function coolingTowerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* tower body (narrow at top, wider at base) */}
      <path d="M18 92 L28 16 L72 16 L82 92 Z" fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* fill packing lines */}
      <line x1={32} y1={50} x2={68} y2={50} stroke="#334155" strokeWidth={1.5} />
      <line x1={30} y1={62} x2={70} y2={62} stroke="#334155" strokeWidth={1.5} />
      <line x1={28} y1={74} x2={72} y2={74} stroke="#334155" strokeWidth={1.5} />
      {/* fan disk at top */}
      <ellipse cx={50} cy={16} rx={22} ry={5} fill="#0f172a" stroke={c} strokeWidth={2} />
      {/* fan cross */}
      <line x1={36} y1={16} x2={64} y2={16} stroke={c} strokeWidth={2} />
      <line x1={50} y1={8} x2={50} y2={24} stroke={c} strokeWidth={2} />
      {/* water drops at base */}
      {[38, 50, 62].map((x) => (
        <ellipse key={x} cx={x} cy={84} rx={2.5} ry={3.5} fill={c} opacity={0.7} />
      ))}
      {p.state === "on" && (
        <>
          <path d="M40 6 L38 0" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
          <path d="M50 4 L50 -2" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
          <path d="M60 6 L62 0" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

// ── Mixer ──────────────────────────────────────────────────────────────
// Vessel with an agitator shaft + impeller. Spins when on.
function mixerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const spinning = p.state === "on";
  return (
    <g>
      {/* vessel */}
      <rect x={20} y={14} width={60} height={76} rx={6}
        fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {/* drive motor */}
      <rect x={42} y={4} width={16} height={12} fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* shaft */}
      <line x1={50} y1={16} x2={50} y2={70} stroke="#cbd5e1" strokeWidth={3} />
      {/* impeller blades */}
      <g style={spinning ? {
        transformOrigin: "50px 70px",
        animation: "sws-fan-spin 2s linear infinite",
      } : { transformOrigin: "50px 70px" }}>
        <line x1={30} y1={70} x2={70} y2={70} stroke={c} strokeWidth={4} strokeLinecap="round" />
        <line x1={50} y1={62} x2={50} y2={78} stroke={c} strokeWidth={4} strokeLinecap="round" />
      </g>
    </g>
  );
}

// ── F6.8: libreria ISA ampliata ─────────────────────────────────────────────
// Simboli industriali aggiuntivi, colorabili per stato come i builtin storici.
// Convenzione invariata: viewBox 0 0 100 100, corpo colorato con stateFill(p),
// tratti di contorno #0f172a.

function valveMotorizedSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M10 40 L50 58 L10 76 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M90 40 L50 58 L90 76 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={47} y={26} width={6} height={20} fill="#0f172a" />
      <rect x={34} y={6} width={32} height={22} rx={3} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <text x={50} y={22} textAnchor="middle" fontSize={14} fontWeight={700} fill="#cbd5e1">M</text>
    </g>
  );
}

function valvePneumaticSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M10 44 L50 62 L10 80 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M90 44 L50 62 L90 80 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={47} y={30} width={6} height={16} fill="#0f172a" />
      {/* membrana */}
      <path d="M26 30 A24 16 0 0 1 74 30 Z" fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
    </g>
  );
}

function checkValveSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M14 30 L74 50 L14 70 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <line x1={78} y1={26} x2={78} y2={74} stroke="#0f172a" strokeWidth={6} />
      <line x1={4} y1={50} x2={14} y2={50} stroke="#0f172a" strokeWidth={4} />
      <line x1={78} y1={50} x2={96} y2={50} stroke="#0f172a" strokeWidth={4} />
    </g>
  );
}

function valve3WaySymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M10 34 L50 54 L10 74 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M90 34 L50 54 L90 74 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M30 94 L50 54 L70 94 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={46} y={10} width={8} height={24} fill="#0f172a" />
      <ellipse cx={50} cy={12} rx={16} ry={5} fill="none" stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

function reliefValveSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M22 52 L78 52 L50 92 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      {/* molla */}
      <path d="M38 46 L62 40 M38 38 L62 32 M38 30 L62 24 M38 22 L62 16" stroke="#cbd5e1" strokeWidth={3} fill="none" />
      <line x1={50} y1={92} x2={50} y2={98} stroke="#0f172a" strokeWidth={4} />
    </g>
  );
}

function strainerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <line x1={4} y1={40} x2={96} y2={40} stroke="#0f172a" strokeWidth={6} />
      <path d="M35 40 L65 40 L50 86 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M42 48 L58 48 M45 58 L55 58 M47 68 L53 68" stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

function blowerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <circle cx={44} cy={56} r={34} fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={70} y={16} width={26} height={18} fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M44 56 L70 25" stroke="#0f172a" strokeWidth={3} fill="none" />
      <circle cx={44} cy={56} r={6} fill="#0f172a" />
    </g>
  );
}

function siloSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  const level = p.level !== undefined ? Math.min(1, Math.max(0, p.level)) : undefined;
  const topY = 12, wallBottom = 62;
  return (
    <g>
      <path d="M24 12 L76 12 L76 62 L50 92 L24 62 Z" fill="#0f172a" stroke="#cbd5e1" strokeWidth={2} />
      {level !== undefined && level > 0 && (() => {
        // riempimento dal basso: prima il cono (62→92), poi le pareti (12→62)
        const total = 80; const filled = total * level;
        const coneH = 30;
        if (filled <= coneH) {
          const y = 92 - filled;
          const half = 26 * (filled / coneH);
          return <path d={`M${50 - half} ${y} L${50 + half} ${y} L50 92 Z`} fill={c} opacity={0.85} />;
        }
        const y = wallBottom - (filled - coneH);
        return <path d={`M24 ${Math.max(topY, y)} L76 ${Math.max(topY, y)} L76 62 L50 92 L24 62 Z`} fill={c} opacity={0.85} />;
      })()}
      <rect x={44} y={4} width={12} height={8} fill="#cbd5e1" />
    </g>
  );
}

function conveyorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <circle cx={18} cy={60} r={12} fill={c} stroke="#0f172a" strokeWidth={2} />
      <circle cx={82} cy={60} r={12} fill={c} stroke="#0f172a" strokeWidth={2} />
      <line x1={18} y1={48} x2={82} y2={48} stroke="#0f172a" strokeWidth={3} />
      <line x1={18} y1={72} x2={82} y2={72} stroke="#0f172a" strokeWidth={3} />
      <rect x={38} y={30} width={24} height={16} fill="#94a3b8" stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

function cycloneSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={30} y={12} width={40} height={22} fill={c} stroke="#0f172a" strokeWidth={2} />
      <path d="M30 34 L70 34 L54 88 L46 88 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={44} y={88} width={12} height={8} fill="#0f172a" />
      <rect x={6} y={14} width={24} height={10} fill={c} stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

function columnSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={34} y={8} width={32} height={84} rx={14} fill={c} stroke="#0f172a" strokeWidth={2} />
      <line x1={36} y1={30} x2={64} y2={30} stroke="#0f172a" strokeWidth={2} />
      <line x1={36} y1={48} x2={64} y2={48} stroke="#0f172a" strokeWidth={2} />
      <line x1={36} y1={66} x2={64} y2={66} stroke="#0f172a" strokeWidth={2} />
    </g>
  );
}

function furnaceSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={14} y={26} width={72} height={62} rx={4} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <path d="M50 76 C36 66 42 52 50 42 C50 54 60 54 58 44 C66 54 64 68 50 76 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <rect x={40} y={10} width={20} height={16} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
    </g>
  );
}

function chillerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={12} y={24} width={76} height={56} rx={6} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* fiocco */}
      <g stroke={c} strokeWidth={4} strokeLinecap="round">
        <line x1={50} y1={34} x2={50} y2={70} />
        <line x1={34} y1={43} x2={66} y2={61} />
        <line x1={34} y1={61} x2={66} y2={43} />
      </g>
    </g>
  );
}

// ── Q40 — quattro "vendored" diventati disegnati ────────────────────────────
// Erano SVG statici (grigi, mai ricolorati per stato, né qui né su LVGL —
// misurato in docs/OPEN_QUESTIONS.md Q40). Coordinate riscalate di peso dal
// viewBox originale (sotto sws-editor/public/symbols/) allo spazio 0..100
// comune a questa libreria — stesso disegno, stessa proporzione, solo un
// elemento colorato per stato invece di tutto grigio fisso.

function reactorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* camicia di riscaldamento */}
      <rect x={5} y={22} width={90} height={68} rx={13} fill="#1e293b" stroke="#94a3b8" strokeWidth={2} />
      {/* vaso interno */}
      <rect x={17.5} y={30} width={65} height={52} rx={7.5} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <path d="M17.5 30 Q50 14 82.5 30" fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* motore */}
      <rect x={42.5} y={2} width={15} height={14} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* albero */}
      <line x1={50} y1={16} x2={50} y2={70} stroke="#cbd5e1" strokeWidth={3} />
      {/* girante — colorata per stato: è la parte in movimento */}
      <g stroke={c} strokeWidth={3} strokeLinecap="round">
        <line x1={27.5} y1={70} x2={72.5} y2={70} />
        <line x1={37.5} y1={62} x2={62.5} y2={78} />
        <line x1={37.5} y1={78} x2={62.5} y2={62} />
      </g>
      {/* bocchelli camicia */}
      <rect x={95} y={32} width={5} height={10} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5} />
      <rect x={95} y={78} width={5} height={10} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5} />
    </g>
  );
}

function heatExchangerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* mantello */}
      <rect x={10} y={25} width={80} height={50} rx={25} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* fascio tubiero — colorato per stato: è il fluido di processo */}
      <g stroke={c} strokeWidth={2.5}>
        <line x1={14} y1={40} x2={86} y2={40} />
        <line x1={14} y1={50} x2={86} y2={50} />
        <line x1={14} y1={60} x2={86} y2={60} />
      </g>
      {/* bocchelli ingresso/uscita */}
      <rect x={2} y={42.5} width={10} height={15} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={88} y={42.5} width={10} height={15} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* bocchelli lato mantello */}
      <rect x={44} y={7.5} width={12} height={20} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={44} y={72.5} width={12} height={20} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
    </g>
  );
}

function filterSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* corpo */}
      <rect x={22.5} y={14} width={55} height={72} rx={7.5} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* mezzo filtrante — colorato per stato invece che tratteggiato
          (nessuna trama disponibile fuori da questo motore) */}
      <rect x={27.5} y={22} width={45} height={56} fill={c} opacity={0.85} />
      {/* ingresso/uscita */}
      <rect x={45} y={2} width={10} height={14} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={45} y={84} width={10} height={14} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* presa manometro differenziale */}
      <circle cx={85} cy={40} r={11.25} fill="#0f172a" stroke="#cbd5e1" strokeWidth={1.5} />
      <text x={85} y={44} textAnchor="middle" fontSize={11} fontWeight={700}
            fill="#cbd5e1" fontFamily="system-ui, sans-serif">DP</text>
    </g>
  );
}

function separatorSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* corpo — colorato per stato per intero, come cyclone/column: qui il
          vaso stesso è "il processo", non un contenitore neutro */}
      <path d="M14.3 14 L85.7 14 L85.7 56 L68.6 96 L31.4 96 L14.3 56 Z"
            fill={c} stroke="#0f172a" strokeWidth={2} strokeLinejoin="round" />
      {/* ingresso tangenziale */}
      <rect x={5.7} y={22} width={20} height={10} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* pescante */}
      <line x1={50} y1={4} x2={50} y2={36} stroke="#cbd5e1" strokeWidth={3} />
      <ellipse cx={50} cy={8} rx={14.3} ry={3} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* scarico di fondo */}
      <rect x={42.9} y={94} width={14.3} height={6} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
    </g>
  );
}

// ── Q40 — sette "vendored" ridisegnati (icone MDI compound) ─────────────────
// Le sette icone qui sotto erano ciascuna un unico `path` SVG compound (con
// buchi/sovrapposizioni via fill-rule) — decomporle in primitive fedeli
// all'originale sarebbe stato lavoro dell'ordine di una settimana da solo
// (misurato). Ridisegnate invece come icone stilizzate semplificate, non una
// copia pixel-perfetta dell'MDI originale: stessa idea riconoscibile, un
// elemento colorato per stato, costruibili con le stesse primitive di tutti
// gli altri builtin di questa libreria.

function solarPanelSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={10} y={10} width={80} height={55} rx={4} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* quattro celle — colorate per stato: è la parte che genera */}
      <rect x={14} y={14} width={32} height={20} fill={c} />
      <rect x={14} y={41} width={32} height={20} fill={c} />
      <rect x={54} y={41} width={32} height={20} fill={c} />
      <rect x={54} y={14} width={32} height={20} fill={c} />
      <rect x={30} y={65} width={14} height={20} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.5} />
      <rect x={56} y={65} width={14} height={20} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.5} />
    </g>
  );
}

function batterySymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={38} y={4} width={24} height={8} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={20} y={12} width={60} height={80} rx={8} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* segmenti di carica — colorati per stato */}
      <rect x={26} y={20} width={48} height={16} fill={c} />
      <rect x={26} y={42} width={48} height={16} fill={c} />
      <rect x={26} y={64} width={48} height={16} fill={c} />
      {/* fulmine di carica */}
      <polyline points="78,20 62,50 74,50 58,85" fill="none" stroke="#cbd5e1" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function transmissionTowerSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      {/* traliccio — colorato per stato per intero */}
      <path d="M50 8 L20 90 L80 90 Z" fill={c} stroke="#0f172a" strokeWidth={2} />
      <line x1={30} y1={35} x2={70} y2={35} stroke="#cbd5e1" strokeWidth={3} />
      <line x1={25} y1={60} x2={75} y2={60} stroke="#cbd5e1" strokeWidth={3} />
    </g>
  );
}

function homeLightningSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M50 8 L10 45 L90 45 Z" fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={20} y={45} width={60} height={45} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={40} y={65} width={20} height={25} fill="#0f172a" />
      {/* fulmine — colorato per stato: l'energia della casa */}
      <polyline points="58,50 45,68 55,68 42,88" fill="none" stroke={c} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function garageSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <path d="M50 10 L8 35 L92 35 Z" fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={8} y={35} width={84} height={55} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* pannelli della basculante — colorati per stato (aperta/chiusa) */}
      <rect x={20} y={46} width={60} height={8} fill={c} />
      <rect x={20} y={58} width={60} height={8} fill={c} />
    </g>
  );
}

function windowOpenSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={10} y={10} width={80} height={80} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      {/* quattro ante — colorate per stato (aperta/chiusa) */}
      <rect x={15} y={15} width={32} height={32} fill={c} />
      <rect x={53} y={15} width={32} height={32} fill={c} />
      <rect x={15} y={53} width={32} height={32} fill={c} />
      <rect x={53} y={53} width={32} height={32} fill={c} />
    </g>
  );
}

function rollerShadeSymbol(p: SymbolRenderProps): ReactElement {
  const c = stateFill(p);
  return (
    <g>
      <rect x={15} y={10} width={70} height={60} rx={6} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
      <rect x={24} y={18} width={52} height={44} fill="#0f172a" />
      {/* lamelle — colorate per stato (tapparella su/giù) */}
      {[26, 34, 42, 50].map((y) => (
        <line key={y} x1={26} y1={y} x2={74} y2={y} stroke={c} strokeWidth={4} />
      ))}
      <rect x={12} y={80} width={76} height={8} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
    </g>
  );
}

export const SYMBOLS: Record<SymbolId, SymbolMeta> = {
  // ── Built-in (hand-rolled JSX) ──
  pump:                 { id: "pump",                 label: "Pompa",              kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: pumpSymbol },
  valve:                { id: "valve",                label: "Valvola",            kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: valveSymbol },
  motor:                { id: "motor",                label: "Motore",             kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: motorSymbol },
  tank:                 { id: "tank",                 label: "Serbatoio",          kind: "builtin", defaultWidth: 70,  defaultHeight: 100, render: tankSymbol },
  fan:                  { id: "fan",                  label: "Ventola",            kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: fanSymbol },
  compressor:           { id: "compressor",           label: "Compressore",        kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: compressorSymbol },
  level_sensor:         { id: "level_sensor",         label: "Sensore livello",    kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: levelSensorSymbol },
  flow_meter:           { id: "flow_meter",           label: "Mis. flusso",        kind: "builtin", defaultWidth: 100, defaultHeight: 80,  render: flowMeterSymbol },
  pressure_indicator:   { id: "pressure_indicator",   label: "Ind. pressione",     kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: pressureIndicatorSymbol },
  breaker:              { id: "breaker",              label: "Interruttore",       kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: breakerSymbol },
  mixer:                { id: "mixer",                label: "Miscelatore",        kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: mixerSymbol },
  heat_pump:            { id: "heat_pump",            label: "Pompa di calore",    kind: "builtin", defaultWidth: 90,  defaultHeight: 100, render: heatPumpSymbol },
  temperature_sensor:   { id: "temperature_sensor",   label: "Sensore temp.",      kind: "builtin", defaultWidth: 70,  defaultHeight: 90,  render: temperatureSensorSymbol },
  boiler:               { id: "boiler",               label: "Caldaia",            kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: boilerSymbol },
  agitator:             { id: "agitator",             label: "Agitatore",          kind: "builtin", defaultWidth: 90,  defaultHeight: 90,  render: agitatorSymbol },
  cooling_tower:        { id: "cooling_tower",        label: "Torre raffreddamento", kind: "builtin", defaultWidth: 80, defaultHeight: 100, render: coolingTowerSymbol },
  // F6.8 — set ISA ampliato
  valve_motorized:      { id: "valve_motorized",      label: "Valvola motorizzata", kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: valveMotorizedSymbol },
  valve_pneumatic:      { id: "valve_pneumatic",      label: "Valvola pneumatica",  kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: valvePneumaticSymbol },
  check_valve:          { id: "check_valve",          label: "Valvola di ritegno",  kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: checkValveSymbol },
  valve_3way:           { id: "valve_3way",           label: "Valvola a 3 vie",     kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: valve3WaySymbol },
  relief_valve:         { id: "relief_valve",         label: "Valvola di sicurezza", kind: "builtin", defaultWidth: 80, defaultHeight: 80,  render: reliefValveSymbol },
  strainer:             { id: "strainer",             label: "Filtro Y",            kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: strainerSymbol },
  blower:               { id: "blower",               label: "Soffiante",           kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: blowerSymbol },
  silo:                 { id: "silo",                 label: "Silo",                kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: siloSymbol },
  conveyor:             { id: "conveyor",             label: "Nastro trasportatore", kind: "builtin", defaultWidth: 100, defaultHeight: 70, render: conveyorSymbol },
  cyclone:              { id: "cyclone",              label: "Ciclone",             kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: cycloneSymbol },
  column:               { id: "column",               label: "Colonna di processo", kind: "builtin", defaultWidth: 70,  defaultHeight: 100, render: columnSymbol },
  furnace:              { id: "furnace",              label: "Forno",               kind: "builtin", defaultWidth: 90,  defaultHeight: 90,  render: furnaceSymbol },
  chiller:              { id: "chiller",              label: "Chiller",             kind: "builtin", defaultWidth: 90,  defaultHeight: 80,  render: chillerSymbol },
  // Q40 — questi 4 erano "vendored" (SVG statico, sotto) fino al 13-09-2026:
  // misurato che `state_on_color` non aveva alcun effetto su di loro, né qui
  // né su LVGL. Ridisegnati come JSX (un elemento a testa colorato per
  // stato), stesso viewBox 0..100 degli altri builtin.
  heat_exchanger:       { id: "heat_exchanger",       label: "Scambiatore",         kind: "builtin", defaultWidth: 100, defaultHeight: 80,  render: heatExchangerSymbol },
  separator:            { id: "separator",            label: "Separatore",          kind: "builtin", defaultWidth: 70,  defaultHeight: 100, render: separatorSymbol },
  reactor:              { id: "reactor",              label: "Reattore",            kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: reactorSymbol },
  filter:               { id: "filter",               label: "Filtro",              kind: "builtin", defaultWidth: 80,  defaultHeight: 100, render: filterSymbol },
  // Q40 (13-09-2026) — questi sette erano "vendored" (icone MDI, sotto
  // ATTRIBUTION.md per la provenienza originale ormai storica): ridisegnate
  // come icone stilizzate, non più le stesse SVG esatte, per poter colorare
  // per stato.
  solar_panel:          { id: "solar_panel",          label: "Pannello solare",     kind: "builtin", defaultWidth: 100, defaultHeight: 70,  render: solarPanelSymbol },
  battery:              { id: "battery",              label: "Batteria",            kind: "builtin", defaultWidth: 60,  defaultHeight: 90,  render: batterySymbol },
  transmission_tower:   { id: "transmission_tower",   label: "Traliccio",           kind: "builtin", defaultWidth: 70,  defaultHeight: 100, render: transmissionTowerSymbol },
  home_lightning:       { id: "home_lightning",       label: "Casa energia",        kind: "builtin", defaultWidth: 80,  defaultHeight: 80,  render: homeLightningSymbol },
  garage:               { id: "garage",               label: "Garage",              kind: "builtin", defaultWidth: 90,  defaultHeight: 70,  render: garageSymbol },
  window_open:          { id: "window_open",          label: "Finestra",            kind: "builtin", defaultWidth: 80,  defaultHeight: 70,  render: windowOpenSymbol },
  roller_shade:         { id: "roller_shade",         label: "Tapparella",          kind: "builtin", defaultWidth: 60,  defaultHeight: 90,  render: rollerShadeSymbol },
};

export const SYMBOL_LIST: SymbolMeta[] = Object.values(SYMBOLS);
