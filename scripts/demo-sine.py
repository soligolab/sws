#!/usr/bin/env python3
"""
Drive a tag with a sine wave for visual demo of the Trend object.

Logs in via POST /api/auth/login, then loops writing
    value = offset + amplitude * sin(2π * t / period)
to the chosen tag every `--interval` seconds.

Usage (defaults match scripts/dev.sh):
    scripts/demo-sine.py
    scripts/demo-sine.py --tag flow --period 20 --amplitude 25 --offset 50

Stop with Ctrl-C. The runtime's TLS cert is self-signed, so we disable
verification — `urllib` doesn't have a nice flag for that, so we hand-roll
an unverified SSL context. Don't paste this script into production unmodified.
"""

import argparse
import json
import math
import ssl
import sys
import time
import urllib.request
import urllib.error
from typing import Optional


def http(
    method: str,
    url: str,
    body: Optional[dict] = None,
    token: Optional[str] = None,
) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def login(base: str, user: str, password: str) -> str:
    res = http("POST", f"{base}/api/auth/login",
               body={"username": user, "password": password})
    return res["token"]


def write_tag(base: str, tag: str, value: float, token: str) -> None:
    http("PUT", f"{base}/api/tags/{tag}", body={"value": value}, token=token)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url",  default="https://localhost:8443")
    p.add_argument("--user",      default="admin")
    p.add_argument("--password",  default="admin")
    p.add_argument("--tag",       default="sine",
                   help="Tag id to write into. Define it in the editor first.")
    p.add_argument("--period",    type=float, default=10.0,
                   help="Wave period in seconds (default 10).")
    p.add_argument("--amplitude", type=float, default=50.0,
                   help="Wave amplitude (peak - centre).")
    p.add_argument("--offset",    type=float, default=50.0,
                   help="Vertical offset / centre of the wave.")
    p.add_argument("--interval",  type=float, default=0.1,
                   help="Seconds between writes (default 100 ms).")
    args = p.parse_args()

    try:
        token = login(args.base_url, args.user, args.password)
    except urllib.error.HTTPError as e:
        print(f"login failed: {e.code} {e.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"cannot reach runtime at {args.base_url}: {e.reason}", file=sys.stderr)
        return 1

    print(f"logged in as {args.user}; driving '{args.tag}' "
          f"({args.offset} ± {args.amplitude}, period {args.period}s)")
    print("Ctrl-C to stop.")

    t0 = time.monotonic()
    next_at = t0
    omega = 2.0 * math.pi / args.period
    try:
        while True:
            now = time.monotonic()
            t = now - t0
            value = args.offset + args.amplitude * math.sin(omega * t)
            try:
                write_tag(args.base_url, args.tag, value, token)
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    print("session expired — re-logging in", file=sys.stderr)
                    token = login(args.base_url, args.user, args.password)
                    continue
                print(f"write failed: {e}", file=sys.stderr)
            except urllib.error.URLError as e:
                print(f"transport error: {e.reason}", file=sys.stderr)
                time.sleep(1.0)
            next_at += args.interval
            sleep_for = next_at - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                # We're behind — resync to "now" so we don't busy-loop.
                next_at = time.monotonic()
    except KeyboardInterrupt:
        print("\nstopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
