import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocus, usePubblicaElenco } from "@/config/fogliaConfig";
import { useAppStore } from "@/store";
import { api } from "@/api/client";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { TagInput } from "@/components/TagInput";
import type { RecipeDef, RecipeSummary } from "@/types";
import { S, SaveBar } from "@/config/comuni";

// ── RECIPES tab ───────────────────────────────────────────────────────────────

function genRecipeId() {
  return "recipe-" + Math.random().toString(36).slice(2, 8);
}

export function RecipesTab() {
  const { t } = useTranslation();
  const [recipes, setRecipes]     = useState<RecipeSummary[]>([]);
  const [selected, setSelected]   = useState<RecipeDef | null>(null);
  const [loading, setLoading]     = useState(false);
  const [saved, setSaved]         = useState(false);
  // Intenzione dell'utente sulla ricetta selezionata (vedi TagsTab).
  const [touched, setTouched]     = useState(false);
  const [newId, setNewId]         = useState("");
  const [newName, setNewName]     = useState("");

  const loadList = async () => {
    try { setRecipes(await api.listRecipes()); } catch { /* no project open */ }
  };

  useEffect(() => { void loadList(); }, []);

  const setConfigFocus = useAppStore((s) => s.setConfigFocus);
  const selectRecipe = async (id: string) => {
    try {
      const r = await api.getRecipe(id);
      setSelected(r);
      setTouched(false);
      setConfigFocus(id);
    } catch { /* ignore */ }
  };

  // Il secondo livello dell'albero ⚙ (24-09-2026): una foglia per ricetta. La
  // foglia apre la ricetta, e aprirla da qui evidenzia la foglia.
  // Solo la ricetta aperta ha una bozza: le altre stanno sul disco.
  usePubblicaElenco("recipes", recipes.map((r) => ({ id: r.id, etichetta: r.name || r.id, modificato: touched && selected?.id === r.id })));
  const focus = useFocus("recipes", recipes.map((r) => r.id));
  useEffect(() => {
    if (focus !== null && selected?.id !== focus) void selectRecipe(focus);
  }, [focus]);

  const saveSelected = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await api.saveRecipe(selected);
      setTouched(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await loadList();
    } finally { setLoading(false); }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    await api.deleteRecipe(selected.id);
    setSelected(null);
    await loadList();
  };

  const createRecipe = async () => {
    const id = newId.trim() || genRecipeId();
    const name = newName.trim() || id;
    const r: RecipeDef = { id, name, setpoints: [] };
    await api.saveRecipe(r);
    setNewId(""); setNewName("");
    await loadList();
    await selectRecipe(id);
  };

  const modifica = (fn: (prev: RecipeDef) => RecipeDef) => {
    setTouched(true);
    setSelected((prev) => (prev ? fn(prev) : null));
  };
  const updateSetpoint = (idx: number, patch: Partial<{ tag: string; value: boolean | number | string }>) =>
    modifica((prev) => ({ ...prev, setpoints: prev.setpoints.map((sp, i) => (i === idx ? { ...sp, ...patch } : sp)) }));
  const addSetpoint = () =>
    modifica((prev) => ({ ...prev, setpoints: [...prev.setpoints, { tag: "", value: 0 }] }));
  const removeSetpoint = (idx: number) =>
    modifica((prev) => ({ ...prev, setpoints: prev.setpoints.filter((_, i) => i !== idx) }));

  const recipeColumns: DataTableColumn<RecipeSummary>[] = [
    { key: "name", header: t("cfg.name"), accessor: (r) => r.name },
    { key: "id", header: t("cfg.recipeId"), accessor: (r) => r.id },
    { key: "setpoints_count", header: t("cfg.setpointsCount"), accessor: (r) => r.setpoints_count, filterable: false, align: "right", width: 60 },
  ];

  return (
    <div style={S.section}>
      <SaveBar onSave={saveSelected} saving={loading} saved={saved} section="recipes" dirty={touched && !!selected} />
      <div style={S.sectionTitle}>RICETTE (ISA-88)</div>
      <div style={S.notice}>
        {t("cfgUi.recipeIntro")}
      </div>

      <div style={{ display: "flex", gap: 12, height: 500 }}>
        {/* Left: recipe list */}
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              style={{ ...S.inputSm, flex: 1 }}
              placeholder={t("cfg.idExample")}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              spellCheck={false}
            />
            <input
              style={{ ...S.inputSm, flex: 1 }}
              placeholder={t("cfg.name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              spellCheck={false}
            />
            <button style={S.btn("primary")} onClick={createRecipe}>+</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <DataTable<RecipeSummary>
              columns={recipeColumns}
              rows={recipes}
              rowKey={(r) => r.id}
              onRowClick={(r) => selectRecipe(r.id)}
              selectedRowKey={selected?.id}
              emptyLabel={t("cfgUi.noRecipes")}
              compact
            />
          </div>
        </div>

        {/* Right: recipe editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {!selected ? (
            <div style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 12, padding: 20 }}>
              {t("cfgUi.selectOrCreateARecipe")}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...S.inputSm, flex: 1 }}
                  value={selected.name}
                  onChange={(e) => { setTouched(true); setSelected({ ...selected, name: e.target.value }); }}
                  placeholder={t("cfg.recipeName")}
                  spellCheck={false}
                />
                <button style={S.btn("danger")} onClick={deleteSelected} title={t("cfg.deleteRecipe")}>✕</button>
              </div>

              <table style={{ ...S.table, flex: 1 }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: "45%" }}>{t("cfg.tag")}</th>
                    <th style={{ ...S.th, width: "40%" }}>{t("cfg.setpointValue")}</th>
                    <th style={S.th} />
                  </tr>
                </thead>
                <tbody>
                  {selected.setpoints.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                        {t("cfgUi.noSetpointsClickAddTo")}
                      </td>
                    </tr>
                  )}
                  {selected.setpoints.map((sp, i) => (
                    <tr key={i}>
                      <td style={S.td}>
                        <TagInput
                          style={S.inputSm}
                          value={sp.tag}
                          onChange={(v) => updateSetpoint(i, { tag: v })}
                          placeholder="tag.path"
                        />
                      </td>
                      <td style={S.td}>
                        <input
                          style={S.inputSm}
                          value={String(sp.value)}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = Number(v);
                            updateSetpoint(i, { value: v === "true" ? true : v === "false" ? false : isNaN(n) ? v : n });
                          }}
                          placeholder="0 / true / false / testo"
                          spellCheck={false}
                        />
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <button style={S.btn("danger")} onClick={() => removeSetpoint(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button style={{ ...S.btn("ghost"), alignSelf: "flex-start" }} onClick={addSetpoint}>
                {t("cfgUi.addSetpoint")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
