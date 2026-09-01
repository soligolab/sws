// Aprire un pannello dell'IDE in una finestra vera del browser.
//
// # Perché un helper e non `window.open` sul posto
//
// Nel repo ci sono già quattro `window.open` sparsi (`RuntimeView.tsx:304`,
// `ConfigView.tsx:8389` e `:8407`, `ViewerLink.tsx:106`), e sono tutti «apri un
// URL e dimenticalo»: nessuno tiene l'handle, nessuno riusa la finestra,
// nessuno si accorge che è stata chiusa. Per un pannello staccato serve
// l'opposto — finestra nominata, riusata, con un ciclo di vita — e di quello
// non c'era nessun precedente.
//
// # Il difetto che questo helper NON ripete
//
// `RuntimeView.tsx:302-305` fa una cosa sensata *per il suo caso*: se il popup
// è bloccato, naviga nella stessa scheda (`window.location.assign`). Per il
// viewer va bene. Per un pannello dell'editor è inaccettabile: porterebbe via
// la pagina che contiene il progetto in memoria e le modifiche non salvate.
//
// Quindi qui la regola è: **l'helper non naviga mai, e non decide cosa dire**.
// Riferisce `bloccata: true` e lascia al chiamante il messaggio, che è la sola
// parte che dipende da cosa si stava aprendo.

/** Cosa è successo alla richiesta di apertura. */
export interface EsitoFinestra {
  /** L'handle, o `null` se il browser ha rifiutato. */
  win: Window | null;
  /**
   * Il browser ha bloccato il popup. Include il caso `undefined`, che è quello
   * che restituisce jsdom nei test (dove `window.open` lancia «Not
   * implemented») — trattarlo come «riuscita» renderebbe verdi dei test su un
   * comportamento che in un browser vero non avviene.
   */
  bloccata: boolean;
  /** Era già aperta: si è solo riportata a fuoco, senza ricaricarla. */
  riusata: boolean;
}

export interface OpzioniFinestra {
  larghezza?: number;
  altezza?: number;
  /**
   * L'handle di un'apertura precedente. Se è ancora vivo si riusa **senza
   * ri-navigare**: riaprire lo stesso URL ricaricherebbe il documento, e per la
   * chat dell'assistente questo significa perdere la conversazione, che vive
   * nel WebSocket lato server e non è ripristinabile.
   */
  handle?: Window | null;
}

export function apriFinestra(
  url: string,
  nome: string,
  opz: OpzioniFinestra = {},
): EsitoFinestra {
  const { larghezza = 440, altezza = 720, handle = null } = opz;

  // 1. Riuso prima di tutto.
  if (handle && !handle.closed) {
    try {
      handle.focus();
    } catch {
      /* `focus()` può essere ignorata dal browser: non è un errore nostro */
    }
    return { win: handle, bloccata: false, riusata: true };
  }

  // 2. Apertura. Centrata sullo schermo in cui sta la finestra corrente, non
  //    sul primario: con due monitor la finestra deve nascere dove sta l'utente.
  const left = Math.round(window.screenX + (window.outerWidth - larghezza) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - altezza) / 2);
  const caratteristiche =
    `popup=yes,width=${larghezza},height=${altezza},left=${left},top=${top}`;

  // Niente `noopener`: con quello `window.open` restituisce sempre `null` e
  // perderemmo insieme il rilevamento del popup bloccato e `win.closed`, cioè
  // le due sole cose che ci servono. È same-origin, l'handle lo vogliamo.
  let win: Window | null | undefined;
  try {
    win = window.open(url, nome, caratteristiche);
  } catch {
    // jsdom lancia; un browser vero no. Vale come «bloccata».
    win = null;
  }

  return { win: win ?? null, bloccata: !win, riusata: false };
}

/**
 * Chiama `quando` la prima volta che la finestra risulta chiusa.
 *
 * Non esiste un evento affidabile per «la finestra figlia è stata chiusa»
 * (`pagehide` sul figlio arriva, ma non se il browser lo uccide), quindi si
 * sonda `closed` una volta al secondo. Costa niente e si ferma da sé al primo
 * scatto; il valore restituito annulla la sorveglianza, e va chiamato nel
 * cleanup dell'effetto che l'ha avviata.
 */
export function sorvegliaChiusura(win: Window, quando: () => void): () => void {
  const id = window.setInterval(() => {
    if (win.closed) {
      window.clearInterval(id);
      quando();
    }
  }, 1000);
  return () => window.clearInterval(id);
}
