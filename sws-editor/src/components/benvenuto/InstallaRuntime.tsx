// Pezzo della schermata di scelta progetto, uscito da `WelcomeScreen.tsx` il
// 28-10-2026 (piano docs/plans/2026-10-26-aprire-sws-soligo-net.md, ramo B
// punto 6). Era un file di 1673 righe con sei componenti dentro: si leggeva
// solo cercando, e ogni modifica a un modale ricompilava la schermata intera
// nella testa di chi la faceva. Il codice e spostato, non riscritto.
//
// Installare un runtime su un dispositivo: il modale, la sezione di deploy e la
// guida a mano. Stanno insieme perche' li usa solo il modale.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconaUI } from "@/ui/IconaUI";
import { api, type SondaggioDispositivo } from "@/api/client";
import { ListaControlli } from "@/config/installazione/ListaControlli";
import { imageRefDaVariante, installazioneConsentita } from "@/config/installazione/sondaggio";
import { containerDeployPayload } from "@/containerDeploy";
import { SceltaOpenplc } from "@/boot/OpenplcSulPannello";
import { campoAmpio, pulsantePrimario, pulsanteSecondario } from "@/ui/base";

// I nomi corti della schermata da cui questo file viene (`WelcomeScreen`),
// tenuti apposta: lo spostamento resta leggibile riga per riga.
const BTN_PRIMARY = pulsantePrimario;
const BTN_GHOST = pulsanteSecondario;
const INPUT = campoAmpio;

// ── DeploySection ─────────────────────────────────────────────────────────────
//
// Q48 (2026-09-09). Fino a oggi questo modulo chiamava `/api/deploy/remote`, che
// scaricava un binario dalle release GitHub — un asset che NON esiste (404 per
// entrambe le architetture): il pulsante falliva sempre. Installava poi un
// binario nativo con `systemctl restart` di sistema, la postura opposta al
// container rootless di produzione, e salvava la password SSH in localStorage.
//
// Ora chiama lo stesso deploy container di Configurazione → Istanza → Device → Installazione: registry,
// architettura decisa dal dispositivo, niente password nel browser. È qui e non
// solo in ConfigView perché questo è il caso «macchina nuova, nessun progetto
// ancora»: ConfigView richiede un progetto aperto per convenzione del pannello.
function DeploySection() {
  const { t } = useTranslation();
  const [host, setHost]           = useState("");
  const [port, setPort]           = useState(22);
  const [user, setUser]           = useState("user");
  const [password, setPassword]   = useState("");
  const [deploying, setDeploying] = useState(false);
  const [conOpenplc, setConOpenplc] = useState(false);
  const [logs, setLogs]           = useState<string[]>([]);
  // La chiave host del dispositivo non è quella memorizzata (factory reset):
  // stesso pulsante di ConfigView, stesso endpoint, stesso gesto umano.
  const [chiaveHostCambiata, setChiaveHostCambiata] = useState(false);
  const [dimenticandoChiave, setDimenticandoChiave] = useState(false);
  // Q52: «Verifica dispositivo» anche qui — una sessione ssh che dice che
  // macchina è e se è pronta, prima di installare. La variante immagine che
  // propone finisce nel deploy; senza verifica il riferimento resta vuoto e
  // l'architettura la decide il dispositivo, come prima.
  const [sondaggio, setSondaggio] = useState<SondaggioDispositivo | null>(null);
  const [sondando, setSondando]   = useState(false);
  const ultimaAzione              = useRef<"sondaggio" | "deploy">("deploy");
  const logsRef                   = useRef<HTMLDivElement>(null);

  // Un altro host, porta o utente: la lista di controlli non parla più di questo caso.
  useEffect(() => { setSondaggio(null); }, [host, port, user]);

  const eseguiSondaggio = async () => {
    if (!host || !user) return;
    ultimaAzione.current = "sondaggio";
    setSondando(true); setChiaveHostCambiata(false);
    try {
      const s = await api.deviceProbe({ host, port, user, password });
      setSondaggio(s);
      if (s.chiave_host_cambiata) setChiaveHostCambiata(true);
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setSondando(false);
    }
  };

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleDeploy = async () => {
    if (!host || !user) return;
    ultimaAzione.current = "deploy";
    setDeploying(true);
    setChiaveHostCambiata(false);
    // La variante la propone la verifica (os-release compreso); senza verifica il
    // riferimento resta vuoto e il dispositivo sceglie latest-<arch> da `uname -m`.
    const imageRef = imageRefDaVariante(sondaggio?.variante_immagine ?? null);
    setLogs([t("welcome.installStart", { user, host, port, ref: imageRef ? `, ${imageRef}` : "" })]);
    try {
      const res = await api.deployDeviceContainer(containerDeployPayload({
        source: "registry",
        imageTarball: "",
        imageRef,
        cleanInstall: false,
        host, port, user, password,
        remoteDir: "/tmp/sws-deploy",
        dataPath: "",
        conOpenplc,
      }));
      if (!res.ok) {
        // Il corpo porta la frase del backend: mostrare solo lo stato la butterebbe via.
        const detail = await res.text().catch(() => "");
        setLogs((l) => [...l, `ERROR: HTTP ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setLogs((l) => [...l, t("welcome.streamingNonSupportato")]); return; }
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter((x) => x.trim()).forEach((line) => {
          if (line === "AZIONE: chiave-host-cambiata") { setChiaveHostCambiata(true); return; }
          setLogs((l) => [...l, line]);
        });
      }
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setDeploying(false);
    }
  };

  const handleDimenticaChiaveHost = async () => {
    setDimenticandoChiave(true);
    try {
      const r = await api.deviceHostKeyForget(host, port);
      setLogs((l) => [...l, `==> ${r.messaggio}`]);
      setChiaveHostCambiata(false);
      // Si riprende da dove ci si era fermati: verifica o installazione.
      if (ultimaAzione.current === "sondaggio") await eseguiSondaggio();
      else await handleDeploy();
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setDimenticandoChiave(false);
    }
  };

  const done = logs.some((l) => l === "DONE");
  const hasError = logs.some((l) => l.startsWith("ERROR:"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        {t("welcome.installIntro")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshHost")}</label>
          <input style={INPUT} placeholder="wp630-xxxx.local" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.port")}</label>
          <input style={{ ...INPUT, width: 60 }} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshUser")}</label>
          <input style={INPUT} placeholder="user" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshPassword")}</label>
          {/* Non si salva da nessuna parte: resta nel modulo finché la finestra è aperta. */}
          <input style={INPUT} type="password" autoComplete="off" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {/* 3 · Verifica, prima di installare. Spegne Installa solo se trova errori. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          style={{ ...BTN_PRIMARY, background: "var(--brand-surface, #1e293b)", opacity: (sondando || !host || !user) ? 0.5 : 1 }}
          disabled={sondando || !host || !user}
          onClick={() => void eseguiSondaggio()}>
          {sondando ? t("cfg.probeRunning") : t("cfg.probeRun")}
        </button>
        <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.probeHint")}</span>
      </div>
      {sondaggio && <ListaControlli sondaggio={sondaggio} />}
      {logs.length > 0 && (
        <div
          ref={logsRef}
          style={{
            background: "#0a0f1a", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6,
            padding: "8px 10px", maxHeight: 160, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
          }}
        >
          {logs.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith("ERROR:") ? "var(--brand-danger-soft, #fca5a5)"
                : line.startsWith("WARN:") ? "var(--brand-warning-soft, #fbbf24)"
                : line === "DONE" ? "var(--brand-success, #22c55e)"
                : "var(--brand-text-muted, #94a3b8)",
            }}>{line}</div>
          ))}
          {deploying && <div style={{ color: "#60a5fa" }}>…</div>}
        </div>
      )}
      {chiaveHostCambiata && (
        <div style={{
          border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4,
          background: "var(--brand-warning-bg, #78350f)", padding: "8px 10px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #facc15)" }}>{t("cfg.hostKeyChanged", { host })}</div>
          <button
            style={{ ...BTN_PRIMARY, opacity: dimenticandoChiave ? 0.6 : 1, alignSelf: "flex-start" }}
            disabled={dimenticandoChiave}
            onClick={() => void handleDimenticaChiaveHost()}>
            {dimenticandoChiave ? t("cfg.hostKeyForgetting") : t("cfg.hostKeyForget")}
          </button>
        </div>
      )}
      <SceltaOpenplc valore={conOpenplc} onChange={setConOpenplc} />
      {(() => {
        const bloccato = !installazioneConsentita(sondaggio);
        const spento = !host || !user || deploying || bloccato;
        return (
          <button
            style={{ ...BTN_PRIMARY, opacity: spento ? 0.5 : 1 }}
            disabled={spento}
            title={bloccato ? t("cfg.installBlockedByProbe") : undefined}
            onClick={handleDeploy}
          >
            {/* La spunta è un'icona, non una lettera del testo: dentro il
                catalogo cambiava disegno da una macchina all'altra, e in una
                lingua che non la vuole non si poteva togliere. */}
            {deploying ? t("welcome.deploying")
              : done ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <IconaUI nome="conferma" px={14} />{t("welcome.deployDone")}
                </span>
              )
              : hasError ? t("welcome.retryDeploy")
              : sondaggio?.sws.installato ? t("cfg.installUpdateBtn")
              : t("welcome.deploy")}
          </button>
        );
      })()}
    </div>
  );
}

/**
 * Installare il runtime su un dispositivo, dalla schermata iniziale.
 *
 * # Cosa c'era prima, e perché è stato tolto
 *
 * Questo modale aveva due schede. La seconda — questa — installa il binario via
 * SSH e funziona. La prima, «Connetti», scriveva `localStorage
 * sws.runtimeBaseUrl` e ricaricava la pagina per far puntare *tutta* la SPA a un
 * altro runtime: e **non funzionava**, perché `admin-main.tsx` chiama
 * `setForceLocalApi(true)` e quindi `getBaseUrl()` esce sempre con `""`.
 * Qualunque cosa si inserisse, il footer continuava a dire «runtime locale».
 *
 * Non era solo inerte, era un doppione: collegare un runtime remoto si fa in
 * Configurazione → Istanza → Device → Connessione → Connetti, che passa dal server (il token resta nel
 * processo locale, mai nel browser) e abilita deploy e relay dei dati vivi. Due
 * modi per la stessa cosa, di cui uno rotto, sono peggio di uno solo.
 *
 * # Perché la schermata iniziale ha comunque una sua installazione
 *
 * ConfigView richiede un progetto aperto. Qui non c'è nessun progetto: è il caso
 * «macchina nuova, niente ancora configurato». Da Q48 (2026-09-09) i due usano lo
 * STESSO endpoint (`/api/deploy/device-container`): la schermata è diversa,
 * l'operazione no — prima qui c'era `/api/deploy/remote`, che scaricava un
 * binario inesistente.
 */
/** Un comando da copiare, con il suo pulsante. */
function Comando({ testo }: { testo: string }) {
  const { t } = useTranslation();
  const [copiato, setCopiato] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      {/* Aspetto da terminale (richiesta del maintainer, 21-10-2026): fondo
          nero e testo verde, uguale in tema chiaro e scuro — un comando da
          incollare in una shell somiglia alla shell, non alla pagina. Il «$»
          è decorazione e non entra negli appunti: il pulsante copia la
          stringa, non quel che si vede. */}
      <pre style={{
        flex: 1, minWidth: 0, margin: 0, padding: "10px 12px", borderRadius: 4,
        background: "#000", border: "1px solid #2f3b2f",
        color: "#3bd16f", fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 12.5, lineHeight: 1.6,
        whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>
        <span style={{ color: "#6b7280", userSelect: "none" }} aria-hidden="true">$ </span>{testo}
      </pre>
      <button
        style={{ ...BTN_GHOST, flex: "0 0 auto" }}
        onClick={() => {
          // Se la scrittura negli appunti è negata (succede fuori da HTTPS e in
          // certi contesti incorporati) si seleziona il testo: copiare a mano
          // resta possibile, e un pulsante che non dice niente no.
          navigator.clipboard?.writeText(testo).then(
            () => { setCopiato(true); setTimeout(() => setCopiato(false), 1500); },
            () => { /* niente appunti: resta la selezione a mano */ },
          );
        }}
      >{copiato
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <IconaUI nome="conferma" px={13} />{t("welcome.installCloudCopiato")}
          </span>
        : t("welcome.installCloudCopia")}</button>
    </div>
  );
}

/** La guida, quando l'IDE gira sul server.
 *
 *  Il modulo SSH qui non ha senso: il gateway dovrebbe entrare nel pannello del
 *  cliente, che sta dietro NAT e non ha una rotta in ingresso — ed è esattamente
 *  ciò che il tunnel esiste per evitare (richiesta del maintainer, 21-10-2026).
 *  I comandi sono quelli del HOWTO §25, nella forma dell'abbinamento col codice:
 *  niente `--tunnel-nome` né `--tunnel-token`, che servono alla strada del
 *  pannello dichiarato a mano. L'indirizzo del gateway viaggia nell'immagine.
 */
function GuidaInstallazione() {
  const { t } = useTranslation();
  const IMG = "ghcr.io/soligolab/sws-runtime:rc-arm64";
  // OpenPLC a richiesta (30-10-2026): una flag in fondo all'ultimo comando.
  const [conOpenplc, setConOpenplc] = useState(false);
  const passi: [string, string][] = [
    // Il segnaposto segue la lingua come tutto il resto: cablato in italiano
    // stonava in mezzo a una guida in inglese (maintainer, 21-10-2026).
    [t("welcome.installCloudPasso1"), `ssh user@<${t("welcome.installCloudIndirizzo")}>`],
    [t("welcome.installCloudPasso2"), `podman pull ${IMG}`],
    [t("welcome.installCloudPasso3"), "mkdir -p ~/sws-install && cd ~/sws-install"],
    [t("welcome.installCloudPasso4"), `podman run --rm --entrypoint tar ${IMG} \\\n  -C /usr/share/sws/quadlet -cf - . | tar -xf -`],
    [t("welcome.installCloudPasso5"), `./install-container.sh --pull ${IMG}${conOpenplc ? " --con-openplc" : ""}`],
  ];
  // I quattro passi dopo l'SSH, uniti in una riga sola (22-10-2026). Il
  // maintainer ha chiesto di **aggiungere** questa forma, non di sostituire
  // quella a passi: chi vuole vedere cosa sta facendo tiene i cinque riquadri,
  // chi ha gia' capito incolla una volta sola.
  //
  // `&&` e non `;`: se un passo fallisce i successivi non partono. Con `;` un
  // `podman pull` andato male lascerebbe proseguire l'estrazione dei quadlet,
  // che fallirebbe in un modo che non somiglia alla causa.
  const aggregato = passi.slice(1).map(([, cmd]) => cmd).join(" && \\\n  ");
  const [unaRiga, setUnaRiga] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.6 }}>
        {t("welcome.installCloudIntro")}
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox" data-testid="guida-openplc" checked={conOpenplc} onChange={(e) => setConOpenplc(e.target.checked)} />
        {t("openplc.guida")}
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        {([[false, t("welcome.installCloudAPassi")], [true, t("welcome.installCloudAggregato")]] as const).map(([v, etichetta]) => (
          <button key={String(v)} type="button" onClick={() => setUnaRiga(v)}
            style={{
              padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer",
              border: "1px solid var(--brand-surface-2, #334155)",
              background: unaRiga === v ? "var(--brand-primary, #3b82f6)" : "transparent",
              color: unaRiga === v ? "#fff" : "var(--brand-text-muted, #94a3b8)",
            }}>
            {etichetta}
          </button>
        ))}
      </div>
      {unaRiga ? (
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <li style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{passi[0][0]}</div>
            <Comando testo={passi[0][1]} />
          </li>
          <li style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{t("welcome.installCloudAggregatoPasso")}</div>
            <Comando testo={aggregato} />
          </li>
        </ol>
      ) : (
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {passi.map(([titolo, cmd]) => (
          <li key={titolo} style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{titolo}</div>
            <Comando testo={cmd} />
          </li>
        ))}
      </ol>
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.6 }}>
        {t("welcome.installCloudDopo")}
      </p>
    </div>
  );
}

export function InstallaRuntimeModal({ onClose, gateway }: { onClose: () => void; gateway: boolean }) {
  const { t } = useTranslation();

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 10, padding: 24,
        // 700 e non 520 (maintainer, 21-10-2026): il comando che estrae i
        // quadlet andava a capo dentro il riquadro, e in un terminale sta su
        // due righe sue. `maxWidth` tiene il dialogo dentro lo schermo di un
        // telefono.
        width: 700, maxWidth: "92vw",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 12 }}>
          {t("welcome.installRuntimeTitle")}
        </div>

        {gateway ? <GuidaInstallazione /> : <DeploySection />}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button style={BTN_GHOST} onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
