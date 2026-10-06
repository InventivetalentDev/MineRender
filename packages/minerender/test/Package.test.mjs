import test from "ava";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as esm from "minerender/browser";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

const cjs = createRequire(import.meta.url)("minerender/browser");

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
