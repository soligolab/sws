# La cartella `docs/sicurezza/`: cosa c'è e in che stato

> Indice dei documenti di sicurezza di SWS, quelli che servono al Cyber Resilience Act (regolamento (UE) 2024/2847).
> Nasce il 17-11-2026 con la [sessione 1 del lavoro sul CRA](../plans/2026-11-17-cra-1-testi-veri.md). Il piano di
> tutte le sessioni e il registro delle decisioni sono in
> [`2026-11-17-cra-sessioni-e-decisioni.md`](../plans/2026-11-17-cra-sessioni-e-decisioni.md).
>
> La guardia `scripts/check_security_docs.sh` controlla che ogni file di questa cartella sia elencato qui, con il suo
> nome esatto.

## I documenti che ci sono

| Documento | Cosa dice | Stato |
|---|---|---|
| [`procedura-art14.md`](procedura-art14.md) | Chi fa cosa e quando se una vulnerabilità di SWS è sfruttata davvero, o se c'è un incidente grave (art. 14) | in uso dal 15-10-2026 |
| [`valutazione-rischio.md`](valutazione-rischio.md) | La valutazione dei rischi (art. 13(2)-(3)): ambito, beni, attori, e lo stato di ogni requisito dell'Allegato I, parte I | **bozza** del 17-11-2026, **interna**: nomina difetti ancora aperti, e resta interna finché ne nomina uno che non sia già pubblico (decisione D5) |

## I documenti da scrivere

Non esistono ancora. La colonna «Quando» dice la sessione che li porta.

| Documento | Cosa dirà | Quando |
|---|---|---|
| `gestione-vulnerabilita.md` | Come si trovano, si valutano e si chiudono le vulnerabilità; SBOM; scansione; avvisi pubblici (Allegato I, parte II) | sessioni 5 e 6 |
| `periodo-di-supporto.md` | Quanto dura il supporto, con la data di fine, e perché (art. 13(8)) | sessioni 5 e 6 |
| `descrizione-prodotto.md` | Uso previsto, varianti, architettura, versioni (Allegato VII, punti 1 e 2) | sessione 7 |
| `requisiti-essenziali.md` | Requisito per requisito: la soluzione adottata e la prova (Allegato VII, punto 5) | sessione 7 |
| `rapporti-di-prova.md` | Le prove fatte per ogni versione (Allegato VII, punto 6) | sessione 7 |
| `dichiarazione-ue.md` | Il modello della dichiarazione UE di conformità (Allegato V) | sessione 7, si firma all'immissione sul mercato |

## I dati che può dare solo il maintainer

I documenti li lasciano come campi da riempire. Non si inventano.

- **Recapito postale** del fabbricante (Mauro Soligo, Soligonet).
- **Data di fine del supporto** (mese e anno), e la durata d'uso attesa del prodotto.
- **Repository pubblico o no**: `security.txt` e il manuale rimandano a GitHub per gli avvisi.
- **CSIRT coordinatore**: il nome va letto sull'elenco pubblicato da ENISA prima della prima notifica.
- **Data di immissione sul mercato** e nome ufficiale del prodotto.
- **Ruolo di Pixsys** quando preinstalla SWS o lo distribuisce col proprio marchio.
- **Accettazione dei rischi residui** della valutazione, con la firma.
