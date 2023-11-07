import * as esbuild from 'esbuild';
import { polyfillNode } from "esbuild-plugin-polyfill-node";

await esbuild.build({
    platform: "browser",
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/bundle.js',
    resolveExtensions:['.tsc', '.ts','.js'],
    // external: ['THREE'],
    define: {
        'global': 'window',
    },
    loader: {
        ".node":"file"
    },
    globalName:"MineRender",
    plugins: [polyfillNode()],
});
setTimeout(() => process.exit(0), 100);