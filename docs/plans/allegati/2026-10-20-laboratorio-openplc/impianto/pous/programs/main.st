PROGRAM main
  VAR
    comando_marcia AT %QX0.0 : BOOL;
    pompa_in_marcia AT %QX0.1 : BOOL;
    allarme_livello AT %QX0.2 : BOOL;
    livello AT %QW0 : INT;
    soglia_alta AT %QW1 : INT;
    portata AT %QW2 : INT;
    passo : INT;
  END_VAR

  (* Un valore iniziale su una variabile %QW non vale: la parte il buffer del protocollo. *)
  IF soglia_alta <= 0 THEN
    soglia_alta := 900;
  END_IF;

  passo := passo + 1;
  IF passo >= 5 THEN
    passo := 0;
    IF pompa_in_marcia THEN
      livello := livello + 1;
    ELSIF livello > 0 THEN
      livello := livello - 1;
    END_IF;
  END_IF;
  allarme_livello := livello >= soglia_alta;
  pompa_in_marcia := comando_marcia AND NOT allarme_livello;
  IF pompa_in_marcia THEN portata := 120; ELSE portata := 0; END_IF;
END_PROGRAM
