// «Genera foto» in the AI tab of the symbol editor (plan
// docs/plans/2026-11-21-simboli-fase-3-foto.md): the image model of the
// «Sfondi» purpose photographs one object at the symbol's proportions. The
// photo is saved in the project's images as soon as it arrives (it was paid
// for) and goes under the drawing, where it can be moved, resized or put in
// a live part like any other photo.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { DescrizioneSimbolo } from "@/types";
import { newImage, type Op } from "./model";
import { C, input } from "./ui";

export function AiPhoto({ d, commit }: { d: DescrizioneSimbolo; commit: (d: DescrizioneSimbolo) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const generate = async () => {
    const description = text.trim();
    if (!description || busy) return;
    setBusy(true);
    setNote(null);
    abort.current = new AbortController();
    try {
      const r = await api.symbolAiPhoto({ description, w: d.w, h: d.h }, abort.current.signal);
      if (!r.ok) {
        setNote({ error: true, text: r.code === "no_model" ? t("symbolEditor.aiPhoto.noModel") : r.message ?? r.code });
        return;
      }
      const op = newImage(r.name, d.w, d.h, { width: r.width, height: r.height });
      commit({ ...d, ops: [op, ...(d.ops as Op[])] });
      setNote({
        error: false,
        text: t(r.transparent ? "symbolEditor.aiPhoto.doneTransparent" : "symbolEditor.aiPhoto.done",
          { name: r.name, cost: r.cost_usd.toFixed(2) }),
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNote({ error: true, text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div data-testid="symbol-ai-photo" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 }}>
      <strong>{t("symbolEditor.aiPhoto.title")}</strong>
      <span style={{ color: C.subtle, fontSize: 11 }}>{t("symbolEditor.aiPhoto.hint")}</span>
      <textarea style={{ ...input, minHeight: 52, resize: "vertical" }} value={text} disabled={busy}
        placeholder={t("symbolEditor.aiPhoto.placeholder")} data-testid="symbol-ai-photo-text"
        onChange={(e) => setText(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={{ ...input, width: "auto" }} disabled={busy || !text.trim()} data-testid="symbol-ai-photo-go"
          onClick={() => void generate()}>{busy ? t("symbolEditor.aiPhoto.busy") : t("symbolEditor.aiPhoto.go")}</button>
        {busy && <button type="button" style={{ ...input, width: "auto" }} onClick={() => abort.current?.abort()}>{t("common.cancel")}</button>}
      </div>
      {note && <span style={{ color: note.error ? C.danger : C.muted, fontSize: 11 }} data-testid="symbol-ai-photo-note">{note.text}</span>}
    </div>
  );
}
