import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AZIONI, RISERVATE, combinazione, combinazioneDi, conflittiDi, leggiPersonalizzate, mostra, salvaPersonalizzate,
  type Personalizzate,
} from "./registro";

/** Le scorciatoie da tastiera nelle Preferenze IDE (18-10-2026, gruppo 4 del
 *  programma delle funzioni utente). Vedere e cambiare le combinazioni del
 *  registro; si salvano in questo browser, come tema e lingua. */
export function SezioneScorciatoie() {
  const { t } = useTranslation();
  const [p, setP] = useState<Personalizzate>(() => leggiPersonalizzate());
  const [cattura, setCattura] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const salva = (nuove: Personalizzate) => { setP(nuove); salvaPersonalizzate(nuove); };

  useEffect(() => {
    if (!cattura) return;
    // In cattura, sul window e in fase di cattura: nessun'altra scorciatoia deve
    // scattare mentre si sta scegliendo la combinazione (Ctrl+S salverebbe).
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCattura(null); return; }
      const c = combinazioneDi(e);
      if (!c) return; // solo un modificatore: si aspetta il tasto
      if (RISERVATE.has(c)) { setMsg(t("scorciatoie.riservata", { combo: mostra(c) })); setCattura(null); return; }
      const altre = conflittiDi(c, cattura, p);
      if (altre.length > 0) {
        const nome = AZIONI.find((a) => a.id === altre[0]);
        setMsg(t("scorciatoie.conflitto", { combo: mostra(c), azione: nome ? t(nome.testo) : altre[0] }));
        setCattura(null);
        return;
      }
      const def = AZIONI.find((a) => a.id === cattura)?.predefinita;
      const nuove = { ...p };
      if (c === def) delete nuove[cattura]; else nuove[cattura] = c;
      salva(nuove);
      setMsg(null);
      setCattura(null);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [cattura, p, t]);

  let gruppo = "";
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("scorciatoie.titolo")}</div>
        <button type="button" data-testid="scorciatoie-ripristina-tutte" disabled={Object.keys(p).length === 0}
          onClick={() => { salva({}); setMsg(null); }} style={{ fontSize: 11 }}>
          {t("scorciatoie.ripristinaTutte")}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "2px 0 8px" }}>{t("scorciatoie.spiegazione")}</div>
      {msg && <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)", marginBottom: 6 }}>{msg}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {AZIONI.flatMap((a) => {
            const righe = [];
            if (a.gruppo !== gruppo) {
              gruppo = a.gruppo;
              righe.push(
                <tr key={`g-${gruppo}`}>
                  <td colSpan={3} style={{ color: "var(--brand-text-subtle, #94a3b8)", fontWeight: 700, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", paddingTop: 8 }}>
                    {t(`scorciatoie.gruppo.${gruppo}`)}
                  </td>
                </tr>,
              );
            }
            const personale = p[a.id] !== undefined;
            righe.push(
              <tr key={a.id} data-testid={`scorciatoia-${a.id}`} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                <td style={{ padding: "4px 8px 4px 0", color: "var(--brand-text-2, #cbd5e1)" }}>
                  {t(a.testo)}{a.id.endsWith("Alt") ? ` (${t("scorciatoie.alternativa")})` : ""}
                </td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace", whiteSpace: "nowrap", color: personale ? "var(--brand-primary, #3b82f6)" : "var(--brand-text-muted, #94a3b8)" }}>
                  {cattura === a.id ? t("scorciatoie.premi") : mostra(combinazione(a.id, p))}
                </td>
                <td style={{ padding: "4px 0", whiteSpace: "nowrap", textAlign: "right" }}>
                  <button type="button" data-testid={`cambia-${a.id}`} onClick={() => { setMsg(null); setCattura(a.id); }} style={{ fontSize: 11 }}>
                    {t("scorciatoie.cambia")}
                  </button>
                  {personale && (
                    <button type="button" onClick={() => { const n = { ...p }; delete n[a.id]; salva(n); }} style={{ fontSize: 11, marginLeft: 4 }}>
                      {t("scorciatoie.predefinita")}
                    </button>
                  )}
                </td>
              </tr>,
            );
            return righe;
          })}
        </tbody>
      </table>
    </div>
  );
}
