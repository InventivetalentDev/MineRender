import { createRequire } from "node:module";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);
const polyfillRequire = createRequire(require.resolve("vite-plugin-node-polyfills"));

export default defineConfig({
    // Structure loading uses prismarine-nbt, which needs browser polyfills for zlib.
    plugins: [nodePolyfills({
        overrides: {
            // readable-stream imports process/; resolve it to a file for Vite's dependency optimizer.
            process: polyfillRequire.resolve("process/browser.js")
        }
    })],
    build: {
        target: "es2020",
        sourcemap: true
    },
    server: {
        port: 5176,
        strictPort: true
    }
});
