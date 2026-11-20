// The image library (plan docs/archive/2026-11-19-libreria-immagini.md): the
// images of the project first — with «+ Carica immagine…» as the first tile —
// then the icons that come with SWS. Until 19-11-2026 it showed the icons
// only, and an image of one's own could be uploaded only as a background.

import { useCallback, useEffect, useRef, useState } from "react";
import { ImgProgetto } from "@/canvas/ImmagineSvg";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { api, ImageExistsError, type ProjectImage } from "@/api/client";
import { UploadImage, kb, type UploadedImage } from "@/images/UploadImage";
import { imageUses } from "@/images/usage";
import { safeImageName } from "@/images/optimize";
import { dimenticaImmagine } from "@/canvas/ImmagineSvg";
import { useAppStore } from "@/store";
import { avviso, chiedi, conferma } from "@/finestraAvviso/finestraAvviso";

interface CatalogItem { id: string; path: string; label: string; }
interface CatalogCat  { id: string; label: string; license: string; items: CatalogItem[]; }
interface Catalog     { categories: CatalogCat[]; }

/** The size of an image in pixels, when it is known. */
export interface ImageSize { width: number; height: number }

interface Props {
  /** `place`: a new image object; `choose`: another picture for one; `manage`: from Risorse. */
  mode?: "place" | "choose" | "manage";
  onSelect?: (path: string, size?: ImageSize) => void;
  onClose:  () => void;
}

/** The deploy sends the project in one zip of at most 8 MB (`remote.rs`, `zip_limits`). */
export const DEPLOY_LIMIT_BYTES = 8 * 1024 * 1024;
/** The icons of the catalog are drawn on a square. */
const ICON_SIZE: ImageSize = { width: 64, height: 64 };
const PROJECT = "project";
const imageUrl = (name: string) => `/api/project/images/${name}`;

const OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 9999,
};
const CARD: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 10,
  width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "80vh",
  display: "flex", flexDirection: "column",
  boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
  overflow: "hidden",
};
const TILE: React.CSSProperties = {
  width: 92, background: "none", borderRadius: 6, cursor: "pointer",
  display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 4px",
};
const SMALL: React.CSSProperties = {
  padding: "2px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: "transparent",
  border: "1px solid var(--brand-border, #475569)", color: "var(--brand-text, #e2e8f0)",
};
const tileBorder = (on: boolean) => `1px solid ${on ? "var(--brand-primary, #3b82f6)" : "var(--sws-select-border, #1e3a5f)"}`;

export function ImageBrowser({ mode = "choose", onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tab, setTab] = useState<number | typeof PROJECT>(PROJECT);
  const [filter, setFilter] = useState("");
  const [images, setImages] = useState<ProjectImage[] | null>(null);
  const [selected, setSelected] = useState<{ path: string; size?: ImageSize } | null>(null);
  const [uploading, setUploading] = useState<File[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  // Where each image is used (session B): pages, popups, faceplates of the store.
  const pages = useAppStore((st) => st.pages);
  const faceplates = useAppStore((st) => st.faceplates);
  const uses = imageUses(pages, faceplates);

  const reload = useCallback(() => api.listProjectImages().then(setImages).catch(() => setImages([])), []);
  useEffect(() => {
    fetch("/images/catalog.json").then((r) => r.json()).then(setCatalog).catch(() => {});
    void reload();
  }, [reload]);
  useEffect(() => { filterRef.current?.focus(); }, [tab]);

  const choose = (path: string, size?: ImageSize) => {
    if (mode === "manage" || !onSelect) return;
    onSelect(path, size);
    onClose();
  };
  const sizeOf = (im: ProjectImage): ImageSize | undefined =>
    im.width && im.height ? { width: im.width, height: im.height } : undefined;
  const shown = (images ?? []).filter((im) => !filter || im.name.toLowerCase().includes(filter.toLowerCase()));
  const cat = typeof tab === "number" ? catalog?.categories[tab] : undefined;
  const items = (cat?.items ?? []).filter((i) =>
    !filter || i.label.toLowerCase().includes(filter.toLowerCase()) || i.id.toLowerCase().includes(filter.toLowerCase()));
  const total = (images ?? []).reduce((s, im) => s + im.size_bytes, 0);
  const names = new Set((images ?? []).map((im) => im.name));
  const unused = (images ?? []).filter((im) => !uses.has(im.name)).length;
  const missing = images === null ? [] : [...uses.keys()].filter((n) => !names.has(n));
  const selectedName = selected?.path.startsWith("/api/project/images/") ? selected.path.slice("/api/project/images/".length) : null;
  const selectedUses = selectedName ? uses.get(selectedName) ?? [] : [];

  const rename = async (name: string) => {
    const to = await chiedi({
      titolo: t("imageBrowser.renameTitle"), testo: t("imageBrowser.renameText", { n: uses.get(name)?.length ?? 0 }), iniziale: name,
      valida: (v) => (safeImageName(v) !== v.trim() || !/\.(png|jpe?g|gif|svg|webp)$/i.test(v.trim()) ? t("imageBrowser.badName") : null),
    });
    if (!to || to.trim() === name) return;
    try {
      await useAppStore.getState().rinominaImmagine(name, to.trim());
      dimenticaImmagine(imageUrl(to.trim()));
      await reload();
      setSelected({ path: imageUrl(to.trim()), size: selected?.size });
    } catch (e) {
      void avviso({ livello: "errore", testo: e instanceof ImageExistsError ? t("imageBrowser.nameTaken", { name: to }) : e instanceof Error ? e.message : String(e) });
    }
  };
  const remove = async (name: string) => {
    const n = uses.get(name)?.length ?? 0;
    const ok = await conferma({ titolo: t("imageBrowser.deleteTitle"), pericolo: true,
      testo: n ? t("imageBrowser.deleteUsed", { name, n }) : t("imageBrowser.deleteUnused", { name }) });
    if (!ok) return;
    try {
      await api.deleteProjectImage(name);
      setSelected(null);
      await reload();
    } catch (e) {
      void avviso({ livello: "errore", testo: e instanceof Error ? e.message : String(e) });
    }
  };
  const replace = async (name: string, file: File) => {
    // The same name, so every use follows: the same kind of file too.
    const ext = (s: string) => s.split(".").pop()?.toLowerCase().replace("jpeg", "jpg");
    if (ext(file.name) !== ext(name)) {
      void avviso({ livello: "errore", testo: t("imageBrowser.replaceKind", { ext: ext(name) }) });
      return;
    }
    try {
      await api.uploadProjectImage(name, file, { replace: true });
      dimenticaImmagine(imageUrl(name));
      await reload();
    } catch (e) {
      void avviso({ livello: "errore", testo: e instanceof Error ? e.message : String(e) });
    }
  };
  const goTo = (pageId: string, objectId?: string) => {
    const st = useAppStore.getState();
    st.setCurrentPage(pageId);
    if (objectId) st.selectObject(objectId);
    onClose();
  };
  const imageFiles = (list: FileList | null | undefined) =>
    [...(list ?? [])].filter((f) => /^image\/(png|jpeg|gif|svg\+xml|webp)$/.test(f.type));

  const uploaded = (done: UploadedImage[]) => {
    setUploading(null);
    void reload();
    setTab(PROJECT);
    const first = done[0];
    if (first) setSelected({ path: first.url, size: first.width && first.height ? { width: first.width, height: first.height } : undefined });
  };
  const tabs = [
    { key: PROJECT as number | typeof PROJECT, label: t("imageBrowser.project"), n: images?.length ?? 0 },
    ...(catalog?.categories ?? []).map((c, i) => ({ key: i as number | typeof PROJECT, label: c.label, n: c.items.length })),
  ];

  const modal = (
    // Closed by a press that starts on the backdrop: a click is sent to the
    // common ancestor, and selecting the name in the upload card by dragging
    // out of it closed both windows (collaudo of 20-11-2026).
    <div style={OVERLAY} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div style={{ ...CARD, outline: dragOver ? "2px dashed var(--brand-primary, #3b82f6)" : undefined }}
        data-testid="image-browser"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = imageFiles(e.dataTransfer.files);
          if (files.length) setUploading(files);
        }}>

        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--brand-surface-2, #334155)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", fontSize: 14 }}>
            {mode === "place" ? t("imageBrowser.insertTitle") : t("imageBrowser.libreria")}
          </span>
          <input ref={filterRef} type="text" placeholder={t("common.search")} value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
              color: "var(--brand-text, #e2e8f0)", padding: "4px 10px", fontSize: 12, width: 170, outline: "none" }} />
          <button onClick={onClose} aria-label={t("common.close")}
            style={{ background: "none", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}>
            ✕
          </button>
        </div>

        {/* Tabs: the project first */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--brand-surface-2, #334155)", padding: "0 8px", flexShrink: 0, overflowX: "auto" }}>
          {tabs.map((x) => (
            <button key={String(x.key)} data-testid={`image-tab-${x.key}`}
              onClick={() => { setTab(x.key); setFilter(""); }}
              style={{ background: "none", border: "none", whiteSpace: "nowrap", padding: "8px 12px", fontSize: 12, cursor: "pointer",
                borderBottom: x.key === tab ? "2px solid var(--brand-primary, #3b82f6)" : "2px solid transparent",
                color: x.key === tab ? "var(--sws-select-text, #93c5fd)" : "var(--brand-text-subtle, #64748b)" }}>
              {x.label}<span style={{ marginLeft: 5, fontSize: 10, opacity: 0.6 }}>({x.n})</span>
            </button>
          ))}
        </div>

        {/* Grid */}
        <div style={{ overflowY: "auto", padding: 12, flex: 1, display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start" }}>
          {tab === PROJECT ? (
            <>
              <button data-testid="image-upload-tile" title={t("imageBrowser.uploadHint")}
                onClick={() => fileRef.current?.click()}
                style={{ ...TILE, border: "1px dashed var(--brand-primary, #3b82f6)", color: "var(--sws-select-text, #93c5fd)", justifyContent: "center", minHeight: 88 }}>
                <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 10, textAlign: "center" }}>{t("imageBrowser.upload")}</span>
              </button>
              <input ref={fileRef} type="file" multiple accept=".png,.jpg,.jpeg,.gif,.svg,.webp" style={{ display: "none" }}
                data-testid="image-upload-input"
                onChange={(e) => {
                  const files = imageFiles(e.target.files);
                  e.target.value = "";
                  if (files.length) setUploading(files);
                }} />
              {shown.map((im) => {
                const path = imageUrl(im.name);
                const on = selected?.path === path;
                return (
                  <button key={im.name} data-testid={`image-project-${im.name}`} title={im.name}
                    onClick={() => setSelected({ path, size: sizeOf(im) })}
                    onDoubleClick={() => choose(path, sizeOf(im))}
                    style={{ ...TILE, border: tileBorder(on), background: on ? "var(--brand-surface-2, #334155)" : "none" }}>
                    <ImgProgetto src={path} alt={im.name} loading="lazy" style={{ width: 64, height: 48, objectFit: "contain" }} />
                    <span style={{ fontSize: 9, color: "var(--brand-text-muted, #94a3b8)", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                      {im.name}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--brand-text-subtle, #64748b)" }}>
                      {im.width && im.height ? `${im.width}×${im.height} · ` : ""}{kb(im.size_bytes)}
                    </span>
                    {!uses.has(im.name) && (
                      <span style={{ fontSize: 9, color: "var(--brand-warning-soft, #fbbf24)" }} data-testid={`image-unused-${im.name}`}>
                        {t("imageBrowser.unused")}
                      </span>
                    )}
                  </button>
                );
              })}
              {images !== null && images.length === 0 && (
                <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: "8px 4px", flex: 1, minWidth: 200 }}>
                  {t("imageBrowser.noProjectImages")}
                </div>
              )}
            </>
          ) : (
            <>
              {!catalog && <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: 16, width: "100%" }}>{t("imageBrowser.loadingCatalog")}</div>}
              {catalog && items.length === 0 && <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: 16, width: "100%" }}>{t("imageBrowser.noResults", { filter })}</div>}
              {items.map((item) => {
                const on = selected?.path === item.path;
                return (
                  <button key={item.id} title={item.label}
                    onClick={() => setSelected({ path: item.path, size: ICON_SIZE })}
                    onDoubleClick={() => choose(item.path, ICON_SIZE)}
                    style={{ ...TILE, width: 76, border: tileBorder(on), background: on ? "var(--brand-surface-2, #334155)" : "none" }}>
                    <ImgProgetto src={item.path} alt={item.label} loading="lazy"
                      style={{ width: 44, height: 44, objectFit: "contain", filter: "invert(1) brightness(0.85)" }} />
                    <span style={{ fontSize: 9, color: "var(--brand-text-muted, #94a3b8)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* The selected image of the project: where it is used, and what can be done with it */}
        {tab === PROJECT && selectedName && names.has(selectedName) && (
          <div data-testid="image-manage" style={{ padding: "6px 16px", borderTop: "1px solid var(--brand-surface-2, #334155)",
            display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ color: "var(--brand-text, #e2e8f0)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{selectedName}</strong>
              <button type="button" style={SMALL} data-testid="image-rename" onClick={() => void rename(selectedName)}>{t("imageBrowser.rename")}</button>
              <button type="button" style={SMALL} data-testid="image-replace" onClick={() => { setReplacing(selectedName); replaceRef.current?.click(); }}>{t("imageBrowser.replace")}</button>
              <button type="button" style={{ ...SMALL, color: "var(--brand-danger, #ef4444)" }} data-testid="image-delete" onClick={() => void remove(selectedName)}>{t("common.delete")}</button>
            </div>
            <div data-testid="image-uses">
              {selectedUses.length === 0 ? t("imageBrowser.notUsed") : t("imageBrowser.usedIn", { n: selectedUses.length })}
              {selectedUses.slice(0, 8).map((u, i) => (
                <button key={i} type="button" style={{ ...SMALL, marginLeft: 4 }} onClick={() => goTo(u.pageId, u.objectId)}
                  disabled={u.faceplate}>
                  {u.pageName}{u.objectId ? ` · ${u.objectId}` : ""}
                </button>
              ))}
              {selectedUses.length > 8 && ` …`}
            </div>
          </div>
        )}
        <input ref={replaceRef} type="file" accept=".png,.jpg,.jpeg,.gif,.svg,.webp" style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && replacing) void replace(replacing, f);
            setReplacing(null);
          }} />

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--brand-surface, #1e293b)", fontSize: 10,
          color: "var(--brand-text-subtle, #94a3b8)", display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ flex: 1 }} data-testid="image-browser-info">
            {tab === PROJECT
              ? <>
                  {t("imageBrowser.projectInfo", { n: images?.length ?? 0, size: kb(total), limit: kb(DEPLOY_LIMIT_BYTES) })}
                  {unused > 0 && <> · {t("imageBrowser.unusedCount", { n: unused })}</>}
                  {missing.length > 0 && (
                    <span style={{ color: "var(--brand-danger, #ef4444)" }} title={missing.join(", ")} data-testid="image-missing">
                      {" · "}{t("imageBrowser.missing", { n: missing.length })}
                    </span>
                  )}
                </>
              : cat ? t("imageBrowser.catalogInfo", { n: items.length, of: cat.items.length, license: cat.license }) : ""}
          </span>
          {mode !== "manage" && (
            <button type="button" data-testid="image-browser-confirm" disabled={!selected}
              onClick={() => selected && choose(selected.path, selected.size)}
              style={{ padding: "5px 14px", fontSize: 12, borderRadius: 4, cursor: selected ? "pointer" : "default",
                border: "1px solid var(--brand-primary, #3b82f6)", opacity: selected ? 1 : 0.5,
                background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)" }}>
              {mode === "place" ? t("imageBrowser.insert") : t("imageBrowser.use")}
            </button>
          )}
        </div>
      </div>
      {uploading && (
        <UploadImage files={uploading} taken={(images ?? []).map((im) => im.name)}
          onDone={uploaded} onCancel={() => setUploading(null)} />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}
