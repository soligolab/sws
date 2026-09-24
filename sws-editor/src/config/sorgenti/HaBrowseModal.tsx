import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { HaBrowsedEntity } from "@/types";
import { S } from "@/config/comuni";

// ── HomeAssistant entity browser modal ────────────────────────────────────────

export type HaBrowseTarget = { rowIdx: number; field: "entity_id" | "attribute" };

export function HaBrowseModal({
  sourceId,
  target,
  onSelect,
  onClose,
}: {
  sourceId: string;
  target: HaBrowseTarget;
  onSelect: (entityId: string, attribute?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [entities, setEntities] = useState<HaBrowsedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.browseHaEntities(sourceId, domainFilter || undefined)
      .then((list) => { setEntities(list); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [sourceId, domainFilter]);

  const filtered = entities.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.entity_id.toLowerCase().includes(q) ||
      (e.friendly_name?.toLowerCase().includes(q) ?? false) ||
      e.state.toLowerCase().includes(q)
    );
  });

  const domains = Array.from(new Set(entities.map((e) => e.entity_id.split(".")[0]))).sort();

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--brand-surface-2, #334155)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-warning, #f59e0b)", letterSpacing: 0.5 }}>
            {t("cfgUi.browseHomeAssistantEntities")}
          </span>
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", flex: 1 }}>
            {target.field === "attribute" ? t("cfgUi.selectEntityThenAttribute") : t("cfgUi.selectEntity")}
          </span>
          <button style={S.btn("ghost")} onClick={onClose}>✕</button>
        </div>

        {/* Filters */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e3a5f", display: "flex", gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder={t("cfg.searchEntity")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <select
            style={{ ...S.input, minWidth: 140 }}
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="">{t("cfg.allDomains")}</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "6px 0" }}>
          {loading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.loadingEntities")}</div>
          )}
          {error && (
            <div style={{ padding: 16, color: "var(--brand-danger, #ef4444)", fontSize: 12 }}>
              {t("cfgUi.entityBrowseError", { error })}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfgUi.noEntitiesFound")}</div>
          )}
          {!loading && !error && filtered.map((ent) => (
            <div key={ent.entity_id} style={{ borderBottom: "1px solid var(--brand-bg, #0f172a)" }}>
              <div
                style={{
                  padding: "7px 16px", display: "flex", alignItems: "center", gap: 12,
                  cursor: "pointer",
                  background: expandedId === ent.entity_id ? "#0f2f35" : "transparent",
                }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = "#162032"; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = expandedId === ent.entity_id ? "#0f2f35" : "transparent"; }}
              >
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => {
                  if (target.field === "entity_id") {
                    onSelect(ent.entity_id);
                  } else {
                    setExpandedId(expandedId === ent.entity_id ? null : ent.entity_id);
                  }
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 2 }}>
                    {ent.entity_id}
                  </div>
                  {ent.friendly_name && ent.friendly_name !== ent.entity_id && (
                    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{ent.friendly_name}</div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", minWidth: 80, textAlign: "right" }}>
                  {ent.state}
                </div>
                {target.field === "entity_id" ? (
                  <button
                    style={{ ...S.btn("primary"), padding: "3px 10px", fontSize: 11 }}
                    onClick={() => onSelect(ent.entity_id)}
                  >
                    {t("cfgUi.select")}
                  </button>
                ) : (
                  <button
                    style={{ ...S.btn("ghost"), padding: "3px 10px", fontSize: 11 }}
                    onClick={() => setExpandedId(expandedId === ent.entity_id ? null : ent.entity_id)}
                  >
                    {expandedId === ent.entity_id ? "▲" : "▼"} attr
                  </button>
                )}
              </div>

              {/* Attribute list — shown when field=attribute and row is expanded */}
              {target.field === "attribute" && expandedId === ent.entity_id && ent.attributes.length > 0 && (
                <div style={{ padding: "4px 16px 8px 32px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ent.attributes.map((attr) => (
                    <button
                      key={attr}
                      style={{ ...S.btn("ghost"), padding: "2px 8px", fontSize: 11 }}
                      onClick={() => onSelect(ent.entity_id, attr)}
                    >
                      {attr}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--brand-surface-2, #334155)", fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>
          {!loading && !error && t("cfgUi.entitiesCount", { shown: filtered.length, total: entities.length })}
        </div>
      </div>
    </div>
  );
}
