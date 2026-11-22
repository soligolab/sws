// The preview of a symbol in the company's library (22-11-2026: the rows had
// only «◆», while the project's symbols showed their drawing). The library
// keeps descriptions, not drawings: each is compiled once per version, with
// the same route the project's symbols go through, and its photos come from
// the library, since the project doesn't have them until the symbol is copied.
import { useEffect, useState } from "react";
import { api, type LibraryEntry } from "@/api/client";
import { useManifestoLib } from "@/symbols/lib/libreria";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import type { SimboloLib } from "@/symbols/lib/manifest";

type Compiled = { svg: string; voce: SimboloLib } | null;
const cache = new Map<string, Promise<Compiled>>();

function compiled(entry: LibraryEntry): Promise<Compiled> {
  const key = `${entry.slug}@${entry.version}`;
  let p = cache.get(key);
  if (!p) {
    p = api.compilaSimboli([entry.symbol])
      .then((r) => (r[0]?.svg && r[0]?.voce ? { svg: r[0].svg, voce: r[0].voce } : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function AnteprimaLibreria({ entry, company, w, h }: { entry: LibraryEntry; company: string; w: number; h: number }) {
  const manifesto = useManifestoLib();
  const [c, setC] = useState<Compiled>(null);
  useEffect(() => {
    let alive = true;
    void compiled(entry).then((x) => { if (alive) setC(x); });
    return () => { alive = false; };
  }, [entry]);
  const base = `/api/library/${encodeURIComponent(company)}/symbols/${encodeURIComponent(entry.slug)}/images/`;
  if (!manifesto || !c) {
    return <span style={{ width: w, textAlign: "center", flexShrink: 0 }}>{entry.symbol.overrides ? "◇" : "◆"}</span>;
  }
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ flexShrink: 0, display: "block" }} data-testid={`anteprima-libreria-${entry.slug}`}>
      <SimboloLibSvg sim={c.voce} svg={c.svg} manifesto={manifesto} prefisso={`libreria-${entry.slug}`}
        x={0} y={0} w={w} h={h} valori={{ corpo: null, livello: 0.6, gira: false, periodoS: 2 }}
        photoAt={(n) => base + encodeURIComponent(n)} />
    </svg>
  );
}
