import * as esbuild from 'esbuild';
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import glob from "glob";

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

if (process.argv.includes("--serve")) {
    const context = await esbuild.context(options);
    await context.watch();
    await context.serve({ servedir: "src", host: "127.0.0.1", port: 3000 });
} else {
    await esbuild.build(options);
}
