/** Gestione di un container già installato: stato, avvio, arresto, riavvio,
 *  avvio al boot, policy di riavvio, pulizia immagini, disinstallazione.
 *
 *  ## Perché è una scheda sua (25-09-2026)
 *
 *  Era un riquadro **dentro** il passo 5 dell'installazione, dentro
 *  `RuntimeConnectionTab`: ci si arrivava solo scorrendo tutta la scheda più
 *  lunga del repo, e solo dopo aver scelto «container» come modo di deploy.
 *  Ma gestire un container installato non ha niente a che fare con
 *  l'installarne uno nuovo: lo si fa dopo, magari mesi dopo, su un dispositivo
 *  che qualcun altro ha installato.
 *
 *  ## I campi del dispositivo sono suoi
 *
 *  Decisione del maintainer: host, porta, utente e password sono **della
 *  scheda**, non condivisi con l'Installazione. Su un dispositivo nuovo si
 *  digitano due volte, ma quello che si scrive qui non cambia l'altra
 *  schermata — e le due schede si possono aprire per dispositivi diversi.
 *
 *  Host, porta, utente e percorso dati si ricordano in `localStorage`: queste
 *  schede non portano bozza (`portaBozza: false`) e si **smontano** cambiando
 *  foglia, quindi senza memoria si ridigiterebbe tutto a ogni giro. La
 *  password no: quella si riscrive ogni volta, di proposito.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAuthToken } from "@/api/client";
import { effectiveDataPath } from "@/containerDeploy";
import { containerManagePayload, type ManageAction, type RestartPolicy } from "@/containerManage";
import {
  CONTAINER_DATA as K_DATA, CONTAINER_HOST as K_HOST, CONTAINER_PORT as K_PORT,
  CONTAINER_USER as K_USER, ricorda, ricordato,
} from "@/config/campiDispositivo";
import { BTN, BTN_RED, INPUT, LOG_BOX, coloreRigaLog } from "./stiliRuntime";


export function ContainerTab() {
  const { t } = useTranslation();

  // Locale (default) = comandi diretti sull'host che esegue il backend, niente
  // SSH: risolve il caso più comune, un container installato per prova sulla
  // stessa macchina che esegue l'IDE.
  const [manageLocal, setManageLocal] = useState(true);
  const [host, setHost] = useState(() => ricordato(K_HOST, ""));
  const [port, setPort] = useState(() => Number(ricordato(K_PORT, "22")) || 22);
  const [user, setUser] = useState(() => ricordato(K_USER, "user"));
  const [pass, setPass] = useState("");
  const [dataPath, setDataPath] = useState(() => ricordato(K_DATA, ""));

  const [manageLog, setManageLog] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicy>("always");
  const [uninstallPurge, setUninstallPurge] = useState(false);

  /** Da remoto senza host o senza utente non si fa niente: il comando
   *  fallirebbe e basta. */
  const bloccato = managing || (!manageLocal && (!host || !user));

  const handleManage = async (action: ManageAction) => {
    if (!manageLocal && (!host || !user)) return;
    // L'unica azione distruttiva è la disinstallazione, e solo con la
    // cancellazione dati merita un secondo avviso che nomini il percorso.
    if (action === "uninstall") {
      const msg = uninstallPurge
        ? t("cfg.uninstallPurgeConfirm", { path: effectiveDataPath(dataPath) })
        : t("cfg.uninstallConfirm", { path: effectiveDataPath(dataPath) });
      if (!window.confirm(msg)) return;
    }
    setManaging(true);
    setManageLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device-container/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(containerManagePayload({
          local: manageLocal,
          host, port, user, password: pass,
          action,
          restartPolicy,
          purge: uninstallPurge,
          dataPath,
        })),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setManageLog([`ERROR: ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => setManageLog((l) => [...l, line]));
      }
    } catch (e: unknown) {
      setManageLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setManaging(false);
      if (action === "uninstall") setUninstallPurge(false);
    }
  };

  const azione = (action: ManageAction, etichetta: string) => (
    <button style={BTN} disabled={bloccato} onClick={() => void handleManage(action)}>
      {t(etichetta)}
    </button>
  );

  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 8 }}>
          {t("cfg.manageTitle")}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={manageLocal} onChange={(e) => setManageLocal(e.target.checked)} />
          {manageLocal ? t("cfg.manageLocal") : t("cfg.manageRemote")}
        </label>

        {!manageLocal && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              style={{ ...INPUT, flex: 1, minWidth: 160 }}
              placeholder="wp630-xxxx.local"
              title={t("cfg.sshHost")}
              value={host}
              onChange={(e) => { setHost(e.target.value); ricorda(K_HOST, e.target.value); }}
            />
            <input
              style={{ ...INPUT, width: 70 }}
              type="number"
              title={t("cfg.port")}
              value={port}
              onChange={(e) => { setPort(Number(e.target.value) || 22); ricorda(K_PORT, e.target.value); }}
            />
            <input
              style={{ ...INPUT, width: 110 }}
              placeholder="user"
              title={t("cfg.sshUser")}
              value={user}
              onChange={(e) => { setUser(e.target.value); ricorda(K_USER, e.target.value); }}
            />
            {/* La password solo nello stato: mai in localStorage (regola del
                2026-09-09), a differenza di host, porta e utente qui sopra. */}
            <input
              style={{ ...INPUT, width: 130 }}
              type="password"
              autoComplete="off"
              title={t("cfg.sshPassword")}
              placeholder={t("cfg.passwordSession")}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {azione("status", "cfg.manageStatus")}
          {azione("start", "cfg.manageStart")}
          {azione("stop", "cfg.manageStop")}
          {azione("restart", "cfg.manageRestart")}
          {azione("enable", "cfg.manageEnableBoot")}
          {azione("disable", "cfg.manageDisableBoot")}
        </div>

        <div style={{ marginBottom: 10 }}>
          {azione("prune_images", "cfg.managePruneImages")}
          <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 3, maxWidth: 480 }}>
            {t("cfg.managePruneImagesHint")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.restartPolicy")}</label>
          <select
            value={restartPolicy}
            style={{ ...INPUT, width: 140 }}
            onChange={(e) => setRestartPolicy(e.target.value as RestartPolicy)}
          >
            <option value="always">{t("cfg.restartPolicyAlways")}</option>
            <option value="on-failure">{t("cfg.restartPolicyOnFailure")}</option>
            <option value="no">{t("cfg.restartPolicyNo")}</option>
          </select>
          {azione("set_restart_policy", "cfg.manageApplyPolicy")}
        </div>

        <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 8 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={uninstallPurge} onChange={(e) => setUninstallPurge(e.target.checked)} />
            <span style={{ fontSize: 12, color: uninstallPurge ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-2, #cbd5e1)" }}>
              {t("cfg.uninstallPurge")}
              <span style={{ display: "block", fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                {t("cfg.uninstallPurgeHint", { path: effectiveDataPath(dataPath) })}
              </span>
            </span>
          </label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input
              style={{ ...INPUT, flex: 1, minWidth: 180 }}
              placeholder={effectiveDataPath("")}
              value={dataPath}
              onChange={(e) => { setDataPath(e.target.value); ricorda(K_DATA, e.target.value); }}
            />
            <button
              style={{ ...BTN_RED, opacity: bloccato ? 0.6 : 1 }}
              disabled={bloccato}
              onClick={() => void handleManage("uninstall")}
            >
              {t("cfg.uninstallBtn")}
            </button>
          </div>
        </div>

        {manageLog.length > 0 && (
          <div style={LOG_BOX}>
            {manageLog.map((l, i) => (
              <div key={i} style={{ color: coloreRigaLog(l) }}>{l}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
