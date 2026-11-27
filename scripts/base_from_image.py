#!/usr/bin/env python3
"""Make an SWS base image from the system layers of a published runtime image.

Plan docs/plans/2026-11-27-immagine-base-del-sistema.md, point 6. The first
`sws-base` must have the same layers that the panels already have, so that the
first update on the new base downloads only the SWS layers. A new `apt-get`
would give new layers, and every panel would download 388 MB again.

This script does not build anything and does not download the layers. It reads
the manifest and the config of a runtime image on ghcr.io, keeps the first N
layers (Ubuntu and the `apt-get` layer), writes a config for them, mounts the
layer blobs from `sws-runtime` into `sws-base`, and publishes the manifest. The
blobs keep their compressed digests: they are the same bytes.

Use it once per architecture, for the first base. The next bases come from
`scripts/build_base.sh`.

    scripts/base_from_image.py --from 2.28.0-dev.5 --version 2026.11.1 [--layers 2] [--push]

Without --push it only prints what it would publish. The credentials come
from the podman login (auth.json), never from the command line.
"""

import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

REGISTRY = "ghcr.io"
SOURCE_REPO = "soligolab/sws-runtime"
BASE_REPO = "soligolab/sws-base"
ARCHES = ("arm64", "amd64")
MANIFEST_TYPE = "application/vnd.docker.distribution.manifest.v2+json"
CONFIG_TYPE = "application/vnd.docker.container.image.v1+json"


def auth_basic() -> str:
    """The base64 user:token of the podman login for ghcr.io."""
    paths = [
        os.path.join(os.environ.get("XDG_RUNTIME_DIR", ""), "containers/auth.json"),
        os.path.expanduser("~/.config/containers/auth.json"),
        os.path.expanduser("~/.docker/config.json"),
    ]
    for p in paths:
        try:
            with open(p, encoding="utf-8") as f:
                auths = json.load(f).get("auths", {})
        except (OSError, ValueError):
            continue
        for key in (REGISTRY, "https://" + REGISTRY):
            if key in auths and auths[key].get("auth"):
                return auths[key]["auth"]
    sys.exit(f"no podman login for {REGISTRY}: run `podman login {REGISTRY}` first")


def token(push: bool) -> str:
    scopes = [f"repository:{SOURCE_REPO}:pull"]
    scopes.append(f"repository:{BASE_REPO}:pull,push" if push else f"repository:{BASE_REPO}:pull")
    url = f"https://{REGISTRY}/token?service={REGISTRY}&" + "&".join(f"scope={s}" for s in scopes)
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth_basic()})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["token"]


def call(tok, method, path, data=None, headers=None, raw=False):
    h = {"Authorization": "Bearer " + tok}
    h.update(headers or {})
    req = urllib.request.Request(f"https://{REGISTRY}{path}", data=data, headers=h, method=method)
    r = urllib.request.urlopen(req, timeout=300)
    body = r.read()
    return r, (body if raw else (json.loads(body) if body else None))


def blob_exists(tok, repo, digest) -> bool:
    try:
        call(tok, "HEAD", f"/v2/{repo}/blobs/{digest}", raw=True)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def upload(tok, repo, digest, data: bytes):
    r, _ = call(tok, "POST", f"/v2/{repo}/blobs/uploads/", data=b"", raw=True)
    loc = r.headers["Location"]
    if loc.startswith("/"):
        loc = f"https://{REGISTRY}{loc}"
    sep = "&" if "?" in loc else "?"
    req = urllib.request.Request(
        f"{loc}{sep}digest={digest}",
        data=data,
        method="PUT",
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/octet-stream"},
    )
    urllib.request.urlopen(req, timeout=600).read()


def mount_or_copy(tok, digest):
    """Put a blob of sws-runtime into sws-base: mount it, or copy it if the registry refuses."""
    if blob_exists(tok, BASE_REPO, digest):
        return "already there"
    try:
        r, _ = call(
            tok, "POST", f"/v2/{BASE_REPO}/blobs/uploads/?mount={digest}&from={SOURCE_REPO}",
            data=b"", raw=True,
        )
        if r.status == 201:
            return "mounted"
    except urllib.error.HTTPError as e:
        if e.code != 202:
            raise
    _, data = call(tok, "GET", f"/v2/{SOURCE_REPO}/blobs/{digest}", raw=True)
    if "sha256:" + hashlib.sha256(data).hexdigest() != digest:
        sys.exit(f"blob {digest}: the downloaded bytes do not match the digest")
    upload(tok, BASE_REPO, digest, data)
    return "copied"


def base_config(cfg: dict, layers: int, version: str) -> dict:
    """The config of the first `layers` layers: rootfs, history and a plain Ubuntu config."""
    history, kept = [], 0
    for h in cfg["history"]:
        if kept == layers:
            break
        history.append(h)
        if not h.get("empty_layer"):
            kept += 1
    if kept != layers:
        sys.exit(f"the image has fewer than {layers} layers in its history")
    history.append({
        "created": history[-1]["created"],
        "created_by": f'LABEL net.soligo.sws.base="{version}"',
        "comment": "scripts/base_from_image.py",
        "empty_layer": True,
    })
    inner = dict(cfg.get("config") or {})
    path = [e for e in inner.get("Env", []) if e.startswith("PATH=")]
    inner = {
        "Env": path,
        "Cmd": ["/bin/bash"],
        "Labels": {"org.opencontainers.image.version": "24.04", "net.soligo.sws.base": version},
    }
    return {
        "architecture": cfg["architecture"],
        "os": cfg["os"],
        **({"variant": cfg["variant"]} if cfg.get("variant") else {}),
        "created": history[-1]["created"],
        "config": inner,
        "rootfs": {"type": "layers", "diff_ids": cfg["rootfs"]["diff_ids"][:layers]},
        "history": history,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="source", required=True, help="runtime version, e.g. 2.28.0-dev.5")
    ap.add_argument("--version", required=True, help="base version, AAAA.MM.N")
    ap.add_argument("--layers", type=int, default=2, help="system layers to keep (default 2)")
    ap.add_argument("--arch", choices=ARCHES, action="append", help="default: both")
    ap.add_argument("--push", action="store_true")
    a = ap.parse_args()

    tok = token(a.push)
    for arch in a.arch or ARCHES:
        _, man = call(tok, "GET", f"/v2/{SOURCE_REPO}/manifests/{a.source}-{arch}",
                      headers={"Accept": MANIFEST_TYPE})
        if man.get("mediaType") != MANIFEST_TYPE:
            sys.exit(f"{a.source}-{arch}: manifest {man.get('mediaType')}, expected {MANIFEST_TYPE}")
        _, cfg = call(tok, "GET", f"/v2/{SOURCE_REPO}/blobs/{man['config']['digest']}")
        new_cfg = json.dumps(base_config(cfg, a.layers, a.version), separators=(",", ":")).encode()
        cfg_digest = "sha256:" + hashlib.sha256(new_cfg).hexdigest()
        new_man = {
            "schemaVersion": 2,
            "mediaType": MANIFEST_TYPE,
            "config": {"mediaType": CONFIG_TYPE, "size": len(new_cfg), "digest": cfg_digest},
            "layers": man["layers"][: a.layers],
        }
        man_bytes = json.dumps(new_man, separators=(",", ":")).encode()
        man_digest = "sha256:" + hashlib.sha256(man_bytes).hexdigest()
        tag = f"{a.version}-{arch}"
        print(f"{arch}: from {SOURCE_REPO}:{a.source}-{arch}")
        for layer in new_man["layers"]:
            print(f"  layer {layer['digest']}  {layer['size'] / 1e6:.1f} MB")
        if a.push:
            for layer in new_man["layers"]:
                print(f"    {layer['digest'][:19]}: {mount_or_copy(tok, layer['digest'])}")
            if not blob_exists(tok, BASE_REPO, cfg_digest):
                upload(tok, BASE_REPO, cfg_digest, new_cfg)
            r, _ = call(tok, "PUT", f"/v2/{BASE_REPO}/manifests/{tag}", data=man_bytes,
                        headers={"Content-Type": MANIFEST_TYPE}, raw=True)
            got = r.headers.get("Docker-Content-Digest", man_digest)
            if got != man_digest:
                sys.exit(f"the registry stored {got}, expected {man_digest}")
        print(f"  {arch} {REGISTRY}/{BASE_REPO}:{tag}@{man_digest}")


if __name__ == "__main__":
    main()
