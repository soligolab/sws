// Choosing a photo for a symbol (plan docs/plans/2026-11-21-simboli-fase-3-foto.md):
// the image library of the project, opened from anywhere in the symbol editor
// — the toolbar, a photo's properties, the entries of a signal — and answered
// as a promise, so none of them has to carry the dialog's state.

import { useSyncExternalStore } from "react";
import { ImageBrowser, type ImageSize } from "@/components/ImageBrowser";
import { imageNameOf } from "@/images/usage";
import { avviso } from "@/finestraAvviso/finestraAvviso";
import i18n from "i18next";
import { photoNameOk } from "./model";

export interface PickedPhoto { name: string; size?: ImageSize }

let pending: ((p: PickedPhoto | null) => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Opens the image library; the photo chosen, or `null`. Only a photo of the
 *  project the panel can draw: an icon of the catalog or an SVG is refused,
 *  with the reason. */
export function pickPhoto(): Promise<PickedPhoto | null> {
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
    notify();
  });
}

function answer(p: PickedPhoto | null): void {
  const r = pending;
  pending = null;
  notify();
  r?.(p);
}

/** Checks a path chosen in the image library: the name of a photo, or `null`
 *  with the reason shown. */
export function photoFromPath(path: string): string | null {
  const name = imageNameOf(path);
  if (!name || !photoNameOk(name)) {
    void avviso({ livello: "errore", testo: i18n.t("symbolEditor.photo.onlyProject") });
    return null;
  }
  return name;
}

/** The dialog, while someone is waiting for a photo. Put once in the editor. */
export function PhotoPickerHost() {
  const open = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => pending !== null,
  );
  if (!open) return null;
  return (
    <ImageBrowser mode="choose"
      onSelect={(path, size) => {
        const name = photoFromPath(path);
        answer(name ? { name, size } : null);
      }}
      onClose={() => { if (pending) answer(null); }} />
  );
}
