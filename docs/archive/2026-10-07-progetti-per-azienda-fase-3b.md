# Fase 3b — i progetti stanno nell'azienda, e si indirizzano per azienda

> Dettaglio della **Fase 3b** del [tronco cloud](../plans/2026-10-05-cloud-utenti-aziende-spazi.md).
> La 3a — aziende e console — è chiusa e confermata a schermo il 07-10-2026.
> Ramo: `feat/progetti-per-azienda`.

## Cosa è già fatto (confermato a schermo dal maintainer)

1. **Ogni azienda ha la sua cartella** sotto la radice dei progetti; l'azienda **implicita** ha
   `cartella = ""`, cioè la radice stessa — così **nessun progetto esistente si è spostato**.
2. `is_external` non guarda più il solo genitore (`dir.parent() != Some(root)`) ma
   `!dir.starts_with(root)`: con le cartelle per azienda la vecchia regola avrebbe dichiarato
   «esterno» ogni progetto d'azienda.
3. L'elenco scandisce **due livelli** e raggruppa per azienda; il selettore dell'azienda compare
   solo a chi sta in più di una.
4. **Il confinamento mancava su `upload_project_zip`** — buco vivo da un mese, chiuso con
   `dentro_radice_nuovo` e presidiato da `check_confinamento.sh`.
5. **Il filtro per appartenenza**, che non c'era affatto: l'elenco serviva i progetti di *tutte* le
   aziende a chiunque fosse collegato. Ora `visibilita()` decide, ed è una funzione pura provata da
   sola. L'amministratore di piattaforma li vede tutti, contrassegnati.

## Il problema che resta, e che può perdere dati

**Il nome del progetto è la chiave, ovunque**:

| dove | com'è oggi |
|---|---|
| registro | `project_registry.rs:30` — `HashMap<String, KnownProjectEntry>`, chiave = nome |
| rotte | `/api/projects/:name/{open,rename,duplicate}`, `DELETE /api/projects/:name` |
| disco | la cartella si risolve dal nome |

Due aziende con un progetto «impianto» **si sovrascrivono a vicenda nel registro**: l'ultima che
lo apre vince, e l'altra si ritrova la voce puntata alla cartella sbagliata.

## La decisione (maintainer, 07-10-2026): l'azienda entra nell'indirizzo

Scelta fra tre opzioni presentate: nomi unici in tutta l'installazione (scartata — spazio di nomi
condiviso, e ad un'azienda verrebbe detto «nome già in uso» per un progetto che non può vedere),
maniglia opaca derivata dal percorso (scartata — indirizzi illeggibili), **azienda esplicita**.

```
POST /api/projects/acme/impianto/open
POST /api/projects/-/collaudo/open        «-» = azienda implicita, cioè la radice
registro:  "acme/impianto" -> /…/acme/impianto
```

Il segmento è la **cartella** dell'azienda, non il suo nome: la cartella è ciò che sta sul disco,
e il percorso è il fatto. `-` per l'implicita, che cartella non ne ha.

**Il guadagno vero non è l'unicità, è l'autorizzazione.** L'azienda si legge dall'indirizzo, prima
di toccare il disco: chi non vi appartiene prende **404** — non 403, che confermerebbe l'esistenza
di quello che non deve vedere. Oggi quel controllo non c'è su nessuna rotta che indirizzi un
progetto per nome: il filtro è solo nell'elenco, e **l'elenco non è una guardia**. Chi conosce il
nome lo apre lo stesso.

## Migrazione del registro

Le chiavi esistenti sono nomi nudi. All'apertura, una chiave senza `/` diventa `-/<nome>`: i
progetti di oggi stanno tutti nella radice o fuori di essa, e in tutti e due i casi l'azienda è
quella implicita. Nessun file da spostare, nessuna perdita se il file manca o è illeggibile — il
registro è già oggi una cache che si ricostruisce dalla scansione.

## Quello che questa fase **non** fa

- **Non fa rispettare le quote**: le colonne ci sono, il conteggio no. Resta per la 3c.

## Verifica

Definition of done di `CLAUDE.md`, più:

- `cargo test`: la migrazione del registro, e il rifiuto 404 a chi indirizza un progetto di
  un'azienda non sua.
- **Una guardia** che nessuna rotta indirizzi un progetto senza passare dal risolutore che
  verifica l'appartenenza — da provare rossa, come le altre tre di questo ramo.
- A schermo: due aziende con un progetto **dello stesso nome**, aperti a turno, ciascuno il suo.
