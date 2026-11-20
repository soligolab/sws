// The assistant's text, formatted (20-11-2026, the maintainer: «i testi sono
// pressoché privi di formattazione»). Models write Markdown; the chat showed
// the asterisks. A small renderer of what they actually write — headings,
// bold, italics, inline code, code blocks, lists, quotes, tables, links — that
// builds React elements: no HTML from the model ever reaches the page.
//
// It reads a text still arriving too: an open code block is a code block up to
// the end, an unclosed `**` stays as it is.

import type React from "react";

export type Block =
  | { k: "p"; lines: string[] }
  | { k: "h"; level: number; text: string }
  | { k: "ul"; items: string[] }
  | { k: "ol"; items: string[]; start: number }
  | { k: "code"; lang: string; text: string }
  | { k: "quote"; lines: string[] }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "hr" };

const FENCE = /^\s*(```|~~~)\s*([\w+.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*•+]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || BULLET.test(l) || NUMBER.test(l) || QUOTE.test(l) || RULE.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The blocks of a Markdown text. */
export function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== fence[1]; i++) body.push(lines[i]);
      i++;
      out.push({ k: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = HEADING.exec(line);
    if (h) { out.push({ k: "h", level: h[1].length, text: h[2].replace(/\s+#+\s*$/, "") }); i++; continue; }
    if (RULE.test(line)) { out.push({ k: "hr" }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      out.push({ k: "table", head, rows });
      continue;
    }
    const ordered = NUMBER.exec(line);
    if (ordered || BULLET.test(line)) {
      const re = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) { items.push(ordered ? m[2] : m[1]); i++; continue; }
        // An indented line goes on with the item above.
        if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !startsBlock(lines[i])) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      out.push(ordered ? { k: "ol", items, start: Number(ordered[1]) } : { k: "ul", items });
      continue;
    }
    if (QUOTE.test(line)) {
      const q: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) q.push(lines[i].replace(QUOTE, ""));
      out.push({ k: "quote", lines: q });
      continue;
    }
    const p: string[] = [line];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) p.push(lines[i]);
    out.push({ k: "p", lines: p });
  }
  return out;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w]))|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g;

/** Bold, italics, inline code and links of one piece of text. */
export function inline(text: string, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} style={CODE_INLINE}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} style={{ fontWeight: 650 }}>{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(m[3].slice(1, -1), k)}</em>);
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf("]("));
      out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer noopener" style={LINK}>{label}</a>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines of one paragraph or item, with their line breaks. */
function withBreaks(lines: string[], key: string): React.ReactNode[] {
  return lines.flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(l, `${key}-${i}`)] : inline(l, `${key}-${i}`)));
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        switch (b.k) {
          case "p":
            return <p key={k} style={P}>{withBreaks(b.lines, k)}</p>;
          case "h":
            return <div key={k} role="heading" aria-level={b.level} style={{ ...H, fontSize: b.level <= 2 ? 13.5 : 12.5 }}>{inline(b.text, k)}</div>;
          case "ul":
          case "ol": {
            const items = b.items.map((it, j) => <li key={j} style={LI}>{withBreaks(it.split("\n"), `${k}-${j}`)}</li>);
            return b.k === "ul"
              ? <ul key={k} style={LIST}>{items}</ul>
              : <ol key={k} start={b.start} style={LIST}>{items}</ol>;
          }
          case "code":
            return <pre key={k} style={CODE_BLOCK} data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
          case "quote":
            return <blockquote key={k} style={QUOTE_STYLE}>{withBreaks(b.lines, k)}</blockquote>;
          case "table":
            return (
              <div key={k} style={{ overflowX: "auto", margin: "4px 0 6px" }}>
                <table style={TABLE}>
                  <thead><tr>{b.head.map((c, j) => <th key={j} style={TH}>{inline(c, `${k}-h${j}`)}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => (
                    <tr key={j}>{r.map((c, x) => <td key={x} style={TD}>{inline(c, `${k}-${j}-${x}`)}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={k} style={HR} />;
        }
      })}
    </>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const P: React.CSSProperties = { margin: "0 0 6px" };
const H: React.CSSProperties = { fontWeight: 700, margin: "8px 0 4px", color: "var(--brand-text, #e2e8f0)" };
const LIST: React.CSSProperties = { margin: "2px 0 6px", paddingLeft: 18 };
const LI: React.CSSProperties = { margin: "1px 0" };
const LINK: React.CSSProperties = { color: "var(--brand-accent, #38bdf8)" };
const CODE_INLINE: React.CSSProperties = {
  fontFamily: MONO, fontSize: "0.92em", padding: "0 4px", borderRadius: 3,
  background: "var(--brand-surface-2, #334155)",
};
const CODE_BLOCK: React.CSSProperties = {
  margin: "4px 0 8px", padding: "6px 8px", maxHeight: 280, overflow: "auto", whiteSpace: "pre",
  fontFamily: MONO, fontSize: 11, lineHeight: 1.45, borderRadius: 4,
  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
};
const QUOTE_STYLE: React.CSSProperties = {
  margin: "2px 0 6px", padding: "2px 0 2px 8px", borderLeft: "3px solid var(--brand-surface-2, #334155)",
  color: "var(--brand-text-muted, #94a3b8)",
};
const TABLE: React.CSSProperties = { borderCollapse: "collapse", fontSize: 11.5 };
const TH: React.CSSProperties = {
  textAlign: "left", padding: "3px 8px", borderBottom: "1px solid var(--brand-surface-2, #334155)", fontWeight: 650,
};
const TD: React.CSSProperties = { padding: "3px 8px", borderBottom: "1px solid var(--brand-surface-2, #334155)", verticalAlign: "top" };
const HR: React.CSSProperties = { border: "none", borderTop: "1px solid var(--brand-surface-2, #334155)", margin: "8px 0" };
