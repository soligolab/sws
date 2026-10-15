// Un capo della tubazione nel pannello proprietà (15-10-2026, piano
// docs/plans/2026-10-15-tubazioni-bocche-e-stili.md): l'oggetto della pagina a
// cui si aggancia e la sua bocca, scelti da un menu. Prima si scriveva l'id a
// mano in un campo di testo, e le porte erano solo i cinque punti del riquadro.

import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { bocchePer } from "@/canvas/tubazioni";
import { useManifestoLib } from "@/symbols/lib/libreria";
import type { SynopticObject } from "@/types";

const LATI = ["center", "top", "bottom", "left", "right"] as const;
const ETICHETTA_LATO: Record<string, string> = {
  center: "props.center", top: "props.above", bottom: "props.below", left: "props.left", right: "props.right",
};

export function CapoTubo({ obj, capo, onChange, stile }: {
  obj: SynopticObject;
  capo: "from" | "to";
  onChange: (patch: Partial<SynopticObject>) => void;
  stile: React.CSSProperties;
}) {
  const { t } = useTranslation();
  useManifestoLib();
  const oggetti = useAppStore((s) => s.pages.find((p) => p.id === s.currentPageId)?.objects ?? []);
  const idCampo = capo === "from" ? "from_obj_id" : "to_obj_id";
  const portaCampo = capo === "from" ? "from_port" : "to_port";
  const scelto = obj[idCampo];
  const bersaglio = oggetti.find((o) => o.id === scelto);
  const bocche = bersaglio ? bocchePer(bersaglio)?.porte ?? [] : [];
  // Un id che non è (più) sulla pagina resta nel menu, invece di sparire in silenzio.
  const nome = (o: SynopticObject) => (o.name ? `${o.name} (${o.id})` : `${o.id} · ${o.type}`);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select data-testid={`capo-${capo}-obj`} style={{ ...stile, cursor: "pointer" }} value={scelto ?? ""}
        onChange={(e) => {
          const id = e.target.value || undefined;
          const nuovo = oggetti.find((o) => o.id === id);
          // Su un simbolo con bocche si parte dalla prima: è quasi sempre quella che si vuole.
          const prima = nuovo ? bocchePer(nuovo)?.porte[0]?.id : undefined;
          onChange({ [idCampo]: id, [portaCampo]: id ? (prima ?? "center") : undefined } as Partial<SynopticObject>);
        }}>
        <option value="">{t("props.capoLibero")}</option>
        {oggetti.filter((o) => o.id !== obj.id && o.type !== "pipe").map((o) => (
          <option key={o.id} value={o.id}>{nome(o)}</option>
        ))}
        {scelto && !bersaglio && <option value={scelto}>{scelto} — {t("props.capoMancante")}</option>}
      </select>
      {scelto && (
        <select data-testid={`capo-${capo}-port`} style={{ ...stile, cursor: "pointer" }} value={obj[portaCampo] ?? "center"}
          onChange={(e) => onChange({ [portaCampo]: e.target.value } as Partial<SynopticObject>)}>
          {bocche.length > 0 && (
            <optgroup label={t("props.bocche")}>
              {bocche.map((b) => <option key={b.id} value={b.id}>{t("props.bocca", { lato: t(ETICHETTA_LATO[b.side]), id: b.id })}</option>)}
            </optgroup>
          )}
          <optgroup label={t("props.latiRiquadro")}>
            {LATI.map((l) => <option key={l} value={l}>{t(ETICHETTA_LATO[l])}</option>)}
          </optgroup>
        </select>
      )}
    </div>
  );
}
