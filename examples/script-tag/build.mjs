import {copyFile, mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {context} from "esbuild";

const require = createRequire(import.meta.url);
const output = new URL("./dist/", import.meta.url);

await mkdir(output, {recursive: true});
await copyFile(new URL("./index.html", import.meta.url), new URL("index.html", output));
await copyFile(require.resolve("minerender/bundle"), new URL("bundle.js", output));

if (process.argv.includes("--serve")) {
    const server = await context({stdin: {contents: ""}, write: false});
    const {host, port} = await server.serve({
        servedir: fileURLToPath(output),
        host: "127.0.0.1",
        port: 5174
    });
    console.log(`Script-tag example: http://${host}:${port}`);
}
