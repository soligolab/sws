import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

export interface PythonEditorHandle {
  /** Insert text at the current cursor position, replacing any selection. */
  insertAtCursor: (text: string) => void;
  /** Focus the editor surface. */
  focus: () => void;
}

interface PythonEditorProps {
  value: string;
  onChange: (next: string) => void;
  height?: number | string;
  /** When true, intercepts Tab so it indents instead of leaving the field. */
  indentTab?: boolean;
  /** Read-only mode for preview. */
  readOnly?: boolean;
}

/**
 * CodeMirror 6 wrapper for Python code. Used by FunctionEditor for the
 * full-screen function body and (via PythonCodeModal) for quick edits.
 *
 * Keeps state in a single EditorView instance so undo/redo within the
 * editor survives React re-renders. External `value` changes are diffed
 * against the current document and re-applied surgically — typing here
 * doesn't trigger a round-trip back through React state.
 */
export const PythonEditor = forwardRef<PythonEditorHandle, PythonEditorProps>(
  function PythonEditor({ value, onChange, height = "100%", indentTab = true, readOnly = false }, ref) {
    const hostRef     = useRef<HTMLDivElement | null>(null);
    const viewRef     = useRef<EditorView | null>(null);
    // Hold the latest onChange in a ref so the listener doesn't capture a stale closure.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const readOnlyComp = useRef(new Compartment());

    // Build the EditorView once on mount.
    useEffect(() => {
      if (!hostRef.current) return;
      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...(indentTab ? [indentWithTab] : []),
          ]),
          python(),
          oneDark,
          readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            ".cm-content": { caretColor: "#e2e8f0" },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      });
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      return () => { view.destroy(); viewRef.current = null; };
    // Intentionally run once — props are reconciled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync external `value` into the editor when it diverges (e.g. user
    // picks a different function from the sidebar).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }, [value]);

    // Sync read-only toggle without re-creating the view.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(readOnly)),
      });
    }, [readOnly]);

    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        view.focus();
      },
      focus: () => viewRef.current?.focus(),
    }), []);

    return (
      <div
        ref={hostRef}
        style={{
          height,
          width: "100%",
          minHeight: 0,
          background: "#282c34", // matches one-dark
          border: "1px solid #334155",
          borderRadius: 4,
          overflow: "hidden",
        }}
      />
    );
  }
);
