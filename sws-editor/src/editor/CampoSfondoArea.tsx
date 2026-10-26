/** L'immagine di sfondo dell'**area attiva** della pagina (25-10-2026): fra
 *  testata e piede della cornice, o tutta la pagina se non ne ha. Il maintainer:
 *  «impostare una immagine di sfondo nella parte attiva della finestra, senza
 *  coprire la cornice». Caricare e scegliere funzionano come per lo sfondo di un
 *  oggetto: l'immagine va in `images/` del progetto e viaggia con lui. */
import { dimenticaImmagine } from "@/canvas/ImmagineSvg";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";

const INPUT: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-border, #475569)",
  borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, boxSizing: "border-box",
};

export function CampoSfondoArea({ value, disabled, onChange, boot }: {
  value?: string;
  disabled?: boolean;
  onChange: (v: string | undefined) => void;
  /** Sulla pagina di boot (26-10-2026) l'etichetta e il suggerimento di
   *  default non valgono: non c'e' una cornice, quindi non c'e' un'«area
   *  attiva», e non c'e' nessun pannello LVGL che la disegna — il boot e'
   *  un PNG. Due parole diverse, non un componente diverso. */
  boot?: boolean;
}) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const [carica, setCarica] = useState(false);
  const [immagini, setImmagini] = useState<{ name: string; size_bytes: number }[] | null>(null);
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 3 }}>{t(boot ? "props.sfondoBoot" : "props.sfondoArea")}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="text" style={INPUT} disabled={disabled} placeholder="/api/project/images/…"
          value={value ?? ""} onChange={(e) => onChange(e.target.value.trim() || undefined)} />
        <button type="button" disabled={disabled || carica} title={t("props.bgUploadHint")}
          style={{ ...INPUT, width: "auto", flex: "none", cursor: "pointer", whiteSpace: "nowrap", opacity: carica ? 0.6 : 1 }}
          onClick={() => file.current?.click()}>{carica ? "…" : t("props.bgUpload")}</button>
        {value && (
          <button type="button" disabled={disabled} title={t("props.sfondoAreaTogli")}
            style={{ ...INPUT, width: "auto", flex: "none", cursor: "pointer" }}
            onClick={() => onChange(undefined)}>✕</button>
        )}
      </div>
      <input ref={file} type="file" accept=".png,.jpg,.jpeg,.gif,.svg,.webp" style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          // La whitelist del server accetta solo [A-Za-z0-9._-].
          const sicuro = f.name.replace(/[^A-Za-z0-9._-]+/g, "_");
          setCarica(true);
          try {
            const res = await api.uploadProjectImage(sicuro, f);
            dimenticaImmagine(res.url);
            onChange(res.url);
            setImmagini(null);
          } catch (err: unknown) {
            alert(t("editor.uploadImageFailed", { err: err instanceof Error ? err.message : String(err) }));
          } finally {
            setCarica(false);
          }
        }} />
      <select style={{ ...INPUT, marginTop: 4, cursor: "pointer" }} value="" disabled={disabled}
        onFocus={() => { if (immagini === null) api.listProjectImages().then(setImmagini).catch(() => setImmagini([])); }}
        onChange={(e) => { if (e.target.value) onChange(`/api/project/images/${e.target.value}`); e.target.value = ""; }}>
        <option value="">{t("props.bgPickUploaded")}</option>
        {(immagini ?? []).map((im) => (
          <option key={im.name} value={im.name}>{im.name} ({Math.round(im.size_bytes / 1024)} KB)</option>
        ))}
      </select>
      <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", marginTop: 2, lineHeight: 1.4 }}>
        {t(boot ? "props.sfondoBootHint" : "props.sfondoAreaHint")}
      </div>
    </div>
  );
}
