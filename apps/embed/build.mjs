import * as esbuild from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: {
    serve: { type: "boolean", default: false },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "3001" }
} });

if (!args.serve) await rm("dist", { recursive: true, force: true });
await mkdir("dist/embed", { recursive: true });
await copyFile("src/index.html", "dist/embed/index.html");
const options = {
    entryPoints: ["src/main.ts"],
    outfile: "dist/embed/main.js",
    bundle: true,
    minify: !args.serve,
    sourcemap: args.serve,
    format: "esm",
    target: "es2020",
    plugins: [polyfillNode({ polyfills: { zlib: true } })],
    logLevel: "info"
};

if (args.serve) {
    const port = Number(args.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${args.port}`);
    const context = await esbuild.context(options);
    await context.watch();
    await context.serve({ servedir: "dist", host: args.host, port });
} else {
    await esbuild.build(options);
}
