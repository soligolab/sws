/** The panel each project remembers (plan
 *  `docs/plans/2026-11-20-dispositivo-ricordato-per-progetto.md`).
 *
 *  Until 20-11-2026 the connection belonged to the IDE, not to the project:
 *  closing a project and opening another kept the panel of the first, and a
 *  deploy sent the new project to it. Now:
 *  - the server closes the connection whenever a project is opened or closed
 *    (outside the cloud, `drop_on_project_change` in `remote.rs`);
 *  - the project remembers its last panel in `project.yaml` (`last_device`);
 *  - the browser keys the connection form reads (`RT_URL_KEY`, `RT_USER_KEY`)
 *    become a mirror of the open project, so the form and the one-click
 *    reconnect never offer another project's panel;
 *  - on open, the IDE asks whether to reconnect. */
import { useEffect, useRef } from "react";
import i18n from "i18next";
import { api } from "@/api/client";
import { prefissoGateway } from "@/api/prefisso";
import { useAppStore } from "@/store";
import { conferma } from "@/finestraAvviso/finestraAvviso";
import { RT_URL_KEY, RT_USER_KEY } from "@/config/schede/RuntimeConnectionTab";
import type { LastDevice } from "@/types";

const normalise = (url: string) => url.trim().replace(/\/+$/, "");

function storageSet(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable: the form starts empty */ }
}

/** The connection form follows the open project: its panel, or nothing. */
export function mirrorLastDevice(device: LastDevice | undefined | null): void {
  storageSet(RT_URL_KEY, device?.url ? normalise(device.url) : null);
  storageSet(RT_USER_KEY, device?.username?.trim() || null);
}

/** After a successful connection: the open project remembers this panel.
 *  Written only when it changes, and without making the project dirty (it is
 *  saved at once through its own section route). */
export async function rememberDevice(url: string, username?: string | null): Promise<void> {
  const project = useAppStore.getState().project;
  if (!project) return;
  const next: LastDevice = { url: normalise(url) };
  const user = username?.trim();
  if (user) next.username = user;
  const prev = project.last_device;
  if (prev && normalise(prev.url) === next.url && (prev.username ?? "") === (next.username ?? "")) return;
  try {
    await api.setLastDevice(next);
    useAppStore.setState((s) => (s.project ? { project: { ...s.project, last_device: next } } : {}));
  } catch { /* not remembered: nothing breaks, the next connection tries again */ }
}

/** On open, with a remembered panel and no connection: ask, then try without a
 *  password. A panel with users (or one that does not answer) leads to the
 *  connection form, already filled in by the mirror. */
export async function offerReconnect(device: LastDevice): Promise<void> {
  const url = normalise(device.url);
  const user = device.username?.trim() || undefined;
  const ok = await conferma({
    titolo: i18n.t("deviceMemory.title"),
    testo: user
      ? i18n.t("deviceMemory.askWithUser", { url, user })
      : i18n.t("deviceMemory.ask", { url }),
    si: i18n.t("deviceMemory.reconnect"),
    no: i18n.t("deviceMemory.notNow"),
  });
  if (!ok) return;
  const { setRemoteConnected, navigateToConfig } = useAppStore.getState();
  try {
    const r = await api.remoteConnect(url, user, undefined);
    if (!r.ok) throw new Error(r.error ?? "");
    setRemoteConnected(true, url);
  } catch {
    navigateToConfig("runtime");
  }
}

/** Once per opened project: mirror its panel into the form, align the
 *  connection state with the server (which has just dropped it), and offer to
 *  reconnect. In the cloud the container is the project and reconnects by
 *  itself, so only the memory is written there. */
export function useDeviceMemory(): void {
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const name = project?.meta?.name ?? null;
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!name) { handled.current = null; return; }
    if (handled.current === name) return;
    handled.current = name;
    if (prefissoGateway()) return;
    const device = useAppStore.getState().project?.last_device;
    mirrorLastDevice(device);
    let alive = true;
    void api.remoteStatus()
      .then((st) => {
        if (!alive) return;
        useAppStore.getState().setRemoteConnected(!!st.connected, st.url ?? null);
        if (!st.connected && device?.url) void offerReconnect(device);
      })
      .catch(() => { /* no answer: the header says so where it matters */ });
    return () => { alive = false; };
  }, [name]);

  // A connection made from anywhere (form, devices, header) is remembered.
  useEffect(() => {
    if (!name || !remoteConnected || !remoteUrl) return;
    let user: string | null = null;
    try { user = localStorage.getItem(RT_USER_KEY); } catch { /* none */ }
    void rememberDevice(remoteUrl, user);
  }, [name, remoteConnected, remoteUrl]);
}
