import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  AuthError,
  NoProjectError,
  PasswordChangeRequiredError,
  RuntimeUnavailableError,
} from "@/api/client";
import { useAppStore } from "@/store";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { pickInitialPageId } from "@/pageLayout";
import { useProjectWatcher } from "@/ws/projectWatcher";
import { useBuildWatcher } from "@/ws/buildWatcher";

// ── Idle screen (no active project on this runtime) ───────────────────────────

function RuntimeIdleScreen() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", gap: 16,
      fontFamily: "system-ui, sans-serif",
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
           stroke="var(--brand-primary, #3b82f6)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Nessun progetto attivo</h2>
      <p style={{ margin: 0, color: "var(--brand-text-muted, #94a3b8)", textAlign: "center", maxWidth: 320 }}>
        Nessun progetto è stato caricato su questo runtime.<br/>
        Contattare l'amministratore.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 20px", borderRadius: 6, background: "var(--brand-surface, #1e293b)",
          color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", cursor: "pointer", fontSize: 14,
        }}
      >
        Riprova
      </button>
    </div>
  );
}

// ── RuntimeViewer — top-level SPA for port 8443 ───────────────────────────────
//
// Anonymous access via optional_auth on 8443 (Viewer role by default).
// No login prompt, no project management — just the live synoptic.

export function RuntimeViewer() {
  const { t } = useTranslation();
  const [updatedNotice, setUpdatedNotice] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);
  const noActiveProject     = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject  = useAppStore((s) => s.setNoActiveProject);
  const setProject          = useAppStore((s) => s.setProject);
  const setPages            = useAppStore((s) => s.setPages);
  const setFaceplates       = useAppStore((s) => s.setFaceplates);
  const clearAuth           = useAppStore((s) => s.clearAuth);
  const setAuth             = useAppStore((s) => s.setAuth);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);

  // Carica (o ricarica) progetto, pagine e faceplate dal runtime.
  // `keepPageId`: se quella pagina esiste ancora si resta lì — a un ricarico
  // automatico l'operatore non deve vedersi spostare la pagina sotto le mani.
  const loadProjectData = useCallback(async (keepPageId?: string) => {
    const p = await api.getProject();
    setNoActiveProject(false);
    setProject(p);

    const names = await api.listSynoptics();
    if (names.length > 0) {
      const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
      const keep = keepPageId && pages.some((x) => x.id === keepPageId)
        ? keepPageId
        : pickInitialPageId(pages, p.page_layout?.home_page_id);
      setPages(pages, keep);
    } else {
      setPages([], "");
    }

    const ids = await api.listFaceplates().catch(() => [] as string[]);
    if (ids.length > 0) {
      const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
      setFaceplates(loaded);
    }
  }, [setNoActiveProject, setProject, setPages, setFaceplates]);

  // Il runtime ricarica il progetto da solo a ogni open/deploy, ma non lo dice
  // ai client: senza questo, dopo un deploy il pannello continua a mostrare la
  // versione precedente finché non lo si ricarica a mano.
  useProjectWatcher((fp) => {
    if (fp === null) { setNoActiveProject(true); return; }
    const current = useAppStore.getState().currentPageId;
    void loadProjectData(current)
      .then(() => {
        // Avviso breve: l'operatore deve capire PERCHÉ la schermata è
        // cambiata sotto le sue mani, senza dovere premere nulla.
        setUpdatedNotice(true);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setUpdatedNotice(false), 4000);
      })
      .catch(() => setNoActiveProject(true));
  });

  // Frontend nuovo distribuito → ricarica. Un bundle nuovo si carica solo
  // ricaricando la pagina, e sul pannello non c'è nessuno che possa premere un
  // pulsante. Scelta del maintainer: viewer automatico, IDE con avviso.
  useBuildWatcher(() => window.location.reload());

  // On mount: detect whether a project is active and load its data.
  useEffect(() => {
    // Initialize authToken so useTagStream() can open the WebSocket.
    // In no-auth mode whoami() returns 200 with a synthetic admin — we use
    // the "no-auth" sentinel token (ignored by optional_auth on the server).
    // If the user has a persisted token it's already in the store; the call
    // is harmless and confirms the session is still valid.
    api.whoami()
      .then((me) => setAuth("no-auth", me.username, me.role))
      .catch(() => { /* anonymous viewer — reads work, writes need auth */ });

    api.getProject()
      .then(async (p) => {
        setNoActiveProject(false);
        setProject(p);

        const names = await api.listSynoptics();
        if (names.length > 0) {
          const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
          setPages(pages, pages[0].id);
        }

        const ids = await api.listFaceplates().catch(() => [] as string[]);
        if (ids.length > 0) {
          const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
          setFaceplates(loaded);
        }
      })
      .catch((e) => {
        if (
          e instanceof NoProjectError ||
          e instanceof RuntimeUnavailableError
        ) {
          setNoActiveProject(true);
        } else if (e instanceof AuthError) {
          clearAuth();
          setNoActiveProject(true);
        } else if (e instanceof PasswordChangeRequiredError) {
          setMustChangePassword(true);
          setNoActiveProject(true);
        } else {
          setNoActiveProject(true);
        }
      });
  }, []);

  if (noActiveProject) return <RuntimeIdleScreen />;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      fontFamily: "system-ui, sans-serif", color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0f172a)",
    }}>
      {updatedNotice && (
        <div style={{
          position: "fixed", top: 12, right: 12, zIndex: 9500,
          background: "var(--brand-surface, #1e293b)",
          border: "1px solid var(--brand-success, #22c55e)",
          color: "var(--brand-success-soft, #86efac)",
          borderRadius: 6, padding: "6px 12px", fontSize: 13,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", pointerEvents: "none",
        }}>
          ⟳ {t("viewer.projectUpdated")}
        </div>
      )}
      <RuntimeView />
    </div>
  );
}
