import { render } from "preact";

import { App } from "./App";
import "./styles/global.css";
import "./ui/components.css";
import "./app-shell.css";
import "./views/browser.css";
import "./views/jobs.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");
render(<App />, root);
