import { useEffect, useRef } from "react";
import i18n from "@/i18n";
import { api, setLockTab, type LockHolder } from "@/api/client";
import { useAppStore } from "@/store";
import { avviso, conferma, scegli } from "@/finestraAvviso/finestraAvviso";

/** The project lock, IDE side (21-11-2026, plan
 *  `docs/plans/2026-11-21-lock-salva-come-sorgenti-sandbox.md`; server side in
 *  `project_lock.rs`).
 *
 *  One id per browser tab, kept in `sessionStorage` so a reload of the same
 *  tab is the same tab: otherwise the reload would find its own lock, still
 *  alive, and call itself «another tab». */
const KEY = "sws.projectLock.tab";
export const HEARTBEAT_MS = 15_000;

function newId(): string {
  try { return crypto.randomUUID(); } catch { return `t${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export const TAB_ID: string = (() => {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) return v;
    const id = newId();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return newId();
  }
})();

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o);

function who(h: LockHolder): string {
  return h.user ?? t("projectLock.someone");
}

function minutes(h: LockHolder): number {
  return Math.max(0, Math.round((Date.now() - h.since_ms) / 60_000));
}

/** What the tab does on opening a project another tab holds: read-only,
 *  take control, or cancel (`false`: the caller closes the project). */
export async function onOpen(holder: LockHolder): Promise<boolean> {
  const testo = holder.same_user
    ? t("projectLock.busySameUser", { minutes: minutes(holder) })
    : t("projectLock.busy", { user: who(holder), minutes: minutes(holder) });
  const choice = await scegli<"read" | "take">({
    testo,
    scelte: [
      { valore: "read", etichetta: t("projectLock.openReadOnly") },
      { valore: "take", etichetta: t("projectLock.takeControl"), pericolo: true },
    ],
  });
  if (choice === null) return false;
  if (choice === "read") {
    useAppStore.getState().setLockReadOnly(holder);
    return true;
  }
  const c = await api.projectLock(TAB_ID, true);
  if (!c.held && c.holder) useAppStore.getState().setLockReadOnly(c.holder);
  return true;
}

/** One heartbeat. A tab that held the lock and no longer does learns who
 *  took it, and becomes read-only. A read-only tab does not beat: it would
 *  take a lock that has expired without anybody having asked. */
export async function heartbeat(): Promise<void> {
  const st = useAppStore.getState();
  if (st.lockReadOnly) return;
  let c: { held: boolean; holder?: LockHolder };
  try {
    c = await api.projectLock(TAB_ID, false);
  } catch {
    return; // runtime unreachable: not a fact about the lock
  }
  if (!c.held && c.holder) {
    useAppStore.getState().setLockReadOnly(c.holder);
    void avviso({ testo: t("projectLock.taken", { user: who(c.holder) }), livello: "info" });
  }
}

/** «Take control» from the read-only banner: after a confirmation, the lock
 *  passes here and the page reloads, so the work starts from the project as
 *  it is now — not from what this tab read while it was read-only. */
export async function takeControl(): Promise<void> {
  if (!(await conferma({ testo: t("projectLock.takeConfirm"), pericolo: true, si: t("projectLock.takeControl") }))) return;
  const c = await api.projectLock(TAB_ID, true);
  if (c.held) window.location.reload();
}

/** Claims the lock while a project is open in this IDE tab, beats, and lets
 *  it go when the project closes or the page goes away. `projectKey` changes
 *  when another project opens; `null` = none open. */
export function useProjectLock(projectKey: string | null, onCancel: () => void) {
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    if (!projectKey) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    setLockTab(TAB_ID);
    void (async () => {
      let c: { held: boolean; holder?: LockHolder } | null = null;
      try { c = await api.projectLock(TAB_ID, false); } catch { c = null; }
      if (!alive) return;
      if (c && !c.held && c.holder && !(await onOpen(c.holder))) {
        if (alive) cancel.current();
        return;
      }
      if (alive) timer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    })();
    const onExit = () => {
      if (!useAppStore.getState().lockReadOnly) api.releaseProjectLockOnExit(TAB_ID);
    };
    window.addEventListener("pagehide", onExit);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      window.removeEventListener("pagehide", onExit);
      if (!useAppStore.getState().lockReadOnly) void api.releaseProjectLock(TAB_ID).catch(() => {});
      useAppStore.getState().setLockReadOnly(null);
    };
  }, [projectKey]);
}
