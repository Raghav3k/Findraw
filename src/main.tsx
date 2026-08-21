import React from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import "./styles/artist-mode.css";
import "./styles/mode-home.css";
import "./styles/workspace-identity.css";
import "./styles/auto-draw.css";
import "./styles/pickers.css";
import "./styles/room-mode.css";

import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


