import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { RecipeSummary } from "@/types";

// ── RecipePanel ─────────────────────────────────────────────────────────────
//
// Estratto da `RecipeModal` (ex chrome fissa in RuntimeView.tsx): stessa
// logica di lista/applica ricette, ma pensato per essere montato sia dentro
// il modale esistente sia come oggetto SCADA piazzabile (`recipe_panel`).

export interface RecipePanelProps {
  /** Only show recipes whose id starts with this prefix. Unset/empty = all. */
  idPrefix?: string;
  compact?: boolean;
  /** Vedi il commento gemello su `DataTable.tsx` (stesso difetto, stessa
   *  data di scoperta, 13-09-2026): i neutri `--brand-*` seguono il tema
   *  dell'app, non lo sfondo della pagina sinottica. `dark: true` (passato da
   *  `SvgCanvas.tsx` per l'oggetto `recipe_panel`) usa i letterali fissi
   *  invece del var(); l'uso nel modale di `RuntimeView.tsx` (chrome
   *  dell'app, non un disegno di pagina) non passa la prop e segue il tema
   *  come sempre. */
  dark?: boolean;
}

export function RecipePanel({ idPrefix, compact = false, dark = false }: RecipePanelProps) {
  const tok = (varName: string, literal: string) => (dark ? literal : `var(${varName}, ${literal})`);
  const nText = tok("--brand-text", "#e2e8f0");
  const nTextSubtle = tok("--brand-text-subtle", "#64748b");
  const nSurface = tok("--brand-surface", "#1e293b");
  const nSuccess = tok("--brand-success", "#22c55e");
  const nDanger = tok("--brand-danger", "#ef4444");
  const { t } = useTranslation();
  const username = useAppStore((s) => s.authUser) ?? "operator";
  const [recipes, setRecipes]   = useState<RecipeSummary[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult]     = useState<string>("");

  useEffect(() => {
    api.listRecipes().then(setRecipes).catch(() => setRecipes([]));
  }, []);

  const filtered = idPrefix ? recipes.filter((r) => r.id.startsWith(idPrefix)) : recipes;

  const apply = useCallback(async (id: string) => {
    setApplying(id);
    setResult("");
    try {
      const r = await api.applyRecipe(id, username);
      setResult(`✓ ${r.applied}/${r.total} setpoint scritti` +
        (r.errors.length > 0 ? ` — Errori: ${r.errors.join(", ")}` : ""));
    } catch {
      setResult(t("viewer.recipeApplyError"));
    } finally {
      setApplying(null);
    }
  }, [username, t]);

  return (
    <div style={{ fontSize: compact ? 11 : 13, color: nText }}>
      {filtered.length === 0 ? (
        <div style={{ color: nTextSubtle, fontSize: compact ? 11 : 13 }}>
          {t("recipePanel.noRecipeAvailable")}
        </div>
      ) : (
        filtered.map((r) => (
          <div key={r.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: compact ? "4px 0" : "8px 0", borderBottom: `1px solid ${nSurface}`,
          }}>
            <div>
              <div style={{ fontSize: compact ? 11 : 13, fontWeight: 600 }}>{r.name}</div>
              {!compact && (
                <div style={{ fontSize: 11, color: nTextSubtle }}>{r.id} · {r.setpoints_count} setpoint</div>
              )}
            </div>
            <button
              onClick={() => apply(r.id)}
              disabled={applying === r.id}
              style={{
                padding: compact ? "2px 8px" : "4px 12px", borderRadius: 4, border: "none",
                background: "#1d4ed8", color: "#fff", cursor: "pointer", fontSize: compact ? 10 : 12,
                opacity: applying === r.id ? 0.6 : 1, flexShrink: 0,
              }}
            >
              {applying === r.id ? "…" : t("viewer.apply")}
            </button>
          </div>
        ))
      )}
      {result && (
        <div style={{ marginTop: 8, fontSize: compact ? 10 : 12, color: result.startsWith("✓") ? nSuccess : nDanger }}>
          {result}
        </div>
      )}
    </div>
  );
}
