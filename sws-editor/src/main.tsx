import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import { RuntimeViewer } from "./viewer/RuntimeViewer";

// Port 8443 — runtime synoptic viewer (operator/anonymous).
// No project management, no canvas editor.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RuntimeViewer />
  </React.StrictMode>,
);
