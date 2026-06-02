import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { setForceLocalApi } from "@/api/client";
import { App } from "./App";

// Port 8444 — full IDE (project management + canvas editor + ConfigView).
// Force all API calls to same-origin so localStorage sws.runtimeBaseUrl is ignored.
setForceLocalApi(true);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
