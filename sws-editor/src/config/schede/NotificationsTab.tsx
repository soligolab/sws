import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { NotificationConfig, SmtpConfig, TelegramConfig } from "@/types";
import { useAppStore } from "@/store";
import { TRANS_COMP, S, MASKED, SaveBar } from "@/config/comuni";

// ── Notifications tab ─────────────────────────────────────────────────────────

function emptySmtp(): SmtpConfig {
  return { host: "", from: "", port: 587, starttls: true };
}

export function NotificationsTab() {
  const { t } = useTranslation();
  const storeProject = useAppStore((s) => s.project);
  const updateProjectNotifications = useAppStore((s) => s.updateProjectNotifications);
  const initial = storeProject?.notifications ?? null;

  const [enabled, setEnabled] = useState<boolean>(initial?.smtp != null);
  const [smtp, setSmtp] = useState<SmtpConfig>(initial?.smtp ?? emptySmtp());
  const [tgEnabled, setTgEnabled] = useState<boolean>(initial?.telegram != null);
  const [tg, setTg] = useState<TelegramConfig>(initial?.telegram ?? { bot_token: "", chat_ids: [] });
  // Q57 — in che lingua parla una notifica. Una predefinita e, se serve, una
  // per canale: "" = «come la predefinita», che il runtime tratta come non
  // dichiarata. Fino al 18-09-2026 `notify_lang` non aveva nessun controllo qui
  // — si impostava solo a mano nel YAML — e **il salvataggio di questa scheda
  // lo cancellava**, perché il payload era `{ smtp, telegram }` e basta.
  const [notifyLang, setNotifyLang] = useState<string>(initial?.notify_lang ?? "");
  const [notifyLangEmail, setNotifyLangEmail] = useState<string>(initial?.notify_lang_email ?? "");
  const [notifyLangTg, setNotifyLangTg] = useState<string>(initial?.notify_lang_telegram ?? "");
  const lingueProgetto = storeProject?.languages?.langs ?? [];
  const linguaPrincipale = storeProject?.languages?.default ?? "";
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<{ id: string; label: string; type: string }[]>([]);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  // Chi è il bot del token: `null` = non ancora chiesto, stringa = errore.
  // Serve a dire all'utente **a chi** deve scrivere — senza, «manda /start al
  // bot» è una frase senza soggetto, e il 23-09-2026 nemmeno il maintainer,
  // che quel bot l'aveva creato, ha capito cosa doveva fare.
  const [bot, setBot] = useState<{ username: string; nome: string } | null>(null);
  const [botErrore, setBotErrore] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "L'utente ha toccato qualcosa in questa tab".
  //
  // NON si usa un confronto strutturale bozza-vs-store per decidere se la
  // sezione è da salvare: il token Telegram arriva mascherato dalle GET, quindi
  // una bozza appena montata può risultare "diversa" dallo store senza che
  // nessuno abbia modificato nulla — e da quando "Salva tutto" svuota le bozze
  // pendenti, quel disallineamento veniva scritto su disco. Con `tgEnabled`
  // falso il payload esce SENZA la sezione telegram e il backend cancella il
  // token salvato. È il bug per cui il token "spariva" dopo Salva tutto.
  const [touched, setTouched] = useState(false);

  // Il server rimanda il token come "********" quando ne ha uno salvato: è il
  // segnale che c'è, non un valore da riscrivere.
  const tokenSaved = tg.bot_token === MASKED;

  const patchSmtp = (patch: Partial<SmtpConfig>) => {
    setTouched(true);
    setSmtp((prev) => ({ ...prev, ...patch }));
  };
  const patchTg = (patch: Partial<TelegramConfig>) => {
    setTouched(true);
    setTg((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config: NotificationConfig | null = (enabled || tgEnabled)
        ? {
            smtp: enabled ? smtp : undefined,
            telegram: tgEnabled ? tg : undefined,
            notify_lang: notifyLang || undefined,
            notify_lang_email: notifyLangEmail || undefined,
            notify_lang_telegram: notifyLangTg || undefined,
          }
        : null;
      await api.saveNotifications(config);
      setTouched(false);
      // Keep the store in sync so switching tabs and returning shows the saved
      // config (the tab re-initialises from storeProject.notifications).
      updateProjectNotifications(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Test chiamando DIRETTAMENTE la Bot API di Telegram dal browser (invia header
  // CORS permissivi): così la prova funziona dal solo editor, senza dipendere da
  // un runtime attivo/raggiungibile. Richiede il token in chiaro (non mascherato).
  const handleTestTelegram = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (tg.chat_ids.length === 0) {
        setTestMsg(t("cfgUi.enterAtLeastOneChat"));
        return;
      }
      // Il token va al server così com'è: se è il placeholder (o vuoto) usa
      // quello salvato. Così la prova percorre la stessa catena degli allarmi.
      await api.testTelegram({ bot_token: tg.bot_token, chat_ids: tg.chat_ids });
      setTestMsg("✓ Messaggio inviato dal runtime.");
    } catch (e: unknown) {
      setTestMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  };

  // Rileva le chat che hanno scritto al bot, e invia il messaggio di prova,
  // passando **dal runtime**: il server risolve il token salvato quando la UI
  // non lo ha in chiaro (dopo un cambio di tab non lo ha mai, perché un
  // segreto non viene mai rimandato al browser).
  //
  // Prima entrambe le operazioni chiamavano l'API di Telegram dal browser.
  // Funzionavano solo appena dopo aver digitato il token — da cui il "perdo il
  // token" — e soprattutto provavano un percorso che non è quello di
  // produzione: gli allarmi partono dal runtime, non dal browser. È il motivo
  // per cui un test poteva passare mentre il dispositivo non aveva alcuna
  // configurazione.
  //
  // Auto-retry perché subito dopo un messaggio l'update può tardare qualche
  // secondo a comparire in getUpdates.
  /** Chiede chi è il bot. Si chiama quando il campo perde il fuoco e
   *  all'apertura se un token è già salvato: mai a ogni tasto, o sarebbe una
   *  richiesta a Telegram per lettera digitata. */
  const verificaBot = async () => {
    const tok = tg.bot_token.trim();
    if (tok === "" && !tokenSaved) { setBot(null); setBotErrore(null); return; }
    try {
      setBotErrore(null);
      setBot(await api.telegramBotIdentity(tg.bot_token));
    } catch (e: unknown) {
      setBot(null);
      setBotErrore(e instanceof Error ? e.message : String(e));
    }
  };

  // Un token già salvato: si chiede chi è il bot appena la scheda si apre, una
  // volta sola. Chi torna a guardare la configurazione vede subito a chi è
  // legata, senza dover toccare niente.
  const botChiesto = useRef(false);
  useEffect(() => {
    if (!tgEnabled || botChiesto.current || !tokenSaved) return;
    botChiesto.current = true;
    api.telegramBotIdentity(MASKED)
      .then(setBot)
      .catch((e: unknown) => setBotErrore(e instanceof Error ? e.message : String(e)));
  }, [tgEnabled, tokenSaved]);

  const handleDetectChats = async () => {
    setDetecting(true);
    setDetectMsg(null);
    setDetected([]);
    try {
      const attempts = 5;
      for (let i = 0; i < attempts; i++) {
        const chats = await api.detectTelegramChats(tg.bot_token);
        if (chats.length > 0) { setDetected(chats); return; }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
      }
      setDetectMsg(bot
        ? t("cfg.telegramNessunaChatConBot", { username: bot.username })
        : t("cfgUi.noChatsFoundSendStart"));
    } catch (e: unknown) {
      setDetectMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDetecting(false);
    }
  };

  const addChatId = (id: string) =>
    patchTg({ chat_ids: tg.chat_ids.includes(id) ? tg.chat_ids : [...tg.chat_ids, id] });

  return (
    <div style={S.section}>
      <SaveBar onSave={handleSave} saving={saving} saved={saved}
        section="notifications"
        dirty={touched} />
      <div style={S.sectionTitle}>{t("cfg.notifLang.title")}</div>
      <div style={S.notice}>{t("cfg.notifLang.notice")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 640, marginBottom: 20 }}>
        {([
          ["default", notifyLang, setNotifyLang, t("cfg.notifLang.default"), t("cfg.notifLang.projectMain", { lang: linguaPrincipale })],
          ["email", notifyLangEmail, setNotifyLangEmail, t("cfg.notifLang.email"), t("cfg.notifLang.asDefault")],
          ["telegram", notifyLangTg, setNotifyLangTg, t("cfg.notifLang.telegram"), t("cfg.notifLang.asDefault")],
        ] as const).map(([k, valore, imposta, etichetta, vuoto]) => (
          <label key={k} style={{ fontSize: 12 }}>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>{etichetta}</div>
            <select
              value={valore}
              onChange={(e) => { setTouched(true); imposta(e.target.value); }}
              style={{ ...S.input, width: "100%" }}
            >
              <option value="">{vuoto}</option>
              {lingueProgetto.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div style={S.sectionTitle}>NOTIFICHE EMAIL</div>
      <div style={S.notice}>
        <Trans i18nKey="cfgUi.smtpNotice" components={TRANS_COMP} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setTouched(true); setEnabled(e.target.checked); }}
          />
          Abilita notifiche SMTP
        </label>
      </div>

      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 640 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Host SMTP *</div>
            <input
              style={S.input}
              placeholder="smtp.example.com"
              value={smtp.host}
              onChange={(e) => patchSmtp({ host: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>{t("cfg.port")}</div>
            <input
              style={S.input}
              type="number"
              placeholder="587"
              value={smtp.port ?? ""}
              onChange={(e) => patchSmtp({ port: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Indirizzo From *</div>
            <input
              style={S.input}
              placeholder={t("cfgUi.alarmsExampleCom")}
              value={smtp.from}
              onChange={(e) => patchSmtp({ from: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Username SMTP</div>
            <input
              style={S.input}
              placeholder={t("cfg.optional")}
              value={smtp.username ?? ""}
              onChange={(e) => patchSmtp({ username: e.target.value || undefined })}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Password SMTP</div>
            <input
              style={S.input}
              type="password"
              placeholder={t("cfg.optional")}
              value={smtp.password ?? ""}
              onChange={(e) => patchSmtp({ password: e.target.value || undefined })}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={smtp.starttls ?? true}
                onChange={(e) => patchSmtp({ starttls: e.target.checked })}
              />
              STARTTLS (raccomandato su porta 587)
            </label>
          </div>
        </div>
      )}

      <div style={{ ...S.sectionTitle, marginTop: 24 }}>NOTIFICHE TELEGRAM</div>
      <div style={S.notice}>
        <Trans i18nKey="cfgUi.telegramNotice" components={TRANS_COMP} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={tgEnabled}
            onChange={(e) => { setTouched(true); setTgEnabled(e.target.checked); }}
          />
          Abilita notifiche Telegram
        </label>
      </div>

      {tgEnabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, maxWidth: 640 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Bot token *</span>
              {tokenSaved && (
                <span style={{ color: "var(--brand-success, #22c55e)", fontSize: 11 }}>
                  {t("cfgUi.savedOnTheServer")}
                </span>
              )}
            </div>
            {/* Il token arriva mascherato dalle GET: mostrare "********" nel
                campo faceva sembrare che il dato fosse andato perso. Meglio un
                campo vuoto che dice esplicitamente com'è la situazione. */}
            <input
              style={S.input}
              type="password"
              placeholder={tokenSaved ? t("cfgUi.alreadySavedWriteHereOnly") : "123456789:ABCdef..."}
              value={tokenSaved && tg.bot_token === MASKED ? "" : tg.bot_token}
              onChange={(e) => patchTg({ bot_token: e.target.value })}
              onBlur={verificaBot}
            />
            {/* I due passi, PRIMA di premere. Il messaggio d'errore li diceva
                dopo il fallimento e senza nominare il bot: chi configura non
                sapeva a chi scrivere. Col link la chat si apre da qui. */}
            {(bot || botErrore) && (
              <div style={{
                marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: 12, lineHeight: 1.6,
                border: `1px solid ${botErrore ? "var(--brand-danger, #ef4444)" : "var(--brand-surface-2, #334155)"}`,
                background: "var(--brand-bg, #0f172a)",
              }}>
                {botErrore ? (
                  <span style={{ color: "var(--brand-danger-soft, #fca5a5)" }}>
                    {t("cfg.telegramBotNonRaggiunto", { errore: botErrore })}
                  </span>
                ) : bot && (
                  <>
                    <div style={{ color: "var(--brand-success, #22c55e)", marginBottom: 4 }}>
                      {t("cfg.telegramBotTrovato", { nome: bot.nome, username: bot.username })}
                    </div>
                    <div style={{ color: "var(--brand-text-muted, #94a3b8)" }}>
                      1. {t("cfg.telegramPasso1")}{" "}
                      <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer"
                         style={{ color: "var(--brand-primary, #3b82f6)" }}>
                        t.me/{bot.username}
                      </a>
                      <br />
                      2. {t("cfg.telegramPasso2")}
                    </div>
                  </>
                )}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <button
                style={S.btn("ghost")}
                onClick={handleDetectChats}
                disabled={detecting || (tg.bot_token.trim() === "" && !tokenSaved)}
                title={t("cfg.telegramGetUpdatesTitle")}
              >
                {detecting ? "Rilevamento…" : "Rileva chat"}
              </button>
              {detectMsg && (
                <span style={{ fontSize: 11, color: detectMsg.startsWith("✗") ? "var(--brand-danger, #ef4444)" : "var(--brand-text-muted, #94a3b8)" }}>
                  {detectMsg}
                </span>
              )}
            </div>
            {detected.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, overflow: "hidden" }}>
                {detected.map((c) => {
                  const added = tg.chat_ids.includes(c.id);
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                      <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)", flex: 1 }}>
                        {c.label} <span style={{ color: "var(--brand-text-subtle, #64748b)", fontFamily: "monospace" }}>· {c.id} · {c.type}</span>
                      </span>
                      <button
                        style={{ ...S.btn("ghost"), padding: "2px 10px", fontSize: 12 }}
                        onClick={() => addChatId(c.id)}
                        disabled={added}
                      >
                        {added ? "✓ aggiunta" : t("cfgUi.add2")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>{t("cfgUi.chatIdOnePerLine")}</div>
            <textarea
              style={{ ...S.input, minHeight: 60, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
              placeholder={"-1001234567890\n123456789"}
              value={tg.chat_ids.join("\n")}
              onChange={(e) => patchTg({ chat_ids: e.target.value.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean) })}
              spellCheck={false}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={S.btn("ghost")}
              onClick={handleTestTelegram}
              disabled={testing || (tg.bot_token.trim() === "" && !tokenSaved) || tg.chat_ids.length === 0}
            >
              {testing ? "Invio…" : "Invia test"}
            </button>
            {testMsg && (
              <span style={{ fontSize: 12, color: testMsg.startsWith("✓") ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
                {testMsg}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.7, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: "10px 12px" }}>
            <strong style={{ color: "var(--brand-text-2, #cbd5e1)" }}>Come configurare</strong>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li><Trans i18nKey="cfgUi.telegramStep1" components={TRANS_COMP} /></li>
              <li><Trans i18nKey="cfgUi.telegramStep2" components={TRANS_COMP} /></li>
              <li><Trans i18nKey="cfgUi.telegramStep3" components={TRANS_COMP} /></li>
              <li><Trans i18nKey="cfgUi.telegramStep4" components={TRANS_COMP} /></li>
            </ol>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger, #ef4444)", fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
