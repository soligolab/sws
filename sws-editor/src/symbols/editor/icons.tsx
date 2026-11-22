// The line icons of the symbol editor (22-11-2026): the same drawing as the
// IDE's (`editor/iconeStrumenti.ts`, `editor/iconeIde.ts`), so a rectangle in
// the editor's tools looks like the rectangle in the IDE's tools. The few the
// IDE has not got are Tabler Icons (MIT, see `editor/iconeIde.LICENSE.txt`).

import { ICONE_IDE } from "@/editor/iconeIde";
import { ICONE_STRUMENTI } from "@/editor/iconeStrumenti";
import type { Op } from "./model";

const OWN: Record<string, string> = {
  circle: '<circle cx="12" cy="12" r="8"/>',
  // A pipe's end with its flange: where a pipe hooks onto the symbol.
  port: '<path d="M3 9h9v6H3"/><path d="M12 6v12"/><path d="M15 12h6"/>',
  eye: '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>', // tabler: eye
  "eye-off": '<path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"/><path d="M3 3l18 18"/>', // tabler: eye-off
  group: '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>', // tabler: copy
  up: '<path d="M12 5v14"/><path d="M18 11l-6 -6l-6 6"/>', // tabler: arrow-up
  down: '<path d="M12 5v14"/><path d="M18 13l-6 6l-6 -6"/>', // tabler: arrow-down
  dot: '<circle cx="12" cy="12" r="2.5"/>',
};

const ICONS: Record<string, string> = {
  select: ICONE_IDE.pointer,
  rect: ICONE_STRUMENTI.rect,
  ellipse: ICONE_STRUMENTI.ellipse,
  line: ICONE_STRUMENTI.line,
  poly: ICONE_STRUMENTI.polyline,
  photo: ICONE_STRUMENTI.image,
  importSvg: ICONE_IDE.upload,
  lock: ICONE_IDE.lock,
  unlock: ICONE_IDE.unlock,
  ...OWN,
};

export function EditorIcon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      // The click belongs to the button around it.
      style={{ flexShrink: 0, display: "block", pointerEvents: "none" }}
      // Our own constant content: no user data goes through here.
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.dot }} />
  );
}

/** The icon of a shape in the layers list. */
export function opIcon(op: Op): string {
  switch (op.op) {
    case "forma": {
      const tag = String(op.tag);
      return tag === "rect" || tag === "ellipse" || tag === "circle" ? tag : "poly";
    }
    case "tratto": return "line";
    case "image": return "photo";
    case "bocca": return "port";
    default: return "dot";
  }
}
