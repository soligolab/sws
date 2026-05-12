import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useTagStream } from "@/ws/tagStream";

export function RuntimeView() {
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const tagValues      = useAppStore((s) => s.tagValues);

  useTagStream();

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
    api.writeTag(tagId, value).catch(console.error);
  };

  const handleScript = (code: string) => {
    api.execScript(code).then((r) => {
      if (r.stdout) console.log("[script stdout]", r.stdout.trimEnd());
      if (r.stderr) console.warn("[script stderr]", r.stderr.trimEnd());
      if (!r.ok && r.error) console.warn("[script]", r.error);
    }).catch(console.error);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Page navigation bar */}
      {pages.length > 1 && (
        <nav style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: "#0f172a",
          borderBottom: "1px solid #334155",
          height: 36,
          flexShrink: 0,
          overflowX: "auto",
        }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentPage(p.id)}
              style={{
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: p.id === currentPageId ? 700 : 400,
                background: p.id === currentPageId ? "#3b82f6" : "transparent",
                color: p.id === currentPageId ? "#fff" : "#64748b",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
        </nav>
      )}

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>
    </div>
  );
}
