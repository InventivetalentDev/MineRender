import * as esbuild from 'esbuild';
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import glob from "glob";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
    options: {
        serve: { type: "boolean", default: false },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "3000" },
    },
});

const files = await new Promise((resolve, reject) => {
    glob("./src/**/script.ts", (error, files) => {
        if (error) reject(error);
        else resolve(files);
    });
});

const options = {
    entryPoints: files,
    bundle: true,
    sourcemap: true,
    target: ['es2020'],
    outdir: 'src',
    entryNames: '[dir]/[name].bundle',
    format: 'esm',
    plugins: [
        polyfillNode({
            polyfills: { zlib: true },
        }),
    ],
    logLevel: "info",
};

if (args.serve) {
    const port = Number(args.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${args.port}`);
    const context = await esbuild.context(options);
    await context.watch();
    await context.serve({ servedir: "src", host: args.host, port });
} else {
    await esbuild.build(options);
}
