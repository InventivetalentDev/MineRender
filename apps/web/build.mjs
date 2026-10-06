import * as esbuild from 'esbuild';
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import glob from "glob";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        serve: { type: "boolean", default: false },
        host: { type: "string", default: process.env.HOST || "0.0.0.0" },
        port: { type: "string", default: process.env.PORT ?? "3000" },
    },
});

const files = await new Promise((resolve, reject) => {
    glob("./src/**/script.ts", (error, files) => {
        if (error) reject(error);
        else resolve(files);
    });
});

const options = {
    platform: "browser",
    format: "esm",
    target: "es2020",
    entryPoints: files,
    bundle: true,
    outbase: "src",
    outdir: "src",
    define: {
        global: "globalThis",
    },
    outExtension: {
        ".js": ".bundle.js"
    },
    // Structure loading uses prismarine-nbt, which requires browser polyfills for zlib.
    plugins: [polyfillNode()],
    logLevel: "info",
};

if (values.serve) {
    const port = Number(values.port);
    if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Port must be an integer between 1 and 65535. Use --port 3000 or PORT=3000.");
    }
    const context = await esbuild.context(options);
    await context.watch();
    await context.serve({ servedir: "src", host: values.host, port });
} else {
    await esbuild.build(options);
}
