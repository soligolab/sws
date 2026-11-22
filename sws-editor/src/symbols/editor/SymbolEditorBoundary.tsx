// A safety net around the symbol editor (test of 2.26.0-rc.23, 21-11-2026): an
// error while drawing the editor unmounted the whole IDE — a blank page, and the
// project gone until F5. Now the editor stops alone, says why, and closes.

import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";
import { useAppStore } from "@/store";
import { HDR_BTN } from "@/components/headerStyles";
import { C } from "./ui";

export class SymbolEditorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("symbol editor stopped", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const close = () => { this.setState({ error: null }); useAppStore.getState().closeSymbolEditor(); };
    return (
      <div data-testid="symbol-editor-crashed" role="alertdialog" style={{
        position: "fixed", inset: 0, zIndex: 9000, background: C.bg, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
      }}>
        <div style={{ maxWidth: 520, padding: 20, border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface }}>
          <strong>{i18n.t("symbolEditor.crashed.title")}</strong>
          <p style={{ color: C.muted }}>{i18n.t("symbolEditor.crashed.text")}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: C.danger, margin: "0 0 12px" }}>{String(error.message || error)}</pre>
          <button type="button" data-testid="symbol-editor-crashed-close" onClick={close} style={HDR_BTN}>
            {i18n.t("symbolEditor.crashed.close")}
          </button>
        </div>
      </div>
    );
  }
}
