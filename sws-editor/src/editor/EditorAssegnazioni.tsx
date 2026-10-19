// Le assegnazioni di un bottone (11-10-2026, piano
// docs/archive/2026-10-11-colore-e-assegnazioni.md): «variabile = valore», una
// riga per variabile, eseguite in ordine al clic.
//
// Il campo del valore segue il **tipo** della variabile scelta: selettore di
// colore per un `color`, vero/falso per un `bool`, numero per interi e reali,
// testo per il resto. Così chi assegna `sfondo = #7f1d1d` non deve ricordarsi
// il formato, e un valore sbagliato non nasce nemmeno.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import { tagCatalog } from "@/tagCatalog";
import { categoriaDi, normalizzaColore } from "@/tag/tipiScalari";
import type { Assegnazione } from "@/types";

const INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "4px 6px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 12,
  boxSizing: "border-box",
  minWidth: 0,
};

/** Il valore di partenza di una riga, secondo il tipo della variabile. */
export function valoreIniziale(categoria: string | undefined): Assegnazione["valore"] {
  switch (categoria) {
    case "colore": return "#000000";
    case "bool": return true;
    case "intero": case "reale": case "tempo": return 0;
    default: return "";
  }
}

export function EditorAssegnazioni({ value, onChange }: {
  value: Assegnazione[] | undefined;
  onChange: (next: Assegnazione[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const tipi = useMemo(() => new Map(tagCatalog(project).map((e) => [e.id, e.tipo])), [project]);
  const righe = value ?? [];

  const scrivi = (next: Assegnazione[]) => onChange(next.length ? next : undefined);
  const cambia = (i: number, parz: Partial<Assegnazione>) =>
    scrivi(righe.map((r, j) => (j === i ? { ...r, ...parz } : r)));

  return (
    <div data-testid="editor-assegnazioni" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {righe.map((r, i) => {
        const categoria = categoriaDi(tipi.get(r.tag));
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 4, alignItems: "center" }}>
            <TagInput style={INPUT} placeholder={t("props.assegnaVariabile")} value={r.tag}
              onChange={(tag) => {
                // Cambiando variabile il valore si riporta al tipo nuovo, se quello
                // vecchio non gli va bene (un colore su un bool non ha senso).
                const cat = categoriaDi(tipi.get(tag));
                const ok = cat === "colore" ? typeof r.valore === "string" && !!normalizzaColore(r.valore)
                  : cat === "bool" ? typeof r.valore === "boolean"
                  : cat === "intero" || cat === "reale" || cat === "tempo" ? typeof r.valore === "number"
                  : true;
                cambia(i, { tag, valore: ok ? r.valore : valoreIniziale(cat) });
              }} />
            <CampoValore categoria={categoria} valore={r.valore} onChange={(valore) => cambia(i, { valore })} />
            <button type="button" title={t("props.assegnaTogli")} onClick={() => scrivi(righe.filter((_, j) => j !== i))}
              style={{ ...INPUT, cursor: "pointer", padding: "4px 8px" }}>✕</button>
          </div>
        );
      })}
      <div>
        <button type="button" onClick={() => scrivi([...righe, { tag: "", valore: "" }])}
          style={{ ...INPUT, cursor: "pointer", padding: "4px 10px" }}>+ {t("props.assegnaAggiungi")}</button>
      </div>
      {righe.length > 0 && (
        <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", lineHeight: 1.4 }}>
          {t("props.assegnaNota")}
        </span>
      )}
    </div>
  );
}

function CampoValore({ categoria, valore, onChange }: {
  categoria: string | undefined;
  valore: Assegnazione["valore"];
  onChange: (v: Assegnazione["valore"]) => void;
}) {
  if (categoria === "colore") {
    const c = normalizzaColore(String(valore)) ?? "#000000";
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
        {/* `<input type="color">` vuole #rrggbb: la trasparenza si scrive nel testo. */}
        <input type="color" value={c.slice(0, 7)} onChange={(e) => onChange(e.target.value + c.slice(7))}
          style={{ width: 28, height: 24, padding: 0, border: "none", background: "transparent", cursor: "pointer" }} />
        <input style={{ ...INPUT, flex: 1, fontFamily: "ui-monospace, monospace" }} value={String(valore)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => { const n = normalizzaColore(e.target.value); if (n) onChange(n); }} />
      </div>
    );
  }
  if (categoria === "bool") {
    return (
      <select style={{ ...INPUT, cursor: "pointer" }} value={String(valore === true)}
        onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (categoria === "intero" || categoria === "reale" || categoria === "tempo") {
    return (
      <input type="number" style={INPUT} value={typeof valore === "number" ? valore : Number(valore) || 0}
        step={categoria === "reale" ? "any" : 1}
        onChange={(e) => onChange(Number(e.target.value))} />
    );
  }
  return <input style={INPUT} value={String(valore)} onChange={(e) => onChange(e.target.value)} />;
}
