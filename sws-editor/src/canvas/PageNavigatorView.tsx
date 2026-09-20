// Il navigatore di pagine (`page_navigator`) disegnato sul canvas SVG: un
// bottone per pagina, generato dall'albero delle pagine, con quello della
// pagina corrente evidenziato.
//
// È un componente e non un ramo dentro il renderer: legge lo store in modo
// reattivo (pagine, pagina corrente, albero), e gli hook non possono stare
// nella catena di `if` di `SvgObject`.
//
// Le voci e la geometria vengono da `pageNavigator.ts`, gemello di
// `page_tree.rs` (stesse fixture): sul pannello LVGL i bottoni cadono negli
// stessi pixel. In modifica il contenuto è **lo stesso** del runtime (regola
// WYSIWYG): cambia solo che i bottoni non ricevono clic e un rettangolo
// trasparente sopra fa da presa per selezione e trascinamento.

import { useMemo } from "react";
import { useAppStore } from "@/store";
import { paginePerNavigazione } from "@/boot/tipi";
import { useLinguaContenuti } from "@/i18n/linguaContenuti";
import { geometriaNavigatore, vociNavigatore } from "@/pageNavigator";
import type { SynopticObject } from "@/types";

/** Il testo che sta in un bottone largo `larghezza`: si accorcia con «…» invece di uscire. */
function accorcia(testo: string, larghezza: number, corpo: number): string {
  const max = Math.max(1, Math.floor((larghezza - 12) / (corpo * 0.6)));
  return testo.length <= max ? testo : `${testo.slice(0, Math.max(1, max - 1))}…`;
}

export function PageNavigatorView({
  obj, w, h, isEditMode, selected, onNavigate,
}: {
  obj: SynopticObject;
  w: number;
  h: number;
  isEditMode: boolean;
  selected: boolean;
  onNavigate?: (pageId: string) => void;
}) {
  const pages = useAppStore((s) => s.pages);
  const corrente = useAppStore((s) => s.currentPageId);
  const albero = useAppStore((s) => s.project?.page_layout?.page_tree);
  const lingua = useLinguaContenuti();

  const voci = useMemo(
    () => vociNavigatore(paginePerNavigazione(pages), albero, corrente, obj, lingua.lang, lingua.table),
    [pages, albero, corrente, obj, lingua.lang, lingua.table],
  );
  const rect = geometriaNavigatore(w, h, voci.length, {
    orientation: obj.nav_orientation,
    fill: obj.nav_fill ?? true,
    size: obj.nav_btn_size,
    gap: obj.nav_gap,
    align: obj.nav_align,
  });

  const corpo = obj.font_size ?? 13;
  const raggio = obj.corner_radius ?? 4;
  // Valori fissi e non variabili di tema: la tela del sinottico è scura in ogni tema, e con
  // `--brand-surface` (bianco nel tema chiaro) il testo chiaro spariva sul bottone.
  const riempi = obj.fill ?? "#334155";
  const riempiAttiva = obj.nav_active_fill ?? "var(--brand-primary, #3b82f6)";
  const testo = obj.color ?? "var(--synoptic-text, var(--brand-text, #e2e8f0))";
  const testoAttivo = obj.nav_active_color ?? "var(--brand-on-primary, #0f172a)";
  const bordo = obj.stroke ?? "#475569";

  return (
    <g>
      <g style={isEditMode ? { pointerEvents: "none" } : undefined}>
        {voci.length === 0 && isEditMode && (
          <>
            <rect x={obj.x} y={obj.y} width={w} height={h} fill="none" stroke={bordo} strokeDasharray="4 3" />
            <text x={obj.x + w / 2} y={obj.y + h / 2 + 4} textAnchor="middle" fill={testo} fontSize={corpo} opacity={0.6}>
              ☰
            </text>
          </>
        )}
        {voci.map((v, i) => {
          const r = rect[i];
          if (!r) return null;
          const attiva = v.attiva;
          return (
            <g
              key={`${v.percorso ? "p" : "v"}-${v.id}`}
              style={{ cursor: isEditMode ? undefined : "pointer" }}
              opacity={v.percorso && !attiva ? 0.75 : 1}
              onClick={(e) => {
                if (isEditMode) return;
                e.stopPropagation();
                onNavigate?.(v.id);
              }}
            >
              <rect
                x={obj.x + r.x} y={obj.y + r.y} width={r.w} height={r.h} rx={raggio}
                fill={attiva ? riempiAttiva : riempi}
                stroke={bordo} strokeWidth={obj.stroke_width ?? 1}
              />
              <text
                x={obj.x + r.x + r.w / 2} y={obj.y + r.y + r.h / 2 + corpo * 0.35}
                textAnchor="middle" fontSize={corpo} fontWeight={attiva ? 700 : 400}
                fill={attiva ? testoAttivo : testo}
                style={{ pointerEvents: "none" }}
              >
                {accorcia(v.label, r.w, corpo)}
              </text>
            </g>
          );
        })}
      </g>
      {isEditMode && (
        <>
          <rect x={obj.x} y={obj.y} width={w} height={h} fill="transparent" />
          {selected && (
            <rect x={obj.x} y={obj.y} width={w} height={h} fill="none" stroke="#facc15" strokeWidth={2}
              strokeDasharray="5 3" style={{ pointerEvents: "none" }} />
          )}
        </>
      )}
    </g>
  );
}
