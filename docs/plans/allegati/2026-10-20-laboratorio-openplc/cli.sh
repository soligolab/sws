#!/usr/bin/env bash
# La CLI dell'Editor OpenPLC v4, senza testa (misura del 20-10-2026).
exec env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE -u DISPLAY -u WAYLAND_DISPLAY \
  "$(dirname "$0")/squashfs-root/open-plc-editor" --cli --user-data "$(cd "$(dirname "$0")" && pwd)/user-data" "$@"
