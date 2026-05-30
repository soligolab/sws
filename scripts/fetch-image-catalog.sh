#!/usr/bin/env bash
# Downloads a curated subset of SVG icons from 4 open-source libraries
# into sws-editor/public/images/{mdi,equinor,tabler,electrical}/
# and generates sws-editor/public/images/catalog.json.
#
# Run from the repository root: bash scripts/fetch-image-catalog.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/sws-editor/public/images"
mkdir -p "$OUT"/{mdi,equinor,tabler,electrical}

echo "==> Downloading Material Design Icons (Apache 2.0)..."
MDI_BASE="https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg"
MDI_ICONS=(
  # Process / fluid
  pump water water-pump pipe-valve pipe valve
  # Thermal
  thermometer thermometer-high thermometer-low thermometer-alert
  fire fire-alert flame
  # Electrical
  lightning-bolt power power-plug current-ac current-dc
  electric-switch fuse
  # Mechanical
  fan cog cog-outline gear settings-outline wrench
  motor-outline
  # Sensors / instruments
  gauge gauge-empty gauge-full gauge-low
  temperature-celsius temperature-fahrenheit
  speedometer speedometer-slow
  # Alarms / status
  alarm alarm-light bell bell-off alert alert-circle
  alert-triangle warning shield-alert
  # Controls
  play pause stop restart refresh
  play-circle pause-circle stop-circle
  # UI
  check check-circle close close-circle
  arrow-up arrow-down arrow-left arrow-right
  eye eye-off lock lock-open
  home database server network wifi
  # Energy
  solar-panel battery battery-charging wind-turbine
  transmission-tower
)
DOWNLOADED_MDI=0
for icon in "${MDI_ICONS[@]}"; do
  dest="$OUT/mdi/${icon}.svg"
  if [ ! -f "$dest" ]; then
    if curl -sf "$MDI_BASE/${icon}.svg" -o "$dest" 2>/dev/null; then
      DOWNLOADED_MDI=$((DOWNLOADED_MDI + 1))
    fi
  fi
done
echo "    MDI: $(ls "$OUT/mdi/"*.svg 2>/dev/null | wc -l) files"

echo "==> Downloading Equinor Engineering Symbols (MIT)..."
TMP_EQ=$(mktemp -d)
# Download the tarball and extract SVG files
if curl -sfL \
  "https://github.com/equinor/engineering-symbols/archive/refs/heads/main.tar.gz" \
  -o "$TMP_EQ/equinor.tar.gz" 2>/dev/null; then
  # Look for SVG files in the archive
  tar xzf "$TMP_EQ/equinor.tar.gz" -C "$TMP_EQ" 2>/dev/null || true
  # Copy any SVG files found
  find "$TMP_EQ" -name "*.svg" ! -path "*/node_modules/*" ! -path "*/__tests__/*" \
    -exec cp {} "$OUT/equinor/" \; 2>/dev/null || true
  echo "    Equinor: $(ls "$OUT/equinor/"*.svg 2>/dev/null | wc -l) files"
else
  echo "    Equinor: download failed (network unavailable?), skipping"
fi
rm -rf "$TMP_EQ"

echo "==> Downloading Tabler Icons (MIT)..."
TABLER_BASE="https://raw.githubusercontent.com/tabler/tabler-icons/master/icons/outline"
TABLER_ICONS=(
  # Navigation / arrows
  arrow-up arrow-down arrow-left arrow-right
  arrow-up-circle arrow-down-circle
  chevron-up chevron-down chevron-left chevron-right
  # Alerts / status
  alert-triangle alert-circle alert-octagon
  info info-circle
  check check-circle
  x x-circle
  # Controls
  player-play player-pause player-stop
  player-play-filled player-pause-filled player-stop-filled
  refresh reload
  # Settings / config
  settings settings-2 adjustments-horizontal
  tool tools
  # Visibility
  eye eye-off
  # Security
  lock lock-open
  # Notifications
  bell bell-off bell-ringing
  # Data / monitoring
  chart-line chart-bar trending-up trending-down
  activity pulse
  # Time
  clock clock-hour-3 history
  # Connection
  wifi wifi-off
  link unlink
  # Power
  power power-off
  # File / data
  database table
)
DOWNLOADED_TABLER=0
for icon in "${TABLER_ICONS[@]}"; do
  dest="$OUT/tabler/${icon}.svg"
  if [ ! -f "$dest" ]; then
    if curl -sf "$TABLER_BASE/${icon}.svg" -o "$dest" 2>/dev/null; then
      DOWNLOADED_TABLER=$((DOWNLOADED_TABLER + 1))
    fi
  fi
done
echo "    Tabler: $(ls "$OUT/tabler/"*.svg 2>/dev/null | wc -l) files"

echo "==> Downloading Electrical Symbol Library (CC0)..."
TMP_EL=$(mktemp -d)
if curl -sfL \
  "https://github.com/basverdoes/ElectricalSymbolLibrary/archive/refs/heads/main.tar.gz" \
  -o "$TMP_EL/electrical.tar.gz" 2>/dev/null; then
  tar xzf "$TMP_EL/electrical.tar.gz" -C "$TMP_EL" 2>/dev/null || true
  find "$TMP_EL" -name "*.svg" \
    -exec cp {} "$OUT/electrical/" \; 2>/dev/null || true
  echo "    Electrical: $(ls "$OUT/electrical/"*.svg 2>/dev/null | wc -l) files"
else
  echo "    Electrical: download failed (network unavailable?), skipping"
fi
rm -rf "$TMP_EL"

echo "==> Generating catalog.json..."
node - <<'NODE'
const fs   = require("fs");
const path = require("path");

const BASE = process.argv[1].includes("node")
  ? path.join(process.env.REPO_ROOT ?? ".", "sws-editor/public/images")
  : "sws-editor/public/images";

// Use cwd-relative path
const base = path.resolve("sws-editor/public/images");

const cats = [
  { id: "mdi",        label: "Material Design Icons",       license: "Apache 2.0" },
  { id: "equinor",    label: "Equinor Engineering Symbols", license: "MIT" },
  { id: "tabler",     label: "Tabler Icons",                license: "MIT" },
  { id: "electrical", label: "Electrical Symbol Library",   license: "CC0" },
];

const catalog = {
  categories: cats.map(cat => {
    const dir = path.join(base, cat.id);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith(".svg")).sort(); }
    catch (_) {}
    return {
      ...cat,
      items: files.map(f => ({
        id:    `${cat.id}-${path.basename(f, ".svg")}`,
        path:  `/images/${cat.id}/${f}`,
        label: path.basename(f, ".svg").replace(/[-_]/g, " "),
      })),
    };
  }),
};

fs.writeFileSync(path.join(base, "catalog.json"), JSON.stringify(catalog, null, 2));
const summary = catalog.categories.map(c => `${c.id}: ${c.items.length}`).join(", ");
console.log("catalog.json written —", summary);
NODE

echo "==> Done."
echo "    Total images: $(find "$OUT" -name '*.svg' | wc -l)"
