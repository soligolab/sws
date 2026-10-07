import { avvia } from "./avvio";
import { Console } from "./console/Console";

// `apiLocale: true`: la console parla solo con il runtime che la serve. Non ha
// senso puntarla a un dispositivo remoto — amministra questa installazione.
avvia(Console, { apiLocale: true });
