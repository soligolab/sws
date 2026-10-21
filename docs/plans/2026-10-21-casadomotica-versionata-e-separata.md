# CasaDomotica: versionarla, e separarla dall'impianto vero — seme

> Nato il 21-10-2026, quando il piano
> [CasaDomotica progetto di riferimento](../archive/2026-10-16-casadomotica-progetto-di-riferimento.md)
> è andato in archivio: la **pratica** è diventata una regola di `CLAUDE.md`, e le due domande
> che quel piano lasciava aperte sono uscite qui.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui ci sono le domande e le misure di quando sono nate, non un
> progetto.

## Le due domande

**1. CasaDomotica non è nel repo.** I gemelli `demo-items-*` sono versionati e viaggiano con
git; CasaDomotica vive sul VPS e basta. Come riferimento del prodotto è un punto debole: una
sessione su un'altra macchina non lo vede, e se il VPS si perde restano solo le copie di
sicurezza. I **540 MB di storico** escludono di metterlo in git com'è — ma il **disegno**
(`project.yaml` più le pagine) sono poche centinaia di kilobyte. Da decidere se e dove
esportarlo periodicamente, e con che cosa: il git di progetto esiste già
([git nel cloud](../archive/2026-10-15-git-nel-cloud.md)), e potrebbe essere la risposta senza
scrivere niente di nuovo.

**2. È anche l'impianto di casa del maintainer.** Usarlo come banco di prova vuol dire fare
esperimenti su qualcosa che gira davvero — luci, tapparelle, allarmi. Da decidere se serve una
copia di lavoro separata e, se sì, come tenerla allineata senza raddoppiare il lavoro, che è
esattamente il motivo per cui l'idea del progetto unico era nata.

## Perché le due domande sono una sola

Se la risposta alla prima è «si esporta il disegno nel git di progetto», la seconda ha già
metà risposta: la copia di lavoro è un clone di quel disegno senza lo storico, e l'allineamento
è un `pull`. Se invece la risposta è «si copia a mano ogni tanto», allora la copia separata
costa il doppio e conviene non farla. Vanno decise insieme.

## Domande per la sessione di plan

- Si esporta il disegno (poche centinaia di kB) o tutto, storico compreso?
- Ogni quanto, e chi lo fa partire: un giro automatico, il deploy, o le mani del maintainer?
- La copia di lavoro vive sul VPS accanto all'originale, o sul server di sviluppo?
- Un esperimento che rompe la copia di lavoro deve poter essere riportato sull'impianto vero, o
  i due rami non si ricongiungono mai?
