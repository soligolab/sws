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

  // ── Vendored (SVG files under /public/symbols/, served at /symbols/) ──
  // The renderer in SvgCanvas pulls these via <image href={path}> and overlays
  // a coloured status badge for the bound tag. See public/symbols/ATTRIBUTION.md
  // for the license / source per file.
  heat_exchanger:     { id: "heat_exchanger",     label: "Scambiatore",       kind: "vendored", path: "/symbols/heat_exchanger.svg",         defaultWidth: 100, defaultHeight: 80  },
  separator:          { id: "separator",          label: "Separatore",        kind: "vendored", path: "/symbols/separator.svg",               defaultWidth: 70,  defaultHeight: 100 },
  reactor:            { id: "reactor",            label: "Reattore",          kind: "vendored", path: "/symbols/reactor.svg",                 defaultWidth: 80,  defaultHeight: 100 },
  filter:             { id: "filter",             label: "Filtro",            kind: "vendored", path: "/symbols/filter.svg",                  defaultWidth: 80,  defaultHeight: 100 },
  solar_panel:        { id: "solar_panel",        label: "Pannello solare",   kind: "vendored", path: "/symbols/solar-panel.svg",             defaultWidth: 100, defaultHeight: 70  },
  battery:            { id: "battery",            label: "Batteria",          kind: "vendored", path: "/symbols/battery-charging-high.svg",   defaultWidth: 60,  defaultHeight: 90  },
  transmission_tower: { id: "transmission_tower", label: "Traliccio",         kind: "vendored", path: "/symbols/transmission-tower.svg",      defaultWidth: 70,  defaultHeight: 100 },
  home_lightning:     { id: "home_lightning",     label: "Casa energia",      kind: "vendored", path: "/symbols/home-lightning-bolt.svg",     defaultWidth: 80,  defaultHeight: 80  },
  garage:             { id: "garage",             label: "Garage",            kind: "vendored", path: "/symbols/garage-open-variant.svg",     defaultWidth: 90,  defaultHeight: 70  },
  window_open:        { id: "window_open",        label: "Finestra",          kind: "vendored", path: "/symbols/window-open-variant.svg",     defaultWidth: 80,  defaultHeight: 70  },
  roller_shade:       { id: "roller_shade",       label: "Tapparella",        kind: "vendored", path: "/symbols/roller-shade.svg",            defaultWidth: 60,  defaultHeight: 90  },
};

export const SYMBOL_LIST: SymbolMeta[] = Object.values(SYMBOLS);
