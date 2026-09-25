/** Pacchetto runtime — **strumento di sviluppo** (Q51).
 *
 *  Costruisce il runtime stesso (`scripts/package.sh`) e elenca i tarball
 *  prodotti in `dist/`. Esiste solo se il runtime gira da un checkout del
 *  repo: per chi usa SWS installato sarebbe un pulsante che fallisce sempre,
 *  e infatti il server risponde 503 quando lo script non c'è
 *  (`packaging.rs`).
 *
 *  ## Perché è una scheda sua (25-09-2026)
 *
 *  Era una sezione in mezzo a `RuntimeConnectionTab`, fra le cose che si fanno
 *  su un dispositivo vero. Sta invece nel sotto-ramo «Sviluppatore»: chi
 *  configura un pannello non deve incontrarla mentre cerca il deploy, e il
 *  sotto-ramo intero **non si disegna** quando il repo non c'è.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getAuthToken } from "@/api/client";
import type { PackageFile } from "@/types";
import { ricorda, ricordato } from "@/config/campiDispositivo";
import { BTN, BTN_PRIMARY, INPUT, LOG_BOX, coloreRigaLog } from "./stiliRuntime";

// Il dispositivo su cui installare il binario: campi suoi, come le altre
// schede del ramo Device, e ricordati perché la scheda si smonta.
const K_HOST = "sws.devdeploy.host";
const K_PORT = "sws.devdeploy.port";
const K_USER = "sws.devdeploy.user";
const K_DIR  = "sws.devdeploy.remoteDir";

export function DevPackageTab() {
  const { t } = useTranslation();
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const [packages, setPackages] = useState<PackageFile[]>([]);
  const [selectedPkg, setSelectedPkg] = useState("");
  // Il deploy del binario nudo: strumento di sviluppo anche lui (Q51), e da
  // qui ha senso — si costruisce un pacchetto e lo si mette su un dispositivo.
  const [host, setHost] = useState(() => ricordato(K_HOST, ""));
  const [port, setPort] = useState(() => Number(ricordato(K_PORT, "22")) || 22);
  const [user, setUser] = useState(() => ricordato(K_USER, "user"));
  const [pass, setPass] = useState("");
  const [remoteDir, setRemoteDir] = useState(() => ricordato(K_DIR, "/tmp/sws-deploy"));
  const [deviceLog, setDeviceLog] = useState<string[]>([]);
  const [deploying, setDeploying] = useState(false);

  const fetchPackages = useCallback(async () => {
    try {
      const pkgs = await api.listPackages();
      setPackages(pkgs);
      setSelectedPkg((s) => (s === "" && pkgs.length > 0 ? pkgs[0].name : s));
    } catch { /* senza repo l'elenco è vuoto comunque */ }
  }, []);

  useEffect(() => { void fetchPackages(); }, [fetchPackages]);

  const handleDeviceDeploy = async () => {
    if (!selectedPkg || !host || !user) return;
    setDeploying(true);
    setDeviceLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tarball: selectedPkg, host, port, user, password: pass, remote_dir: remoteDir,
        }),
      });
      if (!res.ok) { setDeviceLog([`ERROR: ${res.status} ${res.statusText}`]); return; }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => setDeviceLog((l) => [...l, line]));
      }
    } catch (e: unknown) {
      setDeviceLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setDeploying(false);
    }
  };

  const handleBuild = async (noRust = false, noSpa = false) => {
    setBuilding(true);
    setBuildLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/build/package", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ no_rust: noRust, no_spa: noSpa }),
      });
      if (!res.ok) { setBuildLog([`ERROR: ${res.status} ${res.statusText}`]); return; }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => {
          setBuildLog((l) => [...l, line]);
          // A build finita l'elenco ha un tarball in più: si rilegge da sé.
          if (line === "DONE") void fetchPackages();
        });
      }
    } catch (e: unknown) {
      setBuildLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("cfg.runtimePackageTitle")}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button style={{ ...BTN_PRIMARY, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(false, false)}>
            {building ? t("cfg.buildRunning") : t("cfg.buildFull")}
          </button>
          <button style={{ ...BTN, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(true, false)} title={t("cfg.skipCargo")}>
            {t("cfg.buildOnlyUi")}
          </button>
          <button style={{ ...BTN, opacity: building ? 0.6 : 1 }} disabled={building}
            onClick={() => void handleBuild(false, true)} title={t("cfg.skipPnpm")}>
            {t("cfg.buildOnlyRust")}
          </button>
        </div>

        {buildLog.length > 0 && (
          <div style={{ ...LOG_BOX, marginTop: 0, marginBottom: 8 }}>
            {buildLog.map((l, i) => (
              <div key={i} style={{ color: coloreRigaLog(l) }}>{l}</div>
            ))}
          </div>
        )}

        {packages.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>
              {t("cfg.packagesAvailable")}
            </div>
            {packages.map((p) => (
              <div key={p.name}
                onClick={() => setSelectedPkg(p.name)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
                  borderRadius: 4, cursor: "pointer", marginBottom: 2,
                  background: selectedPkg === p.name ? "#1e3a5f" : "transparent",
                  border: `1px solid ${selectedPkg === p.name ? "var(--brand-primary, #3b82f6)" : "transparent"}`,
                }}>
                <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)", flex: 1, fontFamily: "monospace" }}>{p.name}</span>
                <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>
                  {(p.size_bytes / 1024 / 1024).toFixed(1)} MB
                </span>
                <span style={{ fontSize: 10, color: "var(--brand-surface-2, #334155)" }}>
                  {new Date(p.mtime_ms).toLocaleDateString("it-IT")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Il deploy del binario nudo su un dispositivo: era una modalità
            dell'Installazione, e ci stava male — quella scheda è il percorso
            di produzione (container), questo è sviluppo (decisione del
            maintainer, 25-09-2026). */}
        <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 10, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 8 }}>
            {t("cfg.deployModeBinary")}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <input style={{ ...INPUT, flex: 1, minWidth: 150 }} placeholder="wp630-xxxx.local"
              title={t("cfg.sshHost")} value={host}
              onChange={(e) => { setHost(e.target.value); ricorda(K_HOST, e.target.value); }} />
            <input style={{ ...INPUT, width: 70 }} type="number" title={t("cfg.port")} value={port}
              onChange={(e) => { setPort(Number(e.target.value) || 22); ricorda(K_PORT, e.target.value); }} />
            <input style={{ ...INPUT, width: 110 }} placeholder="user" title={t("cfg.sshUser")} value={user}
              onChange={(e) => { setUser(e.target.value); ricorda(K_USER, e.target.value); }} />
            {/* La password solo nello stato, mai in localStorage. */}
            <input style={{ ...INPUT, width: 130 }} type="password" autoComplete="off"
              title={t("cfg.sshPassword")} placeholder={t("cfg.passwordSession")} value={pass}
              onChange={(e) => setPass(e.target.value)} />
          </div>
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", display: "block", marginBottom: 6 }}>
            {t("cfg.requiresSshpassBinary")}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...INPUT, flex: 1, minWidth: 180 }} title={t("cfg.remoteTmpDir")} value={remoteDir}
              onChange={(e) => { setRemoteDir(e.target.value); ricorda(K_DIR, e.target.value); }} />
            <button
              style={{ ...BTN_PRIMARY, opacity: (deploying || !selectedPkg || !host) ? 0.6 : 1 }}
              disabled={deploying || !selectedPkg || !host}
              onClick={() => void handleDeviceDeploy()}
            >
              {deploying ? t("cfg.deployRunning") : t("cfg.installBinaryBtn")}
            </button>
          </div>
          {deviceLog.length > 0 && (
            <div style={LOG_BOX}>
              {deviceLog.map((l, i) => (<div key={i} style={{ color: coloreRigaLog(l) }}>{l}</div>))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
