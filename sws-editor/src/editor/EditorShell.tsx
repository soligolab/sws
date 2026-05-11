// TODO: load actual synoptic from selected project file.
import { useState } from "react";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import type { SynopticObject } from "@/types";

const HELLO_WORLD: SynopticObject[] = [
  { id: "rect1", type: "rect", x: 100, y: 100, width: 200, height: 100, fill: "#4a90d9" },
  { id: "display1", type: "text", x: 120, y: 160, tag: "demo.temperature", format: "{value:.1f} °C" },
];

export function EditorShell() {
  const selectedId = useAppStore((s) => s.selectedObjectId);
  const selectObject = useAppStore((s) => s.selectObject);
  const tagValues = useAppStore((s) => s.tagValues);
  const [objects] = useState<SynopticObject[]>(HELLO_WORLD);

  const selected = objects.find((o) => o.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Toolbox */}
      <aside
        style={{
          width: 200,
          background: "#0f172a",
          borderRight: "1px solid #334155",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ color: "#94a3b8", fontSize: 12 }}>OBJECTS</span>
        {/* TODO: drag-and-drop toolbox palette */}
        {(["rect", "text", "image"] as const).map((t) => (
          <button key={t} style={{ textAlign: "left", padding: "4px 8px", cursor: "not-allowed" }}>
            + {t}
          </button>
        ))}
      </aside>

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          selectedId={selectedId}
          onSelect={selectObject}
        />
      </div>

      {/* Properties panel */}
      <aside
        style={{
          width: 240,
          background: "#0f172a",
          borderLeft: "1px solid #334155",
          padding: 12,
          overflowY: "auto",
        }}
      >
        <span style={{ color: "#94a3b8", fontSize: 12 }}>PROPERTIES</span>
        {selected ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div><strong>ID:</strong> {selected.id}</div>
            <div><strong>Type:</strong> {selected.type}</div>
            {selected.tag && <div><strong>Tag:</strong> {selected.tag}</div>}
            {/* TODO: inline editing of all object properties */}
          </div>
        ) : (
          <p style={{ color: "#475569", marginTop: 8 }}>Select an object</p>
        )}
      </aside>
    </div>
  );
}
