import qrcode from "qrcode-generator";
import { useMemo } from "react";

/**
 * A QR code drawn as one SVG path, black on a white quiet zone (phones read
 * it badly without one). Used by the pairing page to carry the cloud link
 * (`<cloud>/#pair=<code>`, 13-11-2026); level M is enough for a screen.
 */
export function QrCode({ text, size = 180, label }: { text: string; size?: number; label?: string }) {
  const { d, cells } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { d: path, cells: n + 8 };
  }, [text]);
  return (
    <svg
      data-testid="qr-abbinamento"
      role="img"
      aria-label={label ?? text}
      width={size}
      height={size}
      viewBox={`0 0 ${cells} ${cells}`}
      shapeRendering="crispEdges"
      style={{ display: "block", borderRadius: 6 }}
    >
      <rect width={cells} height={cells} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
