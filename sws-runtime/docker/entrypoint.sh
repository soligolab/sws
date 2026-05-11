#!/usr/bin/env sh
set -eu

if [ -z "${SWS_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: SWS_ADMIN_PASSWORD environment variable is required." >&2
  echo "       Set a strong password before starting the container." >&2
  exit 1
fi

exec "$@"
