// TODO: receive synoptic definition from project API.
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useTagStream } from "@/ws/tagStream";
import type { SynopticObject } from "@/types";

const HELLO_WORLD: SynopticObject[] = [
  { id: "rect1", type: "rect", x: 100, y: 100, width: 200, height: 100, fill: "#4a90d9" },
  { id: "display1", type: "text", x: 120, y: 160, tag: "demo.temperature", format: "{value:.1f} °C" },
];

const TAG_IDS = HELLO_WORLD.flatMap((o) => (o.tag ? [o.tag] : []));

export function RuntimeView() {
  const tagValues = useAppStore((s) => s.tagValues);
  useTagStream(TAG_IDS);

  return (
    <div style={{ flex: 1, overflow: "hidden" }}>
      <SvgCanvas objects={HELLO_WORLD} tagValues={tagValues} />
    </div>
  );
}
