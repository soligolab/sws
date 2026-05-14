import { useRef, useState } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

/**
 * Two header buttons + a hidden file input that round-trip a full
 * project (project.yaml + every synoptic) as a single ZIP.
 *
 * Admin only — the underlying endpoints require the Admin role. Hiding
 * the controls for non-Admin is purely cosmetic.
 */
export function ProjectIO() {
  const authRole = useAppStore((s) => s.authRole);
  const setProject = useAppStore((s) => s.setProject);
  const setPages = useAppStore((s) => s.setPages);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (authRole !== "Admin") return null;

  const onExport = async () => {
    setBusy("export");
    setStatus(null);
    try {
      const res = await api.exportProjectZip();
      const filename = filenameFromContentDisposition(res.headers.get("content-disposition"))
        ?? defaultFilename();
      const blob = await res.blob();
      triggerDownload(blob, filename);
      setStatus(`Esportato ${filename}`);
    } catch (e: any) {
      setStatus(`Errore export: ${String(e?.message ?? e)}`);
      console.warn("export failed", e);
    } finally {
      setBusy(null);
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const onImportClick = () => fileInput.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again refires
    if (!file) return;
    if (!confirm(
      "Sostituire l'intero progetto corrente?\n" +
      "I synoptic non inclusi nel bundle saranno eliminati.\n" +
      "Le password MQTT non sono incluse nel bundle: dovrai re-immetterle dopo l'import."
    )) return;

    setBusy("import");
    setStatus(null);
    try {
      await api.importProjectZip(file);
      // Refresh store from the server now that the new project is live.
      const project = await api.getProject();
      setProject(project);
      const names = await api.listSynoptics();
      if (names.length > 0) {
        const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
        setPages(pages, pages[0].id);
      } else {
        setPages([], "");
      }
      setStatus(`Importato ${file.name}`);
    } catch (err: any) {
      setStatus(`Errore import: ${String(err?.message ?? err)}`);
      console.warn("import failed", err);
    } finally {
      setBusy(null);
      setTimeout(() => setStatus(null), 6000);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onExport}
        disabled={busy !== null}
        title="Esporta il progetto come ZIP"
        style={btnStyle(busy === "export")}
      >
        {busy === "export" ? "Esporto…" : "Esporta"}
      </button>
      <button
        onClick={onImportClick}
        disabled={busy !== null}
        title="Importa un progetto da ZIP (sostituisce quello corrente)"
        style={btnStyle(busy === "import")}
      >
        {busy === "import" ? "Importo…" : "Importa"}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        onChange={onFileChosen}
        style={{ display: "none" }}
      />
      {status && (
        <span style={{
          color: status.startsWith("Errore") ? "#fca5a5" : "#86efac",
          fontSize: 11,
          marginLeft: 4,
          maxWidth: 280,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {status}
        </span>
      )}
    </div>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: active ? "#1e3a8a" : "#334155",
    color: "#cbd5e1",
    border: "1px solid #475569",
    borderRadius: 4,
    cursor: active ? "default" : "pointer",
    fontSize: 12,
  };
}

/** Pull `filename="..."` out of a Content-Disposition header. */
function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const m = /filename="([^"]+)"/.exec(cd);
  return m ? m[1] : null;
}

function defaultFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `sws-project-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}.zip`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Tiny delay before revoking — some browsers race when the click handler
  // returns synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
