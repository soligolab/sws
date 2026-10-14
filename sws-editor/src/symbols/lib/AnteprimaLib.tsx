// L'anteprima di un simbolo di libreria, col disegno com'è (rotore fermo,
// livello a metà). La usano il riquadro di scelta e il ramo «Simboli» di
// Strumenti (14-10-2026), dove fa da icona alla riga.
import { svgLibCaricato, useManifestoLib } from "@/symbols/lib/libreria";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import type { SimboloLib } from "@/symbols/lib/manifest";

export function AnteprimaLib({ sim, w = 40, h = 38 }: { sim: SimboloLib; w?: number; h?: number }) {
  const manifesto = useManifestoLib();
  const svg = svgLibCaricato(sim);
  if (!manifesto || !svg) return <svg width={w} height={h} aria-hidden="true" />;
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <SimboloLibSvg sim={sim} svg={svg} manifesto={manifesto} prefisso={`anteprima-${w}-${sim.id.replace(/[^\w-]/g, "_")}`}
        x={0} y={0} w={w} h={h} valori={{ corpo: null, livello: 0.6, gira: false, periodoS: 2 }} />
    </svg>
  );
}
