import { render } from "preact";

import { Login } from "./Login";
import "../styles/global.css";
import "../ui/components.css";
import "./login.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");
render(<Login />, root);
