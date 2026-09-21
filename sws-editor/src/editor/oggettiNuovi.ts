// Com'è fatto un oggetto appena piazzato dalla palette: dimensioni, contenuto
// predefinito ("Testo", "Bottone" — contenuto di progetto, non interfaccia) e
// i colori **fissi** della tabella `coloriPredefiniti.ts`.
//
// I colori **automatici** (testo, linea, tubo) qui non compaiono: il campo
// resta assente e l'oggetto segue lo sfondo della pagina. Fino al 21-09-2026
// questo `switch` stava dentro `EditorShell.handleAddObject` e scriveva nel
// progetto stringhe CSS `var(…)` con un token del marchio: l'SVG le disegnava, il
// selettore colore del pannello le mostrava nere, il pannello LVGL le
// scartava. Separato per essere provabile: il test verifica che nessun tipo
// della palette nasca con un `var(` dentro.

import type { SynopticObject } from "@/types";
import { predefinito } from "@/coloriPredefiniti";

/** L'oggetto nuovo di `type` in (`x`, `y`), o `null` per i tipi che prima
 *  chiedono qualcosa all'utente (`image`: un file; `symbol`: quale simbolo) e
 *  che EditorShell crea dopo la scelta. */
/** Quello che `addObject` accetta: un oggetto completo meno l'`id`, che lo store assegna. */
export type OggettoNuovo = Omit<SynopticObject, "id">;

export function oggettoNuovo(type: SynopticObject["type"], x: number, y: number): OggettoNuovo | null {
    switch (type) {
      case "rect":
        return { type, x, y, width: 150, height: 80, fill: "#4a90d9" };
      case "ellipse":
        return { type, x, y, width: 120, height: 80, fill: "#4a90d9" };
      case "line":
        return { type, x, y, x2: x + 120, y2: y, stroke_width: 2 };
      case "text":
        return { type, x, y: y + 14, text: "Testo", font_size: 14, text_anchor: "start" };
      case "button":
        return { type, x, y, width: 120, height: 40, fill: predefinito("button", "fill"), label: "Bottone", write_value: true };
      case "navbutton":
        return { type, x, y, width: 140, height: 36, label: "Vai alla pagina" };
      case "page_navigator":
        // Una barra in alto: un bottone per pagina, si dividono lo spazio.
        return { type, x, y, width: 480, height: 44, nav_orientation: "horizontal", nav_fill: true, nav_gap: 4 };
      case "lang_selector":
        return { type, x, y, width: 120, height: 32 };
      case "lang_button":
        return { type, x, y, width: 70, height: 32, target_lang: "" };
      case "checkbox":
        return { type, x, y, width: 120, height: 30, label: "Checkbox", checked_value: true, unchecked_value: false };
      case "radio":
        return { type, x, y, width: 160, height: 80, label: "Radio", orientation: "vertical",
          options: [{ label: "Opzione 1", value: "1" }, { label: "Opzione 2", value: "2" }] };
      case "slider":
        return { type, x, y, width: 200, height: 40, min: 0, max: 100, step: 1, orientation: "horizontal" };
      case "setpoint":
        return { type, x, y, width: 140, height: 56, label: "Setpoint", min: 0, max: 100, step: 1 };
      case "gauge":
        return { type, x, y, width: 180, height: 180, min: 0, max: 100, label: "Gauge" };
      case "led":
        return { type, x, y, width: 40, height: 40, on_value: true, on_color: predefinito("led", "on_color"), off_color: predefinito("led", "off_color") };
      case "state_lamp":
        return { type, x, y, width: 140, height: 24, font_size: 13,
          text_list_entries: [
            { value: 0, label: "Fermo", color: "#94a3b8" },
            { value: 1, label: "Marcia", color: "#22c55e" },
            { value: 2, label: "Allarme", color: "#ef4444" },
          ] };
      case "progress_bar":
        return { type, x, y, width: 200, height: 30, min: 0, max: 100, fill: predefinito("progress_bar", "fill"), show_value: true };
      case "table":
        return { type, x, y, width: 300, height: 120,
          table_rows: [{ label: "Tag 1", tag: "", format: "{value:.1f}" }] };
      case "trend":
        return { type, x, y, width: 360, height: 180,
          trend_tags: [{ tag: "" }], window_s: 60 };
      case "xy_plot":
        return { type, x, y, width: 200, height: 200,
          xy_series: [{ tag: "", y_tag: "" }], xy_trail_s: 30 };
      case "text_list":
        return { type, x, y, width: 120, height: 32, font_size: 16, text_anchor: "middle",
          text_list_entries: [
            { value: 0, label: "Chiuso", color: "#94a3b8" },
            { value: 1, label: "Aperto", color: "#22c55e" },
          ],
          text_list_default: "N/D", text_list_default_color: "#ef4444" };
      case "bar_chart":
        return { type, x, y, width: 240, height: 180, min: 0, max: 100,
          bar_orientation: "vertical", bar_show_values: true, bar_show_labels: true,
          bar_show_thresholds: true, bar_gap: 0.2,
          bar_series: [
            { tag: "", label: "Linea 1", color: "#3b82f6" },
            { tag: "", label: "Linea 2", color: "#22c55e" },
          ] };
      case "pie_chart":
        return { type, x, y, width: 200, height: 200, pie_mode: "pie",
          pie_show_labels: true,
          pie_slices: [
            { tag: "", label: "Zona 1", color: "#3b82f6" },
            { tag: "", label: "Zona 2", color: "#22c55e" },
            { tag: "", label: "Zona 3", color: "#f59e0b" },
          ] };
      case "sparkline":
        return { type, x, y, width: 120, height: 30, tag: "",
          spark_window_s: 60, spark_color: predefinito("sparkline", "spark_color"),
          spark_fill: true, spark_fill_opacity: 0.2, spark_stroke_width: 1.5 };
      case "kpi_tile":
        return { type, x, y, width: 180, height: 100, tag: "", label: "KPI",
          spark_window_s: 3600 };
      case "data_log":
        return { type, x, y, width: 380, height: 240, tag: "", label: "Data log",
          window_s: 3600, datalog_page_size: 25 };
      case "alarm_viewer":
        return { type, x, y, width: 360, height: 160,
          alarm_viewer_max_rows: 5, alarm_viewer_mode: "list",
          alarm_viewer_show_ack: true, alarm_viewer_show_ts: true, alarm_viewer_show_empty: true };
      case "alarm_bell":
        return { type, x, y, width: 130, height: 34,
          alarm_bell_show_history: true, alarm_bell_show_shelve: true };
      case "alarm_banner":
        return { type, x, y, width: 600, height: 32 };
      case "alarm_history":
        return { type, x, y, width: 420, height: 220 };
      case "recipe_panel":
        return { type, x, y, width: 260, height: 160 };
      case "image":
        return null; // scelta nel browser dei file: lo fa EditorShell
      case "symbol":
        return null; // scelta nel modale dei simboli: lo fa EditorShell
      case "grid":
        return { type, x, y, width: 400, height: 300,
          label: "Grid",
          grid_rows: 2, grid_cols: 2,
          grid_cells: [],
          grid_show_borders: true,
          grid_border_color: predefinito("grid", "grid_border_color") };
      case "pipe":
        return {
          type, x, y,
          points: [{ x, y }, { x: x + 120, y }, { x: x + 120, y: y + 80 }],
          routing: "straight",
          pipe_style: "flat",
          stroke_width: 8,
        };
      case "faceplate":
        return { type, x, y, width: 120, height: 80 };
      default:
        return { type, x, y, width: 120, height: 80 };
    }
}
