import { defineConfig, Options } from "tsup";
import { polyfillNode } from "esbuild-plugin-polyfill-node";

// Three passes, one per delivery format. They differ in which entry they start from, which is what
// makes the browser/Node split work: src/index.browser.ts registers the DOM EnvProvider and can
// never reach src/env/node, so `canvas`, `node-persist` and `image-size` stay out of the browser
// graph entirely. See src/Env.ts.

const shared: Options = {
    dts: true,
    sourcemap: true,
    splitting: false,
    // `yarn build` removes dist/ up front, so no pass has to clean up after another
    clean: false,
    // ts-deepmerge 2.x is CJS whose module.exports is `{ default: fn }`. TypeScript's
    // esModuleInterop unwraps that for a CJS build, but Node's ESM loader hands the wrapper back
    // untouched, so `import merge from "ts-deepmerge"` resolves to an object and every merge call
    // throws. Inlining it lets esbuild apply the interop at build time instead. It is ~1 KB.
    noExternal: ["ts-deepmerge"]
};

const browserDefines = {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production")
};

export default defineConfig([
    // ESM + CJS for bundlers (Vite, webpack, rollup). Dependencies stay external.
    {
        ...shared,
        name: "browser",
        entry: { index: "src/index.browser.ts" },
        outDir: "dist/browser",
        format: ["esm", "cjs"],
        platform: "browser",
        target: "es2020",
        external: ["three"],
        esbuildOptions(options) {
            options.define = { ...options.define, ...browserDefines };
        }
    },

    // ESM + CJS for headless Node.
    {
        ...shared,
        name: "node",
        entry: { index: "src/index.node.ts" },
        outDir: "dist/node",
        format: ["esm", "cjs"],
        platform: "node",
        target: "node16",
        // canvas is an optionalDependency - never inline it
        external: ["three", "canvas"]
    },

    // Self-contained <script> bundle exposing `window.MineRender`, for unpkg and the plain-HTML
    // demos. Everything is inlined here, three included, because there is no bundler downstream.
    {
        ...shared,
        name: "iife",
        entry: { bundle: "src/index.browser.ts" },
        outDir: "dist",
        format: ["iife"],
        globalName: "MineRender",
        platform: "browser",
        target: "es2020",
        dts: false,
        noExternal: [/.*/],
        // keep the historical dist/bundle.js path rather than tsup's default .global.js
        outExtension: () => ({ js: ".js" }),
        // structure loading goes through prismarine-nbt, which needs zlib - a standalone bundle
        // has to carry that itself. The bundler-facing builds above leave it to the consumer.
        esbuildPlugins: [polyfillNode()],
        esbuildOptions(options) {
            options.define = { ...options.define, ...browserDefines, global: "globalThis" };
        }
    }
]);
