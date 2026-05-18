#!/usr/bin/env sh
set -eu

if [ -z "${SWS_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: SWS_ADMIN_PASSWORD environment variable is required." >&2
  echo "       Set a strong password before starting the container." >&2
  exit 1
fi

# Kiosk mode (PX30 / RK3399 / any ARM64 SBC with a connected display).
# Uncomment one of these CMD overrides in compose.yaml — or just append
# them to the sws-runtime args — to have the runtime open a fullscreen
# browser by itself once /health answers OK. The browser binary must be
# present in the image (this stock Dockerfile does NOT install one):
#
#   command: ["sws-runtime",
#             "--www", "/var/sws/www",
#             "--kiosk-browser", "chromium --kiosk --no-sandbox --app=https://localhost:8443"]
#
# Alternatives:
#   epiphany-browser --application-mode https://localhost:8443
#   firefox --kiosk https://localhost:8443
#   cage -- chromium --kiosk --app=https://localhost:8443     # wayland-only kiosk wrapper

exec "$@"
