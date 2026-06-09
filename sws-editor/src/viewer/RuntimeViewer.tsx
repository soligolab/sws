import { useEffect } from "react";
import {
  api,
  AuthError,
  NoProjectError,
  PasswordChangeRequiredError,
  RuntimeUnavailableError,
} from "@/api/client";
import { useAppStore } from "@/store";
import { AlarmBanner } from "@/components/AlarmBanner";
import { RuntimeView } from "@/runtime-view/RuntimeView";

// ── Idle screen (no active project on this runtime) ───────────────────────────

function RuntimeIdleScreen() {
  const healthUrl = `${window.location.origin}/health`;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "#0f172a", color: "#e2e8f0", gap: 16,
      fontFamily: "system-ui, sans-serif",
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
           stroke="#3b82f6" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Nessun progetto attivo</h2>
      <p style={{ margin: 0, color: "#94a3b8", textAlign: "center", maxWidth: 320 }}>
        Nessun progetto è stato caricato su questo runtime.<br/>
        Contattare l'amministratore.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 20px", borderRadius: 6, background: "#1e293b",
          color: "#e2e8f0", border: "1px solid #334155", cursor: "pointer", fontSize: 14,
        }}
      >
        Riprova
      </button>
      <p style={{ margin: 0, fontSize: 12, color: "#475569", textAlign: "center" }}>
        Certificato TLS non ancora accettato?{" "}
        <a
          href={healthUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#64748b", textDecoration: "underline" }}
        >
          Apri {healthUrl}
        </a>
        {" "}e clicca "Avanzate → Procedi".
      </p>
    </div>
  );
}

// ── RuntimeViewer — top-level SPA for port 8443 ───────────────────────────────
//
// Anonymous access via optional_auth on 8443 (Viewer role by default).
// No login prompt, no project management — just the live synoptic.

export function RuntimeViewer() {
  const noActiveProject     = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject  = useAppStore((s) => s.setNoActiveProject);
  const setProject          = useAppStore((s) => s.setProject);
  const setPages            = useAppStore((s) => s.setPages);
  const setFaceplates       = useAppStore((s) => s.setFaceplates);
  const clearAuth           = useAppStore((s) => s.clearAuth);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);

  // On mount: detect whether a project is active and load its data.
  useEffect(() => {
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
      fontFamily: "system-ui, sans-serif", color: "#e2e8f0", background: "#0f172a",
    }}>
      <AlarmBanner />
      <RuntimeView />
    </div>
  );
}
