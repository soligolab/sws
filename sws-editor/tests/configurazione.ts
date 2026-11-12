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

configure({ asyncUtilTimeout: 5000 });
