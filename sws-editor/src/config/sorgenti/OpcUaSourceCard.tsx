import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { OpcUaAuth, OpcUaNodeMapping, OpcUaSource, TagDataType, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { emptyOpcUaNode } from "@/config/sorgenti/vuote";
import { OpcUaBrowseModal } from "@/config/sorgenti/OpcUaBrowseModal";
import { OpcUaEuromapModal } from "@/config/sorgenti/OpcUaEuromapModal";

// ── OPC-UA card ───────────────────────────────────────────────────────────────
//
// Mirrors the MqttSourceCard shape on purpose so the operator's mental
// model is the same across protocols. PoC scope: anonymous + username
// auth; security policy "None" wired end-to-end (other values stored in
// YAML for forward-compat, ignored by the plugin).

export function OpcUaSourceCard({
  source, onChange, onDelete, onCreateTag,
}: {
  source: OpcUaSource;
  onChange: (s: OpcUaSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  // Il tipo che il browse ha letto dal server, per node_id (23-10-2026).
  // Serve al «＋» di ogni riga: prima il tipo di un tag nuovo lo si sceglieva
  // a mano, e sceglierlo male non si vedeva finché il valore non arrivava
  // storto. Vive solo finché la scheda è aperta — non è roba da salvare nel
  // progetto, è quello che il server ha detto adesso.
  const [tipiDalServer, setTipiDalServer] = useState<Record<string, string>>({});
  const [browseOpen, setBrowseOpen] = useState(false);
  const [euromapOpen, setEuromapOpen] = useState(false);
  // Dal 23-10-2026 il trust store è **tutto Admin** (decisione 7 del piano dei
  // certificati): l'elenco era Supervisor mentre «Fidati» ed «Elimina» erano
  // Admin, e la mezza misura non reggeva — chi vede l'elenco vede le impronte
  // dei server a cui il progetto si collega. Il gate vero è sulle rotte; questo
  // serve perché un Supervisor veda una riga che spiega, invece di un 403.
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);

  const setField = <K extends keyof OpcUaSource>(k: K, v: OpcUaSource[K]) =>
    onChange({ ...source, [k]: v });

  const setAuth = (auth: OpcUaAuth) =>
    onChange({ ...source, auth });

  const setNode = (idx: number, patch: Partial<OpcUaNodeMapping>) =>
    onChange({
      ...source,
      nodes: source.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    });

  const addNode = () =>
    onChange({ ...source, nodes: [...source.nodes, emptyOpcUaNode()] });

  const removeNode = (idx: number) =>
    onChange({ ...source, nodes: source.nodes.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: open ? 12 : 0, cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{open ? "▼" : "▶"}</span>
          <span style={{ fontWeight: 600 }}>OPC-UA · {source.id}</span>
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{source.endpoint_url}</span>
        </div>
        <button
          style={S.btn("danger")}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >{t("common.delete")}</button>
      </div>

      {open && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={S.label}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>{t("cfg.endpointUrl")}</label>
              <input
                style={S.input}
                placeholder="opc.tcp://192.168.1.100:4840"
                value={source.endpoint_url}
                onChange={(e) => setField("endpoint_url", e.target.value)}
              />
            </div>
            <div>
              <label style={S.label}>{t("cfg.securityPolicy")}</label>
              <select
                style={S.input}
                value={source.security_policy}
                onChange={(e) => setField("security_policy", e.target.value)}
              >
                <option value="None">None (no crypto)</option>
                <option value="Basic128Rsa15">Basic128Rsa15 ({t("sorgenti.deprecato")})</option>
                <option value="Basic256">Basic256</option>
                <option value="Basic256Sha256">Basic256Sha256 ({t("sorgenti.raccomandato")})</option>
                <option value="Aes128Sha256RsaOaep">Aes128-SHA256-RsaOaep</option>
                <option value="Aes256Sha256RsaPss">Aes256-SHA256-RsaPss</option>
              </select>
            </div>
            <div>
              <label style={S.label}>{t("cfg.subInterval")}</label>
              <input
                type="number" min={50} step={50} style={S.input}
                value={source.subscription_interval_ms}
                onChange={(e) => setField("subscription_interval_ms", Number(e.target.value) || 500)}
              />
            </div>
          </div>

          {/* Auth ------------------------------------------------------- */}
          <div style={{ marginTop: 12, marginBottom: 6, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
            {t("sorgenti.autenticazione")}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={source.auth.kind === "anonymous"}
                onChange={() => setAuth({ kind: "anonymous" })}
              />
              {t("sorgenti.anonima")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={source.auth.kind === "username_password"}
                onChange={() => setAuth({ kind: "username_password", username: "" })}
              />
              {t("sorgenti.utentePassword")}
            </label>
          </div>
          {source.auth.kind === "username_password" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
              <div>
                <label style={S.label}>{t("cfg.username")}</label>
                <input
                  style={S.input}
                  value={source.auth.username}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    username: e.target.value,
                  })}
                />
              </div>
              <div>
                <label style={S.label}>{t("cfg.password")}</label>
                <input
                  type="password"
                  style={S.input}
                  placeholder={t("cfg.emptyIfPwdEnv")}
                  value={source.auth.password ?? ""}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    password: e.target.value || undefined,
                  })}
                />
              </div>
              <div>
                <label style={S.label}>{t("cfg.passwordEnvVar")}</label>
                <input
                  style={S.input}
                  placeholder="SWS_OPCUA_PWD"
                  value={source.auth.password_env ?? ""}
                  onChange={(e) => setAuth({
                    ...(source.auth as Extract<OpcUaAuth, { kind: "username_password" }>),
                    password_env: e.target.value || undefined,
                  })}
                />
              </div>
            </div>
          )}

          {/* Sicurezza -------------------------------------------------- */}
          <div style={{ marginTop: 12, marginBottom: 6, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
            {t("sorgenti.sicurezzaCertificati")}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={source.trust_all_certs ?? false}
              onChange={(e) => onChange({ ...source, trust_all_certs: e.target.checked })}
            />
            {t("cfgUi.opcuaAccettaTutti")}
          </label>
          {/* 15-10-2026 (CRA): il default è la fiducia al primo contatto, e il
              trust store si vede sempre — è lì che si conferma un certificato
              cambiato. */}
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8, lineHeight: 1.4 }}>
            {t("cfgUi.opcuaPrimoContatto")}
          </div>
          {/* Il trust store di questa sorgente si vede e si governa in
              Sicurezza → Certificati (25-10-2026, «una sezione per dato»),
              con soggetto e scadenza di ogni certificato e i due lati
              affiancati quando c'è un pannello collegato. Qui resta il perché
              di una tabella vuota e la strada per arrivarci. */}
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8, lineHeight: 1.4 }}>
            {source.security_policy === "None" ? `${t("cfgUi.trustStoreSenzaPolicy")} ` : ""}
            {t("certificati.daSorgente")}{" "}
            <button type="button" onClick={() => navigateToConfig("certificati")}
              style={{ background: "none", border: "none", padding: 0, color: "var(--brand-primary-testo, #3b82f6)", cursor: "pointer", fontSize: 11 }}>
              {t("certificati.apri")}
            </button>
          </div>

          {/* Nodes ------------------------------------------------------ */}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, fontWeight: 600 }}>
              NODI MONITORATI ({source.nodes.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                style={S.btn("ghost")}
                onClick={() => setBrowseOpen(true)}
                title={t("cfg.browseAddressSpace")}
              >{t("sorgenti.sfogliaServer")}</button>
              <button
                style={S.btn("ghost")}
                onClick={() => setEuromapOpen(true)}
                title={t("cfg.detectEuromap")}
              >{t("sorgenti.rilevaEuromap")}</button>
            </div>
          </div>
          {source.nodes.length === 0 ? (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, fontStyle: "italic", marginTop: 6 }}>
              {t("cfgUi.noNodesClickNodeTo")}
            </div>
          ) : (
            <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.tag")}</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.nodeId")}</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--brand-text-muted, #94a3b8)" }}>{t("cfg.description")}</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {source.nodes.map((n, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <TagInput
                          value={n.tag}
                          onChange={(v) => setNode(i, { tag: v })}
                          style={{ ...S.input, padding: "2px 6px", flex: 1 }}
                        />
                        <button
                          title={t("cfg.createNewTag")}
                          style={{ ...S.btn("ghost"), padding: "2px 6px" }}
                          onClick={() => setQuickCreate({ rowIdx: i, prefill: n.tag })}
                          // Il tipo letto dal server, se il browse l'ha visto.
                        >＋</button>
                      </div>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        style={{ ...S.input, padding: "2px 6px", fontFamily: "monospace" }}
                        placeholder="ns=2;s=Machine.CycleTime"
                        value={n.node_id}
                        onChange={(e) => setNode(i, { node_id: e.target.value })}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        style={{ ...S.input, padding: "2px 6px" }}
                        value={n.description ?? ""}
                        onChange={(e) => setNode(i, { description: e.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <button style={S.btn("danger")} onClick={() => removeNode(i)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 8 }}>
            <button style={S.btn("ghost")} onClick={addNode}>{t("sorgenti.piuNodo")}</button>
          </div>
        </>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          tipoSuggerito={
            (tipiDalServer[source.nodes[quickCreate.rowIdx]?.node_id ?? ""] as TagDataType | undefined)
          }
          onConfirm={(tag) => {
            onCreateTag(tag);
            setNode(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
      {browseOpen && (
        <OpcUaBrowseModal
          source={source}
          existingNodeIds={new Set(source.nodes.map((n) => n.node_id))}
          onClose={() => setBrowseOpen(false)}
          onImport={(picked) => {
            // Merge in the picked NodeIds, skipping any already present.
            const existing = new Set(source.nodes.map((n) => n.node_id));
            const fresh = picked
              .filter((p) => !existing.has(p.node_id))
              .map<OpcUaNodeMapping>((p) => ({
                tag: "",
                node_id: p.node_id,
                description: p.display_name || undefined,
              }));
            if (fresh.length > 0) {
              onChange({ ...source, nodes: [...source.nodes, ...fresh] });
            }
            setTipiDalServer((p) => {
              const n = { ...p };
              for (const x of picked) if (x.tipo) n[x.node_id] = x.tipo;
              return n;
            });
            setBrowseOpen(false);
          }}
        />
      )}
      {euromapOpen && (
        <OpcUaEuromapModal
          source={source}
          existingNodeIds={new Set(source.nodes.map((n) => n.node_id))}
          onClose={() => setEuromapOpen(false)}
          onCreateTag={onCreateTag}
          onImport={(picked, autoCreateTags) => {
            const existing = new Set(source.nodes.map((n) => n.node_id));
            const sid = source.id;
            const fresh = picked
              .filter((p) => !existing.has(p.node_id))
              .map<OpcUaNodeMapping>((p) => ({
                tag: autoCreateTags ? `${sid}.${p.suggested_tag_suffix}` : "",
                node_id: p.node_id,
                description: `Euromap ${p.spec} · ${p.description}`,
              }));
            if (fresh.length > 0) {
              onChange({ ...source, nodes: [...source.nodes, ...fresh] });
            }
            // Auto-create tags so the operator doesn't have to ＋ each row.
            if (autoCreateTags) {
              for (const p of picked) {
                if (existing.has(p.node_id)) continue;
                onCreateTag({
                  id: `${sid}.${p.suggested_tag_suffix}`,
                  description: `Euromap ${p.spec} · ${p.description}`,
                });
              }
            }
            setEuromapOpen(false);
          }}
        />
      )}
    </div>
  );
}
