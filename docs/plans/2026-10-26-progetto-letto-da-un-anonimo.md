# Il progetto letto da un anonimo sulla porta del viewer

> **Seme — decisione.** Nato il 26-10-2026, lavorando al piano «dove se ne va il tempo».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita per sviscerarne
> tutti i dettagli.** Quello che segue sono le misure di oggi, non un disegno.

## Cosa si è visto

`check_rotte_preauth.sh` leggeva solo il **primo** gruppo `let open = Router::new()` di `router.rs`, quello del router
completo. Il gruppo aperto della **porta del viewer** (7443, `build_runtime_inner`) non l'aveva mai controllato
nessuno. Corretta la guardia, è comparsa una rotta mai dichiarata: **`GET /api/project`**.

Restituisce il progetto attivo **intero**, con i segreti mascherati (`mask_project_secrets`, la tabella di
`sws_core::segreti`), a chiunque raggiunga la 7443 del pannello senza credenziali. È voluto — il commento nel router
dice «Only /api/project (current active project status) is exposed on the runtime port» — perché il viewer anonimo ci
legge quello che gli serve.

Ma «segreti mascherati» non vuol dire «niente di riservato». Escono anche:

- la topologia dell'impianto: indirizzi e porte di PLC, broker, server OPC-UA, datastore;
- `notifications.destinatari_email`: indirizzi email di persone;
- **`notifications.reperibili`** (P4, da oggi): nomi, numeri di telefono e turni di chi è reperibile — dati
  personali, su una porta che sta sulla LAN dell'impianto.

## Le strade che si vedono

1. **Una vista ridotta per l'anonimo**: la stessa rotta restituisce solo i campi che il viewer usa (pagine, lingue,
   stile, cornici), come si è fatto per `/api/system` (versione ridotta per l'anonimo) e per `brand.json` (lista
   bianca `marchi::CAMPI_PUBBLICI`). È la forma già usata due volte nel progetto.
2. **Togliere solo i dati personali** (destinatari, reperibili) dalla risposta anonima. Più piccolo, ma è un elenco
   da tenere a mano, cioè la forma che `segreti.rs` ha dovuto sostituire nel 2f.
3. **Lasciare com'è, dichiarandolo** nel manuale (capitolo 17, Sicurezza): la 7443 non va esposta fuori dalla LAN.

Da misurare nella sessione di plan: quali campi di `/api/project` legge davvero il viewer web e quello LVGL, e chi
altro chiama quella rotta sulla 7443.
