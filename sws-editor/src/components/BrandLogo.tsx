import { useState } from "react";
import { getBrand } from "@/branding";
import { useAppStore } from "@/store";

/**
 * Active white-label brand logo, top-left in the header. Falls back to the
 * brand short name if the image is missing or fails to load. See @/branding.
 *
 * Nel tema chiaro usa `logoChiaroUrl`, se il marchio ne ha uno (30-10-2026):
 * la scritta «SWS» del logo standard è chiara e su fondo bianco quasi non si
 * vedeva. Il tema si legge da `data-theme` sul `<html>`, come fa il CSS:
 * `themeMode` può valere "system", e serve solo a ridisegnare al cambio.
 */
export function BrandLogo() {
  const brand = getBrand();
  const [failed, setFailed] = useState(false);
  useAppStore((s) => s.themeMode);
  const chiaro = typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "light";
  const src = (chiaro && brand.logoChiaroUrl) || brand.logoUrl;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={brand.name}
        title={brand.name}
        style={{ height: 26, width: "auto", display: "block" }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <strong style={{ letterSpacing: 1, fontSize: 15, color: "var(--brand-text, #e2e8f0)" }}>
      {brand.shortName}
    </strong>
  );
}
