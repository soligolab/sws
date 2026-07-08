#!/usr/bin/env bash
#
# SWS editor (IDE-only) portable launcher.
# Unpack the tarball anywhere and run ./run-editor.sh — no root, no systemd.
#
# Serves ONLY the admin IDE (canvas designer) on http://localhost:8460.
# There is NO operator viewer: the editor designs projects, then deploys them
# to a runtime device from the IDE (ConfigView -> Runtime -> Connect).
#
# All data lives next to this script under ./data/ so the package is fully
# self-contained. Delete ./data/ for a clean slate.
#
# Overridable via environment:
#   SWS_ADMIN_PORT      IDE port (default 8460)
#   RUST_LOG=debug      verbose logging
#
# By default the editor runs in no-auth mode (no login), matching the dev
# editor (scripts/start_editor.sh). Set SWS_ADMIN_USER + SWS_ADMIN_PASSWORD
# before launching to require a login instead.

set -euo pipefail

# Resolve the package root (this script's own directory) so it runs from anywhere.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PORT="${SWS_ADMIN_PORT:-8460}"

# Data dirs live next to the package.
CONFIG_DIR="$HERE/data/config"
PROJECTS_ROOT="$HERE/data/projects"
mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT"

# The binary links libpython via PyO3 and needs a python3 available at runtime.
if [ -z "${PYO3_PYTHON:-}" ] && command -v python3 >/dev/null 2>&1; then
    export PYO3_PYTHON=python3
fi

cat <<MSG

────────────────────────────────────────────────────────────────
SWS IDE (editor) — pronto

  Apri il designer:   http://localhost:${PORT}
  Dati (progetti, config) in ./data/
  Connetti un runtime: ConfigView -> Runtime -> Connetti
  Stop: Ctrl-C
────────────────────────────────────────────────────────────────

MSG

# IDE-only: no --viewer-port, so only the admin port binds. A fresh config has
# no TLS cert, so the admin port serves plain HTTP (localhost is a browser
# secure context, so HTTPS is not required for the IDE).
exec "$HERE/bin/sws-runtime" \
    --config         "$CONFIG_DIR" \
    --projects-root  "$PROJECTS_ROOT" \
    --templates-root "$HERE/templates" \
    --admin-port     "$PORT" \
    --www            "$HERE/www"
