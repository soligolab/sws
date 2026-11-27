// The place in the fixed header of the Configuration where the open tab puts
// its help text and its buttons (25-11-2026, `config/testata.tsx`). In a file
// of its own so that `comuni.tsx` (SaveBar) can use it without an import cycle.

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { useInVista } from "@/components/Tenuta";

/** The place in the header where the open tab puts its help text and its
 *  buttons. `null` outside a `ConfigView` (a tab rendered alone, in a test). */
export const SlotTestata = createContext<HTMLElement | null>(null);

/** Puts `children` in the fixed header, when the tab is in view. A tab kept
 *  mounted but hidden (`Tenuta`) puts nothing there. Without a header (a tab
 *  rendered alone) the children stay where they are. */
export function AzioniTestata({ children }: { children: React.ReactNode }) {
  const slot = useContext(SlotTestata);
  const inVista = useInVista();
  if (!inVista) return null;
  if (slot === null) return <>{children}</>;
  return createPortal(children, slot);
}

