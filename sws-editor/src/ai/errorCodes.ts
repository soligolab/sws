/** The errors of the AI runtime that the IDE says in its own language.
 *
 *  The runtime writes its messages in English; the few a customer can act on
 *  (a local model with too small a context, an address the cloud refuses, a
 *  model that closed its turn twice without writing: `model_silent`)
 *  also carry a code with its values, `{ id, ... }`, and the text lives in
 *  `aiErrors.<id>` of the language files. A code the IDE does not know shows
 *  the runtime's message, so a newer runtime never leaves a blank. */
import i18n from "i18next";

export interface AiErrorCode {
  id: string;
  [value: string]: unknown;
}

/** The text of `code`, or `fallback` without a known one. */
export function aiErrorText(code: AiErrorCode | null | undefined, fallback: string): string {
  if (!code?.id) return fallback;
  const key = `aiErrors.${code.id}`;
  return i18n.exists(key) ? i18n.t(key, code) : fallback;
}

/** The text of a refused request: `request` puts the body after « — », and
 *  the body is `{ errore, codice? }`. Anything else stays as it came. */
export function aiErrorOfRequest(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const i = m.indexOf(" — {");
  if (i < 0) return m;
  try {
    const body = JSON.parse(m.slice(i + 3)) as { errore?: unknown; codice?: AiErrorCode };
    const message = typeof body.errore === "string" ? body.errore : m;
    return aiErrorText(body.codice, message);
  } catch {
    return m;
  }
}
