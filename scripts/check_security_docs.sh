#!/usr/bin/env bash
#
# The security documents stay true, complete and pointing at code that exists.
#
# WHY IT EXISTS
#
# On 17-11-2026 the CRA re-measure found SECURITY.md and chapter 17 of the manual
# saying "updates are automatic by default", which the code had never done, and the
# manufacturer written three different ways. Nobody had lied: the documents were
# true once and the code moved under them. A document that cites `file:line` ages
# the same way, silently. This guard is the cheap half of keeping them honest.
#
# WHAT IT CHECKS
#
#   1. every file in docs/sicurezza/ is listed in its LEGGIMI.md, and every
#      relative link of that folder points to a file that exists;
#   2. the risk assessment has all fourteen rows of Annex I, part I: (1) and
#      (2)(a) to (2)(m);
#   3. every `path:line` (or `path:from-to`, or `:line` after a path on the same
#      line) cited in the risk assessment names a file that exists and has at
#      least that many lines. It cannot check that the line still says the same
#      thing: whoever touches a cited line reads it again;
#   4. the false statements of 17-11 do not come back: SECURITY.md and chapter 17
#      do not claim automatic updates by default while the installer does not
#      enable podman's auto-update timer; SECURITY.md, chapter 17 and the art. 14
#      procedure name the same manufacturer.
#
# Usage: ./scripts/check_security_docs.sh [repository root]
#        (the root argument lets the negative tests run on a copy)
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

exec python3 - "$ROOT" <<'PY'
import os, re, sys

root = sys.argv[1]
folder = os.path.join(root, "docs/sicurezza")
index = os.path.join(folder, "LEGGIMI.md")
risk = os.path.join(folder, "valutazione-rischio.md")
bad = []

def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

# 1. the index and the links of the folder
if not os.path.isfile(index):
    bad.append("1: docs/sicurezza/LEGGIMI.md is missing")
else:
    listed = read(index)
    for name in sorted(os.listdir(folder)):
        # Listed means linked or quoted by its exact name: `rischio.md` must not
        # pass because `valutazione-rischio.md` contains it.
        exact = r"(?<![\w.-])" + re.escape(name) + r"(?=[)`])"
        if name != "LEGGIMI.md" and not re.search(exact, listed):
            bad.append(f"1: docs/sicurezza/{name} is not listed in LEGGIMI.md")
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        for target in re.findall(r"\]\(([^)\s]+)\)", read(os.path.join(folder, name))):
            if re.match(r"[a-z]+:", target) or target.startswith("#"):
                continue
            path = os.path.normpath(os.path.join(folder, target.split("#")[0]))
            if not os.path.exists(path):
                bad.append(f"1: docs/sicurezza/{name} links to {target}, which does not exist")

# 2. the fourteen rows of Annex I, part I
if not os.path.isfile(risk):
    bad.append("2: docs/sicurezza/valutazione-rischio.md is missing")
    text = ""
else:
    text = read(risk)
    rows = ["(1)"] + [f"(2)({c})" for c in "abcdefghijklm"]
    for r in rows:
        if not re.search(r"^\|\s*\*\*" + re.escape(r) + r"\*\*", text, re.M):
            bad.append(f"2: the risk assessment has no row for requirement {r}")

# 3. the citations of the risk assessment
def lines_of(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f)

for n, line in enumerate(text.splitlines(), 1):
    last = None
    for token in re.findall(r"`([^`]+)`", line):
        # A file path: a slash, and a dot in the last part (a branch name is not one).
        m = re.fullmatch(r"([A-Za-z0-9_.][A-Za-z0-9_./-]*/[A-Za-z0-9_-]*\.[A-Za-z0-9_.-]+)(?::(\d+)(?:-(\d+))?)?", token)
        if m:
            last = m.group(1)
            path = os.path.join(root, last)
            if not os.path.exists(path):
                bad.append(f"3: valutazione-rischio.md:{n} cites {last}, which does not exist")
                last = None
                continue
            end = m.group(3) or m.group(2)
            if end and lines_of(path) < int(end):
                bad.append(f"3: valutazione-rischio.md:{n} cites {token}, but the file has {lines_of(path)} lines")
            continue
        m = re.fullmatch(r":(\d+)(?:-(\d+))?", token)
        if m and last:
            end = m.group(2) or m.group(1)
            if lines_of(os.path.join(root, last)) < int(end):
                bad.append(f"3: valutazione-rischio.md:{n} cites {last}{token}, past the end of the file")

# 4. the false statements of 17-11
installer = os.path.join(root, "deploy/container/install-container.sh")
# A command, not a comment, that enables the timer.
timer_on = os.path.isfile(installer) and re.search(
    r"^[ \t]*[^#\n]*\benable\b[^\n]*podman-auto-update\.timer", read(installer), re.M)
# (file, the negated form that is true today, the affirmative claim that is not)
claims = [
    ("SECURITY.md",
     r"not(?:\s|\*)+installed(?:\s|\*)+automatically\s+by\s+default",
     r"automatically\s+by\s+default"),
    ("docs/manual/17_sicurezza.md",
     r"(?!x)x",
     r"aggiornamenti\s+automatici\**\s+(?:per|di)\s+default"),
]
for name, negated, claim in claims:
    path = os.path.join(root, name)
    if not os.path.isfile(path) or timer_on:
        continue
    text_without_negation = re.sub(negated, "", read(path), flags=re.I | re.S)
    if re.search(claim, text_without_negation, re.I | re.S):
        bad.append(f"4: {name} claims automatic updates by default, and the installer does not enable them")
for name in ["SECURITY.md", "docs/manual/17_sicurezza.md", "docs/sicurezza/procedura-art14.md"]:
    path = os.path.join(root, name)
    if os.path.isfile(path) and "Mauro Soligo" not in read(path):
        bad.append(f"4: {name} does not name the manufacturer, Mauro Soligo")

if bad:
    print("\033[31m✗\033[0m security documents:")
    for b in bad:
        print("   ", b)
    sys.exit(1)
print("\033[32m✓\033[0m security documents: index complete, 14 requirements, every citation in range, no false claim back")
PY
