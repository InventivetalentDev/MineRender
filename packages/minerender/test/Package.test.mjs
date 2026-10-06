import test from "ava";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as esm from "minerender/browser";

const cjs = createRequire(import.meta.url)("minerender/browser");

for (const [format, library] of [["ESM", esm], ["CJS", cjs]]) {
    test(`${format} package exports produce stable hashes and image cache keys`, t => {
        const input = "MineRender 🐷";
        for (const algorithm of ["md5", "sha1", "sha256", "sha512"]) {
            t.is(library[algorithm](input), createHash(algorithm).update(input).digest("hex"));
        }
        t.is(library.serializeImageKey({ src: input }), createHash("md5").update(input).digest("hex"));
    });
}
