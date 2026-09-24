import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, getAuthToken, getBaseUrl, RuntimeUnavailableError, type DiscoveredRuntime, type DispositivoRete, type SondaggioDispositivo, type VarianteImmagine, dimenticaVersioneProgetto } from "@/api/client";
import { ListaControlli } from "@/config/installazione/ListaControlli";
import { TabellaDispositivi } from "@/config/installazione/TabellaDispositivi";
import { hostDaUrl, imageRefAutomatico, imageRefDaVariante, installazioneConsentita, varianteDaArch } from "@/config/installazione/sondaggio";
import { dispositivoDaRuntime } from "@/config/dispositiviRegistrati";
import { getBrand } from "@/branding";
import { containerDeployPayload, effectiveDataPath, type ContainerSource } from "@/containerDeploy";
import { containerManagePayload, type ManageAction, type RestartPolicy } from "@/containerManage";
import type { PackageFile, ContainerPackage } from "@/types";
import { selectIsDirty, useAppStore } from "@/store";
import { StatoBootImage } from "@/boot/StatoBootImage";
import { TRANS_COMP } from "@/config/comuni";
import { registraDispositivo, flushBeforeDeploy } from "@/config/schede/DevicesTab";

// ── RuntimeConnectionTab ─────────────────────────────────────────────────────

export const RT_URL_KEY  = "sws.runtime.targetUrl";
export const RT_USER_KEY = "sws.runtime.targetUser";
const RT_CONN_KEY = "sws.runtime.connected";

/** URL admin di un device scoperto, con l'host sostituito dall'hostname mDNS
 *  quando disponibile (stabile nel tempo, a differenza dell'IP che può
 *  cambiare per DHCP) — scheme/porta restano quelli di `r.admin_url`, così
 *  non li si duplica/hardcoda qui. Nota: risolto dal browser (fetch/WS), non
 *  dal backend come "Host SSH" — l'affidabilità di `.local` qui dipende dal
 *  sistema dell'utente, non è garantita come lato server. */
function discoveredAdminUrl(r: DiscoveredRuntime): string {
  if (!r.hostname) return r.admin_url;
  try {
    const u = new URL(r.admin_url);
    return `${u.protocol}//${r.hostname}:${u.port}`;
  } catch {
    return r.admin_url;
  }
}

/** Dati raccolti dal pull prima di scrivere qualcosa, in attesa che il modale
 *  di conferma li completi. Il bundle è già in mano e già archiviato: qui si
 *  decide solo con che nome importarlo e cosa fare delle modifiche non salvate. */
type PullPrompt = {
  blob: Blob;
  /** Proposto dal manifest del bundle, modificabile dal maintainer. */
  name: string;
  /** Progetti già presenti in locale: serve a dire "questo lo sostituisci". */
  localNames: string[];
  /** Versione che ha salvato il progetto SUL DISPOSITIVO. */
  savedBy: string | null;
  /** Versione di QUESTO IDE. */
  localVersion: string;
  dirty: boolean;
  saveFirst: boolean;
};

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function RuntimeConnectionTab() {
  const { t } = useTranslation();
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);
  const remoteConnectedStore = useAppStore((s) => s.remoteConnected);
  // Rientro nell'editor dopo il pull: stesse due azioni che App.tsx usa in
  // `onProjectOpened`, prese dallo store invece che passate giù per props.
  const resetProjectState = useAppStore((s) => s.resetProjectState);
  const setNoActiveProject = useAppStore((s) => s.setNoActiveProject);

  const [targetUrl,  setTargetUrl]  = useState(() => localStorage.getItem(RT_URL_KEY)  ?? "");
  const [targetUser, setTargetUser] = useState(() => localStorage.getItem(RT_USER_KEY) ?? "");
  // La password resta qui, nello stato: mai in localStorage (2026-09-09).
  const [targetPass, setTargetPass] = useState("");
  const [status, setStatus]         = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [statusMsg, setStatusMsg]   = useState<string | null>(null);
  // Q49: «Connetti» si è fermato perché il certificato del dispositivo non è
  // quello memorizzato. Il pulsante che segue è l'unico modo di andare avanti,
  // ed è un gesto umano: la fiducia non si rinnova da sola.
  const [certificatoCambiato, setCertificatoCambiato] = useState(false);
  const [dimenticandoCert, setDimenticandoCert] = useState(false);
  const [deployLog, setDeployLog]   = useState<string[]>([]);
  // Gli utenti appartengono al progetto: il deploy li porta sul dispositivo come
  // porta le pagine (2026-09-11). La casella serve al caso futuro in cui è una
  // vista del progetto a creare utenti sul dispositivo (Q54) — accesa di
  // default, perché il default è il progetto.
  const [sostituisciUtenti, setSostituisciUtenti] = useState(true);
  const [deploying, setDeploying]   = useState(false);
  const [deployDone, setDeployDone] = useState(false);
  const [deletingRemote, setDeletingRemote] = useState(false);
  const [pushingUsers, setPushingUsers] = useState(false);
  const [remoteMsg, setRemoteMsg]   = useState<string | null>(null);
  // Pull: riapertura nell'IDE del progetto che gira sul dispositivo. Il bundle
  // sta qui in attesa della conferma perché scaricarlo NON è distruttivo, e
  // averlo già in mano permette di mostrare nel modale il nome vero letto dal
  // manifest, la collisione coi progetti locali e lo scarto di versione —
  // tutto prima che si tocchi qualcosa.
  const [pullLog, setPullLog]       = useState<string[]>([]);
  const [pulling, setPulling]       = useState(false);
  const [pullDone, setPullDone]     = useState(false);
  const [pullAsk, setPullAsk]       = useState<PullPrompt | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered]   = useState<DiscoveredRuntime[] | null>(null);
  // "unreachable" = la fetch verso il runtime a cui l'IDE punta e' fallita
  // (tipicamente: cert self-signed non accettato in questo browser, o host
  // giu') — NON significa "zero runtime sulla rete". Prima veniva collassato
  // in discovered=[] e la UI diceva "Nessun runtime trovato": sembrava rotto.
  const [discoverError, setDiscoverError] = useState<"unreachable" | "generic" | null>(null);

  // On mount: remove stale localStorage key, sync actual state from server.
  useEffect(() => {
    localStorage.removeItem(RT_CONN_KEY);
    api.remoteStatus().then((s) => {
      if (s.connected && s.url) {
        setStatus("connected");
        setRemoteConnected(true, s.url);
      }
    }).catch(() => { /* not critical — start as idle */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Risincronizza lo stato locale quando la connessione cambia da FUORI
  // questo componente — es. il pulsante Deploy nell'header (App.tsx) che
  // riconnette/disconnette all'ultimo dispositivo agendo solo sullo store.
  // Senza questo, se la tab è già montata quando succede, `status` resta
  // bloccato sul valore di quando aveva montato (il suo unico sync è
  // l'effetto one-shot sopra), mentre il pulsante Deploy (che legge lo
  // store direttamente) mostra già lo stato corretto — da qui il
  // disallineamento fra i due.
  useEffect(() => {
    if (remoteConnectedStore && status !== "connected") {
      setStatus("connected"); setStatusMsg(null);
    } else if (!remoteConnectedStore && status === "connected") {
      setStatus("idle");
    }
  }, [remoteConnectedStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live tag panel: tag-id → {value, quality, ts} from /ws/remote/tags relay.
  type LiveTagEntry = { value: unknown; quality: string; ts: number };
  const [liveTags, setLiveTags] = useState<Map<string, LiveTagEntry>>(new Map());
  const liveWsRef = useRef<WebSocket | null>(null);

  // T-28: package build
  const [buildLog, setBuildLog]         = useState<string[]>([]);
  const [building, setBuilding]         = useState(false);
  const [packages, setPackages]         = useState<PackageFile[]>([]);
  const [selectedPkg, setSelectedPkg]   = useState("");
  // T-28: device deploy via SSH
  const [deviceHost, setDeviceHost]     = useState("");
  const [devicePort, setDevicePort]     = useState(22);
  // `user`: le credenziali limitate dell'utente finale (specifica dell'8
  // settembre). Era `root`, contro quella specifica: il container è rootless.
  const [deviceUser, setDeviceUser]     = useState("user");
  // L'host l'ha scritto (o scelto) l'utente: la precompilazione dal dispositivo
  // connesso non deve più toccarlo.
  const [hostTouched, setHostTouched]   = useState(false);
  const [devicePass, setDevicePass]     = useState("");
  const [deviceTmpDir, setDeviceTmpDir] = useState("/tmp/sws-deploy");
  const [deviceLog, setDeviceLog]       = useState<string[]>([]);
  const [deviceDeploying, setDeviceDeploying] = useState(false);
  // Installazione container (Podman) via SSH — stessi campi host/porta/utente/
  // password/remote_dir sopra, riusati identici; cambia solo cosa si spedisce
  // e quale comando gira sul device (install-container.sh, nessun sudo).
  // Container per primo (Q52): è il percorso di produzione. Il binario è «solo
  // sviluppo» e il selettore compare solo quando c'è il repo (Q51).
  const [deployMode, setDeployMode]           = useState<"binary" | "container">("container");
  // Q51: il runtime gira da un checkout del repo? `null` finché non si sa, e
  // finché non si sa la UI di sviluppo non si disegna: niente lampeggio.
  const [repoDisponibile, setRepoDisponibile] = useState<boolean | null>(null);
  const repo = repoDisponibile === true;
  // Q52: la tabella dei dispositivi in rete e il sondaggio via ssh.
  const [dispositivi, setDispositivi] = useState<DispositivoRete[] | null>(null);
  const [cercandoDispositivi, setCercandoDispositivi] = useState(false);
  const [erroreDispositivi, setErroreDispositivi] = useState<"unreachable" | "generic" | null>(null);
  const [sondaggio, setSondaggio] = useState<SondaggioDispositivo | null>(null);
  const [sondando, setSondando] = useState(false);
  const [erroreSondaggio, setErroreSondaggio] = useState<string | null>(null);
  const [varianteSuggerita, setVarianteSuggerita] = useState<VarianteImmagine | null>(null);
  // Da dove viene la variante proposta: dal dispositivo connesso o dalla
  // verifica via ssh. Cambia solo la frase accanto al campo.
  const [varianteDaConnesso, setVarianteDaConnesso] = useState(false);
  // Cosa rilanciare dopo «Dimentica la vecchia chiave»: la chiave cambiata può
  // fermare sia il sondaggio sia il deploy, e il pulsante è lo stesso.
  const ultimaAzione = useRef<"sondaggio" | "deploy" | null>(null);
  const [containerPackages, setContainerPackages] = useState<ContainerPackage[]>([]);
  const [selectedContainerPkg, setSelectedContainerPkg] = useState("");
  const [containerLog, setContainerLog]       = useState<string[]>([]);
  const [containerDeploying, setContainerDeploying] = useState(false);
  // Il deploy si è fermato perché la chiave host del dispositivo non combacia
  // (tipicamente dopo un factory reset). Non si toglie da soli: compare un
  // pulsante, e il gesto resta di chi guarda.
  const [chiaveHostCambiata, setChiaveHostCambiata] = useState(false);
  const [dimenticandoChiave, setDimenticandoChiave] = useState(false);
  // Percorso dati sul device (install-container.sh --data): vuoto = default
  // dello script. Il modello scelto dal dropdown brand-aware pre-compila
  // questo campo, che resta comunque sempre editabile — è anche il "modello
  // custom" richiesto, senza bisogno di uno stato separato.
  const [dataPath, setDataPath] = useState("");
  // Registry per default: è la strada documentata come normale dal 2026-07-30 e
  // trasferisce solo i layer cambiati. L'archivio resta per i dispositivi che il
  // registry non lo raggiungono, che in campo sono il caso normale.
  const [containerSource, setContainerSource] = useState<ContainerSource>("registry");
  // Vuoto = il tag lo compone il dispositivo da `uname -m`. Si riempie solo per
  // inchiodare una versione precisa.
  const [imageRef, setImageRef] = useState("");
  const [cleanInstall, setCleanInstall] = useState(false);
  // Gestione di un container già installato: stato/avvia/ferma/riavvia/
  // abilita-disabilita al boot/policy di restart/disinstalla. Locale (default)
  // = comandi diretti sul host che esegue il backend, niente SSH — risolve il
  // caso più comune: un container installato per test sulla stessa macchina
  // che esegue l'IDE, che collide con `start_runtime.sh` sulle stesse porte.
  // Remoto riusa gli stessi campi host/porta/utente/password del pannello di
  // installazione sopra.
  const [manageLocal, setManageLocal]     = useState(true);
  const [manageLog, setManageLog]         = useState<string[]>([]);
  const [managing, setManaging]           = useState(false);
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicy>("always");
  const [uninstallPurge, setUninstallPurge] = useState(false);

  const target = targetUrl.trim().replace(/\/$/, "");

  const saveForm = () => {
    localStorage.setItem(RT_URL_KEY,  target);
    localStorage.setItem(RT_USER_KEY, targetUser.trim());
  };

  const handleDisconnect = useCallback(() => {
    void api.remoteDisconnect().catch(() => {});
    setStatus("idle"); setStatusMsg(null); setDeployLog([]); setDeployDone(false);
    setRemoteConnected(false);
    window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
  }, [setRemoteConnected]);

  const handleDimenticaCertificato = async () => {
    const host = (() => { try { return new URL(target).hostname; } catch { return ""; } })();
    if (!host) return;
    setDimenticandoCert(true);
    try {
      const r = await api.remoteCertForget(host);
      setStatusMsg(r.messaggio);
      setCertificatoCambiato(false);
      await handleConnect();
    } catch (e: any) {
      setStatusMsg(String(e?.message ?? e));
    } finally {
      setDimenticandoCert(false);
    }
  };

  const handleConnect = async () => {
    if (!target) { setStatusMsg(t("cfgUi.enterTheRuntimeUrl")); return; }
    saveForm();
    setStatus("connecting"); setStatusMsg(null);
    try {
      // Credentials are optional: if the remote has no users defined it
      // accepts connections without authentication.
      const user = targetUser.trim() || undefined;
      const pass = targetPass || undefined;
      const result = await api.remoteConnect(target, user, pass);
      setCertificatoCambiato(result.azione === "certificato-cambiato");
      if (!result.ok) throw new Error(result.error ?? t("cfgUi.connectionFailed"));
      setStatus("connected");
      // La nota dice cosa è successo quando è riuscita ma non come chiedevi:
      // p.es. il dispositivo non ha utenti e le credenziali sono state ignorate.
      setStatusMsg(result.nota ?? null);
      setRemoteConnected(true, target);
      window.dispatchEvent(new CustomEvent("sws:runtime-connected", { detail: { url: target } }));
    } catch (e: any) {
      setStatus("error");
      setStatusMsg(String(e?.message ?? e));
      setRemoteConnected(false);
      window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
    }
  };

  // Poll /api/remote/status every 5 s while connected. Clears state if the
  // local runtime loses the session (restart, token expiry).
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      try {
        const s = await api.remoteStatus();
        if (!s.connected) handleDisconnect();
      } catch { /* network error — keep current state, will retry */ }
    }, 5000);
    return () => clearInterval(id);
  }, [status, handleDisconnect]);

  // Open the /ws/remote/tags relay when connected; close on disconnect.
  useEffect(() => {
    if (status !== "connected") {
      liveWsRef.current?.close();
      liveWsRef.current = null;
      setLiveTags(new Map());
      return;
    }
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const token  = getAuthToken();
    const url    = `${scheme}://${window.location.host}/ws/remote/tags${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    liveWsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", tags: ["*"] }));
    ws.onmessage = (ev) => {
      try {
        type WireEntry = { id: string; value: unknown; quality: string; ts: number };
        type WireMsg = { type: string; tags?: WireEntry[]; changed?: WireEntry[] };
        const msg = JSON.parse(ev.data as string) as WireMsg;
        if (msg.type === "snapshot" && msg.tags) {
          const m = new Map<string, LiveTagEntry>();
          for (const t of msg.tags) m.set(t.id, { value: t.value, quality: t.quality, ts: t.ts });
          setLiveTags(m);
        } else if (msg.type === "delta" && msg.changed) {
          setLiveTags((prev) => {
            const m = new Map(prev);
            for (const t of msg.changed!) m.set(t.id, { value: t.value, quality: t.quality, ts: t.ts });
            return m;
          });
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => { ws.close(); };
    return () => { ws.close(); liveWsRef.current = null; };
  }, [status]);

  const handleDownloadCert = async () => {
    // Via backend (proxy /api/remote/cert), non fetch diretta browser->target:
    // quella fallirebbe proprio finche' il cert non e' gia' accettato, che e'
    // l'unico momento in cui questo pulsante serve. curl resta solo come
    // ultima spiaggia nel messaggio d'errore (backend che non raggiunge l'host).
    try {
      const res = await api.downloadRemoteCert(target);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sws.crt";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setStatusMsg(t("cfgUi.certDownloadFailed", { message: e?.message ?? e, target }));
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscovered(null);
    setDiscoverError(null);
    try {
      const found = await api.discoverRuntimes();
      setDiscovered(found);
    } catch (e) {
      setDiscoverError(e instanceof RuntimeUnavailableError ? "unreachable" : "generic");
    } finally {
      setDiscovering(false);
    }
  };

  const fetchPackages = useCallback(async () => {
    try { const pkgs = await api.listPackages(); setPackages(pkgs); if (pkgs.length > 0 && !selectedPkg) setSelectedPkg(pkgs[0].name); }
    catch { /* ignore */ }
  }, [selectedPkg]);

  const fetchContainerPackages = useCallback(async () => {
    try {
      const pkgs = await api.listContainerPackages();
      setContainerPackages(pkgs);
      if (pkgs.length > 0 && !selectedContainerPkg) setSelectedContainerPkg(pkgs[0].image_tarball);
    } catch { /* ignore */ }
  }, [selectedContainerPkg]);

  // Q51: prima si chiede al server se c'è il repo; solo allora si caricano i
  // pacchetti, che senza repo tornerebbero comunque vuoti. Un runtime che non
  // ha ancora la rotta (404) o non risponde conta come «nessun repo»: la UI di
  // sviluppo è quella che deve guadagnarsi il diritto di comparire.
  useEffect(() => {
    let vivo = true;
    (async () => {
      let r = false;
      try { r = (await api.buildStato()).repo; } catch { /* runtime vecchio o irraggiungibile */ }
      if (!vivo) return;
      setRepoDisponibile(r);
      if (r) { void fetchPackages(); void fetchContainerPackages(); }
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Senza repo esistono solo il container e il registry: qualunque altra
  // scelta rimasta nello stato porterebbe a un pulsante che fallisce.
  useEffect(() => {
    if (repoDisponibile === false) { setDeployMode("container"); setContainerSource("registry"); }
  }, [repoDisponibile]);

  // Q52: se l'editor è collegato a un dispositivo, quello è la destinazione
  // più probabile. Si propone l'hostname dell'URL di connessione, ma solo
  // finché il campo è vuoto e l'utente non l'ha toccato: un valore scritto a
  // mano non si sovrascrive mai.
  useEffect(() => {
    if (hostTouched || deviceHost) return;
    if (status !== "connected" && !remoteConnectedStore) return;
    const h = hostDaUrl(target);
    if (h) setDeviceHost(h);
  }, [status, remoteConnectedStore, target, hostTouched, deviceHost]);

  // Q52: dal runtime collegato si legge anche l'architettura (`/api/system`,
  // dal 2.7.2), e con quella si propone la variante immagine senza aspettare
  // la verifica via ssh. Solo se il riferimento è «nostro» (vuoto o uno dei
  // nostri tag) e nessun sondaggio ha già detto la sua. Un runtime più vecchio
  // non manda `arch`: allora non si propone niente.
  useEffect(() => {
    if (status !== "connected" && !remoteConnectedStore) return;
    if (sondaggio || varianteSuggerita || !imageRefAutomatico(imageRef)) return;
    let vivo = true;
    api.remoteGetSystemStatus().then((st) => {
      if (!vivo) return;
      const v = varianteDaArch(st.arch);
      if (v && imageRefAutomatico(imageRef)) {
        setImageRef(imageRefDaVariante(v));
        setVarianteSuggerita(v);
        setVarianteDaConnesso(true);
      }
    }).catch(() => { /* non collegato davvero, o runtime senza il campo */ });
    return () => { vivo = false; };
  }, [status, remoteConnectedStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Host, porta o utente diversi = un altro dispositivo, o un altro accesso: la
  // lista di controlli precedente non parla più di questo caso.
  useEffect(() => {
    setSondaggio(null);
    setVarianteSuggerita(null);
    setVarianteDaConnesso(false);
  }, [deviceHost, devicePort, deviceUser]);

  const scegliHost = (h: string) => {
    setHostTouched(true);
    setDeviceHost(h);
    setChiaveHostCambiata(false);
  };

  const cercaDispositivi = async () => {
    setCercandoDispositivi(true); setDispositivi(null); setErroreDispositivi(null);
    try { setDispositivi(await api.discoverDispositivi()); }
    catch (e) { setErroreDispositivi(e instanceof RuntimeUnavailableError ? "unreachable" : "generic"); }
    finally { setCercandoDispositivi(false); }
  };

  const eseguiSondaggio = async () => {
    if (!deviceHost || !deviceUser) return;
    ultimaAzione.current = "sondaggio";
    setSondando(true); setErroreSondaggio(null); setChiaveHostCambiata(false);
    try {
      const s = await api.deviceProbe({ host: deviceHost, port: devicePort, user: deviceUser, password: devicePass, data_path: dataPath.trim() });
      setSondaggio(s);
      if (s.chiave_host_cambiata) setChiaveHostCambiata(true);
      // La variante proposta finisce nel campo solo se il campo è «nostro»:
      // vuoto o già uno dei nostri tag. Un riferimento scritto a mano resta.
      if (s.variante_immagine && imageRefAutomatico(imageRef)) {
        setImageRef(imageRefDaVariante(s.variante_immagine));
        setVarianteSuggerita(s.variante_immagine);
        setVarianteDaConnesso(false);
      }
    } catch (e) {
      setErroreSondaggio(e instanceof RuntimeUnavailableError ? t("cfg.discoverUnreachable") : String(e));
    } finally {
      setSondando(false);
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
          if (line === "DONE") void fetchPackages();
        });
      }
    } catch (e: unknown) {
      setBuildLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setBuilding(false);
    }
  };

  const handleDeviceDeploy = async () => {
    if (!selectedPkg || !deviceHost || !deviceUser) return;
    setDeviceDeploying(true);
    setDeviceLog([]);
    try {
      const token = getAuthToken() ?? "";
      const res = await fetch("/api/deploy/device", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tarball: selectedPkg, host: deviceHost, port: devicePort,
          user: deviceUser, password: devicePass, remote_dir: deviceTmpDir,
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
      setDeviceDeploying(false);
    }
  };

  /** Toglie dal known_hosts di questo PC le chiavi del dispositivo e rilancia
   *  il deploy. Ci si arriva solo dal pulsante che compare quando ssh si è
   *  fermato per quel motivo: la chiave non si cancella mai da sola. */
  const handleDimenticaChiaveHost = async () => {
    if (!deviceHost) return;
    setDimenticandoChiave(true);
    try {
      const r = await api.deviceHostKeyForget(deviceHost, devicePort);
      setContainerLog((l) => [...l, `==> ${r.messaggio}`]);
      setChiaveHostCambiata(false);
      // Si riprende da dove ci si era fermati: il sondaggio se era lui a
      // essersi fermato, altrimenti il deploy.
      if (ultimaAzione.current === "sondaggio") await eseguiSondaggio();
      else await handleContainerDeploy();
    } catch (e: unknown) {
      setContainerLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setDimenticandoChiave(false);
    }
  };

  const handleContainerDeploy = async () => {
    if (!deviceHost || !deviceUser) return;
    if (containerSource === "archive" && !selectedContainerPkg) return;
    // Conferma prima di qualunque cosa, e nominando la cartella: è l'unico
    // punto della UI in cui un clic cancella i progetti di un dispositivo.
    if (cleanInstall &&
        !window.confirm(t("cfg.cleanInstallConfirm", { path: effectiveDataPath(dataPath) }))) return;
    ultimaAzione.current = "deploy";
    setContainerDeploying(true);
    setContainerLog([]);
    setChiaveHostCambiata(false);
    try {
      const res = await api.deployDeviceContainer(containerDeployPayload({
        source: containerSource,
        imageTarball: selectedContainerPkg,
        imageRef,
        cleanInstall,
        host: deviceHost, port: devicePort,
        user: deviceUser, password: devicePass, remoteDir: deviceTmpDir,
        dataPath,
      }));
      if (!res.ok) {
        // Il corpo porta il messaggio in italiano del backend ("riferimento
        // immagine non valido: …"); mostrare solo lo status lo buttava via.
        const detail = await res.text().catch(() => "");
        setContainerLog([`ERROR: ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) => {
          // Riga a macchina: accende il pulsante e non si mostra nel log.
          if (line === "AZIONE: chiave-host-cambiata") { setChiaveHostCambiata(true); return; }
          setContainerLog((l) => [...l, line]);
        });
      }
    } catch (e: unknown) {
      setContainerLog((l) => [...l, `ERROR: ${String(e)}`]);
    } finally {
      setContainerDeploying(false);
      // La spunta non sopravvive all'uso: una seconda installazione fatta di
      // fretta non deve azzerare il dispositivo perché la casella era rimasta.
      setCleanInstall(false);
    }
  };

  const handleManage = async (action: ManageAction) => {
    if (!manageLocal && (!deviceHost || !deviceUser)) return;
    // Stessa cautela di handleContainerDeploy: l'unica azione qui distruttiva
    // è la disinstallazione, e solo con la cancellazione dati merita un
    // secondo avviso che nomini il percorso.
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
          host: deviceHost, port: devicePort, user: deviceUser, password: devicePass,
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

  /** La metà che parla col server. `confermato` diventa vero solo dopo che
   *  l'utente ha risposto al `window.confirm` del 428, e allora la funzione si
   *  richiama **una sola volta**: il flag è già a `true` e il server non può
   *  chiedere di nuovo. */
  const eseguiDeploy = async (confermato: boolean): Promise<void> => {
      const res = await api.deployToRuntime({
        replaceUsers: sostituisciUtenti,
        confirmNoUsers: confermato,
      });

      // 428: il server ha guardato e si è fermato **prima** di toccare qualcosa.
      // Il progetto non ha utenti e il dispositivo ne ha: proseguire lo
      // lascerebbe accessibile senza password. La decisione è di chi guarda lo
      // schermo, non del codice.
      if (res.status === 428 && !confermato) {
        const d = await res.json().catch(() => ({} as any));
        const elenco = Array.isArray(d?.utenti_dispositivo) && d.utenti_dispositivo.length
          ? d.utenti_dispositivo.join(", ")
          : t("cfg.deployNoUsersUnknown");
        if (!window.confirm(t("cfg.deployNoUsersConfirm", { utenti: elenco }))) {
          setDeployLog((l) => [...l, "✗ Deploy annullato."]);
          return;
        }
        return eseguiDeploy(true);
      }

      if (!res.ok || !res.body) {
        // Il corpo è dove il server mette la frase utile: «Un deploy è già in
        // corso», «Nessun runtime remoto connesso», «Nessun progetto attivo».
        // Buttarlo via lasciava a schermo un «409 Conflict» che non dice niente
        // a nessuno — successo il 2026-09-08, e la diagnosi è costata più della
        // causa. Lo stato resta, in coda: serve a chi legge un registro.
        const dett = await res.text().catch(() => "");
        const spiegazione = dett.trim();
        throw new Error(spiegazione
          ? t("cfgUi.deployFailedReason", { reason: spiegazione, status: res.status })
          : t("cfgUi.deployFailedStatus", { status: res.status, statusText: res.statusText }));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter(Boolean).forEach((line) =>
          setDeployLog((l) => [...l, line])
        );
      }
  };

  const handleDeploy = async () => {
    setDeploying(true); setDeployLog([]); setDeployDone(false);
    try {
      const ok = await flushBeforeDeploy((m) => setDeployLog((l) => [...l, m]));
      if (!ok) { setDeploying(false); return; }
      await eseguiDeploy(false);
      setDeployDone(true);
    } catch (e: any) {
      setDeployLog((l) => [...l, `✗ ${e?.message ?? String(e)}`]);
    } finally {
      setDeploying(false);
    }
  };

  /** Passo 1 del pull: solo letture. Scarica il bundle, lo archivia subito come
   *  .zip, e apre il modale di conferma. Niente qui tocca il progetto locale. */
  const handlePullProject = async () => {
    setPulling(true); setPullLog([]); setPullDone(false);
    const log = (m: string) => setPullLog((l) => [...l, m]);
    try {
      // Scarto di versione: `project_saved_by` è del progetto SUL DISPOSITIVO,
      // `runtime_version` è di QUESTO IDE. È lo stesso confronto del pulsante
      // "⚠ Aggiorna progetto", mostrato qui prima e non dopo.
      let savedBy: string | null = null;
      let localVersion = "";
      try {
        const [remote, local] = await Promise.all([
          api.remoteGetSystemStatus(),
          api.getSystemStatus(),
        ]);
        savedBy = remote.project_saved_by;
        localVersion = local.runtime_version;
        if (remote.active_project) log(t("cfgUi.deviceProject", { name: remote.active_project }));
      } catch { /* non bloccante: l'avviso di versione è un di più, non il flusso */ }

      log(t("cfgUi.downloadingTheProjectFromThe"));
      const res = await api.pullRemoteProject();
      const suggested = res.headers.get("X-Project-Name") || t("cfgUi.project2");
      const blob = await res.blob();
      log(`✓ Scaricato "${suggested}" (${(blob.size / 1024).toFixed(1)} KB)`);

      // ARCHIVIO, subito: il .zip esce dal browser prima che qualsiasi cosa
      // tocchi il disco. Se il resto del flusso va storto — o se l'aggiornamento
      // di formato che l'IDE offrirà dopo rovina qualcosa — questa copia del
      // progetto com'era sul dispositivo esiste già.
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `${suggested}-dal-runtime-${stamp}.zip`);
      log(`✓ Copia di sicurezza scaricata: ${suggested}-dal-runtime-${stamp}.zip`);

      const locals = await api.listProjects().catch(() => []);
      setPullAsk({
        blob,
        name: suggested,
        localNames: locals.map((p) => p.name),
        savedBy,
        localVersion,
        dirty: selectIsDirty(useAppStore.getState()),
        saveFirst: true,
      });
    } catch (e: any) {
      log(`✗ ${e?.message ?? String(e)}`);
      setPullDone(true);
    } finally {
      setPulling(false);
    }
  };

  /** Passo 2 del pull: da qui in poi si scrive. Confermato dal modale. */
  const handlePullConfirm = async () => {
    const ask = pullAsk;
    if (!ask) return;
    const name = ask.name.trim();
    setPullAsk(null);
    setPulling(true);
    const log = (m: string) => setPullLog((l) => [...l, m]);
    try {
      if (ask.dirty && ask.saveFirst) {
        if (!await flushBeforeDeploy(log)) { setPulling(false); return; }
      } else if (ask.dirty) {
        log("⚠ Modifiche locali non salvate: scartate su richiesta");
      }

      log(t("cfgUi.closingTheOpenProject"));
      await api.closeProject();

      // L'upload rifiuta con 409 se la cartella esiste già: per sovrascrivere
      // bisogna rimuoverla. Si può farlo solo ora, a progetto chiuso — a
      // progetto attivo la delete risponderebbe 409 a sua volta.
      if (ask.localNames.includes(name)) {
        log(t("cfgUi.removingLocalSameName", { name }));
        await api.deleteProject(name);
      }

      log(`Import come "${name}"…`);
      const created = await api.uploadProjectZip(ask.blob, name);
      log(`Apertura di "${created.name}"…`);
      await api.openProject(created.name);
      // Q30: la versione vista è quella del progetto di **prima**. Tenerla
      // farebbe rifiutare il primo salvataggio su quello nuovo con un 409 che
      // non ha nessuna corsa dietro — un conflitto inventato insegna a
      // ignorare i conflitti veri.
      dimenticaVersioneProgetto();

      // Backup lato IDE dello stato appena importato: integro, prima di
      // qualunque modifica e prima dell'aggiornamento di formato che il
      // pulsante "⚠ Aggiorna progetto" offrirà se le versioni divergono.
      try {
        const b = await api.createBackup();
        log(`✓ Backup nel runtime IDE: ${b.name}`);
      } catch (e: any) {
        log(t("cfgUi.backupFailedOpen", { message: e?.message ?? String(e) }));
      }

      log(t("cfgUi.deviceProjectOpenedInThe"));
      setPullDone(true);

      // Stessa sequenza di `onProjectOpened` in App.tsx: si svuota lo stato del
      // progetto precedente PRIMA di dichiarare che ce n'è uno attivo, così
      // l'editor rimonta vuoto invece di mostrare per un istante le pagine di
      // quello vecchio mentre arrivano quelle nuove.
      resetProjectState();
      setNoActiveProject(false);
    } catch (e: any) {
      log(`✗ ${e?.message ?? String(e)}`);
      setPullDone(true);
    } finally {
      setPulling(false);
    }
  };

  const handleDeleteRemoteProject = async () => {
    if (!window.confirm(t("cfg.deleteRemoteProjectConfirm"))) return;
    setDeletingRemote(true); setRemoteMsg(null);
    try {
      await api.remoteDeleteProject();
      setRemoteMsg(t("cfgUi.projectDeletedFromTheRuntime"));
    } catch (e: any) {
      setRemoteMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setDeletingRemote(false);
    }
  };

  // Allinea gli account **senza** ridistribuire il progetto: dall'11-09-2026 il
  // deploy li porta già (gli utenti appartengono al progetto), ma qui si mandano
  // da soli — utile quando sul dispositivo gira lo stesso progetto e sono
  // cambiate solo le password. Chiede conferma perché invalida le sessioni
  // aperte sul dispositivo.
  const handlePushUsers = async () => {
    if (!window.confirm(t("cfg.pushUsersConfirm"))) return;
    setPushingUsers(true); setRemoteMsg(null);
    try {
      const res = await api.pushUsersToRuntime();
      setRemoteMsg(t("cfgUi.usersSent", { count: res.users }) + (res.note ? " " + res.note : ""));
    } catch (e: any) {
      setRemoteMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setPushingUsers(false);
    }
  };

  const INPUT: React.CSSProperties = {
    background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4, padding: "6px 8px", fontSize: 13,
  };
  const BTN: React.CSSProperties = {
    padding: "6px 14px", borderRadius: 5, cursor: "pointer", fontSize: 13,
    border: "1px solid var(--brand-surface-2, #334155)", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  };
  const BTN_PRIMARY: React.CSSProperties = {
    ...BTN, background: "#1d4ed8", border: "1px solid var(--brand-primary-hover, #2563eb)", color: "#fff", fontWeight: 600,
  };
  const BTN_RED: React.CSSProperties = {
    ...BTN, background: "#450a0a", border: "1px solid #dc2626", color: "var(--brand-danger-soft, #fca5a5)",
  };

  const connected = status === "connected";
  let hostLabel = target;
  try { hostLabel = new URL(target).host; } catch { /* keep raw */ }

  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Connection config */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("cfgUi.remoteRuntimeConnection")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.targetRuntimeUrl")}</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input style={{ ...INPUT, flex: 1, boxSizing: "border-box" }}
              placeholder="https://192.168.1.10:8444"
              value={targetUrl}
              onChange={(e) => { setTargetUrl(e.target.value); if (connected) handleDisconnect(); }}
            />
            <button
              style={{ ...BTN, whiteSpace: "nowrap", flexShrink: 0 }}
              title={t("cfg.openHealthTls")}
              disabled={!target}
              onClick={() => { if (target) window.open(`${target}/health`, "_blank"); }}
            >Accetta cert TLS ↗</button>
            <button
              style={{ ...BTN, whiteSpace: "nowrap", flexShrink: 0 }}
              title={t("cfg.discoverMdns")}
              disabled={discovering}
              onClick={handleDiscover}
            >{discovering ? "Cerco…" : t("cfgUi.findRuntime")}</button>
          </div>
          {discoverError && (
            <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>
                {discoverError === "unreachable" ? t("cfg.discoverUnreachable") : t("cfg.discoverFailed")}
              </span>
              {discoverError === "unreachable" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={{ ...BTN, whiteSpace: "nowrap" }}
                    onClick={() => window.open(`${getBaseUrl()}/health`, "_blank")}
                  >{t("cfg.discoverAcceptCert")}</button>
                  <button
                    style={{ ...BTN, whiteSpace: "nowrap" }}
                    onClick={() => window.location.reload()}
                  >{t("cfg.discoverReload")}</button>
                </div>
              )}
            </div>
          )}
          {discovered !== null && (
            <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "6px 8px" }}>
              {discovered.length === 0
                ? <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfg.noRuntimeFound")}</span>
                : discovered.map((r) => (
                    <div
                      key={r.admin_url}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        borderBottom: "1px solid var(--brand-surface, #1e293b)", cursor: "pointer" }}
                      onClick={() => {
                        setTargetUrl(discoveredAdminUrl(r));
                        // L'hostname mDNS (stabile, a differenza dell'IP che può
                        // cambiare per DHCP) va bene per Host SSH — risolto dal
                        // resolver del sistema operativo del backend, non dal
                        // browser. Se assente (runtime più vecchio di questo
                        // campo), ripiega sull'IP come prima.
                        if (r.hostname) {
                          scegliHost(r.hostname);
                        } else {
                          try { scegliHost(new URL(r.admin_url).hostname); } catch { /* invalid URL — leave Host SSH untouched */ }
                        }
                        if (connected) handleDisconnect();
                        setDiscovered(null);
                      }}
                    >
                      <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
                        {r.hostname || r.name}{r.version ? ` v${r.version}` : ""}
                      </span>
                      {/* Pill solo sui runtime in container: dice quale procedura
                          di aggiornamento usare (install-container.sh / immagine)
                          invece del deploy del binario nudo. Un runtime nativo
                          non ha pill — e nemmeno uno più vecchio di questo
                          campo, che non lo annuncia: l'assenza non afferma
                          niente. */}
                      {r.container && (
                        <span
                          title={t("cfgUi.containerRuntime", { name: r.container })}
                          style={{
                            fontSize: 10, lineHeight: 1.6, padding: "0 6px", borderRadius: 999,
                            whiteSpace: "nowrap", flexShrink: 0,
                            color: "var(--brand-primary, #38bdf8)",
                            background: "var(--brand-surface, #1e293b)",
                            border: "1px solid var(--brand-surface-2, #334155)",
                          }}
                        >📦 {r.container}</span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>{discoveredAdminUrl(r)}</span>
                      {/* Q50: il discovery non butta più via quello che trova. */}
                      <button
                        style={{ padding: "1px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, flexShrink: 0, border: "1px solid var(--brand-primary-hover, #2563eb)", background: "#1e3a5f", color: "#93c5fd" }}
                        title={t("cfg.devicesAddToListTitle")}
                        onClick={(e) => {
                          e.stopPropagation();
                          const n = dispositivoDaRuntime(r, discoveredAdminUrl(r));
                          registraDispositivo(n)
                            .then(() => setStatusMsg(t("cfg.devicesAdded", { label: n.label })))
                            .catch((err) => setStatusMsg(t("cfg.devicesSaveFailed", { err: String(err) })));
                        }}>
                        {t("cfg.devicesAddToList")}
                      </button>
                    </div>
                  ))
              }
            </div>
          )}
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
            Porta 8444 = accesso admin (deploy). Porta 8443 = viewer operatori.
          </span>
          {/* «SWS» nell'etichetta, e il perché sotto: questi sono gli utenti
              applicativi del progetto (users.yaml), non l'utente SSH del
              dispositivo che il wizard di installazione chiede poche righe più
              giù. Le due coppie di campi si chiamavano tutte «Utente» e
              «Password»: il 2026-09-11 il maintainer ha messo qui le credenziali
              SSH e si è visto rifiutare la connessione. */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.swsUser")} <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.optional")}</span></label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" }}
                placeholder={t("cfg.emptyIfNoUsers")} value={targetUser}
                onChange={(e) => setTargetUser(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.swsPassword")} <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.optional")}</span></label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" }}
                type="password" placeholder="••••••••" value={targetPass}
                onChange={(e) => setTargetPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !connected && handleConnect()} />
            </div>
          </div>
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", lineHeight: 1.4 }}>
            {t("cfg.swsCredentialsHint")}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!connected && (
              <button style={BTN_PRIMARY} onClick={handleConnect} disabled={status === "connecting"}>
                {status === "connecting" ? t("cfgUi.connecting") : "Connetti"}
              </button>
            )}
            {connected && (
              <button style={BTN_RED} onClick={handleDisconnect}>{t("cfg.disconnect")}</button>
            )}
            <button style={BTN} onClick={handleDownloadCert} disabled={!target} title={t("cfg.downloadTargetCert")}>
              {t("cfgUi.downloadTlsCert")}
            </button>
          </div>
        </div>
      </section>

      {/* Status */}
      <section style={{
        padding: "10px 14px", borderRadius: 6,
        background: connected ? "#052e16" : status === "error" ? "#1c0a0a" : "var(--brand-bg, #0f172a)",
        border: `1px solid ${connected ? "#16a34a" : status === "error" ? "#dc2626" : "var(--brand-surface, #1e293b)"}`,
      }}>
        {connected && (
          <span style={{ color: "var(--brand-success-soft, #4ade80)", fontWeight: 600, fontSize: 13 }}>
            ● Connesso a {hostLabel}
          </span>
        )}
        {status === "idle" && (
          <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 13 }}>{t("cfg.notConnected")}</span>
        )}
        {status === "connecting" && (
          <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13 }}>{t("cfgUi.connecting2")}</span>
        )}
        {status === "error" && (
          <span style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 13, whiteSpace: "pre-wrap" }}>✗ {statusMsg}</span>
        )}
          {status === "error" && certificatoCambiato && (
            <div style={{ marginTop: 8 }}>
              <button
                style={{ ...BTN_PRIMARY, opacity: dimenticandoCert ? 0.6 : 1 }}
                disabled={dimenticandoCert}
                onClick={() => void handleDimenticaCertificato()}>
                {dimenticandoCert ? t("cfg.certForgetting") : t("cfg.certForget")}
              </button>
            </div>
          )}
        {status !== "error" && statusMsg && (
          <span style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, display: "block", marginTop: 4, whiteSpace: "pre-wrap" }}>{statusMsg}</span>
        )}
      </section>

      {/* Deploy */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {t("cfgUi.deployProject")}
          </div>
          <p style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", margin: "0 0 10px" }}>
            {t("cfgUi.exportsTheActiveProjectAnd")}
          </p>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", margin: "0 0 10px" }}>
            <input type="checkbox" checked={sostituisciUtenti}
              onChange={(e) => setSostituisciUtenti(e.target.checked)} />
            <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
              {t("cfg.deployReplaceUsers")}
              <span style={{ display: "block", fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                {t("cfg.deployReplaceUsersHint")}
              </span>
            </span>
          </label>
          {!deployDone && (
            <button style={{ ...BTN_PRIMARY, opacity: deploying ? 0.6 : 1 }}
              onClick={handleDeploy} disabled={deploying}>
              {deploying ? "Deploy in corso…" : t("cfgUi.deployActiveProject")}
            </button>
          )}
          {deployLog.length > 0 && (
            <div style={{
              marginTop: 10, background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)",
              borderRadius: 4, padding: "8px 10px", maxHeight: 180, overflowY: "auto",
              fontFamily: "monospace", fontSize: 12,
            }}>
              {deployLog.map((l, i) => (
                <div key={i} style={{ color: l.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : l.startsWith("🚀") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
              ))}
            </div>
          )}
          {deployDone && (
            <button style={{ ...BTN, marginTop: 8 }} onClick={() => { setDeployLog([]); setDeployDone(false); }}>
              {t("cfgUi.newDeploy")}
            </button>
          )}

          {/* Danger: rimuovi il progetto attivo dal runtime */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--brand-surface, #1e293b)" }}>
            <p style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", margin: "0 0 8px" }}>
              {t("cfgUi.deletesTheProjectCurrentlyActive")}
            </p>
            <button style={{ ...BTN, opacity: pushingUsers ? 0.6 : 1 }}
              title={t("cfg.pushUsersOnlyTitle")}
              onClick={handlePushUsers} disabled={pushingUsers}>
              {pushingUsers ? "Invio…" : t("cfgUi.updateUsersOnTheDevice")}
            </button>
            <button style={{ ...BTN_RED, opacity: deletingRemote ? 0.6 : 1 }}
              onClick={handleDeleteRemoteProject} disabled={deletingRemote}>
              {deletingRemote ? "Eliminazione…" : t("cfgUi.deleteProjectOnTheRuntime")}
            </button>
            {remoteMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: remoteMsg.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : "var(--brand-success-soft, #4ade80)" }}>
                {remoteMsg}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Pull — il verso opposto del Deploy. Sezione separata di proposito: il
          Deploy manda via il progetto locale, questo lo SOSTITUISCE con quello
          del dispositivo, e i due non devono stare a un pixel di distanza. */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {t("cfgUi.reopenTheDeviceSProject")}
          </div>
          <p style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", margin: "0 0 10px" }}>
            {t("cfgUi.downloadsTheProjectRunningOn")}
          </p>
          {!pullDone && (
            <button style={{ ...BTN, opacity: pulling ? 0.6 : 1 }}
              onClick={handlePullProject} disabled={pulling || deploying}>
              {pulling ? "Lettura in corso…" : t("cfgUi.reopenTheDeviceSProject2")}
            </button>
          )}
          {pullLog.length > 0 && (
            <div style={{
              marginTop: 10, background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)",
              borderRadius: 4, padding: "8px 10px", maxHeight: 180, overflowY: "auto",
              fontFamily: "monospace", fontSize: 12,
            }}>
              {pullLog.map((l, i) => (
                <div key={i} style={{ color: l.startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : l.startsWith("⚠") ? "var(--brand-warning-soft, #fbbf24)" : l.startsWith("🚀") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
              ))}
            </div>
          )}
          {pullDone && (
            <button style={{ ...BTN, marginTop: 8 }} onClick={() => { setPullLog([]); setPullDone(false); }}>
              {t("cfgUi.close")}
            </button>
          )}
        </section>
      )}

      {/* Conferma del pull. Un modale e non tre `confirm()` di fila perché le
          decisioni sono legate fra loro: con che nome importare dipende da cosa
          c'è già in locale, e la scelta sulle modifiche non salvate va vista
          insieme al resto, non in un popup che è già sparito quando arriva il
          successivo. */}
      {pullAsk && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 8000,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setPullAsk(null); }}
        >
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, width: 560, display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>
              {t("cfgUi.reopenTheDeviceSProject")}
            </div>

            {pullAsk.savedBy && pullAsk.localVersion && pullAsk.savedBy !== pullAsk.localVersion && (
              <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #fbbf24)", background: "var(--brand-warning-bg, #78350f)", border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4, padding: "6px 8px" }}>
                {t("header.migrateConfirm", { savedBy: pullAsk.savedBy, runtime: pullAsk.localVersion })}
                {" "}L'aggiornamento non avviene ora: dopo l'apertura comparirà il pulsante «⚠ Aggiorna progetto».
              </div>
            )}

            <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "flex", flexDirection: "column", gap: 4 }}>
              {t("cfgUi.importAs")}
              <input
                style={INPUT}
                value={pullAsk.name}
                autoFocus
                onChange={(e) => setPullAsk({ ...pullAsk, name: e.target.value })}
                spellCheck={false}
              />
            </label>
            {pullAsk.localNames.includes(pullAsk.name.trim()) ? (
              <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)" }}>
                <Trans i18nKey="cfgUi.pullExists" values={{ name: pullAsk.name.trim() }} components={TRANS_COMP} />
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
                {t("cfgUi.noLocalProjectWithThis")}
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #fbbf24)" }}>
              <Trans i18nKey="cfgUi.pullBundleCreds" components={TRANS_COMP} />
            </div>

            {pullAsk.dirty && (
              <div style={{ borderTop: "1px solid var(--brand-surface-2, #334155)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                  {t("cfgUi.theCurrentlyOpenProjectHas")}
                </div>
                <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
                  <input type="radio" checked={pullAsk.saveFirst} onChange={() => setPullAsk({ ...pullAsk, saveFirst: true })} style={{ marginRight: 6 }} />
                  {t("cfgUi.saveBeforeClosing")}
                </label>
                <label style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer" }}>
                  <input type="radio" checked={!pullAsk.saveFirst} onChange={() => setPullAsk({ ...pullAsk, saveFirst: false })} style={{ marginRight: 6 }} />
                  {t("cfgUi.closeWithoutSavingChangesAre")}
                </label>
              </div>
            )}

            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
              {t("cfgUi.theZipCopyOfThe")}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={BTN} onClick={() => { setPullAsk(null); setPullDone(true); }}>{t("common.cancel")}</button>
              <button style={{ ...BTN_PRIMARY, opacity: pullAsk.name.trim() ? 1 : 0.6 }}
                onClick={handlePullConfirm} disabled={!pullAsk.name.trim()}>
                {t("cfgUi.openInTheIde")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote logs: non più un pannello a parte — confluiscono nello stesso
          log viewer dei log locali (cassetto in basso, ☰ Menu → Log), con
          target prefissato "remote:" così il filtro esistente li isola. Vedi
          useRemoteLogStream (sws-editor/src/ws/remoteLogStream.ts). */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Log remoti
          </div>
          <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
            <Trans i18nKey="cfgUi.remoteLogsHint" components={TRANS_COMP} />
          </span>
        </section>
      )}

      {/* T-72 F5 — com'è andata l'installazione dell'immagine di boot. */}
      {connected && <StatoBootImage />}

      {/* Live tag panel via /ws/remote/tags relay */}
      {connected && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Variabili live ({liveTags.size})
          </div>
          <div style={{
            background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
            padding: "6px 8px", maxHeight: 220, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11,
          }}>
            {liveTags.size === 0
              ? <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfgUi.noVariablesReceived")}</span>
              : Array.from(liveTags.entries()).slice(0, 50).map(([id, t]) => {
                  const qColor = t.quality === "Good" ? "var(--brand-success-soft, #4ade80)" : t.quality === "Bad" ? "var(--brand-danger-soft, #f87171)" : "#fb923c";
                  return (
                    <div key={id} style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--brand-bg, #0f172a)", padding: "1px 0" }}>
                      <span style={{ color: "var(--brand-text-subtle, #64748b)", width: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={id}>{id}</span>
                      <span style={{ color: "var(--brand-text, #e2e8f0)", flex: 1 }}>{JSON.stringify(t.value)}</span>
                      <span style={{ color: qColor, width: 36, textAlign: "right", flexShrink: 0 }}>{t.quality === "Good" ? "OK" : t.quality === "Bad" ? "BAD" : "UNC"}</span>
                    </div>
                  );
                })
            }
          </div>
        </section>
      )}

      {/* Package build — Q51: strumento di sviluppo, esiste solo se il runtime
          gira da un checkout del repo (scripts/package.sh). Per l'utente
          finale sarebbe un pulsante che fallisce sempre. */}
      {repo && (
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
          <div style={{
            background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
            padding: "8px 10px", maxHeight: 150, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, marginBottom: 8,
          }}>
            {buildLog.map((l, i) => (
              <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
            ))}
          </div>
        )}
        {packages.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>{t("cfg.packagesAvailable")}</div>
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
      </section>

      )}

      {/* Installa su dispositivo — Q52: un flusso in cinque passi. Destinazione
          (a mano, dal dispositivo connesso, o dalla tabella mDNS di tutto ciò
          che c'è in rete), credenziali (mai salvate), sondaggio via ssh che dice
          che macchina è e se è pronta, immagine, installa. Il container è il
          percorso di produzione; il binario nativo è «solo sviluppo» e compare
          solo con il repo (Q51). Sempre visibile: col registry non dipende da
          cosa c'è in dist/. */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("cfg.installTitle")}
        </div>
        {repo && (
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <button
              style={{ ...(deployMode === "binary" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
              onClick={() => setDeployMode("binary")}>
              {t("cfg.deployModeBinary")}
            </button>
            <button
              style={{ ...(deployMode === "container" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
              onClick={() => setDeployMode("container")}>
              {t("cfg.deployModeContainer")}
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

          {/* 1 · Destinazione */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6 }}>{t("cfg.stepTarget")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.sshHost")}</label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                placeholder="wp630-xxxx.local" value={deviceHost}
                onChange={(e) => { setHostTouched(true); setDeviceHost(e.target.value); }} />
            </div>
            <div style={{ width: 70 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.port")}</label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                type="number" value={devicePort}
                onChange={(e) => setDevicePort(Number(e.target.value))} />
            </div>
            <button style={{ ...BTN, flexShrink: 0 }} disabled={cercandoDispositivi}
              onClick={() => void cercaDispositivi()}>
              {cercandoDispositivi ? t("cfg.devicesSearching") : t("cfg.devicesSearch")}
            </button>
          </div>
          <TabellaDispositivi dispositivi={dispositivi} inCorso={cercandoDispositivi}
            errore={erroreDispositivi} onScegli={scegliHost} />

          {/* 2 · Credenziali */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6 }}>{t("cfg.stepCredentials")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.sshUser")}</label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                placeholder="user" value={deviceUser}
                onChange={(e) => setDeviceUser(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }} title={t("cfg.passwordSessionTitle")}>{t("cfg.sshPassword")}</label>
              {/* Solo nello stato: mai in localStorage (regola del 2026-09-09). */}
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                type="password" autoComplete="off" placeholder={t("cfg.passwordSession")} value={devicePass}
                onChange={(e) => setDevicePass(e.target.value)} />
            </div>
          </div>
          {/* Speculare alla riga del pannello «Connetti»: le due coppie di
              credenziali si somigliavano troppo. */}
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", lineHeight: 1.4 }}>
            {t("cfg.sshCredentialsHint")}
          </span>

          {/* 3 · Sondaggio */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6 }}>{t("cfg.stepProbe")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button style={{ ...BTN, opacity: (sondando || !deviceHost || !deviceUser) ? 0.6 : 1 }}
              disabled={sondando || !deviceHost || !deviceUser}
              onClick={() => void eseguiSondaggio()}>
              {sondando ? t("cfg.probeRunning") : t("cfg.probeRun")}
            </button>
            <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.probeHint")}</span>
          </div>
          {erroreSondaggio && (
            <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)" }}>{erroreSondaggio}</div>
          )}
          {sondaggio && <ListaControlli sondaggio={sondaggio} />}

          {/* La chiave host non combacia: quasi sempre è il factory reset del
              pannello, che se ne rigenera di nuove. Il pulsante c'è perché la
              rimozione resta un gesto umano — automatizzarla spegnerebbe per
              sempre la protezione che ci ha fermati. Uno solo, qui, perché può
              fermare sia il sondaggio sia il deploy. */}
          {chiaveHostCambiata && (
            <div style={{
              border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4,
              background: "var(--brand-warning-bg, #78350f)",
              padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #facc15)" }}>
                {t("cfg.hostKeyChanged", { host: deviceHost })}
              </div>
              <button
                style={{ ...BTN_PRIMARY, opacity: dimenticandoChiave ? 0.6 : 1, alignSelf: "flex-start" }}
                disabled={dimenticandoChiave}
                onClick={() => void handleDimenticaChiaveHost()}>
                {dimenticandoChiave ? t("cfg.hostKeyForgetting") : t("cfg.hostKeyForget")}
              </button>
            </div>
          )}

          {/* 4 · Immagine */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6 }}>{t("cfg.stepImage")}</div>
          {deployMode === "binary" ? (
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.selectedPackage")}</label>
              <select
                value={selectedPkg}
                onChange={(e) => setSelectedPkg(e.target.value)}
                style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}>
                {packages.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Archivio locale = un .tar.gz in dist/: esiste solo con il repo. */}
              {repo && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.imageSource")}</label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={{ ...(containerSource === "registry" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
                      onClick={() => setContainerSource("registry")}>
                      {t("cfg.imageSourceRegistry")}
                    </button>
                    <button
                      style={{ ...(containerSource === "archive" ? BTN_PRIMARY : BTN), padding: "5px 12px", fontSize: 12 }}
                      disabled={containerPackages.length === 0}
                      title={containerPackages.length === 0 ? t("cfg.noContainerImages") : undefined}
                      onClick={() => setContainerSource("archive")}>
                      {t("cfg.imageSourceArchive")}
                    </button>
                  </div>
                </div>
              )}
              {containerSource === "archive" && repo ? (
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.selectedImage")}</label>
                  {/* L'elenco si legge al montaggio della tab. Le immagini si
                      costruiscono da shell, quindi una appena prodotta non
                      compare finché non si ricarica: il pulsante ↻ rilegge. */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={selectedContainerPkg}
                      onChange={(e) => setSelectedContainerPkg(e.target.value)}
                      style={{ ...INPUT, flex: 1, boxSizing: "border-box" as const }}>
                      {containerPackages.map((p) => (
                        <option key={p.image_tarball} value={p.image_tarball}>
                          {p.image_tarball} ({p.arch})
                        </option>
                      ))}
                    </select>
                    <button style={{ ...BTN, flexShrink: 0 }}
                      title={t("cfg.reloadImages")}
                      onClick={() => void fetchContainerPackages()}>↻</button>
                  </div>
                </div>
              ) : (
                <div>
                  {/* Un'immagine per architettura (Q53): il riferimento lo
                      propone la verifica del dispositivo o il runtime
                      collegato; vuoto, lo decide il dispositivo da `uname -m`.
                      Fino al 2026-09-10 qui c'erano due pulsanti per scegliere
                      fra l'immagine SDK Pixsys e quella generica: non esistono
                      più due immagini. */}
                  {varianteSuggerita && (
                    <div style={{ fontSize: 10, color: "var(--brand-success-soft, #4ade80)", marginBottom: 6 }}>
                      {t(varianteDaConnesso ? "cfg.imageVariantFromConnected" : "cfg.imageVariantSuggested", { variant: varianteSuggerita })}
                    </div>
                  )}
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.imageRef")}</label>
                  <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                    placeholder="ghcr.io/soligolab/sws-runtime:2.7.1-arm64"
                    value={imageRef}
                    onChange={(e) => { setImageRef(e.target.value); setVarianteSuggerita(null); }} />
                  <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                    {t("cfg.imageRefHint")}
                  </span>
                </div>
              )}
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.remoteTmpDir")}</label>
            <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
              value={deviceTmpDir}
              onChange={(e) => setDeviceTmpDir(e.target.value)} />
          </div>
          {deployMode === "container" && (
            <div>
              {getBrand().dataPathPresets.length > 0 && (
                <>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.deviceModel")}</label>
                  <select
                    value=""
                    style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const, marginBottom: 8 }}
                    onChange={(e) => {
                      const preset = getBrand().dataPathPresets.find((d) => d.label === e.target.value);
                      if (preset) setDataPath(preset.path);
                    }}>
                    <option value="">{t("cfg.deviceModelPick")}</option>
                    <optgroup label={getBrand().shortName}>
                      {getBrand().dataPathPresets.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
                    </optgroup>
                  </select>
                </>
              )}
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.dataPathOnDevice")}</label>
              <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
                placeholder={t("cfg.dataPathPlaceholder")}
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)} />
            </div>
          )}

          {/* 5 · Installa */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6 }}>{t("cfg.stepInstall")}</div>
          {deployMode === "binary" ? (
            <>
              <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.requiresSshpassBinary")}</span>
              <button
                style={{ ...BTN_PRIMARY, opacity: (deviceDeploying || !deviceHost || !selectedPkg) ? 0.6 : 1 }}
                disabled={deviceDeploying || !deviceHost || !selectedPkg}
                onClick={() => void handleDeviceDeploy()}>
                {deviceDeploying ? t("cfg.deployRunning") : t("cfg.installBinaryBtn")}
              </button>
              {deviceLog.length > 0 && (
                <div style={{
                background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                padding: "8px 10px", maxHeight: 150, overflowY: "auto",
                fontFamily: "monospace", fontSize: 11,
              }}>
                  {deviceLog.map((l, i) => (
                  <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                ))}
                </div>
              )}
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.requiresSshpassContainer")}</span>
              {/* Vale per entrambe le sorgenti: agisce sui dati del
                  dispositivo, non sull'immagine. */}
              <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 8 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={cleanInstall}
                    onChange={(e) => setCleanInstall(e.target.checked)} />
                  <span style={{ fontSize: 12, color: cleanInstall ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-2, #cbd5e1)" }}>
                    {t("cfg.cleanInstall")}
                    <span style={{ display: "block", fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                      {t("cfg.cleanInstallHint", { path: effectiveDataPath(dataPath) })}
                    </span>
                  </span>
                </label>
              </div>
              {/* Spento solo quando il sondaggio ha guardato e ha trovato errori:
                  la lista sopra dice quali. Senza sondaggio si installa come
                  prima di Q52. */}
              {(() => {
                const bloccato = !installazioneConsentita(sondaggio);
                const spento = containerDeploying || !deviceHost || !deviceUser || bloccato
                  || (containerSource === "archive" && !selectedContainerPkg);
                return (
                  <button
                    style={{ ...(cleanInstall ? BTN_RED : BTN_PRIMARY), opacity: spento ? 0.6 : 1 }}
                    disabled={spento}
                    title={bloccato ? t("cfg.installBlockedByProbe") : undefined}
                    onClick={() => void handleContainerDeploy()}>
                    {containerDeploying
                      ? t("cfg.deployRunning")
                      : cleanInstall ? t("cfg.cleanInstallBtn")
                      : sondaggio?.sws.installato ? t("cfg.installUpdateBtn") : t("cfg.installBtn")}
                  </button>
                );
              })()}
              {containerLog.length > 0 && (
                <div style={{
                background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                padding: "8px 10px", maxHeight: 150, overflowY: "auto",
                fontFamily: "monospace", fontSize: 11,
              }}>
                  {containerLog.map((l, i) => (
                  <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                ))}
                </div>
              )}

                {/* Gestione di un container già installato — indipendente da
                    remote_dir: agisce sulla unit già sul dispositivo (o su
                    questa macchina), non su quanto appena installato sopra. */}
                <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 8 }}>
                    {t("cfg.manageTitle")}
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={manageLocal}
                      onChange={(e) => setManageLocal(e.target.checked)} />
                    {manageLocal ? t("cfg.manageLocal") : t("cfg.manageRemote")}
                  </label>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("status")}>{t("cfg.manageStatus")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("start")}>{t("cfg.manageStart")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("stop")}>{t("cfg.manageStop")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("restart")}>{t("cfg.manageRestart")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("enable")}>{t("cfg.manageEnableBoot")}</button>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("disable")}>{t("cfg.manageDisableBoot")}</button>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("prune_images")}>{t("cfg.managePruneImages")}</button>
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
                    <button style={BTN} disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("set_restart_policy")}>
                      {t("cfg.manageApplyPolicy")}
                    </button>
                  </div>

                  <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={uninstallPurge}
                        onChange={(e) => setUninstallPurge(e.target.checked)} />
                      <span style={{ fontSize: 12, color: uninstallPurge ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-2, #cbd5e1)" }}>
                        {t("cfg.uninstallPurge")}
                        <span style={{ display: "block", fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                          {t("cfg.uninstallPurgeHint", { path: effectiveDataPath(dataPath) })}
                        </span>
                      </span>
                    </label>
                    <button
                      style={{ ...BTN_RED, opacity: (managing || (!manageLocal && (!deviceHost || !deviceUser))) ? 0.6 : 1, marginTop: 6 }}
                      disabled={managing || (!manageLocal && (!deviceHost || !deviceUser))}
                      onClick={() => void handleManage("uninstall")}>
                      {t("cfg.uninstallBtn")}
                    </button>
                  </div>

                  {manageLog.length > 0 && (
                    <div style={{
                      background: "var(--brand-bg, #020617)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4,
                      padding: "8px 10px", maxHeight: 150, overflowY: "auto", marginTop: 8,
                      fontFamily: "monospace", fontSize: 11,
                    }}>
                      {manageLog.map((l, i) => (
                        <div key={i} style={{ color: l.startsWith("ERROR") ? "var(--brand-danger-soft, #f87171)" : l === "DONE" ? "var(--brand-success-soft, #4ade80)" : l.startsWith("WARN") ? "#fb923c" : "var(--brand-text-muted, #94a3b8)" }}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
    </div>
  );
}
