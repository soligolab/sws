// Who is signed in, for the `{{user.*}}` placeholders of the pages (plan
// docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md, block B).
//
// The name to show and the previous login come from `whoami`, asked again
// whenever the session changes (a login, a logout, a deploy that renews it).
// The resolver of the texts reads them from `impostaUtenteDeiTesti`, and the
// objects of the page redraw because they read `authProfilo` from the store.
import { api } from "@/api/client";
import { impostaUtenteDeiTesti } from "@/i18n/projectI18n";
import { useAppStore } from "@/store";

let avviato = false;

function pubblica(): void {
  const st = useAppStore.getState();
  impostaUtenteDeiTesti(st.authUser ? {
    username: st.authUser,
    role: st.authRole,
    name: st.authProfilo?.name ?? null,
    lastLoginMs: st.authProfilo?.lastLoginMs ?? null,
  } : null);
}

function rileggi(): void {
  const st = useAppStore.getState();
  if (!st.authUser) {
    st.setAuthProfilo(null);
    return;
  }
  const chi = st.authUser;
  void api.whoami().then((me) => {
    if (useAppStore.getState().authUser !== chi) return;
    useAppStore.getState().setAuthProfilo({ name: me.display_name ?? null, lastLoginMs: me.previous_login_ms ?? null });
  }).catch(() => { /* the login name stands in for the name */ });
}

/** Started once per window (the IDE, the viewer): idempotent. */
export function avviaProfiloUtente(): void {
  if (avviato) return;
  avviato = true;
  let prima = { token: useAppStore.getState().authToken, user: useAppStore.getState().authUser };
  pubblica();
  rileggi();
  useAppStore.subscribe((st) => {
    if (st.authToken !== prima.token || st.authUser !== prima.user) {
      prima = { token: st.authToken, user: st.authUser };
      rileggi();
    }
    pubblica();
  });
}
