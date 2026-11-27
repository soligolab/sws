// The draft of the Users page (25-11-2026, plan
// `docs/plans/2026-11-25-save-nella-testata.md`, decision 2). The fields write
// here, and the one Save of the header writes the draft. Before, every field
// saved by itself on leaving it, and «✓ Saved» showed for 2.5 s in the row:
// the maintainer saw it at the third attempt.
//
// The new password stays an action of its own, and saves at once (decision of
// 27-11-2026): a password does not wait in a draft. Creating and deleting a
// user stay actions of their own too.

import type { UpdateUserBody, UserRole, UserSummary } from "@/api/client";

/** What the page changed of one user. `zones` is the text as typed: «zone1,»
 *  must survive the key that writes the comma. */
export interface BozzaUtente {
  display_name?: string;
  role?: UserRole;
  must_change_password?: boolean;
  session_ttl_secs?: number | null;
  zones?: string;
}

export type BozzeUtenti = Record<string, BozzaUtente>;

/** The zones as typed, as a list. */
export function zoneDaTesto(text: string): string[] {
  return text.split(",").map((z) => z.trim()).filter(Boolean);
}

/** The request that writes `b` over `u`: only what really differs. Empty when
 *  the draft says what the server already has. */
export function patchDaBozza(u: UserSummary, b: BozzaUtente): UpdateUserBody {
  const p: UpdateUserBody = {};
  if (b.display_name !== undefined) {
    const v = b.display_name.trim();
    if (v !== (u.display_name ?? "")) p.display_name = v || null;
  }
  if (b.role !== undefined && b.role !== u.role) p.role = b.role;
  if (b.must_change_password !== undefined && b.must_change_password !== u.must_change_password) {
    p.must_change_password = b.must_change_password;
  }
  if (b.session_ttl_secs !== undefined && b.session_ttl_secs !== u.session_ttl_secs) {
    p.session_ttl_secs = b.session_ttl_secs;
  }
  if (b.zones !== undefined) {
    const zones = zoneDaTesto(b.zones);
    if (zones.join(",") !== (u.allowed_zones ?? []).join(",")) p.allowed_zones = zones;
  }
  return p;
}

/** The drafts after a change to one field of one user. A user whose draft is
 *  back to the server's values leaves the drafts: the page is not «changed»
 *  any more. */
export function conModifica(
  bozze: BozzeUtenti,
  u: UserSummary,
  change: BozzaUtente,
): BozzeUtenti {
  const b = { ...bozze[u.username], ...change };
  const next = { ...bozze };
  if (Object.keys(patchDaBozza(u, b)).length === 0) delete next[u.username];
  else next[u.username] = b;
  return next;
}
