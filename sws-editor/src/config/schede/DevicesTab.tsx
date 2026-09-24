import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, RuntimeUnavailableError, type DispositivoRete } from "@/api/client";
import { TabellaDispositivi } from "@/config/installazione/TabellaDispositivi";
import { modoAccesso, spiegaCredenzialiMancanti, spiegaLoginFallito } from "@/config/credenzialiDispositivo";
import { CHIAVE_LEGACY, chiaveUrl, dispositivoDaRete, eGiaInLista, leggiListaLegacy, unisciDispositivo } from "@/config/dispositiviRegistrati";
import type { SavedDevice } from "@/types";
import { selectIsDirty, useAppStore } from "@/store";
import i18n from "@/i18n";
import { RT_URL_KEY, RT_USER_KEY } from "@/config/schede/RuntimeConnectionTab";

// ── T-24 DevicesTab ───────────────────────────────────────────────────────────

// Q50: la lista sta sul server (`/api/devices`). Chi la aggiunge da fuori la
// scheda (i pulsanti «+ Dispositivi» del discovery) passa da qui: legge, unisce,
// scrive. Piccola e rara: due richieste vanno bene.
export async function registraDispositivo(nuovo: SavedDevice): Promise<SavedDevice[]> {
  const attuale = await api.listDevices();
  return api.saveDevices(unisciDispositivo(attuale, nuovo));
}

/** Core deploy logic, reusable from RuntimeConnectionTab and DevicesTab. */
/**
 * Svuota le modifiche non salvate prima di un deploy.
 *
 * Entrambi i percorsi di deploy costruiscono lo ZIP leggendo il progetto **da
 * disco** (`/api/project/export` lato server), quindi senza questo passaggio un
 * deploy con modifiche pendenti spedisce lo stato precedente: i log dicono
 * "completato" e sul dispositivo si continua a vedere la versione vecchia.
 *
 * Ritorna false se il salvataggio è fallito: in quel caso il deploy va annullato
 * invece di pubblicare qualcosa di diverso da ciò che l'autore vede.
 */
export async function flushBeforeDeploy(onLog: (msg: string) => void): Promise<boolean> {
  if (!selectIsDirty(useAppStore.getState())) return true;
  onLog(i18n.t("cfgUi.savingUnsavedChanges"));
  await useAppStore.getState().saveAll();
  const st = useAppStore.getState();
  if (st.saveStatus === "error") {
    onLog(i18n.t("cfgUi.saveFailedDeployCancelled", { reason: st.saveError ?? i18n.t("cfgUi.unknownError") }));
    return false;
  }
  onLog(i18n.t("cfgUi.saved2"));
  return true;
}

async function deployToTarget(
  target: string,
  user: string,
  pass: string,
  onLog: (msg: string) => void,
): Promise<boolean> {
  try {
    if (!await flushBeforeDeploy(onLog)) return false;
    onLog(i18n.t("cfgUi.exportingTheProjectFromThe"));
    // true: il deploy vuole SEMPRE i segreti — un dispositivo che li riceve
    // senza non si collega a niente (Passo 2, 2d). Diverso da «Esporta» nel
    // menù, che di default li esclude.
    const exportRes = await api.exportProjectZip(true);
    const cd = exportRes.headers.get("content-disposition") ?? "";
    const nameMatch = cd.match(/filename="([^"]+)"/);
    const zipName = nameMatch?.[1] ?? "project.zip";
    const projectName = zipName.replace(/\.zip$/, "");
    const zipBlob = await exportRes.blob();
    onLog(`✓ Esportato: ${zipName} (${(zipBlob.size / 1024).toFixed(1)} KB)`);

    // T-68 — si chiede prima al pannello se il login serve. Su un pannello
    // appena installato non ci sono utenti: tentare il login fallisce per
    // forza (quell'utente non esiste) e **cinque fallimenti bloccano
    // l'account per un minuto**, con ogni nuovo tentativo che allunga il
    // blocco. È la stessa lezione di T-57, che era stata applicata a
    // «Connetti» e non a questo percorso.
    const authRequired = await fetch(`${target}/api/system`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (typeof j?.auth_required === "boolean" ? (j.auth_required as boolean) : undefined))
      .catch(() => undefined);

    let remoteToken: string | null = null;
    switch (modoAccesso(authRequired, user, pass)) {
      case "senza-login":
        onLog(i18n.t("cfgUi.thePanelHasNoUsers"));
        break;
      case "credenziali-mancanti":
        throw new Error(spiegaCredenzialiMancanti());
      case "login": {
        onLog("Login al target…");
        const loginRes = await fetch(`${target}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user, password: pass }),
        });
        if (!loginRes.ok) {
          throw new Error(spiegaLoginFallito(loginRes.status, loginRes.headers.get("Retry-After")));
        }
        remoteToken = (await loginRes.json()).token;
        onLog("✓ Login OK");
        break;
      }
    }
    // Senza token non si manda l'header: su un pannello senza utenti un
    // `Bearer null` sarebbe una credenziale finta, e il runtime la
    // tratterebbe come tale.
    const autorizzazione: Record<string, string> =
      remoteToken ? { "Authorization": `Bearer ${remoteToken}` } : {};

    onLog("Upload ZIP al target…");
    let uploadRes = await fetch(`${target}/api/projects/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", ...autorizzazione },
      body: zipBlob,
    });
    if (uploadRes.status === 409) {
      const conflict = await uploadRes.json().catch(() => ({}));
      const realName = (conflict as any).name ?? projectName;
      const ok = window.confirm(i18n.t("cfg.overwriteRemoteProjectConfirm", { name: realName }));
      if (!ok) throw new Error("Deploy annullato dall'utente.");
      onLog(`Rimozione di "${realName}" dal target…`);
      await fetch(`${target}/api/projects/close`, { method: "POST", headers: autorizzazione }).catch(() => {});
      const delRes = await fetch(`${target}/api/projects/${encodeURIComponent(realName)}`,
        { method: "DELETE", headers: autorizzazione });
      if (!delRes.ok) {
        const body = await delRes.text().catch(() => "");
        throw new Error(`Impossibile rimuovere "${realName}": ${delRes.status}${body ? ` — ${body}` : ""}`);
      }
      onLog(`✓ Rimosso "${realName}"`);
      uploadRes = await fetch(`${target}/api/projects/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/zip", ...autorizzazione },
        body: zipBlob,
      });
    }
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => "");
      throw new Error(`Upload fallito: ${uploadRes.status}${body ? ` — ${body}` : ""}`);
    }
    const { name: uploadedName } = await uploadRes.json();
    onLog(i18n.t("cfgUi.uploadedAs", { name: uploadedName }));

    onLog(i18n.t("cfgUi.activatingProject"));
    const openRes = await fetch(`${target}/api/projects/${encodeURIComponent(uploadedName)}/open`, {
      method: "POST",
      headers: autorizzazione,
    });
    if (!openRes.ok) {
      const body = await openRes.text().catch(() => "");
      throw new Error(`Attivazione fallita: ${openRes.status}${body ? ` — ${body}` : ""}`);
    }
    onLog(`✓ "${uploadedName}" attivo sul runtime`);
    onLog("🚀 Deploy completato!");
    return true;
  } catch (e: any) {
    onLog(`✗ ${e?.message ?? String(e)}`);
    return false;
  }
}

interface DeviceState {
  checking: boolean;
  online: boolean;
  fingerprint: string | null;
}

export function DevicesTab() {
  const { t } = useTranslation();
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  // Q50: la lista arriva dal server. Al primo avvio dopo l'aggiornamento, se il
  // server non ha niente e il browser ha la vecchia lista, la si porta su una
  // volta sola (senza il campo password) e si toglie dal browser.
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [avvisoLista, setAvvisoLista] = useState<string | null>(null);
  const [caricata, setCaricata] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        let lista = await api.listDevices();
        const legacy = leggiListaLegacy(localStorage.getItem(CHIAVE_LEGACY));
        if (lista.length === 0 && legacy.length > 0) {
          lista = await api.saveDevices(legacy);
          if (vivo) setAvvisoLista(t("cfg.devicesMigrated", { n: lista.length }));
        }
        if (legacy.length > 0 || localStorage.getItem(CHIAVE_LEGACY) !== null) localStorage.removeItem(CHIAVE_LEGACY);
        if (vivo) setDevices(lista);
      } catch (e) {
        if (vivo) setAvvisoLista(t("cfg.devicesLoadFailed", { err: String(e) }));
      } finally {
        if (vivo) setCaricata(true);
      }
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Q50: «Cerca dispositivi in rete» anche qui, per registrare ciò che si trova.
  const [rete, setRete] = useState<DispositivoRete[] | null>(null);
  const [cercandoRete, setCercandoRete] = useState(false);
  const [erroreRete, setErroreRete] = useState<"unreachable" | "generic" | null>(null);
  const [states, setStates] = useState<Record<string, DeviceState>>({});
  // Le password dei dispositivi, per URL: **solo in memoria**. Al reload si
  // richiedono, con il campo nella riga. Il controllo periodico le legge da una
  // ref perché la sua callback non deve rinascere a ogni tasto battuto.
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const passwordsRef = useRef(passwords);
  passwordsRef.current = passwords;
  const [localFp, setLocalFp] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ label: "", url: "", user: "admin", pass: "" });
  const [deployingUrl, setDeployingUrl] = useState<string | null>(null);
  const [connettendo, setConnettendo] = useState<string | null>(null);
  const [esitoConnessione, setEsitoConnessione] = useState<{ url: string; testo: string | null; errore: boolean } | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);

  // Ottimista: la lista si aggiorna subito, e se il server rifiuta (URL non
  // valido, doppione) si torna a quella di prima e si dice perché.
  const saveDevices = (list: SavedDevice[]) => {
    const prima = devices;
    setDevices(list);
    setAvvisoLista(null);
    api.saveDevices(list)
      .then((salvata) => setDevices(salvata))
      .catch((e) => { setDevices(prima); setAvvisoLista(t("cfg.devicesSaveFailed", { err: String(e) })); });
  };

  const cercaRete = async () => {
    setCercandoRete(true); setRete(null); setErroreRete(null);
    try { setRete(await api.discoverDispositivi()); }
    catch (e) { setErroreRete(e instanceof RuntimeUnavailableError ? "unreachable" : "generic"); }
    finally { setCercandoRete(false); }
  };

  const checkDevice = useCallback(async (device: SavedDevice) => {
    const url = device.url;
    setStates((s) => ({ ...s, [url]: { ...s[url], checking: true, online: s[url]?.online ?? false, fingerprint: s[url]?.fingerprint ?? null } }));
    let online = false;
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      online = r.ok;
    } catch { /* offline */ }

    if (!online) {
      setStates((s) => ({ ...s, [url]: { checking: false, online: false, fingerprint: null } }));
      return;
    }

    let fingerprint: string | null = null;
    // Con un utente ma senza password in memoria non si tenta il login: la
    // firma resta «n/d» finché non la si inserisce nella riga.
    const password = passwordsRef.current[url];
    if (device.user && password === undefined) {
      setStates((s) => ({ ...s, [url]: { checking: false, online: true, fingerprint: null } }));
      return;
    }
    try {
      const loginR = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: device.user, password: password ?? "" }),
        signal: AbortSignal.timeout(5000),
      });
      if (loginR.ok) {
        const { token } = await loginR.json();
        const fpR = await fetch(`${url}/api/project/fingerprint`, {
          headers: { "Authorization": `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (fpR.ok) {
          const fp = await fpR.json();
          fingerprint = fp.sha256 ?? null;
        }
      }
    } catch { /* auth failed or no project */ }

    setStates((s) => ({ ...s, [url]: { checking: false, online: true, fingerprint } }));
  }, []);

  const checkAll = useCallback((list: SavedDevice[]) => {
    list.forEach((d) => void checkDevice(d));
  }, [checkDevice]);

  useEffect(() => {
    api.getProjectFingerprint().then((fp) => setLocalFp(fp.sha256)).catch(() => {});
  }, []);

  useEffect(() => {
    if (devices.length > 0) checkAll(devices);
    const timer = setInterval(() => checkAll(devices), 30_000);
    return () => clearInterval(timer);
  }, [devices, checkAll]);

  const handleConnect = async (device: SavedDevice) => {
    const pass = passwords[device.url];
    localStorage.setItem(RT_URL_KEY, device.url);
    localStorage.setItem(RT_USER_KEY, device.user);
    // Prima non chiamava mai l'API di connessione — scriveva solo le
    // credenziali in localStorage e sparava l'evento, quindi "Connetti" non
    // connetteva davvero nulla (vedi anche RuntimeConnectionTab.handleConnect,
    // stesso schema).
    setConnettendo(device.url); setEsitoConnessione(null);
    try {
      const result = await api.remoteConnect(device.url, device.user || undefined, pass || undefined);
      if (!result.ok) throw new Error(result.error ?? t("cfgUi.connectionFailed"));
      setRemoteConnected(true, device.url);
      setEsitoConnessione({ url: device.url, testo: result.nota ?? null, errore: false });
      window.dispatchEvent(new CustomEvent("sws:runtime-connected", { detail: { url: device.url } }));
    } catch (e: any) {
      // Prima finiva in `console.warn` e a schermo non cambiava niente: si
      // premeva «Connetti» e non si capiva se avesse fatto qualcosa.
      setEsitoConnessione({ url: device.url, testo: String(e?.message ?? e), errore: true });
      setRemoteConnected(false);
    } finally {
      setConnettendo(null);
    }
  };

  const handleDisconnect = async () => {
    await api.remoteDisconnect().catch(() => {});
    setRemoteConnected(false);
    setEsitoConnessione(null);
    window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
  };

  const handleDeploy = async (device: SavedDevice) => {
    setDeployingUrl(device.url);
    setDeployLog([]);
    await deployToTarget(device.url, device.user, passwords[device.url] ?? "", (msg) =>
      setDeployLog((l) => [...l, msg])
    );
    setDeployingUrl(null);
    // Refresh fingerprint after deploy
    setTimeout(() => void checkDevice(device), 1500);
  };

  const INPUT: React.CSSProperties = {
    background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4, padding: "5px 8px", fontSize: 12,
  };
  const BTN: React.CSSProperties = {
    padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12,
    border: "1px solid var(--brand-surface-2, #334155)", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: 1 }}>
        {t("cfg.devicesRegistered")}
      </div>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: -12 }}>{t("cfg.devicesStoredWhere")}</div>
      {avvisoLista && (
        <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #fbbf24)" }}>{avvisoLista}</div>
      )}

      {/* Device table */}
      {devices.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
          {caricata ? t("cfg.devicesNoneSaved") : "…"}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-subtle, #64748b)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>{t("cfg.labelWord")}</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>URL</th>
                {/* T-68 — l'utente si vede e si cambia qui. Prima non
                    compariva affatto: un dispositivo preso dal discovery nasce
                    senza utente, e non c'era modo di accorgersene né di
                    aggiungerlo se non cancellandolo e rifacendolo. */}
                <th style={{ textAlign: "left", padding: "6px 8px" }}>{t("cfg.swsUser")}</th>
                <th style={{ textAlign: "center", padding: "6px 8px" }}>{t("cfg.state")}</th>
                <th style={{ textAlign: "center", padding: "6px 8px" }}>{t("cfg.fingerprint")}</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>{t("cfg.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const st = states[d.url];
                const checking = st?.checking ?? false;
                const online = st?.online ?? null;
                const fp = st?.fingerprint ?? null;
                const match = localFp && fp ? (localFp === fp ? "sync" : "diff") : "unknown";
                // La password serve solo se un utente c'è: senza utente il
                // problema da risolvere è l'utente, e chiederla prima sarebbe
                // chiedere la seconda metà di una cosa che non ha la prima.
                const mancaPassword = !!d.user && passwords[d.url] === undefined;
                const mancaUtente = !d.user;
                // Verde solo per il dispositivo a cui si è davvero connessi,
                // non per tutti quando una connessione è aperta da qualche parte.
                const connessoQui = remoteConnected && chiaveUrl(remoteUrl ?? "") === chiaveUrl(d.url);
                return (
                  <tr key={d.url} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                    <td style={{ padding: "8px", color: "var(--brand-text, #e2e8f0)", fontWeight: 600 }}>{d.label}</td>
                    <td style={{ padding: "8px", color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace", fontSize: 11 }}>{d.url}</td>
                    <td style={{ padding: "8px" }}>
                      <input
                        style={{ ...INPUT, width: 100, borderColor: mancaUtente ? "var(--brand-warning, #f59e0b)" : undefined }}
                        placeholder={t("cfg.swsUserPlaceholder")}
                        title={mancaUtente ? t("cfg.deviceUserMissing") : t("cfg.swsCredentialsHint")}
                        defaultValue={d.user}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === d.user) return;
                          // Cambiare utente invalida la password tenuta in
                          // memoria: è la password *di quell'utente*, e
                          // riusarla sarebbe un tentativo fallito in più su un
                          // budget che dopo cinque si esaurisce.
                          setPasswords((p) => { const n = { ...p }; delete n[d.url]; return n; });
                          saveDevices(devices.map((x) => (x.url === d.url ? { ...x, user: v } : x)));
                        }}
                      />
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {online === null || checking
                        ? <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>…</span>
                        : online
                          ? <span style={{ color: "#34d399" }}>● online</span>
                          : <span style={{ color: "var(--brand-danger-soft, #f87171)" }}>● offline</span>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {!online ? <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>—</span>
                        : match === "sync"    ? <span style={{ color: "#34d399" }}>✓ in sync</span>
                        : match === "diff"    ? <span style={{ color: "#fb923c" }}>✗ diff. versione</span>
                        : <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>? n/d</span>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                        {mancaPassword && (
                          <input style={{ ...INPUT, width: 120 }} type="password" autoComplete="off"
                            placeholder={t("cfg.passwordSession")} title={t("cfg.passwordSessionTitle")}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              const v = (e.target as HTMLInputElement).value;
                              if (!v) return;
                              setPasswords((p) => ({ ...p, [d.url]: v }));
                              // Con la password si può anche leggere la firma.
                              setTimeout(() => void checkDevice(d), 0);
                            }} />
                        )}
                        {connessoQui ? (
                          <button
                            style={{ ...BTN, background: "var(--brand-success-bg, #14532d)", borderColor: "var(--brand-success, #22c55e)", color: "var(--brand-success-soft, #86efac)" }}
                            onClick={() => void handleDisconnect()}
                            title={t("cfg.disconnect")}>● {t("cfg.disconnect")}</button>
                        ) : (
                          <button style={BTN} disabled={mancaPassword || connettendo === d.url}
                            onClick={() => void handleConnect(d)}
                            title={mancaPassword ? t("cfg.passwordSessionTitle") : t("cfg.setTargetConnect")}>
                            {connettendo === d.url ? t("cfg.connecting") : t("cfg.connect")}
                          </button>
                        )}
                        <button style={{ ...BTN, background: "#1e3a5f", borderColor: "var(--brand-primary-hover, #2563eb)", color: "#93c5fd" }}
                          disabled={deployingUrl === d.url || mancaPassword}
                          title={mancaPassword ? t("cfg.passwordSessionTitle") : undefined}
                          onClick={() => void handleDeploy(d)}>
                          {deployingUrl === d.url ? t("cfg.deployRunning") : "Deploy"}
                        </button>
                        <button style={{ ...BTN, color: "var(--brand-danger-soft, #f87171)", borderColor: "var(--brand-danger-bg, #7f1d1d)" }}
                          onClick={() => saveDevices(devices.filter((x) => x.url !== d.url))}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* L'esito dell'ultima connessione. Prima finiva in console.warn: si
          premeva «Connetti» e a schermo non cambiava niente. */}
      {esitoConnessione && (
        <div style={{
          fontSize: 11, lineHeight: 1.4, padding: "6px 10px", borderRadius: 4,
          background: esitoConnessione.errore ? "var(--brand-danger-bg, #7f1d1d)" : "var(--brand-success-bg, #14532d)",
          color: esitoConnessione.errore ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-success-soft, #86efac)",
        }}>
          {esitoConnessione.errore ? `✗ ${t("cfg.connectFailed")}` : `✓ ${t("cfg.connectOk")}`}
          {esitoConnessione.testo ? ` ${esitoConnessione.testo}` : ""}
          <span style={{ opacity: 0.8 }}> — {esitoConnessione.url}</span>
        </div>
      )}

      {/* Deploy log */}
      {deployLog.length > 0 && (
        <div style={{ background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
          padding: "8px 10px", maxHeight: 150, overflowY: "auto", fontFamily: "monospace", fontSize: 11 }}>
          {deployLog.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : l.startsWith("🚀") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
          ))}
        </div>
      )}

      {/* Add device form */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          {t("cfg.devicesAdd")}
        </div>
        {/* Q50: ciò che c'è in rete, con un «+» per registrarlo. Stessa tabella
            di «Installa su dispositivo» (Q52). */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          <div>
            <button style={BTN} disabled={cercandoRete} onClick={() => void cercaRete()}>
              {cercandoRete ? t("cfg.devicesSearching") : t("cfg.devicesSearch")}
            </button>
          </div>
          <TabellaDispositivi dispositivi={rete} inCorso={cercandoRete} errore={erroreRete}
            onScegli={(h) => setAddForm((f) => ({ ...f, url: f.url || `https://${h}:8444`, label: f.label || h.replace(/\.local$/i, "") }))}
            onAggiungi={(d) => { const n = dispositivoDaRete(d); saveDevices(unisciDispositivo(devices, n)); void checkDevice(n); }}
            giaPresenti={(d) => eGiaInLista(devices, dispositivoDaRete(d).url)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.labelWord")}</label>
            <input style={{ ...INPUT, width: 120 }} placeholder="PLC-01"
              value={addForm.label} onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.adminUrl")}</label>
            <input style={{ ...INPUT, width: 200 }} placeholder="https://192.168.1.10:8444"
              value={addForm.url} onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value.trim() }))} />
          </div>
          {/* «Utente»/«password» non dicevano quali: sono le credenziali
              applicative SWS, non quelle SSH del sistema — stessa distinzione
              già fatta nei pannelli «Connetti» e «Installa» (T-57). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.swsUser")}</label>
            <input style={{ ...INPUT, width: 110 }} placeholder="admin"
              value={addForm.user} onChange={(e) => setAddForm((f) => ({ ...f, user: e.target.value }))} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }} title={t("cfg.passwordSessionTitle")}>
              {t("cfg.swsPassword")} <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>({t("cfg.passwordSession")})</span>
            </label>
            <input style={{ ...INPUT, width: 130 }} type="password" autoComplete="off" placeholder="••••••••"
              value={addForm.pass} onChange={(e) => setAddForm((f) => ({ ...f, pass: e.target.value }))} />
          </div>
          <button
            style={{ ...BTN, background: "#1e3a5f", borderColor: "var(--brand-primary-hover, #2563eb)", color: "#93c5fd", padding: "5px 14px" }}
            disabled={!addForm.url || !addForm.user}
            onClick={() => {
              const label = addForm.label.trim() || addForm.url;
              const newDevice: SavedDevice = { label, url: addForm.url, user: addForm.user };
              const updated = [...devices.filter((d) => d.url !== newDevice.url), newDevice];
              // La password resta in memoria, non nella lista salvata.
              setPasswords((p) => ({ ...p, [newDevice.url]: addForm.pass }));
              saveDevices(updated);
              setAddForm({ label: "", url: "", user: "admin", pass: "" });
              void checkDevice(newDevice);
            }}
          >{t("cfg.add")}</button>
        </div>
        <span style={{ display: "block", marginTop: 6, fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", lineHeight: 1.4 }}>
          {t("cfg.swsCredentialsHint")}
        </span>
        {localFp && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>
            Firma locale: <span style={{ fontFamily: "monospace", color: "var(--brand-text-subtle, #64748b)" }}>{localFp.substring(0, 16)}…</span>
          </div>
        )}
      </div>
    </div>
  );
}
