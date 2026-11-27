// The update channel of the connected panel, chosen from the IDE (25-11-2026,
// plan docs/plans/2026-11-25-cambio-di-canale-dal-cloud.md).
//
// Until then a panel changed channel only with a reinstallation over SSH, which
// the cloud cannot do. The maintainer: «switch per saltare da devel a stable con
// opportuni warning». The panel decides what happens (`update_channel.rs`): with
// a higher version on the chosen channel it switches now, otherwise the choice
// waits and the image stays — a panel never goes down a version.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoAggiornamento, type UpdateChannelName, type UpdateVersions } from "@/api/client";
import { conferma } from "@/finestraAvviso/finestraAvviso";
import { scegliVersione } from "@/components/sceltaVersione";

/** The menu entry that opens «Fix a version…» (26-11-2026). It is not a
 *  channel: choosing it opens the list of versions. */
const PIN = "pin";

const CHANNELS: readonly UpdateChannelName[] = ["stable", "test", "dev"];
type ChannelChoice = UpdateChannelName | "none";

/** The API name of a channel as the status names it. */
export function channelName(canale: StatoAggiornamento["canale"] | StatoAggiornamento["canale_scelto"]): UpdateChannelName | null {
  if (canale === "stabile") return "stable";
  if (canale === "prova") return "test";
  if (canale === "sviluppo") return "dev";
  return null;
}

export function UpdateChannel({ stato, onChanged, onSwitchStarted, onBusy }: {
  stato: StatoAggiornamento;
  /** The new status of a choice that waits (or was taken back). */
  onChanged: (s: StatoAggiornamento) => void;
  /** The panel switches now: it installs `a` and restarts. `pin`: to a
   *  fixed version (26-11-2026). */
  onSwitchStarted: (s: StatoAggiornamento, kind?: "channel" | "pin") => void;
  /** The request is on its way (the snapshot can take minutes): the parent
   *  says so and holds «Update now» (review of 25-11-2026). */
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  // A fixed or archive panel can also go back to its pinned image: `none`.
  const pinned = stato.canale === "fissata" || stato.canale === "archivio";
  const imageChannel = channelName(stato.canale);
  // The channel the panel follows now: the chosen one if it waits, else the
  // image's; `none` for a pinned panel with no choice.
  const current: ChannelChoice = channelName(stato.canale_scelto) ?? imageChannel ?? "none";
  const [choice, setChoice] = useState<ChannelChoice>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The versions the panel can be fixed to (26-11-2026). Only a runtime that
  // knows `/api/update/versions` answers: for an older one the entry is hidden.
  const [versions, setVersions] = useState<UpdateVersions | null>(null);
  useEffect(() => {
    let alive = true;
    api.remoteUpdateVersions()
      .then((v) => { if (alive && Array.isArray(v?.versions)) setVersions(v); })
      .catch(() => { if (alive) setVersions(null); });
    return () => { alive = false; };
  }, []);

  // «Fix a version…»: the list, then the confirmation with the snapshot and
  // the restart, then the request.
  const pin = async () => {
    if (!versions) return;
    if (versions.versions.length === 0) {
      setError(t("aggiornamento.fissaNessuna"));
      return;
    }
    const picked = await scegliVersione({
      titolo: t("aggiornamento.fissaTitolo"),
      testo: t("aggiornamento.fissaTesto", { running: versions.running }),
      versioni: versions.versions,
      inUso: versions.running,
    });
    if (!picked) return;
    if (!(await conferma({ testo: t("aggiornamento.fissaConferma", { a: picked }) }))) return;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      const next = await api.remoteFixVersion(picked);
      if (next.in_corso) onSwitchStarted({ ...next, disponibile: next.disponibile ?? picked }, "pin");
      else onChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  const label = (c: ChannelChoice) => c === "none"
    ? t(`aggiornamento.canaleNomeNessuno.${stato.canale === "archivio" ? "archivio" : "fissata"}`)
    : t(`aggiornamento.canaleNome.${c}`);

  const confirmText = (): string => {
    // Back to the image's own channel, or to the pinned image: nothing is
    // installed, the choice that waited goes.
    if (choice === "none" || choice === imageChannel) {
      return t("aggiornamento.canaleConfermaRitorno", { canale: label(choice), versione: stato.versione });
    }
    const parts = [t("aggiornamento.canaleConferma", { canale: label(choice), versione: stato.versione })];
    if (choice === "dev") parts.unshift(t("aggiornamento.canaleAvvisoSviluppo"));
    return parts.join("\n\n");
  };

  const apply = async () => {
    // Only a real change of channel can start a switch (and its snapshot).
    const mayStartSwitch = choice !== "none" && choice !== imageChannel;
    if (!(await conferma({ testo: confirmText(), pericolo: choice === "dev" && mayStartSwitch }))) return;
    setBusy(true);
    if (mayStartSwitch) onBusy?.(true);
    setError(null);
    try {
      const next = await api.remoteCambiaCanale(choice);
      // `in_corso` in the answer: the panel switches now (the snapshot is
      // taken, the installer starts). Without it the choice waits, or it was
      // taken back.
      if (next.in_corso) onSwitchStarted(next);
      else onChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  const chosen = stato.canale_scelto ? channelName(stato.canale_scelto) : null;
  return (
    <div style={{ marginTop: 10 }} data-testid="update-channel">
      <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("aggiornamento.canaleTitolo")}</span>{" "}
      <select data-testid="update-channel-select" value={choice} disabled={busy}
        onChange={(e) => {
          if (e.target.value === PIN) { void pin(); return; }
          setChoice(e.target.value as ChannelChoice);
        }}>
        {pinned && <option value="none">{label("none")}</option>}
        {CHANNELS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
        {versions && <option value={PIN} data-testid="update-pin-entry">{t("aggiornamento.fissaVoce")}</option>}
      </select>{" "}
      <button type="button" data-testid="update-channel-apply" disabled={busy || choice === current}
        onClick={() => void apply()}>
        {t("aggiornamento.canaleCambia")}
      </button>
      {choice === "dev" && choice !== current && (
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--brand-warning, #f59e0b)" }}>
          ⚠ {t("aggiornamento.canaleAvvisoSviluppo")}
        </div>
      )}
      {chosen && (
        <div data-testid="update-channel-waiting" style={{ marginTop: 4, fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>
          {stato.disponibile
            ? t("aggiornamento.canaleInAttesaDisponibile", { canale: label(chosen), a: stato.disponibile })
            : t("aggiornamento.canaleInAttesa", { canale: label(chosen), versione: stato.versione })}
        </div>
      )}
      {error && <div style={{ marginTop: 4, fontSize: 12, color: "var(--brand-danger, #ef4444)" }}>{error}</div>}
    </div>
  );
}
