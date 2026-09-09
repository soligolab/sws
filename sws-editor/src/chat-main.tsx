// Entry point della finestra staccata della chat.
//
// Gemello di `log-main.tsx`, e l'ordine delle chiamate conta: vedi il commento
// su `setForceLocalApi`.

import { avvia } from "@/avvio";
import { ChatWindow } from "@/components/ChatWindow";

void avvia(ChatWindow, { apiLocale: true });
