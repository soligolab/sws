import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, AuthError, NoProjectError, PasswordChangeRequiredError, RuntimeUnavailableError } from "@/api/client";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { BrandLogo } from "@/components/BrandLogo";
import { DirtyIndicator } from "@/components/DirtyIndicator";
import { HDR_BTN } from "@/components/headerStyles";
import { MainMenu } from "@/components/MainMenu";
import { RuntimeCtrl } from "@/components/RuntimeCtrl";
import { ViewerLink } from "@/components/ViewerLink";
import { UserMenu } from "@/components/UserMenu";
import { ChatPanel } from "@/components/ChatPanel";
import { LogPanel } from "@/components/LogPanel";
import { apriFinestra, sorvegliaChiusura } from "@/apriFinestra";
import { idEditore, Ponte } from "@/ai/ponte";
import { riassumi } from "@/ai/riassunto";
import { LoginScreen } from "@/components/LoginScreen";
import { ReAuthModal } from "@/components/ReAuthModal";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { EditorShell } from "@/editor/EditorShell";

/** La Configurazione si carica **quando serve**, non all'avvio.
 *
 *  `ConfigView.tsx` è il file più grande del progetto — diecimila righe, con
 *  dentro tutte le schede: variabili, protocolli, allarmi, utenti, backup,
 *  dispositivi, ricette. L'IDE però apre in modalità **Editor**, e chi disegna
 *  un sinottico può non aprire mai la Configurazione in tutta la sessione:
 *  metterla nel bundle iniziale fa pagare a tutti il costo di una schermata che
 *  molti non guardano.
 *
 *  Conta soprattutto sul dispositivo, dove la SPA arriva dal pannello e non da
 *  una CDN, e su una macchina che ha altro da fare.
 *
 *  Il modulo espone un export **nominato**, quindi va rimappato su `default`:
 *  `React.lazy` vuole un modulo con quello. */
const ConfigView = lazy(() =>
  import("@/config/ConfigView").then((m) => ({ default: m.ConfigView })));
import { getBrand } from "@/branding";
import { selectIsDirty, useAppStore } from "@/store";
import { pickInitialPageId } from "@/pageLayout";
import { useLogStream } from "@/ws/logStream";
import { useRemoteLogStream } from "@/ws/remoteLogStream";
import { useTagStream } from "@/ws/tagStream";
import { chiudiAiStream } from "@/ws/aiStream";
import { useProjectWatcher } from "@/ws/projectWatcher";
import { useBuildWatcher } from "@/ws/buildWatcher";
import { useCertWatcher } from "@/ws/certWatcher";
import { canEditProject, canConfigureProject } from "@/auth/permissions";

// Port 8444 — full IDE (canvas editor + ConfigView + project management).
// Served via admin-main.tsx which calls setForceLocalApi(true) before render.
type Mode = "edit" | "config";

// ── Role gate for admin port ──────────────────────────────────────────────────

const HDR_BTN_DENY: React.CSSProperties = {
  padding: "8px 20px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, cursor: "pointer", fontSize: 14,
};

function AccessDenied({ role, onLogout }: { role: string; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", background: "var(--brand-bg, #0f172a)",
      color: "var(--brand-text, #e2e8f0)", gap: 16, fontFamily: "system-ui",
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{t("accessDenied.title")}</div>
      <div style={{ fontSize: 14, color: "var(--brand-text-muted, #94a3b8)", maxWidth: 400, textAlign: "center" }}>
        {t("accessDenied.requires")} {t("accessDenied.authenticatedAs", { role })}
      </div>
      <button style={HDR_BTN_DENY} onClick={onLogout}>{t("accessDenied.logout")}</button>
    </div>
  );
}

// ── Shared header-button style ────────────────────────────────────────────────

const LOG_PANEL_KEY = "sws.logPanel.open";
const CHAT_PANEL_KEY = "sws.chatPanel.open";

export function App() {
  const { t } = useTranslation();
  const mode             = useAppStore((s) => s.appMode);
  const setMode          = useAppStore((s) => s.setAppMode);
  const configTab        = useAppStore((s) => s.configTab);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  // Log drawer: state stays here (App owns <LogPanel>), the toggle moved into
  // the ☰ menu — it is a diagnostic, not a per-minute control.
  const [logOpen, setLogOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LOG_PANEL_KEY) === "1"; } catch { return false; }
  });
  const toggleLog = () => {
    setLogOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(LOG_PANEL_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Chat dell'assistente (T-50): cassetto laterale, stesso schema del log —
  // stato qui, interruttore nel menu ☰, scelta ricordata in localStorage.
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(CHAT_PANEL_KEY) === "1"; } catch { return false; }
  });
  const toggleChat = () => {
    setChatOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(CHAT_PANEL_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // I log staccati in una finestra propria. L'handle si tiene per **riusare**
  // la finestra invece di riaprirla: `window.open` sullo stesso URL ricarica il
  // documento, e per una console di log significa perdere il buffer che si
  // stava leggendo. Non serve nessun canale fra le finestre: `LogPanel` è sola
  // lettura verso il progetto, quindi quella finestra apre i propri stream e
  // vive da sé (vedi `components/LogWindow.tsx`).
  const finestraLog = useRef<Window | null>(null);
  const [logStaccatoErrore, setLogStaccatoErrore] = useState<string | null>(null);

  const staccaLog = () => {
    const esito = apriFinestra("/index-log.html", "sws-log", {
      larghezza: 900, altezza: 520, handle: finestraLog.current,
    });
    if (esito.bloccata) {
      // Rumoroso, e senza navigare via: qui c'è il progetto in memoria.
      setLogStaccatoErrore(t("logWindow.blocked"));
      return;
    }
    setLogStaccatoErrore(null);
    finestraLog.current = esito.win;
    if (esito.win && !esito.riusata) {
      // Quando la chiudono, si dimentica l'handle: al prossimo clic si riapre
      // invece di provare un `focus()` su una finestra morta.
      sorvegliaChiusura(esito.win, () => { finestraLog.current = null; });
    }
  };

  // ── La chat staccata, e il lato-editor del ponte ──────────────────────────
  //
  // Staccare la chat e' una **consegna**, non un duplicato: la conversazione
  // vive nel WebSocket lato runtime, quindi la finestra nuova ne apre uno suo e
  // ricomincia da zero. Per questo, appena la finestra si apre, qui il pannello
  // si chiude e resta disabilitato (`chatStaccata`) — averlo aperto in due posti
  // vorrebbe dire due conversazioni, entrambe a pagamento.
  //
  // Il ponte serve perche' `applyAiProposal` deve girare **qui**: scrive lo
  // store, la history e le `pendingSections`, che sono closure e non
  // attraversano nessun canale. Vedi `@/ai/ponte`.
  const finestraChat = useRef<Window | null>(null);
  const [chatStaccata, setChatStaccata] = useState(false);
  const [chatStaccataErrore, setChatStaccataErrore] = useState<string | null>(null);
  const ponte = useMemo(() => new Ponte(idEditore()), []);

  useEffect(() => {
    if (!ponte.vivo) return;

    const stop = ponte.ascolta((m) => {
      switch (m.t) {
        case "ciao": {
          // Una chat staccata si e' presentata: il pannello qui non deve
          // riaprirsi. Vale anche dopo un ricarico dell'editor, ed e' il modo in
          // cui l'IDE riparte sapendo di avere una chat fuori.
          setChatStaccata(true);
          const st = useAppStore.getState();
          ponte.manda({ t: "stato", a: m.da, progetto: st.project?.meta.name ?? null });
          break;
        }
        case "chat-chiusa":
          setChatStaccata(false);
          finestraChat.current = null;
          break;
        case "diff": {
          const st = useAppStore.getState();
          try {
            const diff = riassumi(m.proposta.project ?? null, m.proposta.pages ?? null,
                                  st.project, st.pages);
            ponte.manda({ t: "diff-ok", a: m.da, rid: m.rid, diff });
          } catch (e: any) {
            // Si **dice** che non si sa, invece di mandare un elenco vuoto: `[]`
            // sullo schermo diventa «questa proposta non cambia niente».
            ponte.manda({ t: "diff-no", a: m.da, rid: m.rid,
                          errore: String(e?.message ?? e) });
          }
          break;
        }
        case "applica": {
          void useAppStore.getState().applyAiProposal(m.proposta).then((esito) => {
            ponte.manda({ t: "applicato", a: m.da, rid: m.rid,
                          ok: esito.ok, motivo: esito.motivo, avviso: esito.avviso });
          });
          break;
        }
      }
    });

    // «Sono (ri)partito». Una chat viva risponde con `ciao`, e cosi' dopo un
    // ricarico l'editor ritrova il suo stato invece di riaprire il pannello.
    ponte.manda({ t: "editore-pronto" });

    const addio = () => ponte.manda({ t: "editore-chiuso" });
    window.addEventListener("pagehide", addio);
    return () => {
      window.removeEventListener("pagehide", addio);
      stop();
    };
  }, [ponte]);

  const staccaChat = () => {
    const esito = apriFinestra(`/index-chat.html#e=${encodeURIComponent(ponte.mio)}`,
                               "sws-chat", { larghezza: 460, altezza: 760,
                                             handle: finestraChat.current });
    if (esito.bloccata) {
      // Il pannello resta aperto e il socket **non** si chiude: la consegna non
      // e' avvenuta, e fingere il contrario perderebbe la conversazione.
      setChatStaccataErrore(t("chatWindow.blocked"));
      return;
    }
    setChatStaccataErrore(null);
    finestraChat.current = esito.win;
    if (esito.win && !esito.riusata) {
      sorvegliaChiusura(esito.win, () => {
        finestraChat.current = null;
        setChatStaccata(false);
      });
    }
    // Solo ora si chiude qui: la conversazione passa di la'.
    chiudiAiStream();
    setChatOpen(false);
    try { localStorage.setItem(CHAT_PANEL_KEY, "0"); } catch { /* ignore */ }
    setChatStaccata(true);
  };

  // Stream runtime logs and tag values whenever the user is authenticated.
  useLogStream();
  useRemoteLogStream();
  useTagStream();

  const authToken              = useAppStore((s) => s.authToken);
  const authUser               = useAppStore((s) => s.authUser);
  const authRole               = useAppStore((s) => s.authRole);
  const expiresAtMs            = useAppStore((s) => s.expiresAtMs);
  const setExpiresAtMs         = useAppStore((s) => s.setExpiresAtMs);
  const mustChangePassword     = useAppStore((s) => s.mustChangePassword);
  const setMustChangePassword  = useAppStore((s) => s.setMustChangePassword);
  const setAuth                = useAppStore((s) => s.setAuth);
  const clearAuth              = useAppStore((s) => s.clearAuth);
  const noActiveProject        = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject     = useAppStore((s) => s.setNoActiveProject);
  const reAuthNeeded           = useAppStore((s) => s.reAuthNeeded);
  const setReAuthNeeded        = useAppStore((s) => s.setReAuthNeeded);
  const setPages       = useAppStore((s) => s.setPages);
  const setFaceplates  = useAppStore((s) => s.setFaceplates);
  const resetProjectState = useAppStore((s) => s.resetProjectState);
  const project             = useAppStore((s) => s.project);
  const setProject          = useAppStore((s) => s.setProject);
  const setProjectLoadError = useAppStore((s) => s.setProjectLoadError);
  const isDirty             = useAppStore(selectIsDirty);
  const saveAll             = useAppStore((s) => s.saveAll);
  const resetDirty          = useAppStore((s) => s.resetDirty);
  const saveStatus          = useAppStore((s) => s.saveStatus);
  const remoteDeployStatus  = useAppStore((s) => s.remoteDeployStatus);

  // Role-gated UI surfaces. Supervisor + Admin get editor and config;
  // Viewer/Operator should use the runtime SPA (port 8443) instead.
  const canEdit = canEditProject(authRole);

  // True while the initial getProject()+whoami() bootstrap is in flight.
  // Prevents LoginScreen from flashing before we know the auth state.
  const [bootstrapping, setBootstrapping] = useState(true);

  const [confirmPending, setConfirmPending] = useState<"close" | "logout" | null>(null);
  // Il progetto sul runtime è cambiato sotto di noi (deploy da un altro IDE,
  // pull GitOps, modifica dei file sul dispositivo). NON si ricarica da soli:
  // in editor ci può essere lavoro non salvato, e sovrascriverlo senza chiedere
  // sarebbe peggio del mostrare dati vecchi. Il viewer invece si aggiorna da sé.
  const [projectChangedOutside, setProjectChangedOutside] = useState(false);
  // Q30: il rifiuto per versione vive nello store perché lo produce `saveAll()`,
  // che sta là.
  const saveConflict = useAppStore((s) => s.saveConflict);
  const setSaveConflict = useAppStore((s) => s.setSaveConflict);
  // Frontend nuovo servito dal runtime. Mai automatico qui: un reload
  // butterebbe via le modifiche non salvate.
  const [newBuildAvailable, setNewBuildAvailable] = useState(false);
  // Il runtime remoto era irraggiungibile (tipicamente: cert self-signed non
  // accettato) ed e' tornato a rispondere — serve un reload per riconnettersi.
  const [runtimeBackReload, setRuntimeBackReload] = useState(false);
  const [waitingForSave, setWaitingForSave] = useState(false);

  // Remote deploy target connection state — letto direttamente dallo store
  // (aggiornato da RuntimeConnectionTab/DevicesTab in ConfigView.tsx), non più
  // da un proprio specchio locale via localStorage/eventi: erano due fonti di
  // verità indipendenti che potevano disallinearsi (es. disconnessione dal
  // bottone Deploy che non si rifletteva in Configurazione → Runtime).
  const remoteConnected    = useAppStore((s) => s.remoteConnected);
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);

  // Dev-mode TTL banner: shown to Admin/Supervisor when their session has an expiry.
  // Lets them quickly disable it for convenience during development.
  const [devTtlBanner, setDevTtlBanner] = useState<{ ttlSecs: number } | null>(null);
  const [ttlBusy, setTtlBusy] = useState(false);

  useEffect(() => {
    if (!authToken || !authUser || (authRole !== "Admin" && authRole !== "Supervisor")) {
      setDevTtlBanner(null);
      return;
    }
    api.listUsers()
      .then((users) => {
        const me = users.find((u) => u.username === authUser);
        if (me && me.session_ttl_secs !== null && me.session_ttl_secs !== 0) {
          setDevTtlBanner({ ttlSecs: me.session_ttl_secs });
        }
      })
      .catch(() => { /* non-critical */ });
  }, [authToken, authUser, authRole]);

  const handleDisableTtl = async () => {
    if (!authUser) return;
    setTtlBusy(true);
    try {
      await api.updateUser(authUser, { session_ttl_secs: 0 });
      setDevTtlBanner(null);
    } catch { /* ignore */ } finally {
      setTtlBusy(false);
    }
  };
  const effectiveMode: Mode =
    (mode === "edit"   && !canEdit)      ? "config" :
    mode;
  const allowedModes: Mode[] = canEdit
    ? (["edit", "config"] as Mode[])
    : (["config"] as Mode[]);

  // ── URL hash deep-linking (#edit | #view | #config | #config/<tab>) ─────────
  // Read once after the app becomes active (authenticated + project open).
  const deepLinkApplied = useRef(false);
  const VALID_TABS = ["tags","protocols","alarms","users","resources","system","backups"];
  useEffect(() => {
    if (!authToken || noActiveProject || deepLinkApplied.current) return;
    deepLinkApplied.current = true;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("config/")) {
      const tab = hash.slice("config/".length);
      if (VALID_TABS.includes(tab)) navigateToConfig(tab as Parameters<typeof navigateToConfig>[0]);
      else setMode("config");
    } else if (hash === "edit" || hash === "config") {
      setMode(hash as Mode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, noActiveProject]);

  // Keep hash in sync whenever mode or configTab changes (for bookmarking).
  useEffect(() => {
    if (!authToken || noActiveProject) return;
    const hash = effectiveMode === "config" ? `config/${configTab}` : effectiveMode;
    history.replaceState(null, "", `#${hash}`);
  }, [effectiveMode, configTab, authToken, noActiveProject]);

  // Listen for mid-session token expiry fired by api/client.ts
  useEffect(() => {
    const handler = () => { if (authToken) setReAuthNeeded(true); };
    window.addEventListener("sws:session-expired", handler);
    return () => window.removeEventListener("sws:session-expired", handler);
  }, [authToken, setReAuthNeeded]);

  // Proactive session refresh: fire 5 min before expiry so idle sessions
  // don't time out. Effect re-runs whenever expiresAtMs changes (i.e., after
  // each successful refresh), creating a self-rescheduling timer chain.
  useEffect(() => {
    if (!authToken || !expiresAtMs) return;
    const delay = Math.max(expiresAtMs - Date.now() - 5 * 60_000, 30_000);
    const timer = setTimeout(async () => {
      try {
        const r = await api.refresh();
        setExpiresAtMs(r.expires_at_ms);
      } catch {
        // Failure is handled by the existing session-expired event + ReAuthModal;
        // no duplicate action needed here.
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [authToken, expiresAtMs, setExpiresAtMs]);

  // Mount flow:
  //   1. If no token → try GET /api/project to detect 503 (no project open).
  //      503 → WelcomeScreen.  Any other error → LoginScreen.
  //   2. If token present → same call. 200 → load project. 401 → clear auth.
  //      503 → WelcomeScreen (project was closed externally).
  useEffect(() => {
    if (mustChangePassword) return;

    api.getProject()
      .then(async (p) => {
        setNoActiveProject(false);
        setProject(p);
        // No token and project is open: we may be in no-auth mode.
        // Probe whoami; if it succeeds (synthetic admin), set a sentinel
        // token so the main app renders instead of LoginScreen.
        if (!authToken) {
          try {
            const me = await api.whoami();
            setAuth("no-auth", me.username, me.role, me.must_change_password);
          } catch { /* has users → LoginScreen will appear */ }
        }
        setBootstrapping(false);
      })
      .catch((e) => {
        if (e instanceof NoProjectError) {
          setNoActiveProject(true);
          clearAuth();
        } else if (e instanceof RuntimeUnavailableError) {
          // Runtime non raggiungibile → WelcomeScreen; la WelcomeScreen
          // gestirà il retry/errore quando l'utente interagisce.
          setNoActiveProject(true);
          clearAuth();
        } else if (e instanceof AuthError) {
          clearAuth();
        } else if (e instanceof PasswordChangeRequiredError) {
          setMustChangePassword(true);
        } else {
          setProjectLoadError(e?.message ?? String(e));
        }
        setBootstrapping(false);
      });

    if (!authToken) return;

    api.listSynoptics()
      .then(async (names) => {
        // Progetto senza synoptic (es. appena creato vuoto): azzera le pagine,
        // altrimenti resterebbe in memoria il contenuto del progetto precedente.
        if (names.length === 0) { setPages([], ""); return; }
        const loaded = await Promise.all(names.map((n) => api.getSynoptic(n)));
        // Letto imperativamente dallo store (non da una chiusura locale): questo
        // effetto lancia getProject() e listSynoptics() come due catene .then
        // indipendenti, quindi project potrebbe non essere ancora stato settato
        // quando arriviamo qui — in quel caso home_page_id è undefined e
        // pickInitialPageId degrada al comportamento di oggi (prima pagina).
        const homePageId = useAppStore.getState().project?.page_layout?.home_page_id;
        setPages(loaded, pickInitialPageId(loaded, homePageId));
      })
      .catch((e) => {
        if (e instanceof AuthError) clearAuth();
        else if (e instanceof PasswordChangeRequiredError) setMustChangePassword(true);
      });

    api.listFaceplates()
      .then(async (ids) => {
        if (ids.length === 0) { setFaceplates([]); return; }
        const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
        setFaceplates(loaded);
      })
      .catch(() => { /* non-critical — no faceplates configured */ });
  }, [authToken, mustChangePassword]);

  // resetDirty() before leaving: after a "close without saving" the store
  // still holds the modified pages, and a later F5 on the WelcomeScreen
  // would raise the beforeunload prompt for a project that is no longer open.
  const executeClose = async () => {
    resetDirty();
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    resetProjectState();
    setNoActiveProject(true);
  };

  const executeLogout = async () => {
    resetDirty();
    try { await api.logout(); } catch { /* ignore */ }
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  const handleLogout = () => {
    if (isDirty) { setConfirmPending("logout"); return; }
    executeLogout();
  };

  const handleCloseProject = () => {
    if (isDirty) { setConfirmPending("close"); return; }
    executeClose();
  };

  // After triggering saveAll(), wait for saveStatus "ok" (save succeeded) or
  // "error" (save failed) before closing. Keyed on saveStatus rather than on
  // isDirty: a section that stays dirty would otherwise hang here forever.
  useEffect(() => {
    if (!waitingForSave) return;
    if (saveStatus === "ok") {
      setWaitingForSave(false);
      const pending = confirmPending;
      setConfirmPending(null);
      if (pending === "close") executeClose();
      else if (pending === "logout") executeLogout();
    } else if (saveStatus === "error") {
      setWaitingForSave(false);
      setConfirmPending(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForSave, saveStatus]);

  // I salvataggi dell'autore cambiano il fingerprint tanto quanto un deploy
  // esterno: senza questa guardia l'avviso comparirebbe dopo ogni Ctrl+S.
  // Il polling è a 10 s e un salvataggio dura meno di 1 s, quindi 20 s di
  // finestra bastano per attribuire il cambio a noi.
  const lastLocalSaveAt = useRef(0);
  useEffect(() => {
    if (saveStatus === "ok") lastLocalSaveAt.current = Date.now();
  }, [saveStatus]);

  useBuildWatcher(() => setNewBuildAvailable(true));
  useCertWatcher(() => setRuntimeBackReload(true));

  useProjectWatcher(() => {
    if (Date.now() - lastLocalSaveAt.current < 20_000) return; // è stato un nostro salvataggio
    setProjectChangedOutside(true);
  });

  // Ctrl+S / Cmd+S — global, so it works in Configuration mode too (where
  // EditorShell is unmounted). preventDefault unconditionally, otherwise the
  // browser's own "Save page" dialog leaks through when nothing is dirty.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void useAppStore.getState().saveAll();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Warn before the tab is closed/reloaded with unsaved changes. Attached
  // only while dirty, so it costs nothing the rest of the time. Closing the
  // project and logging out don't unload the document (they re-render the
  // WelcomeScreen in place) and are guarded by their own dialog.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Tab title: "● Project — Brand" while dirty. Layers on top of the title
  // set once at boot by applyBranding().
  useEffect(() => {
    const brand = getBrand();
    const base  = project?.meta.name ? `${project.meta.name} — ${brand.shortName}` : brand.name;
    document.title = isDirty ? `● ${base}` : base;
  }, [isDirty, project?.meta.name]);

  // Blank while the first getProject()+whoami() round-trip is in flight.
  if (bootstrapping) return null;

  // No active project → show project picker (WelcomeScreen).
  if (noActiveProject) {
    return (
      <WelcomeScreen
        onProjectOpened={async () => {
            // whoami BEFORE setNoActiveProject so the WelcomeScreen stays
            // visible while we probe auth state — avoids a LoginScreen flash.
            // No-auth mode: server injects synthetic admin → 200.
            // Auth mode: swap_store invalidated old session → 401.
            try {
              const me = await api.whoami();
              clearAuth();
              setAuth("no-auth", me.username, me.role, me.must_change_password);
            } catch {
              clearAuth(); // has users → LoginScreen correct
            }
            // Clear any leftover project/pages from before this screen was
            // shown, so EditorShell remounts empty instead of flashing the
            // previous project's canvas while the real data is still in
            // flight (fetched by the effect below, keyed on authToken).
            resetProjectState();
            setNoActiveProject(false);
          }}
      />
    );
  }

  if (!authToken) {
    const handleCancelLogin = async () => {
      try { await api.closeProject(); } catch { /* ignore */ }
      setNoActiveProject(true);
    };
    return <LoginScreen onCancel={handleCancelLogin} />;
  }

  if (mustChangePassword) {
    return <ChangePasswordScreen />;
  }

  // Role gate: Operator/Viewer cannot use the IDE on port 8444.
  if (!canConfigureProject(authRole)) {
    return <AccessDenied role={authRole ?? "Viewer"} onLogout={handleLogout} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0f172a)" }}>
      {/* Header */}
      <header style={{
        height: 48,
        background: "var(--brand-surface, #1e293b)",
        borderBottom: "1px solid var(--brand-surface-2, #334155)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        flexShrink: 0,
      }}>
        <BrandLogo />
        {/* Qui stava l'indicatore ARCH-004 del «runtime remoto a cui punta la
            SPA», con un click per staccarsi. Non poteva accendersi: leggeva
            `getRuntimeBaseUrl()`, e `admin-main.tsx` chiama
            `setForceLocalApi(true)`, quindi in questo bundle quella funzione
            esce sempre con `""`. Un indicatore che non può accendersi è peggio
            di nessun indicatore, perché fa credere che l'assenza significhi
            qualcosa. Lo stato del runtime remoto **vero** — quello collegato da
            Configurazione → Runtime, che passa dal server — lo mostrano il
            marcatore di `RuntimeCtrl` e la scheda Stato. */}
        <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 13 }}>
          {t("app.project")}: {project?.meta.name ?? "—"}
        </span>
        <DirtyIndicator />
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {allowedModes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "5px 14px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: effectiveMode === m ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)",
                color: effectiveMode === m ? "var(--brand-on-primary, #fff)" : "var(--brand-text, #e2e8f0)",
                fontWeight: effectiveMode === m ? 600 : 400,
                fontSize: 13,
              }}
            >
              {t(m === "edit" ? "header.mode.editor" : "header.mode.config")}
            </button>
          ))}
        </div>
        <RuntimeCtrl />
        {/* Apre la pagina operatore del runtime — quello connesso se c'è,
            altrimenti il locale. Sta accanto a Deploy di proposito: la domanda
            "ha funzionato?" arriva subito dopo averlo premuto. */}
        <ViewerLink />
        {/* Remote deploy target indicator — shows sync status when connected */}
        {(() => {
          const syncLabel =
            remoteDeployStatus === "syncing" ? t("header.syncing") :
            remoteDeployStatus === "ok"      ? t("header.synced") :
            remoteDeployStatus === "error"   ? t("header.syncError") :
            t("header.deploy");
          const dotColor =
            remoteDeployStatus === "syncing" ? "var(--brand-warning, #f59e0b)" :
            remoteDeployStatus === "ok"      ? "var(--brand-success-soft, #4ade80)" :
            remoteDeployStatus === "error"   ? "var(--brand-danger, #ef4444)" :
            remoteConnected ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger, #ef4444)";
          const btnExtra = remoteConnected
            ? { background: "#14532d", color: "var(--brand-success-soft, #4ade80)", border: "1px solid #16a34a" }
            : {};
          // Ultimo target salvato da RuntimeConnectionTab (ConfigView.tsx) —
          // permette un "riconnetti" esplicito con un click, senza tentare
          // nulla in automatico all'avvio dell'IDE.
          const lastTargetUrl = !remoteConnected ? localStorage.getItem("sws.runtime.targetUrl") : null;
          const titleStr = remoteConnected
            ? t("header.deployConnectedTitle")
            : lastTargetUrl
              ? t("header.deployReconnectTitle", { url: lastTargetUrl })
              : t("header.deployConfigTitle");
          return (
            <button
              onClick={async () => {
                if (remoteConnected) {
                  if (window.confirm(t("header.deployDisconnectConfirm"))) {
                    try { await api.remoteDisconnect(); } catch { /* già scollegato lato server, ignora */ }
                    setRemoteConnected(false);
                  }
                } else if (lastTargetUrl) {
                  const user = localStorage.getItem("sws.runtime.targetUser") || undefined;
                  const pass = localStorage.getItem("sws.runtime.targetPass") || undefined;
                  try {
                    const result = await api.remoteConnect(lastTargetUrl, user, pass);
                    if (!result.ok) throw new Error(result.error ?? "Connessione fallita");
                    setRemoteConnected(true, lastTargetUrl);
                  } catch {
                    // Ultimo dispositivo irraggiungibile o credenziali cambiate
                    // — porta l'utente su Configurazione → Runtime per un
                    // tentativo manuale invece di fallire in silenzio.
                    navigateToConfig("runtime");
                  }
                } else {
                  navigateToConfig("runtime");
                }
              }}
              title={titleStr}
              style={{ ...HDR_BTN, ...btnExtra, display: "flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />
              {syncLabel}
            </button>
          );
        })()}
        <UserMenu onLogout={handleLogout} />
        <MainMenu
          onLogout={handleLogout}
          onCloseProject={handleCloseProject}
          logOpen={logOpen}
          onToggleLog={toggleLog}
          chatOpen={chatOpen}
          onToggleChat={toggleChat}
          chatStaccata={chatStaccata}
          onStaccaChat={staccaChat}
          onStaccaLog={staccaLog}
        />
      </header>

      {/* Alarm banner */}
      {runtimeBackReload && (
        <div style={{
          background: "var(--brand-success-bg, #166534)", borderBottom: "1px solid var(--brand-success, #22c55e)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
          fontSize: 12, color: "#fff", flexShrink: 0,
        }}>
          <span>🔓</span>
          <span style={{ flex: 1 }}>{t("app.runtimeReachableReload")}</span>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", borderColor: "#fff" }}
            onClick={() => window.location.reload()}
          >
            {t("app.reloadNow")}
          </button>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", border: "none" }}
            onClick={() => setRuntimeBackReload(false)}
            title={t("app.dismiss")}
          >
            ✕
          </button>
        </div>
      )}
      {newBuildAvailable && (
        <div style={{
          background: "var(--brand-primary, #3b82f6)", borderBottom: "1px solid var(--brand-primary-hover, #2563eb)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
          fontSize: 12, color: "#fff", flexShrink: 0,
        }}>
          <span>⬆</span>
          <span style={{ flex: 1 }}>{t("app.newBuildAvailable")}</span>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", borderColor: "#fff" }}
            onClick={() => window.location.reload()}
          >
            {t("app.reloadNow")}
          </button>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", border: "none" }}
            onClick={() => setNewBuildAvailable(false)}
            title={t("app.dismiss")}
          >
            ✕
          </button>
        </div>
      )}
      {/* Q30: lo stesso banner serve i due modi di scoprire che il progetto è
          cambiato sotto i piedi — il watcher se l'accorge da sé, il 409 lo
          scopre perché un salvataggio è stato rifiutato. Il rimedio è identico
          (ricaricare), e due banner che offrono lo stesso pulsante
          sarebbero due modi di dire una cosa sola; cambia solo la frase, perché
          nel secondo caso c'è una modifica appena rifiutata di cui rendere
          conto. */}
      {(projectChangedOutside || saveConflict) && (
        <div style={{
          background: "var(--brand-warning-bg, #78350f)", borderBottom: "1px solid var(--brand-warning, #f59e0b)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
          fontSize: 12, color: "var(--brand-warning-soft, #facc15)", flexShrink: 0,
        }}>
          <span>⟳</span>
          <span style={{ flex: 1 }}>
            {saveConflict ? t("app.saveConflict") : t("app.projectChangedOutside")}
          </span>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "var(--brand-warning-soft, #facc15)", borderColor: "var(--brand-warning, #f59e0b)" }}
            onClick={() => window.location.reload()}
          >
            {t("app.reloadNow")}
          </button>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "var(--brand-warning-soft, #facc15)", border: "none" }}
            onClick={() => { setProjectChangedOutside(false); setSaveConflict(false); }}
            title={t("app.dismiss")}
          >
            ✕
          </button>
        </div>
      )}

      {/* La finestra staccata dei log è stata bloccata dal browser. Un avviso
          visibile e non un `console.warn`: un popup bloccato è la cosa più
          facile da non notare, e senza questa riga il clic sembrerebbe non
          aver fatto niente. Si chiude da sé quando l'apertura riesce. */}
      {chatStaccataErrore && (
        <div style={{
          background: "var(--brand-danger-soft, #451a1a)",
          borderBottom: "1px solid var(--brand-danger, #ef4444)",
          padding: "5px 16px", display: "flex", alignItems: "center",
          gap: 12, fontSize: 12, color: "var(--brand-text, #e2e8f0)", flexShrink: 0,
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>{chatStaccataErrore}</span>
          <button style={{ ...HDR_BTN, padding: "2px 8px" }}
                  onClick={() => setChatStaccataErrore(null)}>✕</button>
        </div>
      )}

      {logStaccatoErrore && (
        <div style={{
          background: "var(--brand-danger-soft, #451a1a)",
          borderBottom: "1px solid var(--brand-danger, #ef4444)",
          padding: "5px 16px", display: "flex", alignItems: "center",
          gap: 12, fontSize: 12, color: "var(--brand-text, #e2e8f0)", flexShrink: 0,
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>{logStaccatoErrore}</span>
          <button
            style={{ ...HDR_BTN, padding: "2px 8px" }}
            onClick={() => setLogStaccatoErrore(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Dev-mode TTL banner: suggests disabling session expiry during development */}
      {devTtlBanner && (
        <div style={{
          background: "#1c1917", borderBottom: "1px solid #44403c",
          padding: "5px 16px", display: "flex", alignItems: "center",
          gap: 12, fontSize: 12, color: "#d6d3d1", flexShrink: 0,
        }}>
          <span style={{ color: "#a8a29e" }}>⏱</span>
          <span>
            {t("header.ttlBanner", { min: Math.round(devTtlBanner.ttlSecs / 60) })}
          </span>
          <button
            onClick={handleDisableTtl}
            disabled={ttlBusy}
            style={{
              background: "#292524", color: "#d6d3d1",
              border: "1px solid #44403c", borderRadius: 4,
              padding: "2px 10px", cursor: ttlBusy ? "default" : "pointer",
              fontSize: 11,
            }}
          >
            {ttlBusy ? "…" : t("header.deactivate")}
          </button>
          <button
            onClick={() => setDevTtlBanner(null)}
            style={{
              background: "transparent", color: "#78716c", border: "none",
              cursor: "pointer", fontSize: 13, padding: "0 4px", marginLeft: "auto",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main area */}
      <main style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {effectiveMode === "edit"   && <EditorShell />}
        {effectiveMode === "config" && (
          // Il fallback è volutamente scarno: il pezzo arriva dallo stesso
          // server che ha appena servito la pagina, quindi si vede per un
          // istante o non si vede affatto. Uno scheletro elaborato
          // lampeggerebbe, che è peggio di una riga di testo.
          <Suspense fallback={
            <div style={{ padding: 24, color: "var(--brand-text-subtle, #94a3b8)", fontSize: 13 }}>
              {t("config.loading", { defaultValue: "Caricamento configurazione…" })}
            </div>
          }>
            <ConfigView />
          </Suspense>
        )}
        {/* Chat drawer (right) — dentro <main> così sta accanto al canvas
            invece che sotto: una conversazione è alta, non larga. */}
        {/* `!chatStaccata`: con la chat in una finestra propria il cassetto non
            si apre, altrimenti sarebbero due socket e due conversazioni. */}
        <ChatPanel open={chatOpen && !chatStaccata} onClose={() => {
          setChatOpen(false);
          try { localStorage.setItem(CHAT_PANEL_KEY, "0"); } catch { /* ignore */ }
        }} />
      </main>

      {/* Log drawer (bottom) */}
      <LogPanel open={logOpen} onClose={() => {
        setLogOpen(false);
        try { localStorage.setItem(LOG_PANEL_KEY, "0"); } catch { /* ignore */ }
      }} />

      {/* Re-auth overlay — session expired mid-use */}
      {reAuthNeeded && <ReAuthModal />}

      {/* Unsaved-changes confirmation dialog */}
      {confirmPending && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: "24px 28px", maxWidth: 360, width: "90%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("unsaved.title")}</div>
            <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>{t("unsaved.body")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                style={{ ...HDR_BTN, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", padding: "8px 16px", fontSize: 13 }}
                disabled={waitingForSave}
                onClick={() => { void saveAll(); setWaitingForSave(true); }}
              >
                {waitingForSave ? t("header.saving") : t("unsaved.saveClose")}
              </button>
              <button
                style={{ ...HDR_BTN, background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid #991b1b", padding: "8px 16px", fontSize: 13 }}
                onClick={() => {
                  const pending = confirmPending;
                  setConfirmPending(null);
                  if (pending === "close") executeClose();
                  else executeLogout();
                }}
              >
                {t("unsaved.discard")}
              </button>
              <button
                style={{ ...HDR_BTN, padding: "8px 16px", fontSize: 13 }}
                onClick={() => { setConfirmPending(null); setWaitingForSave(false); }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
