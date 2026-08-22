// ── Motore di espressioni client-side (F2.2, piano SCADA-widgets) ───────────
//
// Valuta espressioni nei binding senza `eval`/`new Function`: tokenizer +
// parser Pratt + evaluator su AST. Sintassi (sottoinsieme deliberato):
//
//   {tank.level} * 100 / {tank.capacity}
//   {temp} > 80 ? '#ef4444' : '#22c55e'
//   clamp(({raw} - 4) / 16 * 100, 0, 100)
//
// - Riferimenti tag: `{tag.id}` (qualunque carattere tranne `}`).
// - Numeri, stringhe ('…' o "…"), true/false/null.
// - Aritmetica + - * / %, confronti > >= < <= == !=, logica && || !,
//   ternario ?:, parentesi.
// - Funzioni: min max abs round floor ceil sqrt pow clamp if.
//
// `parse()` è memoizzata (mappa modulo-level): la stessa espressione non
// viene ri-parsata a ogni render. `extractDeps()` alimenta collectTagIds —
// un tag usato in un'espressione va sottoscritto come qualunque altro.

import type { TagState } from "@/types";

// ── AST ──────────────────────────────────────────────────────────────────────

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  | { k: "tag"; id: string }
  | { k: "un"; op: "-" | "!"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export type ExprValue = number | string | boolean | null;

// ── Tokenizer ────────────────────────────────────────────────────────────────

interface Tok { t: string; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const push = (t: string, v: string) => toks.push({ t, v });
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) throw new Error(`riferimento tag non chiuso a colonna ${i + 1}`);
      const id = src.slice(i + 1, end).trim();
      if (!id) throw new Error("riferimento tag vuoto {}");
      push("tag", id); i = end + 1; continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error("stringa non chiusa");
      push("str", src.slice(i + 1, end)); i = end + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      push("num", m[0]); i += m[0].length; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      push("ident", m[0]); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (["&&", "||", "==", "!=", ">=", "<="].includes(two)) { push("op", two); i += 2; continue; }
    if ("+-*/%<>!?:(),".includes(c)) { push("op", c); i++; continue; }
    throw new Error(`carattere inatteso '${c}' a colonna ${i + 1}`);
  }
  return toks;
}

// ── Parser (Pratt) ───────────────────────────────────────────────────────────

const FUNCTIONS = new Set(["min", "max", "abs", "round", "floor", "ceil", "sqrt", "pow", "clamp", "if"]);

/** Precedenze: più alto lega più stretto. Il ternario è gestito a parte. */
const BIN_PREC: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, ">": 4, ">=": 4, "<": 4, "<=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
};

function parseTokens(toks: Tok[]): Node {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const expectOp = (v: string) => {
    const tk = next();
    if (!tk || tk.t !== "op" || tk.v !== v) throw new Error(`atteso '${v}'`);
  };

  function primary(): Node {
    const tk = next();
    if (!tk) throw new Error("espressione incompleta");
    if (tk.t === "num") return { k: "num", v: Number(tk.v) };
    if (tk.t === "str") return { k: "str", v: tk.v };
    if (tk.t === "tag") return { k: "tag", id: tk.v };
    if (tk.t === "ident") {
      if (tk.v === "true") return { k: "bool", v: true };
      if (tk.v === "false") return { k: "bool", v: false };
      if (tk.v === "null") return { k: "null" };
      if (FUNCTIONS.has(tk.v)) {
        expectOp("(");
        const args: Node[] = [];
        if (!(peek()?.t === "op" && peek().v === ")")) {
          for (;;) {
            args.push(ternary());
            if (peek()?.t === "op" && peek().v === ",") { next(); continue; }
            break;
          }
        }
        expectOp(")");
        return { k: "call", fn: tk.v, args };
      }
      throw new Error(`identificatore sconosciuto '${tk.v}' — i tag si scrivono {${tk.v}}`);
    }
    if (tk.t === "op") {
      if (tk.v === "(") { const e = ternary(); expectOp(")"); return e; }
      if (tk.v === "-") return { k: "un", op: "-", a: primary() };
      if (tk.v === "!") return { k: "un", op: "!", a: primary() };
    }
    throw new Error(`token inatteso '${tk.v}'`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== "op") break;
      const prec = BIN_PREC[tk.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = binary(prec + 1);
      left = { k: "bin", op: tk.v, a: left, b: right };
    }
    return left;
  }

  function ternary(): Node {
    const cond = binary(1);
    if (peek()?.t === "op" && peek().v === "?") {
      next();
      const a = ternary();
      expectOp(":");
      const b = ternary();
      return { k: "tern", c: cond, a, b };
    }
    return cond;
  }

  const root = ternary();
  if (pos !== toks.length) throw new Error(`testo in eccesso dopo l'espressione: '${toks[pos].v}'`);
  return root;
}

// ── Cache di parse + API pubblica ───────────────────────────────────────────

const CACHE = new Map<string, { ast: Node; deps: string[] } | { error: string }>();

function collectDeps(n: Node, out: Set<string>): void {
  switch (n.k) {
    case "tag": out.add(n.id); break;
    case "un": collectDeps(n.a, out); break;
    case "bin": collectDeps(n.a, out); collectDeps(n.b, out); break;
    case "tern": collectDeps(n.c, out); collectDeps(n.a, out); collectDeps(n.b, out); break;
    case "call": n.args.forEach((a) => collectDeps(a, out)); break;
    default: break;
  }
}

function parse(src: string): { ast: Node; deps: string[] } {
  const hit = CACHE.get(src);
  if (hit) {
    if ("error" in hit) throw new Error(hit.error);
    return hit;
  }
  try {
    const ast = parseTokens(tokenize(src));
    const deps = new Set<string>();
    collectDeps(ast, deps);
    const entry = { ast, deps: [...deps] };
    CACHE.set(src, entry);
    return entry;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    CACHE.set(src, { error });
    throw new Error(error);
  }
}

/** Errore di sintassi (o null se valida). Per la validazione live in editor. */
export function validateExpr(src: string): string | null {
  try { parse(src); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Tag referenziati dall'espressione (per la sottoscrizione). [] se invalida. */
export function extractDeps(src: string): string[] {
  try { return parse(src).deps; } catch { return []; }
}

const num = (v: ExprValue): number =>
  typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : v === null ? 0 : Number(v) || 0;
const truthy = (v: ExprValue): boolean =>
  typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v !== null && String(v).length > 0;

function evalNode(n: Node, tags: Record<string, TagState>): ExprValue {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "bool": return n.v;
    case "null": return null;
    case "tag": {
      const tv = tags[n.id];
      return tv === undefined ? null : (tv.value as ExprValue);
    }
    case "un": {
      const a = evalNode(n.a, tags);
      return n.op === "-" ? -num(a) : !truthy(a);
    }
    case "bin": {
      // Cortocircuito per la logica; il resto valuta entrambi i lati.
      if (n.op === "&&") return truthy(evalNode(n.a, tags)) ? evalNode(n.b, tags) : false;
      if (n.op === "||") { const a = evalNode(n.a, tags); return truthy(a) ? a : evalNode(n.b, tags); }
      const a = evalNode(n.a, tags); const b = evalNode(n.b, tags);
      switch (n.op) {
        case "+": return typeof a === "string" || typeof b === "string" ? String(a) + String(b) : num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": return num(a) / num(b);
        case "%": return num(a) % num(b);
        case "==": return a === b || num(a) === num(b);
        case "!=": return !(a === b || num(a) === num(b));
        case ">": return num(a) > num(b);
        case ">=": return num(a) >= num(b);
        case "<": return num(a) < num(b);
        case "<=": return num(a) <= num(b);
        default: throw new Error(`operatore '${n.op}'`);
      }
    }
    case "tern": return truthy(evalNode(n.c, tags)) ? evalNode(n.a, tags) : evalNode(n.b, tags);
    case "call": {
      const args = n.args.map((a) => evalNode(a, tags));
      switch (n.fn) {
        case "min": return Math.min(...args.map(num));
        case "max": return Math.max(...args.map(num));
        case "abs": return Math.abs(num(args[0]));
        case "round": return args.length > 1 ? Number(num(args[0]).toFixed(num(args[1]))) : Math.round(num(args[0]));
        case "floor": return Math.floor(num(args[0]));
        case "ceil": return Math.ceil(num(args[0]));
        case "sqrt": return Math.sqrt(num(args[0]));
        case "pow": return Math.pow(num(args[0]), num(args[1]));
        case "clamp": return Math.min(Math.max(num(args[0]), num(args[1])), num(args[2]));
        case "if": return truthy(args[0]) ? args[1] : args[2];
        default: throw new Error(`funzione '${n.fn}'`);
      }
    }
  }
}

/** Valuta `src` contro i valori tag correnti. `null` su errore di qualunque
 *  tipo — un'espressione rotta non deve mai far crollare il rendering. */
export function evalExpr(src: string, tags: Record<string, TagState>): ExprValue {
  try { return evalNode(parse(src).ast, tags); } catch { return null; }
}
