import test from "ava";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import { WrappedImage } from "../src/WrappedImage";

function wrap(width: number, height: number) {
    const regions: number[][] = [];
    const image = new WrappedImage({
        width, height,
        data: {
            getImageData(x: number, y: number, width: number, height: number) {
                regions.push([x, y, width, height]);
                return { width, height, data: new Uint8ClampedArray(width * height * 4) };
            }
        }
    } as ExtractableImageData);
    return { image, regions };
}

test("static textures have one frame covering the whole image", t => {
    for (const [width, height] of [[16, 16], [32, 16], [16, 24]]) {
        const { image, regions } = wrap(width, height);
        t.false(image.animated);
        t.is(image.frameCount, 1);
        const frame = image.getFrameSectionData(0);
        t.is(frame.width, width);
        t.is(frame.height, height);
        t.deepEqual(regions, [[0, 0, width, height]]);
    }
});

test("each animation frame extracts one square from its vertical strip", t => {
    const { image, regions } = wrap(16, 64);
    t.true(image.animated);
    t.is(image.frameCount, 4);
    for (const index of [0, 1, 3]) {
        const frame = image.getFrameSectionData(index);
        t.is(frame.width, 16);
        t.is(frame.height, 16);
    }
    t.deepEqual(regions, [[0, 0, 16, 16], [0, 16, 16, 16], [0, 48, 16, 16]]);
});

test("frame requests outside the strip clamp to its first or last frame", t => {
    const { image, regions } = wrap(16, 64);
    for (const index of [-1, 4, 99]) image.getFrameSectionData(index);
    t.deepEqual(regions, [[0, 0, 16, 16], [0, 48, 16, 16], [0, 48, 16, 16]]);

    const staticImage = wrap(32, 16);
    staticImage.image.getFrameSectionData(1);
    t.deepEqual(staticImage.regions, [[0, 0, 32, 16]]);
});
