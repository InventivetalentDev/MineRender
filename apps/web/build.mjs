import * as esbuild from 'esbuild';
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import glob from "glob";
import { parseArgs } from "node:util";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

const { values: args } = parseArgs({
    options: {
        serve: { type: "boolean", default: false },
        production: { type: "boolean", default: false },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "3000" },
    },
});

if (args.production && args.serve) throw new Error("Use preview:cf to serve the production build.");

function findFiles(pattern) {
    return new Promise((resolve, reject) => {
        glob(pattern, (error, files) => {
            if (error) reject(error);
            else resolve(files);
        });
    });
}

function publicPath(path) {
    return path.startsWith("editor/") || path.startsWith("demo/") ? path : `demo/${path}`;
}

const sourcePath = file => relative("src", file).split(sep).join("/");
const files = await findFiles("./src/**/script.ts");

const options = {
    entryPoints: args.production ? files.map(file => ({ in: file, out: publicPath(sourcePath(file).replace(/\.ts$/, "")) })) : files,
    bundle: true,
    sourcemap: !args.production,
    minify: args.production,
    target: ['es2020'],
    outdir: args.production ? 'dist' : 'src',
    entryNames: '[dir]/[name].bundle',
    format: 'esm',
    define: {
        MINERENDER_PLAYGROUND_HOME: JSON.stringify(args.production ? "/demo/" : "../../"),
        MINERENDER_EMBED_URL: JSON.stringify(process.env.EMBED_URL ?? "https://beta.minerender.org/embed/"),
    },
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
    if (args.production) await rm("dist", { recursive: true, force: true });
    await esbuild.build(options);
    if (args.production) await Promise.all((await findFiles("./src/**/*.{html,css}")).map(async file => {
        const output = `dist/${publicPath(sourcePath(file))}`;
        await mkdir(dirname(output), { recursive: true });
        if (!file.endsWith(".html")) return copyFile(file, output);
        const html = (await readFile(file, "utf8")).replace(/\b(href|src)="([^"]+)"/g, (attribute, name, value) => {
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return attribute;
            const url = new URL(value, `https://build.invalid/${sourcePath(file)}`);
            return `${name}="/${publicPath(url.pathname.slice(1))}${url.search}${url.hash}"`;
        });
        await writeFile(output, html);
    }));
}
