// Il motore di rendering di un progetto: le due decisioni, senza React (T-58).
import type { ProjectTarget, ProjectTargetKind } from "../types";

/** Come si scrive un motore nel progetto.
 *
 *  `web` si scrive come **assenza del campo**, non come `{kind: "web"}`: è la
 *  stessa cosa per chi legge (`wanted_engine` in `display_target.rs` tratta
 *  `None` e `Web` allo stesso modo) ed è come stanno tutti i progetti creati
 *  prima che il campo esistesse. Scriverlo esplicitamente aggiungerebbe righe a
 *  `project.yaml` che non dicono niente di nuovo. */
export function targetDaSalvare(kind: ProjectTargetKind): ProjectTarget | null {
  return kind === "web" ? null : { kind };
}

/** Il verso che può far sparire qualcosa dallo schermo.
 *
 *  **LVGL → web non perde mai niente**: il browser disegna più tipi di quanti
 *  ne disegni il pannello, e nessuna delle limitazioni del motore LVGL vale
 *  per il browser. **web → LVGL sì**: simboli personalizzati, immagini
 *  PNG/JPG, barre orizzontali, torte non ad anello, e le azioni dei pulsanti
 *  che sul pannello non esistono affatto.
 *
 *  Fra i due motori LVGL non c'è rischio: cambia come si parla col display,
 *  non che cosa si sa disegnare. */
export function versoRischioso(attuale: ProjectTargetKind, nuovo: ProjectTargetKind): boolean {
  return attuale === "web" && nuovo !== "web";
}
