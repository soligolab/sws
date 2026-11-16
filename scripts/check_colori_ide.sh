#!/usr/bin/env bash
#
# No hand-written hex colours in the IDE: every colour goes through a CSS
# variable written by the theme.
#
# WHY IT EXISTS
#
# The IDE has two styles (plan docs/archive/2026-11-14-stile-sobrio.md): the
# colourful one of always, and the sober one, where three colours chosen by the
# person — background, ink, accent — paint everything. The theme writes them as
# CSS variables in `applyAppearance` (sws-editor/src/theme.ts). A colour written
# by hand, `color: "#93c5fd"`, ignores both the style and light/dark: in the
# sober style it is a blue spot nobody chose. On 14-11-2026 there were about 200
# of them in the IDE (EditorShell 40, LeftPanel 38, the config/ tabs about 100).
#
# WHAT IT REQUIRES
#
#   in the .ts/.tsx files of sws-editor/src, comments removed, no `#rgb`,
#   `#rrggbb` or `#rrggbbaa` outside a `var(...)`. The colourful look stays the
#   same because the hex moves into the fallback: `var(--sws-select-bg, #1e3a5f)`,
#   and the theme sets the variable only in the sober style.
#
#   Two ways out, both written down:
#     - a whole file or folder in EXCLUDED below, with its reason (the synoptic
#       canvas, the runtime, palettes that ARE the colours);
#     - a single line marked `fixed-colour` in a comment: a colour that must
#       not follow the IDE style. Either it is DATA (the default value of a
#       colour picker, the colour a new object gets in the project), or it is
#       the thing itself (the black of a terminal, the white behind a device
#       photo, the code editor's own theme, a shadow).
#
# Usage:  ./scripts/check_colori_ide.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$@" <<'PY'
import os, re, sys

ROOT = "sws-editor/src/"

# Files and folders that are not the IDE's own chrome, each with its reason.
# A path ending in "/" is a folder.
EXCLUDED = {
    "canvas/":                         "the synoptic canvas: objects drawn as the panel draws them",
    "control-panel/":                  "the panel's control panel, its own look on the device",
    "runtime-view/":                   "the runtime viewer, painted by the project, not by the IDE style",
    "viewer/":                         "the viewer of the panel",
    "planimetrie/":                    "floor plans: scene materials and the 3D view are drawing data",
    "cornici/":                        "frames drawn around synoptic objects",
    "boot/rasterizza.ts":              "the boot image rasterised for the device",
    "boot/tipi.ts":                    "the default colours of a boot image (project data)",
    "symbols/":                        "the symbol library: drawings and their materials",
    "branding/":                       "the brand palettes: these are the colours the theme writes",
    "theme.ts":                        "the theme itself: it turns the palettes into variables",
    "coloriPredefiniti.ts":            "default colours of synoptic objects (check_colori.sh)",
    "editor/iconeAttivita.ts":         "COLORI_ATTIVITA: the per-item palette the theme writes",
    "editor/oggettiNuovi.ts":          "the colours a new synoptic object is born with (project data)",
    "config/schede/stiliRuntime.ts":   "the runtime styles offered to the project (project data)",
    "components/AlarmBellPanel.tsx":   "runtime alarm panel, drawn inside the synoptic",
    "components/AlarmHistory.tsx":     "runtime alarm history, drawn inside the synoptic",
    "components/DataTable.tsx":        "runtime data table widget, drawn inside the synoptic",
    "components/RecipePanel.tsx":      "runtime recipe widget, drawn inside the synoptic",
    "components/QrCode.tsx":           "a QR code must stay black on white to be read",
}

HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_])")


def excluded(rel: str) -> bool:
    if ".test." in rel:
        return True  # tests compare colours on purpose
    return any(rel == e or (e.endswith("/") and rel.startswith(e)) for e in EXCLUDED)


def strip_vars(line: str) -> str:
    """Remove every `var(...)`, nested ones included: a hex there is a fallback."""
    out, i = [], 0
    while i < len(line):
        if line.startswith("var(", i):
            depth, k = 0, i
            while k < len(line):
                if line[k] == "(":
                    depth += 1
                elif line[k] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            i = k + 1
            out.append("VAR")
            continue
        out.append(line[i])
        i += 1
    return "".join(out)


def strip_comments(text: str) -> list[str]:
    """Comments go, line numbers stay (a block comment leaves its newlines).

    A comment opens only in code, never inside a string: `accept="image/*"` or
    a glob `"./*.yaml"` used to open a block comment that ran to the next `*/`
    of the file and hid every colour in between. So the text is walked keeping
    track of where we are: code, a "…" or '…' string (ends with the line), or a
    template literal, whose `${…}` holes are code again.

    A wrong guess errs on the visible side: text taken for a string is still
    scanned, so the worst case is a colour in a comment reported by mistake.
    """
    out: list[str] = []
    # What we are inside of, innermost last: a quote character, or the brace
    # depth of a `${…}` hole. Empty: plain code.
    stack: list = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        top = stack[-1] if stack else None
        if isinstance(top, str):  # inside a string
            if c == "\\" and i + 1 < n and text[i + 1] != "\n":
                out.append(text[i:i + 2])
                i += 2
                continue
            if c == top or (c == "\n" and top != "`"):
                stack.pop()
            elif top == "`" and text.startswith("${", i):
                stack.append(0)
                out.append("${")
                i += 2
                continue
            out.append(c)
            i += 1
            continue
        # Code. A backslash before `/*` or `//` means a regular expression
        # (`/\/*$/`), not a comment; `://` is a URL in JSX text.
        escaped = i > 0 and text[i - 1] == "\\"
        if text.startswith("/*", i) and not escaped:
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            out.append("\n" * text.count("\n", i, end))
            i = end
            continue
        if text.startswith("//", i) and not escaped and (i == 0 or text[i - 1] != ":"):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        if c in "\"'`":
            stack.append(c)
        elif isinstance(top, int):  # inside a `${…}` hole: follow its braces
            if c == "{":
                stack[-1] = top + 1
            elif c == "}":
                if top == 0:
                    stack.pop()
                else:
                    stack[-1] = top - 1
        out.append(c)
        i += 1
    return "".join(out).split("\n")


def scan(rel: str, text: str) -> tuple[list[tuple[int, str]], int]:
    """The hand-written colours of one file, and how many lines are marked fixed."""
    raw = text.split("\n")
    found, data = [], 0
    for n, line in enumerate(strip_comments(text), 1):
        hits = HEX.findall(strip_vars(line))
        if not hits:
            continue
        if "fixed-colour" in raw[n - 1]:
            data += 1
            continue
        found.append((n, raw[n - 1].strip()))
    return found, data


# The guard proves its own scanner at every run: (source, lines that must be
# reported, lines marked fixed). A scanner that goes blind stays green, and a
# green guard that sees nothing is worse than no guard.
SELF_CHECK = [
    # A `/*` inside a string is not a comment: both colours are seen.
    ('<input accept="image/*" />\n<div style={{ color: "#ff0000" }} />\n{/* note */}\n<p style={{ color: "#00ff00" }} />', [2, 4], 0),
    ("const g = import.meta.glob('./*.yaml');\nconst c = \"#123456\";\n/* end */", [2], 0),
    # Real comments hide their colours, and the lines keep their numbers.
    ('/* #fff\n   #000 */\nconst a = "#abc"; // #def\n// #123\n{/* #456 */}', [3], 0),
    # A fallback inside var(), nested too, is not hand-written.
    ('a: "var(--sws-x, #fff)", b: "var(--sws-y, var(--brand-text, #e2e8f0))"\nc: "1px solid #333"', [2], 0),
    # A URL is not a line comment; the marked line is counted, not reported.
    ('const u = "http://x/#fff";\nconst d = "#808080"; /* fixed-colour */', [1], 1),
    # A template literal: its text is not code, its holes are.
    ('const t = `a /* ${x ? `b` : "c" /* #111 */} `;\nconst k = "#222";\n/* */', [2], 0),
    # A regular expression with an escaped slash does not open a comment.
    ('const r = p.replace(/\\/*$/, "");\nconst k = "#333";\n/* */', [2], 0),
]


def self_check() -> list[str]:
    wrong = []
    for k, (source, lines, marked) in enumerate(SELF_CHECK, 1):
        found, data = scan("self-check", source)
        if [n for n, _ in found] != lines or data != marked:
            wrong.append(f"caso {k}: attese le righe {lines} e {marked} segnate, "
                         f"trovate {[n for n, _ in found]} e {data}")
    return wrong


def main() -> int:
    wrong = self_check()
    if wrong:
        for w in wrong:
            print(f"  \033[31m✗\033[0m {w}")
        print("\033[31mColori dell'IDE: la guardia non supera la propria prova: "
              "la lettura dei commenti e delle stringhe è rotta.\033[0m")
        return 1
    bad, data, files = [], 0, 0
    for root, _, names in os.walk(ROOT):
        for f in sorted(names):
            if not f.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(root, f)
            rel = path[len(ROOT):]
            if excluded(rel):
                continue
            files += 1
            found, d = scan(rel, open(path, encoding="utf-8").read())
            data += d
            bad += [(rel, n, l) for n, l in found]
    stale = [e for e in EXCLUDED if not os.path.exists(ROOT + e.rstrip("/"))]
    if bad or stale:
        for rel, n, l in bad:
            print(f"  \033[31m✗\033[0m src/{rel}:{n}: {l[:140]}")
        for e in stale:
            print(f"  \033[31m✗\033[0m esclusione «{e}» in check_colori_ide.sh: il percorso non esiste più")
        if bad:
            print(f"\033[31mColori dell'IDE: {len(bad)} righe con un colore scritto a mano.\033[0m")
            print("    Mettilo in una variabile del tema (var(--sws-…, #colore-di-oggi), scritta da")
            print("    applyAppearance in theme.ts), oppure, se è un dato del progetto o deve restare com'è,")
            print("    segna la riga con un commento «fixed-colour».")
        return 1
    print(f"\033[32mColori dell'IDE: {files} file senza colori scritti a mano "
          f"({data} righe segnate «fixed-colour», {len(EXCLUDED)} esclusioni).\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
PY
