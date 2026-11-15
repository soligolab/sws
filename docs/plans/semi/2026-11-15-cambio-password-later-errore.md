# «Later» al cambio password obbligatorio: errore «password sbagliata» e operazione eseguita lo stesso

> Seme, non piano. Segnalato dal maintainer il 15-11-2026 sul TC620, dal pannello. Non prioritario: «possiamo
> sistemarlo dopo, ora voglio finire il lavoro sui TY».

## Il sintomo

Alla schermata del cambio password obbligatorio, se per sbaglio si scrive un carattere nel campo della vecchia
password, lo si cancella e si preme «Later» (Più tardi), il modulo dice che la password è sbagliata, ma l'operazione
è stata eseguita comunque (si entra).

## Quello che si è visto leggendo il codice (15-11-2026, senza riprodurlo)

- `sws-editor/src/components/ChangePasswordScreen.tsx`: «Più tardi» è un `button type="button"` che chiama
  `rimanda(false)` e non legge i campi. Il suo errore sarebbe «auth.pwChangeError», non «la vecchia password non è
  corretta» (`auth.pwOldWrong`), che compare solo dal ramo `submit`. Quindi con ogni probabilità sul pannello parte
  anche l'invio del modulo (per esempio un Invio della tastiera a schermo o il focus che si sposta), e il «Later»
  riesce mentre l'invio fallisce.
- `rimanda_cambio_password` in `sws-web/src/router.rs` non guarda la password: non può essere lui.
- Non so se il blocco si ripresenta senza aver toccato il campo (non provato).

## Primo passo

Riprodurlo sul TC620 con gli strumenti del browser (richieste fatte quando si preme «Later»), prima di toccare
codice.
