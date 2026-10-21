# Quando si consuma, e quando si libera, una licenza di pannello — seme

> Nato il 21-10-2026, chiudendo il piano
> [licenze, pannelli contesi, e cosa ci dice il loro numero](../archive/2026-10-21-licenze-e-pannelli-contesi.md).
> Due domande di quel piano sono state decise e attuate; questa è rimasta aperta per scelta del
> maintainer, perché `max_pannelli` può diventare una quota vera solo dopo che è decisa.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui c'è la domanda e le misure di oggi, non un progetto.

## La domanda

`max_pannelli` esiste nella tabella delle aziende, la console lo **mostra** accanto al numero vero
dal 21-10-2026, e non ferma niente. Per farlo valere servono due regole che oggi non ci sono:

- **quando si consuma**: all'abbinamento, o alla prima connessione del pannello?
- **quando si libera**: con un comando (chi lo dà?), dopo un tempo di silenzio (quanto?), o mai?

La seconda è quella che pesa. Un tetto che nessuno libera è un tetto che, prima o poi, blocca un
cliente che non ha fatto niente di male: ha cambiato tre pannelli in due anni e i vecchi sono in
un cassetto, contati come se fossero in campo.

## Cosa è misurato (21-10-2026)

- Una riga di `pannelli_abbinati.json` tiene `abbinato_ms` e `ultimo_ms`: **il tempo di silenzio
  è già misurabile**, nessun dato nuovo serve per una regola a tempo.
- Lo stato è `attivo | sospeso | bandito`. Non c'è «dismesso»: un pannello che non si userà più
  o resta attivo per sempre, o lo si bandisce — che però vuol dire un'altra cosa (non deve
  rientrare mai più, nemmeno riformattato).
- Il numero per azienda lo calcola `Abbinati::conta_di`, che conta **tutte** le righe
  dell'azienda, qualunque sia lo stato. Se la licenza dovesse contare solo gli attivi, è una riga
  di filtro.
- Il tetto dei **progetti aperti** è il precedente da guardare: è applicato dal gateway su ciò che
  gira in quel momento, quindi si libera da sé. Una licenza di pannello non ha quel vantaggio —
  un pannello spento è ancora un pannello comprato.

## Domande per la sessione di plan

- La licenza è sulla scatola (il seriale, che sopravvive al reset) o sull'abbinamento?
- Serve uno stato «dismesso», distinto da sospeso e da bandito, che libera il posto?
- Una regola a tempo («non si fa vivo da 90 giorni → libera il posto») è accettabile, o un
  pannello di scorta spento per sei mesi deve restare dell'azienda?
- Quando il tetto rifiuta, cosa vede chi sta abbinando: un errore, o la proposta di liberare un
  posto scegliendo quale pannello dismettere?
- Va deciso insieme alla Fase 5 del tronco cloud (registrazione, email, 2FA), che è l'altro pezzo
  di «un cliente vero con un contratto vero»?
