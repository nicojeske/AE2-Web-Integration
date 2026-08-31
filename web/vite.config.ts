import { fileURLToPath, URL } from "node:url";

import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

import { mockApiPlugin } from "./src/dev/mock-server.ts";

// Builds the terminal into one self-contained HTML file so AE2Controller.WebHandler (which only ever
// serves a single static resource per request) needs no change and no new HTTP route. The output is
// committed to src/main/resources/assets/ — see REDESIGN_MILESTONES.md for why.
//
// login.html is intentionally NOT built here yet (M9 rebuilds it) - vite-plugin-singlefile only
// supports one HTML entry per build, and the old login.html keeps working untouched until then.
const assetsDir = fileURLToPath(new URL("../src/main/resources/assets", import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [preact(), viteSingleFile({ removeViteModuleLoader: true }), command === "serve" && mockApiPlugin()],
  build: {
    outDir: assetsDir,
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./webpage.html", import.meta.url)),
    },
  },
}));
