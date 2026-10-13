import test from "ava";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
