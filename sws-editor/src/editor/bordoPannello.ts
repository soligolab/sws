/** Il trascinamento del bordo di un pannello (31-10-2026).
 *
 *  Durante il trascinamento la larghezza va **sull'elemento**, una volta per
 *  fotogramma, e chi tiene lo stato lo sente una volta sola, al rilascio. Il
 *  pannello destro teneva la larghezza nello stato di EditorShell e la
 *  aggiornava a ogni pixel: si ridisegnava l'editor intero, canvas compreso, e
 *  su una pagina piena il bordo non stava dietro al mouse — lo stesso guasto
 *  dei selettori colore.
 *
 *  Il contenuto da allargare è `contenuto`, o il fratello subito dopo la
 *  maniglia (il pannello destro, che ha la maniglia sul bordo sinistro). */
export function trascinaBordo(e: React.MouseEvent, o: {
  larghezza: number;
  min: number;
  max: number;
  /** -1 se la maniglia sta sul bordo sinistro (il pannello destro). */
  verso: 1 | -1;
  /** L'elemento da allargare, quando non è il fratello dopo la maniglia. */
  contenuto?: HTMLElement | null;
  onFine: (larghezza: number) => void;
}): void {
  e.preventDefault();
  const startX = e.clientX;
  const contenuto = o.contenuto ?? (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
  let larghezza = o.larghezza;
  let fotogramma: number | null = null;
  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";
  const onMove = (ev: MouseEvent) => {
    larghezza = Math.min(o.max, Math.max(o.min, o.larghezza + o.verso * (ev.clientX - startX)));
    if (contenuto && fotogramma === null) fotogramma = requestAnimationFrame(() => {
      fotogramma = null;
      contenuto.style.width = `${larghezza}px`;
    });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (fotogramma !== null) cancelAnimationFrame(fotogramma);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    o.onFine(larghezza);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
