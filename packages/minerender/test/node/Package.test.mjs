import test from "ava";
import { createRequire } from "node:module";
import { decode } from "fast-png";
import * as esm from "minerender/node";
import * as browser from "minerender/browser";

const cjs = createRequire(import.meta.url)("minerender/node");

test.after.always(() => {
    esm.shutdown();
    cjs.shutdown();
    browser.shutdown();
});

for (const [format, library] of [["ESM", esm], ["CJS", cjs]]) {
    test.serial(`${format} Node package creates a native renderer and exports PNG bytes`, async t => {
        t.is(typeof library.NodeRenderer, "function");
        t.false("NodeRenderer" in browser);
        const renderer = await library.NodeRenderer.create({ width: 12, height: 8 });
        try {
            renderer.renderer.setClearColor(0xff0000, 1);
            const png = await renderer.renderToBuffer();
            t.true(Buffer.isBuffer(png));
            const image = decode(png);
            t.deepEqual([image.width, image.height], [12, 8]);
            t.deepEqual(Array.from(image.data.subarray(0, 4)), [255, 0, 0, 255]);
        } finally {
            renderer.dispose();
        }
    });
}
