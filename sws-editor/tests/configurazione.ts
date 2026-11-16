// La configurazione comune dei test (11-11-2026).
//
// Le attese di Testing Library (`findBy…`, `waitFor`) scadono di base a 1 s. A
// macchina carica — la suite intera, o una compilazione Rust in parallelo — due
// test (`abbinaPannelloCloud`, `avvisoAggiornamento`) fallivano una volta ogni
// cinque-sei giri: non per un difetto, ma perché il componente arrivava dopo il
// secondo. Il piano di manutenzione chiedeva di vederli fallire prima di
// toccarli: visti l'11-11, tutti e due con «Unable to find» su un elemento che
// compare dopo una promessa. Un test che aspetta una cosa vera resta veloce;
// uno che aspetta una cosa che non arriva fallisce lo stesso, solo più tardi.
import { configure } from "@testing-library/react";
import { afterAll } from "vitest";

configure({ asyncUtilTimeout: 5000 });

// Let React finish before jsdom goes away (16-11-2026). After a commit made
// outside `act()` — a store update that follows an `await` in a handler —
// React flushes the passive effects in a scheduler task (`setImmediate`), and
// that task starts by reading `window.event`. When the commit lands in the last
// moments of a file, the task is still queued while vitest tears the
// environment down, and it throws «window is not defined»: every test passes
// and the run is red. Seen with `logicaUnificata.test.tsx` the day the icons of
// the left panel became components that subscribe to the store (a passive
// effect each). Two turns of the event loop: one for a pending render, one for
// the passive effects it schedules. The real `setImmediate`, taken before any
// test can replace it: a file that ends with fake timers on would wait forever.
const realSetImmediate = globalThis.setImmediate;
afterAll(async () => {
  for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => realSetImmediate(resolve));
});
