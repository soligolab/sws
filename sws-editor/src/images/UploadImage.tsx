// The card that uploads images into the project (plan
// docs/plans/2026-11-19-libreria-immagini.md): one file at a time, with its
// preview, its name, «Ottimizza per il pannello» ticked when it is worth it,
// and the three ways out when the name is taken. Used by the image library,
// by a file dropped on the canvas and by a picture pasted from the clipboard.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, ImageExistsError } from "@/api/client";
import { dimenticaImmagine } from "@/canvas/ImmagineSvg";
import {
  freeImageName, imageSize, optimizeImage, optimizedSize, safeImageName, shouldOptimize, withExtension, type Optimized,
} from "./optimize";

export interface UploadedImage { name: string; url: string; width?: number; height?: number }

const OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 10000,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const CARD: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 10,
  width: 420, maxWidth: "calc(100vw - 32px)", padding: 16, display: "flex", flexDirection: "column", gap: 10,
  color: "var(--brand-text, #e2e8f0)", fontSize: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
};
const INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
  color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 12, width: "100%", boxSizing: "border-box",
};
const button = (primary: boolean): React.CSSProperties => ({
  padding: "5px 12px", fontSize: 12, borderRadius: 4, cursor: "pointer",
  border: `1px solid ${primary ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)"}`,
  background: primary ? "var(--brand-primary, #3b82f6)" : "transparent",
  color: primary ? "var(--brand-on-primary, #fff)" : "var(--brand-text, #e2e8f0)",
});

export const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function UploadImage({ files, taken, onDone, onCancel }: {
  files: File[]; taken: string[];
  onDone: (uploaded: UploadedImage[]) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const [done, setDone] = useState<UploadedImage[]>([]);
  const [names, setNames] = useState<string[]>(taken);
  const file = files[i];
  const [base, setBase] = useState(() => safeImageName(file?.name ?? ""));
  const [size, setSize] = useState<[number, number] | null>(null);
  const [optimize, setOptimize] = useState(false);
  const [result, setResult] = useState<Optimized | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // A new file: its name, its size, and the optimised version ready to compare.
  useEffect(() => {
    if (!file) return;
    let live = true;
    setBase(safeImageName(file.name));
    setSize(null); setResult(null); setError(""); setOptimize(false);
    void imageSize(file).then((s) => {
      if (!live) return;
      setSize(s);
      if (s && shouldOptimize(file.type, file.size, s[0], s[1])) {
        setOptimize(true);
        void optimizeImage(file, safeImageName(file.name)).then((r) => { if (live) setResult(r); });
      }
    });
    return () => { live = false; };
  }, [file]);

  if (!file) return null;
  const optimized = optimize && result;
  const finalName = optimized ? withExtension(base, result.name.endsWith(".png") ? "image/png" : "image/jpeg") : base;
  const exists = names.includes(finalName);

  const next = (added?: UploadedImage) => {
    const all = added ? [...done, added] : done;
    if (added) setNames((n) => [...n, added.name]);
    if (i + 1 < files.length) { setDone(all); setI(i + 1); } else onDone(all);
  };
  const upload = async (name: string, replace: boolean) => {
    setBusy(true); setError("");
    try {
      const blob = optimized ? result.blob : file;
      const r = await api.uploadProjectImage(name, blob, { replace });
      dimenticaImmagine(r.url);
      const dims = optimized ? [result.width, result.height] : size;
      next({ name: r.name, url: r.url, width: dims?.[0], height: dims?.[1] });
    } catch (e) {
      if (e instanceof ImageExistsError) setNames((n) => (n.includes(name) ? n : [...n, name]));
      else setError(t("images.upload.failed", { err: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div style={OVERLAY} onClick={onCancel}>
      <div style={CARD} onClick={(e) => e.stopPropagation()} data-testid="upload-image">
        <strong style={{ fontSize: 14 }}>
          {t("images.upload.title")}{files.length > 1 ? ` (${i + 1}/${files.length})` : ""}
        </strong>
        <img src={preview} alt="" style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain", alignSelf: "center",
          background: "var(--brand-bg, #0f172a)", borderRadius: 4 }} />
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{t("images.upload.name")}</span>
          <input style={INPUT} value={base} data-testid="upload-image-name"
            onChange={(e) => setBase(safeImageName(e.target.value))} />
        </label>
        <div style={{ color: "var(--brand-text-muted, #94a3b8)" }} data-testid="upload-image-size">
          {size ? `${size[0]}×${size[1]} px · ` : ""}{kb(file.size)}
        </div>
        {size && shouldOptimize(file.type, file.size, size[0], size[1]) && (
          <label style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input type="checkbox" checked={optimize} data-testid="upload-image-optimize"
              onChange={(e) => setOptimize(e.target.checked)} />
            <span>
              {t("images.upload.optimize")}
              <span style={{ display: "block", color: "var(--brand-text-subtle, #64748b)" }}>
                {result
                  ? t("images.upload.optimizedTo", { w: result.width, h: result.height, size: kb(result.blob.size) })
                  : t("images.upload.optimizing", { w: optimizedSize(size[0], size[1])[0], h: optimizedSize(size[0], size[1])[1] })}
              </span>
            </span>
          </label>
        )}
        {exists ? (
          <div data-testid="upload-image-exists" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "var(--brand-warning-soft, #fbbf24)" }}>{t("images.upload.exists", { name: finalName })}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={button(true)} disabled={busy} data-testid="upload-image-replace"
                onClick={() => void upload(finalName, true)}>{t("images.upload.replace")}</button>
              <button type="button" style={button(false)} disabled={busy} data-testid="upload-image-keep-both"
                onClick={() => void upload(freeImageName(finalName, names), false)}>{t("images.upload.keepBoth")}</button>
              <button type="button" style={button(false)} disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            {files.length > 1 && <button type="button" style={button(false)} disabled={busy} onClick={() => next()}>{t("images.upload.skip")}</button>}
            <button type="button" style={button(false)} disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
            <button type="button" style={button(true)} disabled={busy || !base} data-testid="upload-image-go"
              onClick={() => void upload(finalName, false)}>{busy ? "…" : t("images.upload.go")}</button>
          </div>
        )}
        {error && <div style={{ color: "var(--brand-danger, #ef4444)" }}>{error}</div>}
      </div>
    </div>
  );
  return createPortal(card, document.body);
}
