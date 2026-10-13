import { defineConfig, Options } from "tsup";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import type { Plugin } from "esbuild";
import { existsSync } from "node:fs";
import path from "node:path";

// The passes differ in which entry they start from, which is what
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
    // Three's exporters are ESM-only; inline them so the CJS entry stays require-compatible.
    noExternal: ["ts-deepmerge", /^three\/examples\/jsm\//]
};

const browserDefines = {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production")
};

// Keep relative imports as imports naming the emitted .mjs file, because Node resolves
// neither extensions nor directory indexes.
const perModule: Plugin = {
    name: "per-module",
    setup(build) {
        build.onResolve({ filter: /^\.\.?\// }, args => {
            if (args.kind === "entry-point") return;
            const base = path.resolve(args.resolveDir, args.path);
            const source = [base + ".ts", base + ".js", path.join(base, "index.ts")].find(file => existsSync(file));
            if (!source) return;
            let relative = path.relative(args.resolveDir, source).replace(/\.(ts|js)$/, ".mjs").replace(/\\/g, "/");
            if (!relative.startsWith(".")) relative = "./" + relative;
            return { path: relative, external: true };
        });
    }
};

export default defineConfig([
    // CJS for consumers using require. Dependencies stay external.
    {
        ...shared,
        name: "browser",
        entry: { index: "src/index.browser.ts", "section.worker": "src/env/browser/section.worker.ts" },
        dts: { entry: { index: "src/index.browser.ts" } },
        outDir: "dist/browser",
        format: ["cjs"],
        platform: "browser",
        target: "es2020",
        external: ["three"],
        esbuildOptions(options) {
            options.define = { ...options.define, ...browserDefines };
        }
    },

    // Preserve module boundaries so bundlers can remove unused browser code.
    {
        ...shared,
        name: "browser-esm",
        entry: [
            "src/**/*.ts", "src/**/*.js", "!src/**/*.d.ts", "!src/env/node/**",
            "!src/index.node.ts", "!src/env/browser/section.worker.ts", "!src/_model/**", "!src/lib/**"
        ],
        dts: { entry: { "index.browser": "src/index.browser.ts" } },
        outDir: "dist/browser/esm",
        format: ["esm"],
        platform: "browser",
        target: "es2020",
        noExternal: ["ts-deepmerge"],
        esbuildPlugins: [perModule],
        esbuildOptions(options) {
            options.define = { ...options.define, ...browserDefines };
        }
    },

    // BrowserEnv resolves the worker next to its own module.
    {
        ...shared,
        name: "browser-worker",
        entry: { "env/browser/section.worker": "src/env/browser/section.worker.ts" },
        outDir: "dist/browser/esm",
        format: ["esm"],
        platform: "browser",
        target: "es2020",
        dts: false,
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
        target: "node22",
        // Native modules are optional dependencies and remain outside the bundle.
        external: ["three", "canvas", "gl"]
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
