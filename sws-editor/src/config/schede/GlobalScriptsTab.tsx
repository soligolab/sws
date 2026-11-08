// Configurazione → Python, dall'08-11-2026: un rimando. Gli script si scrivono
// nell'editor della logica, al posto del sinottico, come le funzioni (piano
// della logica unificata, L1); la scheda resta perché `#config/scripts` e i
// collegamenti di prima continuino a portare da qualche parte — e portano lì.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

export function GlobalScriptsTab() {
  const { t } = useTranslation();
  const scripts = useAppStore((s) => s.project?.global_scripts) ?? [];
  const focus = useAppStore((s) => s.configFocus);
  const primo = focus && scripts.some((g) => g.id === focus) ? focus : scripts[0]?.id;

  useEffect(() => {
    if (!primo) return;
    const st = useAppStore.getState();
    st.selectScript(primo);
    st.setAppMode("edit");
  }, [primo]);

  return (
    <div data-testid="scheda-script-rimando" style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <p style={{ margin: 0, color: "var(--brand-text-2, #cbd5e1)" }}>{t("logica.scriptSpostati")}</p>
      {!primo && (
        <div>
          <button type="button" onClick={() => { const st = useAppStore.getState(); st.addScript(); st.setAppMode("edit"); }}
            style={{ background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {t("logica.nuovoScript")}
          </button>
        </div>
      )}
    </div>
  );
}
