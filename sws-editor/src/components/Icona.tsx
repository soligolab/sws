// An icon of the IDE that follows the style (plan docs/archive/2026-11-14-stile-sobrio.md,
// session 3, 16-11-2026): in the colourful style the emoji the IDE always had,
// in the sober one a line icon from `ICONE_IDE`, drawn in the one colour the
// person chose for icons (`--sws-icone`). An icon missing from the registry
// falls back to the emoji, so a new emoji never leaves a hole.
import type React from "react";
import { useAppStore } from "@/store";
import { EMOJI_ICON_NAMES, ICONE_IDE } from "@/editor/iconeIde";
import { ICONE_ATTIVITA } from "@/editor/iconeAttivita";

/** The variation selector some emoji carry (`⚙️`): the registry is keyed without it. */
const bare = (emoji: string) => emoji.replace(/\uFE0F/g, "");

const byName = (name: string | undefined) => (name ? ICONE_IDE[name] ?? ICONE_ATTIVITA[name] : undefined);

/** The concept an icon is drawn from: the explicit name when it has an icon,
 *  else the one the emoji stands for. `undefined`: there is only the emoji. */
export function iconNameOf(nome: string | undefined, emoji: string): string | undefined {
  if (byName(nome)) return nome;
  const fromEmoji = EMOJI_ICON_NAMES[bare(emoji)];
  return byName(fromEmoji) ? fromEmoji : undefined;
}

/** The SVG content for a name, or for the emoji when the name has no icon. */
export function iconSvg(nome: string | undefined, emoji: string): string | undefined {
  return byName(iconNameOf(nome, emoji));
}

/** True in the sober style: for the few places an icon cannot go (the text of
 *  an `<option>`), which then show the icon next to the control instead. */
export function useSoberStyle(): boolean {
  return useAppStore((s) => s.ideStyle) === "sober";
}

export function Icona({ nome, emoji, size = "1.1em", color, style }: {
  /** The concept in `ICONE_IDE` (or an activity-bar item); without it the emoji says which. */
  nome?: string;
  /** What the colourful style shows, and the fallback of the sober one. */
  emoji: string;
  size?: number | string;
  /** The stroke colour; default the icons colour of the sober style, else the text's.
   *  Pass `currentColor` on a filled button, where the text colour is the readable one. */
  color?: string;
  /** Extra style of the line icon; the emoji takes the style of the text around it. */
  style?: React.CSSProperties;
}) {
  const sober = useSoberStyle();
  const name = sober ? iconNameOf(nome, emoji) : undefined;
  const svg = byName(name);
  // The emoji as the plain text it always was: no wrapper, so the colourful
  // IDE keeps the very same DOM (and the same accessible names) as before.
  if (!svg) return <>{emoji}</>;
  return (
    <svg aria-hidden="true" data-icon={name} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: color ?? "var(--sws-icone, currentColor)", flexShrink: 0, verticalAlign: "-0.15em", ...style }}
      // Our own constant content: no user data goes through here.
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
