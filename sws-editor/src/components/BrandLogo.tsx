import { useState } from "react";
import { getBrand } from "@/branding";

/**
 * Active white-label brand logo, top-left in the header. Falls back to the
 * brand short name if the image is missing or fails to load. See @/branding.
 */
export function BrandLogo() {
  const brand = getBrand();
  const [failed, setFailed] = useState(false);

  if (brand.logoUrl && !failed) {
    return (
      <img
        src={brand.logoUrl}
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
