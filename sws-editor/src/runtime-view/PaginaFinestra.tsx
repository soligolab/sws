// Una pagina aperta come finestra (P1, 17-10-2026, piano docs/plans/2026-10-17-finestre-popup.md).
//
// Modale: sfondo scuro, Esc e clic fuori chiudono, come il popup dei faceplate.
// Non modale: niente sfondo, la pagina sotto resta usabile; si apre centrata e si
// trascina tenendo la barra del titolo, senza uscire dallo schermo.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import type { ButtonAction, CustomSymbol, FaceplateDef, SynopticObject, SynopticPage, TagState } from "@/types";
import { titoloFinestra } from "@/finestre/finestra";

const BARRA = 32;

export function PaginaFinestra({ pagina, oggetti, parametri, sfondo, tagValues, customSymbols, faceplates,
  onWriteTag, onScript, onNavigate, onButtonAction, onClose }: {
  pagina: SynopticPage;
  oggetti: SynopticObject[];
  parametri: Record<string, string>;
  sfondo?: string;
  tagValues: Record<string, TagState>;
  customSymbols: CustomSymbol[];
  faceplates: FaceplateDef[];
  onWriteTag?: (tag: string, value: string | number | boolean) => void;
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
  onButtonAction?: (a: ButtonAction) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modale = pagina.finestra?.modale !== false;
  const w = pagina.width ?? 480;
  const h = pagina.height ?? 320;
  // La finestra non supera lo schermo: la pagina dentro si rimpicciolisce.
  const scala = Math.min(1, (window.innerWidth * 0.94) / w, (window.innerHeight * 0.9 - BARRA) / h);
  const larg = w * scala;
  const alt = h * scala + BARRA;
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - larg) / 2),
    y: Math.max(0, (window.innerHeight - alt) / 2),
  }));
  const trascina = useRef<{ dx: number; dy: number } | null>(null);

  // Una finestra nuova (o la stessa con altri parametri) riparte dal centro.
  useEffect(() => {
    setPos({ x: Math.max(0, (window.innerWidth - larg) / 2), y: Math.max(0, (window.innerHeight - alt) / 2) });
  }, [pagina.id, larg, alt]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const titolo = useMemo(() => titoloFinestra(pagina, parametri), [pagina, parametri]);

  const finestra = (
    <div data-testid="pagina-finestra" data-modale={modale ? "1" : "0"}
      style={{ position: "fixed", left: pos.x, top: pos.y, width: larg, zIndex: 9400,
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55)", overflow: "hidden" }}
      onClick={(e) => e.stopPropagation()}>
      <div data-testid="finestra-titolo"
        style={{ height: BARRA, display: "flex", alignItems: "center", padding: "0 6px 0 12px", gap: 8,
          background: "var(--brand-surface, #1e293b)", cursor: modale ? "default" : "move", userSelect: "none", touchAction: "none" }}
        onPointerDown={(e) => {
          if (modale || (e.target as HTMLElement).closest("button")) return;
          trascina.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = trascina.current;
          if (!d) return;
          setPos({
            x: Math.min(Math.max(0, e.clientX - d.dx), Math.max(0, window.innerWidth - larg)),
            y: Math.min(Math.max(0, e.clientY - d.dy), Math.max(0, window.innerHeight - BARRA)),
          });
        }}
        onPointerUp={() => { trascina.current = null; }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {titolo}
        </span>
        <button type="button" data-testid="finestra-chiudi" title={t("finestraPopup.chiudi")} onClick={onClose}
          style={{ background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
            color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", padding: "1px 8px", fontSize: 13 }}>✕</button>
      </div>
      <div style={{ width: larg, height: h * scala }}>
        <SvgCanvas
          objects={oggetti}
          tagValues={tagValues}
          background={sfondo}
          customSymbols={customSymbols}
          faceplates={faceplates}
          pageWidth={w}
          pageHeight={h}
          sizeMode="fixed"
          fitScale={scala}
          onWriteTag={onWriteTag}
          onScript={onScript}
          onNavigate={onNavigate}
          onButtonAction={onButtonAction}
        />
      </div>
    </div>
  );

  if (!modale) return finestra;
  return (
    <div data-testid="finestra-sfondo"
      style={{ position: "fixed", inset: 0, zIndex: 9300, background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}>
      {finestra}
    </div>
  );
}
