#!/usr/bin/env python3
"""The tags of the image registry, and whether a version is the newest.

Part 2 of the plan docs/plans/2026-11-22-dev-rc-release-e-portale-di-sviluppo.md
(22-11-2026). The moving tag of a channel must point at the newest version that
channel admits, or a panel is told «2.27.0-rc.1 available» and its update pulls
an older image. `dev-<arch>` admits releases, rc and dev: a 2.26.0-rc.27 built
on release/2.26 must not move it back under a 2.27.0-dev.3. So before moving a
moving tag, the build asks this script whether its version is the newest of
the channel.

Anonymous read (the registry lists tags without credentials), with pagination
(the `Link` header): 376 tags on 22-11-2026, and the dev builds add more.

Usage:
    registro.py tags                          every tag, one per line
    registro.py piu-nuova VERSION ARCH CANALE exit 0 if VERSION is >= every
                                              version of CANALE (stabile, rc, dev)
                                              for ARCH in the registry
"""
import json
import re
import sys
import urllib.request

REPO = "soligolab/sws-runtime"
HOST = "https://ghcr.io"
FORMA = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-(dev|rc)\.(\d+))?$")


def token() -> str:
    with urllib.request.urlopen(f"{HOST}/token?scope=repository:{REPO}:pull", timeout=20) as r:
        return json.load(r)["token"]


def tags() -> list[str]:
    t = token()
    url = f"{HOST}/v2/{REPO}/tags/list?n=1000"
    out: list[str] = []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {t}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out += json.load(r).get("tags") or []
            link = r.headers.get("Link", "")
        m = re.search(r"<([^>]+)>", link)
        url = (HOST + m.group(1) if m.group(1).startswith("/") else m.group(1)) if m else None
    return out


def chiave(v: str):
    """Semver order: a release after its pre-releases, dev before rc."""
    m = FORMA.match(v)
    if not m:
        return None
    a, b, c, pre, n = m.groups()
    rango = {"dev": 0, "rc": 1, None: 2}[pre]
    return (int(a), int(b), int(c), rango, int(n or 0))


AMMESSI = {"stabile": {None}, "rc": {None, "rc"}, "dev": {None, "rc", "dev"}}


def piu_nuova(versione: str, arch: str, canale: str, elenco: list[str]) -> bool:
    mia = chiave(versione)
    if mia is None:
        raise SystemExit(f"versione non valida: {versione}")
    suffisso = f"-{arch}"
    for t in elenco:
        if not t.endswith(suffisso):
            continue
        v = t[: -len(suffisso)]
        m = FORMA.match(v)
        # The old calendar numbering (2026.7.0) is not newer than anything.
        if not m or int(m.group(1)) >= 1000 or m.group(4) not in AMMESSI[canale]:
            continue
        if chiave(v) > mia:
            return False
    return True


def main(argv: list[str]) -> int:
    if argv[:1] == ["tags"]:
        print("\n".join(tags()))
        return 0
    if len(argv) == 4 and argv[0] == "piu-nuova" and argv[3] in AMMESSI:
        return 0 if piu_nuova(argv[1], argv[2], argv[3], tags()) else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
