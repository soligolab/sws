// Il pannello proprietà del navigatore di pagine: orientamento, da dove
// vengono le voci, misure, colori, e la tabella delle eccezioni per pagina
// (etichetta, posizione, esclusione).
//
// Un componente a parte perché `EditorShell` è già enorme; riceve dal pannello
// i suoi stessi costruttori di campo, così l'aspetto è quello degli altri tipi.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { paginePerNavigazione } from "@/boot/tipi";
import { CampoTestoTradotto } from "@/editor/CampoTestoTradotto";
import { ordinaPagine, riconcilia, righe } from "@/pageTree";
import type { NavItem, SynopticObject } from "@/types";

type Campo = (etichetta: string, contenuto: ReactNode) => ReactNode;

/** Toglie dalle eccezioni quelle che non dicono più niente (tutto ai valori predefiniti). */
function ripulisci(items: NavItem[]): NavItem[] | undefined {
  const utili = items.filter((i) => (i.label ?? "").trim() !== "" || i.order !== undefined || i.hidden);
  return utili.length > 0 ? utili : undefined;
}

export function NavigatorProperties({
  obj, onChange, field, numInput, colorInput, inputStyle,
}: {
  obj: SynopticObject;
  onChange: (patch: Partial<SynopticObject>) => void;
  field: Campo;
  numInput: (key: keyof SynopticObject, fallback: number) => ReactNode;
  colorInput: (key: keyof SynopticObject, fallback: string) => ReactNode;
  inputStyle: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const pagine = useAppStore((s) => s.pages);
  const albero = useAppStore((s) => s.project?.page_layout?.page_tree);

  const sinottiche = paginePerNavigazione(pagine);
  const ordinate = ordinaPagine(sinottiche, albero);
  const livelli = new Map(
    righe(riconcilia(albero, sinottiche.map((p) => p.id)), new Set()).map((r) => [r.id, r.livello] as const),
  );
  const items = obj.nav_items ?? [];
  const sorgente = obj.nav_source ?? "all";
  const fill = obj.nav_fill ?? true;

  const cambiaItem = (pageId: string, patch: Partial<NavItem>) => {
    const esiste = items.some((i) => i.page_id === pageId);
    const nuovi = esiste
      ? items.map((i) => (i.page_id === pageId ? { ...i, ...patch } : i))
      : [...items, { page_id: pageId, ...patch }];
    onChange({ nav_items: ripulisci(nuovi) });
  };

  const select = (valore: string, opzioni: [string, string][], su: (v: string) => void) => (
    <select style={{ ...inputStyle, cursor: "pointer" }} value={valore} onChange={(e) => su(e.target.value)}>
      {opzioni.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <>
      {field(t("nav.orientation"), select(obj.nav_orientation ?? "horizontal",
        [["horizontal", t("nav.horizontal")], ["vertical", t("nav.vertical")]],
        (v) => onChange({ nav_orientation: v as SynopticObject["nav_orientation"] })))}

      {field(t("nav.source"), select(sorgente,
        [["all", t("nav.sourceAll")], ["roots", t("nav.sourceRoots")],
         ["children_of", t("nav.sourceChildrenOf")], ["children_of_current", t("nav.sourceChildrenOfCurrent")]],
        (v) => onChange({ nav_source: v as SynopticObject["nav_source"] })))}

      {sorgente === "children_of" && field(t("nav.node"),
        <select style={{ ...inputStyle, cursor: "pointer" }} value={obj.nav_node ?? ""}
          onChange={(e) => onChange({ nav_node: e.target.value || undefined })}>
          <option value="">{t("props.dashSelect")}</option>
          {ordinate.map((p) => (
            <option key={p.id} value={p.id}>{" ".repeat(livelli.get(p.id) ?? 0)}{p.name}</option>
          ))}
        </select>)}

      {(sorgente === "children_of" || sorgente === "children_of_current") && field(t("nav.breadcrumb"),
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input type="checkbox" checked={!!obj.nav_breadcrumb}
            onChange={(e) => onChange({ nav_breadcrumb: e.target.checked || undefined })} />
          {t("nav.breadcrumbHint")}
        </label>)}

      {field(t("nav.fill"),
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input type="checkbox" checked={fill}
            onChange={(e) => onChange({ nav_fill: e.target.checked })} />
          {t("nav.fillHint")}
        </label>)}
      {!fill && field(t("nav.btnSize"), numInput("nav_btn_size", 120))}
      {!fill && field(t("nav.align"), select(obj.nav_align ?? "start",
        [["start", t("nav.alignStart")], ["center", t("nav.alignCenter")], ["end", t("nav.alignEnd")]],
        (v) => onChange({ nav_align: v as SynopticObject["nav_align"] })))}
      {field(t("nav.gap"), numInput("nav_gap", 4))}

      {field(t("nav.fillColor"), colorInput("fill", "#1e293b"))}
      {field(t("nav.activeFill"), colorInput("nav_active_fill", "#3b82f6"))}
      {field(t("nav.textColor"), colorInput("color", "#e2e8f0"))}
      {field(t("nav.activeColor"), colorInput("nav_active_color", "#0f172a"))}
      {field(t("nav.border"), colorInput("stroke", "#334155"))}
      {field(t("nav.cornerRadius"), numInput("corner_radius", 4))}
      {field(t("nav.fontSize"), numInput("font_size", 13))}

      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px",
                    color: "var(--brand-text-muted, #94a3b8)" }}>
        {t("nav.items")}
      </div>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 6 }}>{t("nav.itemsHint")}</div>
      {ordinate.map((p) => {
        const it = items.find((i) => i.page_id === p.id);
        return (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 46px 24px", gap: 4, alignItems: "center", marginBottom: 4 }}>
            <div style={{ gridColumn: "1 / -1", fontSize: 11, paddingLeft: (livelli.get(p.id) ?? 0) * 10,
                          color: it?.hidden ? "var(--brand-text-subtle, #64748b)" : "var(--brand-text, #e2e8f0)",
                          textDecoration: it?.hidden ? "line-through" : undefined }}>
              {p.name}
            </div>
            <CampoTestoTradotto
              valore={it?.label}
              placeholder={t("nav.labelPh")}
              stile={inputStyle}
              onChange={(v) => cambiaItem(p.id, { label: v.trim() === "" ? undefined : v })}
            />
            <input
              type="number" min={1} style={{ ...inputStyle, padding: "2px 4px" }} title={t("nav.posTitle")}
              placeholder={t("nav.posPh")}
              value={it?.order ?? ""}
              onChange={(e) => cambiaItem(p.id, { order: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
            <input
              type="checkbox" title={t("nav.hideTitle")} checked={!!it?.hidden}
              onChange={(e) => cambiaItem(p.id, { hidden: e.target.checked || undefined })}
            />
          </div>
        );
      })}
    </>
  );
}
