import test from "ava";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import * as esm from "minerender/browser";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

const cjs = createRequire(import.meta.url)("minerender/browser");

test("package sideEffects entries match files", t => {
    const root = new URL("../", import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    for (const entry of pkg.sideEffects) {
        t.true(entry.includes("*")
            ? globSync(entry, { cwd: fileURLToPath(root) }).length > 0
            : existsSync(new URL(entry, root)), entry);
    }
});

test("an esbuild bundle of part of the browser build initializes what it imports", async t => {
    const result = buildSync({
        stdin: {
            contents: 'import { AssetKey } from "minerender/browser"; export default new AssetKey("a", "b").toNamespacedString();',
            resolveDir: fileURLToPath(new URL("./", import.meta.url))
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        external: ["zlib"],
        logLevel: "silent"
    });
    const module = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
    t.is(module.default, "a:b");
});

test("a code-split esbuild bundle of the browser build initializes AssetLoader.ROOT", async t => {
    const dir = mkdtempSync(join(tmpdir(), "minerender-split-"));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    buildSync({
        entryPoints: { index: resolve(import.meta.dirname, "../dist/browser/esm/index.browser.mjs") },
        bundle: true,
        splitting: true,
        outdir: dir,
        format: "esm",
        platform: "browser",
        external: ["zlib", "assert"],
        logLevel: "silent"
    });
    const module = await import(pathToFileURL(join(dir, "index.js")).href);
    t.is(module.AssetLoader.ROOT, module.DEFAULT_ROOT);
    t.is(typeof module.DEFAULT_ROOT, "string");
    t.true(module.DEFAULT_ROOT.length > 0);
});

test("a code-split esbuild bundle of the browser build parses NBT", async t => {
    const dir = mkdtempSync(join(tmpdir(), "minerender-split-"));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    buildSync({
        entryPoints: { index: resolve(import.meta.dirname, "../dist/browser/esm/index.browser.mjs") },
        bundle: true,
        splitting: true,
        outdir: dir,
        format: "esm",
        platform: "browser",
        // Use Node's Buffer so prismarine-nbt's instanceof checks match the global Buffer.
        external: ["zlib", "assert", "buffer"],
        // prismarine-nbt calls require("zlib"); esbuild's ESM output needs require in scope for external CommonJS requires.
        banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
        logLevel: "silent"
    });
    const module = await import(pathToFileURL(join(dir, "index.js")).href);
    const nbt = createRequire(import.meta.url)("prismarine-nbt");
    const bytes = nbt.writeUncompressed(nbt.comp({ answer: nbt.int(42) }));
    const parsed = await module.NBTHelper.fromBuffer(new Uint8Array(bytes));
    t.is(parsed.value.answer.value, 42);
    t.is(parsed.compression, "none");
});

test("every browser module can be imported first", async t => {
    const root = resolve(import.meta.dirname, "../dist/browser/esm");
    const files = globSync("**/*.mjs", { cwd: root })
        .filter(file => file !== "env/browser/section.worker.mjs");
    t.true(files.length > 0);
    const run = promisify(execFile);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < files.length) {
            const file = files[next++];
            const url = pathToFileURL(resolve(root, file)).href;
            await t.notThrowsAsync(run(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(url)})`],
                { timeout: 30000 }), file);
        }
    }));
});

test("browser bundles register their environment provider", async t => {
    const result = buildSync({
        stdin: {
            contents: 'import { Env } from "minerender/browser"; export default Env.provider.name;',
            resolveDir: fileURLToPath(new URL("./", import.meta.url))
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        external: ["zlib"],
        logLevel: "silent"
    });
    const module = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
    t.is(module.default, "browser");
    t.is(cjs.Env.provider.name, "browser");
});

test("renderer and skin static imports exclude non-skin modules and dependencies", t => {
    const root = resolve(import.meta.dirname, "../dist/browser/esm");
    const pending = ["renderer/Renderer.mjs", "skin/scene/SkinObject.mjs"].map(file => resolve(root, file));
    const visited = new Set(), bare = new Set();
    function walk() {
        while (pending.length) {
            const file = pending.pop();
            if (visited.has(file)) continue;
            visited.add(file);
            const source = readFileSync(file, "utf8");
            for (const match of source.matchAll(/^\s*(?:import\s+(?:[^"'();]+?\s+from\s+)?|export\s+[^"'();]+?\s+from\s+)["']([^"']+)["']/gm)) {
                const specifier = match[1];
                if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier));
                else bare.add(specifier);
            }
        }
    }
    walk();
    for (const file of ["model/scene/ModelObject.mjs", "model/block/scene/BlockObject.mjs",
        "entity/scene/EntityObject.mjs", "gui/scene/GuiObject.mjs", "UVMapper.mjs", "assets/AssetLoader.mjs"]) {
        t.false(visited.has(resolve(root, file)), file);
    }
    pending.push(resolve(root, "env/browser/register.mjs"));
    walk();
    for (const specifier of ["@zip.js/zip.js", "localforage", "buffer", "crypto-js",
        "three/examples/jsm/exporters/GLTFExporter.js"]) {
        t.false(bare.has(specifier), specifier);
    }
});

test("the section worker package export resolves to the built worker file", t => {
    const worker = import.meta.resolve("minerender/section.worker");
    t.is(worker, new URL("../dist/browser/esm/env/browser/section.worker.mjs", import.meta.url).href);
    t.true(existsSync(new URL(worker)));
});

for (const [format, library] of [["ESM", esm], ["CJS", cjs]]) {
    test(`${format} package exports geometry without browser globals`, t => {
        const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        t.is(library.SceneExporter.toObj(mesh).split("\n").filter(line => line.startsWith("f ")).length, 12);
        t.true(library.SceneExporter.toPLY(mesh).includes("element face 12"));
        mesh.geometry.dispose();
        mesh.material.dispose();
    });

    test(`${format} package exports produce stable hashes and image cache keys`, t => {
        const input = "MineRender 🐷";
        for (const algorithm of ["md5", "sha1", "sha256", "sha512"]) {
            t.is(library[algorithm](input), createHash(algorithm).update(input).digest("hex"));
        }
        t.is(library.serializeImageKey({ src: input }), createHash("md5").update(input).digest("hex"));
    });
}
