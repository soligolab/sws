import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

/** L'anteprima del PNG di una pagina di boot, nel pannello della pagina (T-72 F4).
 *
 *  Mostra il PNG **che c'è sul server** — quello che il deploy installerà — e non
 *  una simulazione: se il PNG è indietro rispetto al disegno, lo dice. «Rigenera»
 *  lo rifà subito (senza aspettare «Salva»); «Scarica» lo dà com'è. */
export function AnteprimaPng({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const page = useAppStore((s) => s.pages.find((p) => p.id === pageId));
  const esito = useAppStore((s) => s.bootPng[pageId]);
  const setBootPng = useAppStore((s) => s.setBootPng);
  const [url, setUrl] = useState<string | null>(null);
  const [byte, setByte] = useState<number | null>(null);
  const [occupato, setOccupato] = useState(false);
  const nome = page?.name;

  // Rilegge il PNG dal server quando cambia il nome o ne è stato generato uno nuovo.
  useEffect(() => {
    if (!nome) return;
    let vivo = true;
    let corrente: string | null = null;
    api.getBootPng(nome).then((blob) => {
      if (!vivo) return;
      if (!blob) { setUrl(null); setByte(null); return; }
      corrente = URL.createObjectURL(blob);
      setUrl(corrente); setByte(blob.size);
    }).catch(() => { if (vivo) { setUrl(null); setByte(null); } });
    return () => { vivo = false; if (corrente) URL.revokeObjectURL(corrente); };
  }, [nome, esito?.quando]);

  if (!page) return null;

  const rigenera = async () => {
    setOccupato(true);
    try {
      const { rasterizzaPagina, MAX_PNG_BYTES } = await import("@/boot/rasterizza");
      const { png, avvisi } = await rasterizzaPagina(page, useAppStore.getState().customSymbols ?? []);
      if (png.size > MAX_PNG_BYTES) throw new Error(t("boot.pngTooLarge", { kb: Math.round(png.size / 1024) }));
      await api.putBootPng(page.name, png);
      setBootPng(page.id, { ok: true, byte: png.size, messaggio: avvisi.join(" ") || undefined }, JSON.stringify(page));
      // Il PNG entra nell'impronta del progetto, e questo non passa da «Salva»: senza
      // l'evento il sorvegliante lo leggerebbe come un deploy esterno («il progetto
      // sul runtime è cambiato») — visto nelle schermate del manuale, 20-09-2026.
      try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ }
    } catch (e) {
      setBootPng(page.id, { ok: false, messaggio: e instanceof Error ? e.message : String(e) });
    } finally {
      setOccupato(false);
    }
  };

  const scarica = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0" }}>
      <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", fontWeight: 700 }}>{t("boot.previewTitle")}</div>
      {url ? (
        <img src={url} alt={t("boot.previewAlt")}
          style={{ width: "100%", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, background: "#000" }} />
      ) : (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 4, padding: 8 }}>
          {t("boot.noPng")}
        </div>
      )}
      {byte !== null && (
        <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
          {page.width}×{page.height} · {Math.max(1, Math.round(byte / 1024))} KB
        </div>
      )}
      {esito?.ok && esito.messaggio && (
        <div style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", background: "#451a0322", border: "1px solid #92400e", borderRadius: 4, padding: "4px 8px" }}>
          {t("boot.pngWithWarnings", { msg: esito.messaggio })}
        </div>
      )}
      {esito && !esito.ok && (
        <div style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", background: "#451a0322", border: "1px solid #92400e", borderRadius: 4, padding: "4px 8px" }}>
          {t("boot.pngNotUpdated", { err: esito.messaggio ?? "" })}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={occupato} onClick={rigenera} style={BTN} title={t("boot.regenerateHint")}>
          {occupato ? t("boot.generating") : t("boot.regenerate")}
        </button>
        <button type="button" disabled={!url} onClick={scarica} style={BTN}>{t("boot.download")}</button>
      </div>
    </div>
  );
}

const BTN: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer",
};
