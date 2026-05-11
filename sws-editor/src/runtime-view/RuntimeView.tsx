import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useTagStream } from "@/ws/tagStream";

export function RuntimeView() {
  const pages         = useAppStore((s) => s.pages);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const tagValues     = useAppStore((s) => s.tagValues);

  useTagStream();

  const objects = pages.find((p) => p.id === currentPageId)?.objects ?? [];

  return (
    <div style={{ flex: 1, overflow: "hidden" }}>
      <SvgCanvas objects={objects} tagValues={tagValues} />
    </div>
  );
}
