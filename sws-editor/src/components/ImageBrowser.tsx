import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";

interface CatalogItem { id: string; path: string; label: string; }
interface CatalogCat  { id: string; label: string; license: string; items: CatalogItem[]; }
interface Catalog     { categories: CatalogCat[]; }

interface Props {
  onSelect: (path: string) => void;
  onClose:  () => void;
}

const OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 9999,
};
const CARD: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 10,
  width: 580, maxHeight: "80vh",
  display: "flex", flexDirection: "column",
  boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
  overflow: "hidden",
};

export function ImageBrowser({ onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [catalog,    setCatalog]    = useState<Catalog | null>(null);
  const [activeTab,  setActiveTab]  = useState(0);
  const [filter,     setFilter]     = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/images/catalog.json")
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => {});
  }, []);

  useEffect(() => {
    filterRef.current?.focus();
  }, [activeTab]);

  const cat   = catalog?.categories[activeTab];
  const items = (cat?.items ?? []).filter((i) =>
    !filter ||
    i.label.toLowerCase().includes(filter.toLowerCase()) ||
    i.id.toLowerCase().includes(filter.toLowerCase())
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  const modal = (
    <div style={OVERLAY} onClick={onClose} onKeyDown={handleKey}>
      <div style={CARD} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--brand-surface-2, #334155)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ flex: 1, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", fontSize: 14 }}>
            Libreria immagini
          </span>
          <input
            ref={filterRef}
            type="text"
            placeholder={t("common.search")}
            style={{
              background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
              color: "var(--brand-text, #e2e8f0)", padding: "4px 10px", fontSize: 12, width: 170, outline: "none",
            }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "var(--brand-text-subtle, #64748b)",
              cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        {catalog && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--brand-surface-2, #334155)", padding: "0 8px", flexShrink: 0 }}>
            {catalog.categories.map((c, i) => (
              <button
                key={c.id}
                onClick={() => { setActiveTab(i); setFilter(""); }}
                style={{
                  background: "none", border: "none",
                  borderBottom: i === activeTab ? "2px solid var(--brand-primary, #3b82f6)" : "2px solid transparent",
                  color: i === activeTab ? "#93c5fd" : "var(--brand-text-subtle, #64748b)",
                  padding: "8px 12px", fontSize: 12, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
                <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.6 }}>
                  ({c.items.length})
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div style={{
          overflowY: "auto", padding: 12, flex: 1,
          display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start",
        }}>
          {!catalog && (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: 16, width: "100%" }}>
              Caricamento catalogo…
            </div>
          )}
          {catalog && items.length === 0 && (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: 16, width: "100%" }}>
              Nessun risultato per "{filter}"
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.path); onClose(); }}
              title={item.label}
              style={{
                width: 76, background: "none",
                border: "1px solid #1e3a5f",
                borderRadius: 6, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 4, padding: "6px 4px",
                transition: "border-color 0.1s, background 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--brand-primary, #3b82f6)";
                (e.currentTarget as HTMLElement).style.background = "var(--brand-surface, #1e293b)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#1e3a5f";
                (e.currentTarget as HTMLElement).style.background = "none";
              }}
            >
              <img
                src={item.path}
                alt={item.label}
                loading="lazy"
                style={{
                  width: 44, height: 44, objectFit: "contain",
                  filter: "invert(1) brightness(0.85)",
                }}
              />
              <span style={{
                fontSize: 9, color: "var(--brand-text-muted, #94a3b8)", textAlign: "center",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                width: "100%",
              }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        {cat && (
          <div style={{
            padding: "6px 16px", borderTop: "1px solid var(--brand-surface, #1e293b)",
            fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)",
            display: "flex", gap: 12,
          }}>
            <span>{items.length} di {cat.items.length} simboli</span>
            <span>·</span>
            <span>Licenza: {cat.license}</span>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
