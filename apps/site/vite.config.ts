import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);
const polyfillRequire = createRequire(require.resolve("vite-plugin-node-polyfills"));

/**
 * protodef (used by prismarine-nbt) compiles parsers with a direct `eval` that reads the
 * locals `native` and `PartialReadError`. Rollup does not treat `eval` as a use of those
 * locals and drops them, so the production build fails with "native is not defined".
 * Compiling through `new Function` with explicit parameters keeps them referenced.
 */
function protodefEvalScope(): Plugin {
    const target = "return eval(code)()";
    return {
        name: "protodef-eval-scope",
        enforce: "pre",
        transform(code, id) {
            if (!/[\\/]protodef[\\/]src[\\/]compiler\.js$/.test(id)) return;
            if (!code.includes(target)) this.error("protodef compiler.js changed; update protodefEvalScope()");
            return code.replace(target, 'return new Function("native", "PartialReadError", "return (" + code + ")")(native, PartialReadError)()');
        }
    };
}

export default defineConfig({
    plugins: [
        protodefEvalScope(),
        // Structure loading uses prismarine-nbt, which needs browser polyfills for zlib.
        nodePolyfills({
            overrides: {
                // readable-stream imports process/; resolve it to a file for Vite's dependency optimizer.
                process: polyfillRequire.resolve("process/browser.js")
            }
        })
    ],
    build: {
        target: "es2020",
        sourcemap: true
    },
    server: {
        port: 5176,
        strictPort: true
    }
});
