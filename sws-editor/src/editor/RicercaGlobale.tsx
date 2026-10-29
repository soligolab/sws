/** La ricerca globale dell'IDE (richiesta del maintainer, 26-10-2026).
 *
 *  Il campo sta **sopra** l'albero e **fuori** dal contenitore che scorre:
 *  così non se ne va mai, qualunque cosa si stia guardando. Non è
 *  `position: sticky` ma qualcosa di più semplice e di più solido — non è
 *  dentro ciò che scorre, quindi non può scorrere.
 *
 *  Lo sfondo verde chiaro è una richiesta esplicita, e il motivo è il colpo
 *  d'occhio: la colonna è tutta grigia e bianca, e un campo grigio in mezzo a
 *  grigio non lo trova nessuno. In tema scuro la coppia si rovescia — verde
 *  molto scuro, testo verde chiaro — perché il verde chiaro su fondo scuro
 *  acceca.
 *
 *  Il motore sta in `ricercaGlobale.ts` ed è puro; qui c'è solo il disegno,
 *  la tastiera e la navigazione. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { useManifestoLib } from "@/symbols/lib/libreria";
import { azioneDi } from "@/scorciatoie/registro";
import { aggiungiOggetto } from "@/editor/azioniEditor";
import { paletteForTarget } from "@/editor/LeftPanel";
import { SCHEDE } from "@/config/schede";
import { eBoot } from "@/boot/tipi";
import { eFaceplateDef } from "@/faceplate/modello";
import { cercaOvunque, inFila, type Categoria, type Voce } from "@/editor/ricercaGlobale";
import type { AppConfigTab } from "@/config/schede";

// I ripieghi sono i valori **scuri**, perche' `:root` in questo progetto e'
// il tema scuro: i chiari stanno nel blocco `[data-theme="light"]`, che il
// runtime attiva scrivendo l'attributo (`theme.ts`, `applyAppearance`).
const VERDE = {
  sfondo: "var(--sws-cerca-bg, #052e16)",
  bordo: "var(--sws-cerca-bordo, #166534)",
  testo: "var(--sws-cerca-testo, #86efac)",
  campo: "var(--sws-cerca-campo, #0b2a17)",
};

/** Il campo. Vive fuori dall'albero che scorre. */
export function CampoRicerca({ testo, onTesto }: { testo: string; onTesto: (v: string) => void }) {
  const { t } = useTranslation();
  const rif = useRef<HTMLInputElement>(null);

  // La scorciatoia passa dal registro, quindi è modificabile nelle Preferenze
  // come tutte le altre. Qui **non** si salta quando il fuoco è in un campo —
  // al contrario delle scorciatoie dell'editor: si deve poter cercare mentre
  // si sta scrivendo da qualche altra parte, che è proprio quando serve.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (azioneDi(e, "globale") === "cercaOvunque") {
        e.preventDefault();
        rif.current?.focus();
        rif.current?.select();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div style={{ background: VERDE.sfondo, borderBottom: `1px solid ${VERDE.bordo}`, padding: 8, flexShrink: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, background: VERDE.campo,
        border: `1px solid ${VERDE.bordo}`, borderRadius: 5, padding: "5px 7px",
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={VERDE.testo}
             strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={rif}
          type="search"
          data-testid="ricerca-globale"
          value={testo}
          placeholder={t("ricerca.placeholder")}
          aria-label={t("ricerca.placeholder")}
          onChange={(e) => onTesto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { onTesto(""); e.currentTarget.blur(); } }}
          style={{
            border: 0, outline: 0, background: "transparent", color: "var(--brand-text, #0f172a)",
            font: "inherit", fontSize: 12, width: "100%", padding: 0, minWidth: 0,
          }}
        />
      </div>
    </div>
  );
}

const CATEGORIA_TESTO: Record<Categoria, string> = {
  variabili: "ricerca.gruppoVariabili",
  pagine: "ricerca.gruppoPagine",
  oggetti: "ricerca.gruppoOggetti",
  strumenti: "ricerca.gruppoStrumenti",
  impostazioni: "ricerca.gruppoImpostazioni",
};

/** I risultati, al posto dell'albero finché c'è del testo. */
export function RisultatiRicerca({ testo, onChiudi }: { testo: string; onChiudi: () => void }) {
  const { t } = useTranslation();
  const pages = useAppStore((s) => s.pages);
  const tags = useAppStore((s) => s.project?.tags);
  const alarms = useAppStore((s) => s.project?.alarms);
  const sources = useAppStore((s) => s.project?.sources);
  const targetKind = useAppStore((s) => s.project?.target?.kind);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const selectObject = useAppStore((s) => s.selectObject);
  const setAppMode = useAppStore((s) => s.setAppMode);
  const manifesto = useManifestoLib();
  const [scelto, setScelto] = useState(0);

  const isLvgl = targetKind === "lvgl_framebuffer" || targetKind === "lvgl_wayland";
  const paginaBoot = eBoot(pages.find((p) => p.id === currentPageId));
  const paginaFaceplate = eFaceplateDef(pages.find((p) => p.id === currentPageId));

  const gruppi = useMemo(() => cercaOvunque(testo, {
    pages,
    tags: tags ?? [],
    gruppiPalette: paletteForTarget(isLvgl, paginaBoot, paginaFaceplate),
    simboli: manifesto?.symbols ?? [],
    schede: SCHEDE as readonly { id: string }[],
    elementi: [
      ...(alarms ?? []).map((a) => ({ scheda: "alarms", id: a.id, nome: a.id })),
      // Non tutte le sorgenti hanno un nome: quelle che non ce l'hanno si
      // riconoscono dall'id, che e' sempre presente.
      ...(sources ?? []).map((s) => ({
        scheda: "protocols", id: s.id ?? s.kind,
        nome: (s as { name?: string }).name ?? s.id ?? s.kind,
      })),
      // I faceplate non sono più un elemento della Configurazione: sono pagine
      // (29-10-2026), e la ricerca li trova fra le pagine.
    ],
    t,
  }), [testo, pages, tags, alarms, sources, isLvgl, paginaBoot, paginaFaceplate, manifesto, t]);

  const fila = useMemo(() => inFila(gruppi), [gruppi]);
  useEffect(() => { setScelto(0); }, [testo]);

  const apri = (v: Voce) => {
    switch (v.esito.tipo) {
      case "pagina":
        setAppMode("edit"); setCurrentPage(v.esito.pageId); break;
      case "oggetto":
        setAppMode("edit"); setCurrentPage(v.esito.pageId); selectObject(v.esito.objId); break;
      case "variabile":
        navigateToConfig("tags", v.esito.id); break;
      case "impostazione":
        navigateToConfig(v.esito.scheda as AppConfigTab, v.esito.elemento ?? null); break;
      case "strumento": {
        const r = v.esito.risultato;
        if (r.kind === "tipo") aggiungiOggetto(r.type);
        else aggiungiOggetto("symbol", { symbol_id: r.sim.id });
        break;
      }
    }
    onChiudi();
  };

  // Frecce e Invio sull'elenco intero, non dentro un gruppo: chi guarda vede
  // una colonna sola, e una navigazione per gruppi sorprenderebbe.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!fila.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setScelto((n) => (n + 1) % fila.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setScelto((n) => (n - 1 + fila.length) % fila.length); }
      else if (e.key === "Enter") { e.preventDefault(); apri(fila[scelto] ?? fila[0]); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fila, scelto]);

  if (!gruppi.length) {
    return <div style={{ fontSize: 11.5, color: "var(--brand-text-subtle, #64748b)", padding: "10px 12px" }}>
      {t("ricerca.nessuno", { q: testo.trim() })}
    </div>;
  }

  let i = -1;
  return (
    <div data-testid="ricerca-risultati">
      {gruppi.map((g) => (
        <div key={g.categoria}>
          <div style={{
            fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: VERDE.testo,
            background: "var(--brand-surface-2, #f1f5f9)", padding: "4px 9px",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>{t(CATEGORIA_TESTO[g.categoria])}</span>
            <span>{g.totale > g.voci.length ? t("ricerca.diPiu", { n: g.voci.length, tot: g.totale }) : g.totale}</span>
          </div>
          {g.voci.map((v) => {
            i += 1;
            const on = i === scelto;
            return (
              <div
                key={v.chiave}
                role="button"
                tabIndex={-1}
                data-testid={`ricerca-voce-${v.chiave}`}
                onMouseDown={(e) => { e.preventDefault(); apri(v); }}
                style={{
                  padding: "5px 9px", cursor: "pointer",
                  background: on ? "var(--brand-surface-2, #f1f5f9)" : undefined,
                }}
              >
                <div style={{
                  fontSize: 12, color: "var(--brand-text, #0f172a)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{v.nome}</div>
                {v.dove && <div style={{
                  fontSize: 10.5, color: "var(--brand-text-subtle, #64748b)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{v.dove}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
