import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

import { mockApiPlugin } from "./src/dev/mock-server.ts";

// Builds the terminal into one self-contained HTML file so AE2Controller.WebHandler (which only ever
// serves a single static resource per request) needs no change and no new HTTP route. The output is
// committed to src/main/resources/assets/ — see CLAUDE.md's "Web frontend" section for why.
//
// vite-plugin-singlefile only supports one HTML entry per build (documented wontfix), so the terminal
// and the login page are built as two separate invocations of this same config (`npm run build` runs
// `vite build` then `vite build --mode login`) rather than as one multi-input build.
const assetsDir = fileURLToPath(new URL("../src/main/resources/assets", import.meta.url));

// `example_website/index.php` serves its own copies of both pages (str_replace-substituting the same
// placeholder tokens - see index.php's own comments on each) - keep them byte-identical to the
// mod-served ones rather than maintaining a second implementation.
function copyToExampleWebsite(fileName: string): Plugin {
    const target = fileURLToPath(new URL(`../example_website/${fileName}`, import.meta.url));
    return {
        name: `ae2-copy-${fileName}-to-example-website`,
        apply: "build",
        async closeBundle() {
            await copyFile(join(assetsDir, fileName), target);
        },
    };
}

export default defineConfig(({ command, mode }) => {
    const isLogin = mode === "login";
    return {
        plugins: [
            preact(),
            viteSingleFile({ removeViteModuleLoader: true }),
            command === "serve" && mockApiPlugin(),
            command === "build" && copyToExampleWebsite(isLogin ? "login.html" : "webpage.html"),
        ],
        build: {
            outDir: assetsDir,
            emptyOutDir: false,
            rollupOptions: {
                input: fileURLToPath(new URL(isLogin ? "./login.html" : "./webpage.html", import.meta.url)),
            },
        },
    };
});
