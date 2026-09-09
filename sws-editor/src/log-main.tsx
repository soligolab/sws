// Entry point della finestra staccata dei log.
//
// Gemello di `admin-main.tsx`, e l'ordine delle chiamate conta: vedi il
// commento su `setForceLocalApi`.

import { avvia } from "@/avvio";
import { LogWindow } from "@/components/LogWindow";

void avvia(LogWindow, { apiLocale: true });
