#!/usr/bin/env python3
"""
Drive any number of tags with chosen waveforms — superset of demo-sine.py.

Usage:
    scripts/demo-driver.py --gen 'tag=sine,wave=sin,period=10,amp=50,offset=50'
    scripts/demo-driver.py \\
        --gen 'tag=sine,wave=sin' \\
        --gen 'tag=cosine,wave=cos,period=8' \\
        --gen 'tag=triangle,wave=tri,period=12,amp=30,offset=20' \\
        --gen 'tag=ramp,wave=saw,period=20' \\
        --gen 'tag=square,wave=square,period=4,amp=25,offset=50' \\
        --gen 'tag=noise,wave=random,amp=10,offset=50'

Each --gen is a comma-separated list of key=value pairs:
    tag       (required) — tag id to write into
    wave      sin | cos | tri | square | saw | random | step  (default sin)
    period    period in seconds                                 (default 10)
    amplitude / amp   peak above the centre                     (default 50)
    offset    centre value                                      (default 50)
    interval  seconds between writes                            (default 0.1)
    phase     phase offset in seconds                           (default 0)
    duty      duty cycle for square 0..1                        (default 0.5)
    step_low / step_high / step_at  for the step waveform

All generators run concurrently on the same asyncio loop. The script
re-authenticates on 401 (survives a runtime restart).

Stdlib-only: math, time, asyncio, urllib, ssl. No external deps.

Stop with Ctrl-C.
"""

import argparse
import asyncio
import json
import math
import random
import ssl
import sys
import time
import urllib.error
import urllib.request
from typing import Optional


SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def http(method: str, url: str, body: Optional[dict] = None, token: Optional[str] = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=5) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def login(base: str, user: str, password: str) -> str:
    res = http("POST", f"{base}/api/auth/login", body={"username": user, "password": password})
    return res["token"]


def parse_gen(spec: str) -> dict:
    """Parse 'k1=v1,k2=v2' into a dict. Floats parsed when possible."""
    out: dict = {}
    for pair in spec.split(","):
        if not pair.strip():
            continue
        if "=" not in pair:
            raise ValueError(f"--gen entry missing '=': {pair!r}")
        k, v = pair.split("=", 1)
        k = k.strip()
        v = v.strip()
        try:
            out[k] = float(v)
        except ValueError:
            out[k] = v
    if "tag" not in out:
        raise ValueError(f"--gen entry missing 'tag=': {spec!r}")
    # Normalize aliases
    if "amp" in out and "amplitude" not in out:
        out["amplitude"] = out.pop("amp")
    return out


def waveform_value(kind: str, t: float, cfg: dict) -> float:
    """Compute one sample at relative time `t` (seconds since start)."""
    period    = float(cfg.get("period", 10.0))
    amplitude = float(cfg.get("amplitude", 50.0))
    offset    = float(cfg.get("offset", 50.0))
    phase     = float(cfg.get("phase", 0.0))
    omega = 2.0 * math.pi / max(0.001, period)
    tt = t + phase

    if kind == "sin":
        return offset + amplitude * math.sin(omega * tt)
    if kind == "cos":
        return offset + amplitude * math.cos(omega * tt)
    if kind == "tri":
        # Triangle in [-1, 1]
        frac = (tt / period) % 1.0
        tri = 4 * abs(frac - 0.5) - 1
        return offset + amplitude * tri
    if kind == "saw":
        frac = (tt / period) % 1.0
        return offset + amplitude * (2 * frac - 1)
    if kind == "square":
        duty = float(cfg.get("duty", 0.5))
        frac = (tt / period) % 1.0
        hi = 1.0 if frac < duty else -1.0
        return offset + amplitude * hi
    if kind == "random":
        # Uniform noise around the centre
        return offset + amplitude * (2 * random.random() - 1)
    if kind == "step":
        # Switch between step_low and step_high every step_at seconds.
        step_at  = float(cfg.get("step_at", 5.0))
        lo = float(cfg.get("step_low", offset - amplitude))
        hi = float(cfg.get("step_high", offset + amplitude))
        on_hi = int(tt / max(0.001, step_at)) % 2 == 1
        return hi if on_hi else lo
    raise ValueError(f"unknown wave kind: {kind!r}")


async def driver(args, gen_cfg: dict, token_box: dict, lock: asyncio.Lock):
    tag      = str(gen_cfg["tag"])
    kind     = str(gen_cfg.get("wave", "sin"))
    interval = float(gen_cfg.get("interval", args.default_interval))

    if kind not in {"sin", "cos", "tri", "saw", "square", "random", "step"}:
        print(f"[{tag}] unknown wave={kind!r}; using sin", file=sys.stderr)
        kind = "sin"

    print(f"[{tag}] starting wave={kind} every {interval}s")
    t0 = time.monotonic()
    next_at = t0
    while True:
        t = time.monotonic() - t0
        value = waveform_value(kind, t, gen_cfg)
        # Run the blocking PUT off the event-loop thread.
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: http("PUT", f"{args.base_url}/api/tags/{tag}",
                             body={"value": value}, token=token_box["token"]),
            )
        except urllib.error.HTTPError as e:
            if e.code == 401:
                async with lock:
                    print(f"[{tag}] 401 — re-logging in", file=sys.stderr)
                    token_box["token"] = login(args.base_url, args.user, args.password)
                continue
            print(f"[{tag}] write failed: {e}", file=sys.stderr)
        except urllib.error.URLError as e:
            print(f"[{tag}] transport: {e.reason}", file=sys.stderr)
            await asyncio.sleep(1.0)
            continue
        next_at += interval
        delay = next_at - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            next_at = time.monotonic()


async def main_async(args) -> int:
    try:
        token = login(args.base_url, args.user, args.password)
    except urllib.error.HTTPError as e:
        print(f"login failed: {e.code} {e.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"cannot reach runtime at {args.base_url}: {e.reason}", file=sys.stderr)
        return 1
    token_box = {"token": token}
    lock = asyncio.Lock()

    gens = [parse_gen(s) for s in args.gen]
    if not gens:
        print("no --gen given, nothing to do", file=sys.stderr)
        return 2

    print(f"logged in as {args.user}; {len(gens)} generators running. Ctrl-C to stop.")
    await asyncio.gather(*(driver(args, g, token_box, lock) for g in gens))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("--base-url", default="https://localhost:8443")
    p.add_argument("--user",     default="admin")
    p.add_argument("--password", default="admin")
    p.add_argument("--gen", action="append", default=[],
                   help="Generator spec (repeatable). Comma-separated key=value list with at least tag=NAME.")
    p.add_argument("--default-interval", type=float, default=0.1,
                   help="Default write interval (s) when a generator omits 'interval'.")
    args = p.parse_args()

    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nstopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
