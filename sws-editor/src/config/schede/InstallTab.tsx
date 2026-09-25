import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, RuntimeUnavailableError, type DispositivoRete, type SondaggioDispositivo, type VarianteImmagine } from "@/api/client";
import { ListaControlli } from "@/config/installazione/ListaControlli";
import { TabellaDispositivi } from "@/config/installazione/TabellaDispositivi";
import { hostDaUrl, imageRefAutomatico, imageRefDaVariante, installazioneConsentita, varianteDaArch } from "@/config/installazione/sondaggio";
import { getBrand } from "@/branding";
import { containerDeployPayload, effectiveDataPath, type ContainerSource } from "@/containerDeploy";
import type { ContainerPackage } from "@/types";
import { useAppStore } from "@/store";
import { useRepoDisponibile } from "@/config/repoDisponibile";
import {
  INSTALL_DATA, INSTALL_HOST, INSTALL_PORT, INSTALL_USER, ricorda, ricordato,
} from "@/config/campiDispositivo";
import { BTN, BTN_PRIMARY, BTN_RED, INPUT } from "./stiliRuntime";

export function InstallTab() {
  const { t } = useTranslation();
  // T-28: package build
  // T-28: device deploy via SSH
  const [deviceHost, setDeviceHost]     = useState(() => ricordato(INSTALL_HOST, ""));
  const [devicePort, setDevicePort]     = useState(() => Number(ricordato(INSTALL_PORT, "22")) || 22);
  // `user`: le credenziali limitate dell'utente finale (specifica dell'8
  // settembre). Era `root`, contro quella specifica: il container è rootless.
  const [deviceUser, setDeviceUser]     = useState(() => ricordato(INSTALL_USER, "user"));
  // L'host l'ha scritto (o scelto) l'utente: la precompilazione dal dispositivo
  // connesso non deve più toccarlo.
  const [hostTouched, setHostTouched]   = useState(false);
  const [devicePass, setDevicePass]     = useState("");
  const [deviceTmpDir, setDeviceTmpDir] = useState("/tmp/sws-deploy");
  // Installazione container (Podman) via SSH — stessi campi host/porta/utente/
  // password/remote_dir sopra, riusati identici; cambia solo cosa si spedisce
  // e quale comando gira sul device (install-container.sh, nessun sudo).
  // Container per primo (Q52): è il percorso di produzione. Il binario è «solo
  // sviluppo» e il selettore compare solo quando c'è il repo (Q51).
  // Q51: il runtime gira da un checkout del repo? `null` finché non si sa, e
  // finché non si sa la UI di sviluppo non si disegna: niente lampeggio.
  // Il flag del repo è condiviso (store): lo legge anche l'albero, per
  // decidere se mostrare il sotto-ramo «Sviluppatore».
  const repo = useRepoDisponibile();
  // Chi è il dispositivo connesso, per proporre la destinazione (Q52). Prima
  // era lo stato locale della connessione; ora la connessione è un'altra
  // scheda, e la verità sta nello store.
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
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
  const [dataPath, setDataPath] = useState(() => ricordato(INSTALL_DATA, ""));
  // Registry per default: è la strada documentata come normale dal 2026-07-30 e
  // trasferisce solo i layer cambiati. L'archivio resta per i dispositivi che il
  // registry non lo raggiungono, che in campo sono il caso normale.
  const [containerSource, setContainerSource] = useState<ContainerSource>("registry");
  // Vuoto = il tag lo compone il dispositivo da `uname -m`. Si riempie solo per
  // inchiodare una versione precisa.
  const [imageRef, setImageRef] = useState("");
  const [cleanInstall, setCleanInstall] = useState(false);

  const fetchContainerPackages = useCallback(async () => {
    try {
      const pkgs = await api.listContainerPackages();
      setContainerPackages(pkgs);
      if (pkgs.length > 0 && !selectedContainerPkg) setSelectedContainerPkg(pkgs[0].image_tarball);
    } catch { /* ignore */ }
  }, [selectedContainerPkg]);
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

  // Senza repo l'archivio locale non esiste: resta il registry, o il
  // pulsante fallirebbe.
  useEffect(() => {
    if (!repo) setContainerSource("registry");
  }, [repo]);

  // Con il repo si caricano gli archivi immagine disponibili in locale. Il
  // tarball del binario non serve più qui: quel deploy è nel ramo
  // Sviluppatore dal 25-09-2026.
  useEffect(() => { if (repo) void fetchContainerPackages(); }, [repo, fetchContainerPackages]);

  // Q52: se l'editor è collegato a un dispositivo, quello è la destinazione
  // più probabile. Si propone l'hostname dell'URL di connessione, ma solo
  // finché il campo è vuoto e l'utente non l'ha toccato: un valore scritto a
  // mano non si sovrascrive mai.
  useEffect(() => {
    if (hostTouched || deviceHost) return;
    if (!remoteConnected || !remoteUrl) return;
    const h = hostDaUrl(remoteUrl);
    if (h) setDeviceHost(h);
  }, [remoteConnected, remoteUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Il dispositivo connesso dichiara la sua architettura, e con quella si
  // propone la variante immagine senza aspettare la verifica via ssh. Solo se
  // il riferimento è «nostro» e nessun sondaggio ha già detto la sua.
  useEffect(() => {
    if (!remoteConnected) return;
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
  }, [remoteConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Host, porta o utente diversi = un altro dispositivo, o un altro accesso:
  // la lista di controlli precedente non parla più di questo caso.
  // Quello che si è scritto qui si ritrova alla prossima apertura: queste
  // schede si smontano cambiando foglia.
  useEffect(() => { ricorda(INSTALL_HOST, deviceHost); }, [deviceHost]);
  useEffect(() => { ricorda(INSTALL_PORT, String(devicePort)); }, [devicePort]);
  useEffect(() => { ricorda(INSTALL_USER, deviceUser); }, [deviceUser]);
  useEffect(() => { ricorda(INSTALL_DATA, dataPath); }, [dataPath]);

  useEffect(() => {
    setSondaggio(null);
    setVarianteSuggerita(null);
    setErroreSondaggio(null);
    setChiaveHostCambiata(false);
  }, [deviceHost, devicePort, deviceUser]);

  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 20 }}>

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
        {/* Il binario nudo era una modalità di questa scheda; dal 25-09-2026
            sta nel sotto-ramo Sviluppatore, insieme alla costruzione del
            pacchetto. Qui resta il container, che è il percorso di
            produzione. */}
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
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 4 }}>{t("cfg.remoteTmpDir")}</label>
            <input style={{ ...INPUT, width: "100%", boxSizing: "border-box" as const }}
              value={deviceTmpDir}
              onChange={(e) => setDeviceTmpDir(e.target.value)} />
          </div>
          {(
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

                {/* La gestione di un container già installato è una scheda
                    sua dal 25-09-2026 (Device › Container): non c'entra con
                    l'installarne uno nuovo, e ci si arrivava solo scorrendo
                    fin qui dopo aver scelto «container» come modo di deploy. */}
              </>
          </div>
        </section>
    </div>
  );
}
