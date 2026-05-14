import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useTagStream } from "@/ws/tagStream";

export function RuntimeView() {
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const tagValues      = useAppStore((s) => s.tagValues);
  const customSymbols  = useAppStore((s) => s.customSymbols);

  useTagStream();

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
    api.writeTag(tagId, value).catch(console.error);
  };

  // Dispatcher for object on_press_fn / on_release_fn handlers. Resolves
  // the named function server-side; per-binding param overrides ride along
  // as a plain JSON object. The server returns the same shape as
  // /api/script/exec so the console logging is identical.
  const handleScript = (fn: string, args: Record<string, string | number | boolean>) => {
    api.runFunction(fn, args).then((r) => {
      if (r.stdout) console.log(`[${fn} stdout]`, r.stdout.trimEnd());
      if (r.stderr) console.warn(`[${fn} stderr]`, r.stderr.trimEnd());
      if (!r.ok && r.error) console.warn(`[${fn}]`, r.error);
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
          customSymbols={customSymbols}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>
    </div>
  );
}
