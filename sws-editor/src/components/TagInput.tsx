import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { tagCatalog } from "@/tagCatalog";
import { eSegnaposto } from "@/tag/riconciliaTag";
import { QuickCreateTagModal } from "./QuickCreateTagModal";
import type { TagDataType } from "@/types";
import i18n from "i18next";

interface TagInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  /** Il tipo che chi ospita l'input lascia intuire (la mappatura, l'oggetto):
   *  precompila il modale «definisci», non impone niente. */
  tipoSuggerito?: TagDataType;
}

/** Lo stato di un id rispetto al progetto (Fase 0b). `dichiarato` non si
 *  segnala: è la normalità. `in-attesa` = ha già una definizione che il Salva
 *  creerà; `nuovo` = non dichiarato: il Salva lo creerà con il tipo dedotto,
 *  a meno che non lo si definisca da qui. I segnaposto dei faceplate e le
 *  stringhe vuote non hanno stato. */
export type StatoTag = "dichiarato" | "in-attesa" | "nuovo" | null;

export function statoTag(id: string, dichiarati: ReadonlySet<string>, inAttesa: ReadonlySet<string>): StatoTag {
  const t = id.trim();
  if (t === "" || eSegnaposto(t)) return null;
  if (dichiarati.has(t)) return "dichiarato";
  if (inAttesa.has(t)) return "in-attesa";
  return "nuovo";
}

/**
 * Text input with a ▾ button that opens a filterable tag-picker dropdown.
 * Free-text entry is always allowed.
 */
export function TagInput({ value, onChange, placeholder, style, tipoSuggerito }: TagInputProps) {
  const { t } = useTranslation();
  // Non solo `project.tags`: in molti progetti le variabili nascono dalle
  // mappature delle sorgenti (topic MQTT, registri Modbus, nodi OPC-UA) e non
  // vengono dichiarate a mano — guardando solo i tag dichiarati il selettore
  // risultava vuoto proprio nei progetti più realistici.
  const project = useAppStore((s) => s.project);
  const tags    = useMemo(() => tagCatalog(project), [project]);
  const inAttesa = useAppStore((s) => s.tagInAttesa);
  const aggiungiTagInAttesa = useAppStore((s) => s.aggiungiTagInAttesa);
  const dichiarati = useMemo(() => new Set((project?.tags ?? []).map((x) => x.id)), [project]);
  const idsInAttesa = useMemo(() => new Set(inAttesa.map((x) => x.id)), [inAttesa]);
  const stato = statoTag(value, dichiarati, idsInAttesa);
  const [definisci, setDefinisci] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const filterRef    = useRef<HTMLInputElement>(null);
  const [open, setOpen]     = useState(false);
  const [filter, setFilter] = useState("");

  // Close when focus leaves the component entirely.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the filter input after the dropdown mounts (avoids autoFocus blur race).
  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  const q = filter.trim().toLowerCase();
  const filtered = tags.filter(
    (t) => !q || t.id.toLowerCase().includes(q)
              || (t.description ?? "").toLowerCase().includes(q)
              || (t.source ?? "").toLowerCase().includes(q)
  );

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setFilter("");
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", gap: 2 }}>
      <input
        ref={inputRef}
        type="text"
        style={{ ...style, flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {(
        <button
          type="button"
          style={{
            flexShrink: 0,
            background: "var(--brand-surface, #1e293b)",
            border: "1px solid var(--brand-border, #475569)",
            borderRadius: 4,
            color: "var(--brand-text-muted, #94a3b8)",
            cursor: "pointer",
            padding: "0 6px",
            fontSize: 11,
            lineHeight: 1,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setFilter(""); setOpen((o) => !o); }}
          tabIndex={-1}
          title={t("tagInput.select")}
        >
          ▾
        </button>
      )}
      {/* Lo stato dell'id (Fase 0b): «nuovo» apre il modale per definirlo
          prima che il Salva lo crei col tipo dedotto; «in attesa» dice che la
          definizione c'è già. Un id dichiarato non mostra niente. */}
      {stato === "nuovo" && (
        <button
          type="button"
          style={{ flexShrink: 0, background: "transparent", border: "1px dashed var(--brand-warning, #f59e0b)", borderRadius: 4,
                   color: "var(--brand-warning, #f59e0b)", cursor: "pointer", padding: "0 5px", fontSize: 11, lineHeight: 1 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDefinisci(true)}
          tabIndex={-1}
          title={t("tagInput.nuovoHint")}
          aria-label={t("tagInput.nuovoHint")}
        >
          ＋
        </button>
      )}
      {stato === "in-attesa" && (
        <span style={{ flexShrink: 0, alignSelf: "center", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}
              title={t("tagInput.inAttesaHint")} aria-label={t("tagInput.inAttesaHint")}>⏳</span>
      )}
      {definisci && (
        <QuickCreateTagModal
          initialId={value}
          tipoSuggerito={tipoSuggerito}
          onConfirm={(def) => { aggiungiTagInAttesa(def); if (def.id !== value) onChange(def.id); }}
          onClose={() => setDefinisci(false)}
        />
      )}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--brand-bg, #0f172a)",
            border: "1px solid var(--brand-surface-2, #334155)",
            borderRadius: 4,
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            marginTop: 2,
          }}
        >
          <input
            ref={filterRef}
            type="text"
            placeholder={t("tagInput.filterPlaceholder")}
            style={{
              width: "100%",
              background: "var(--brand-surface, #1e293b)",
              border: "none",
              borderBottom: "1px solid var(--brand-surface-2, #334155)",
              color: "var(--brand-text, #e2e8f0)",
              padding: "5px 8px",
              fontSize: 11,
              boxSizing: "border-box",
              outline: "none",
            }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          />
          {filtered.map((t) => (
            <div
              key={t.id}
              style={{ padding: "5px 8px", cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--brand-surface, #1e293b)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
              onMouseDown={() => select(t.id)}
            >
              <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace", fontSize: 12 }}>{t.id}</span>
              {t.description && (
                <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.description}
                </span>
              )}
              {t.origin === "source" && (
                <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}
                  title={i18n.t("tagInputMsg.variableInferredFromThisSource")}>
                  ↗ {t.source}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "8px", fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
              {tags.length === 0 ? t("tagInput.noTagsInProject") : t("tagInput.noTags")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
