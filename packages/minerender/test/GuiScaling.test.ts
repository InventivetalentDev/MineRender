import test from "ava";
import type { BufferGeometry } from "three";
import { createGuiTextureGeometry } from "../src/gui/GuiTextureGeometry";
import type { GuiSpriteScaling } from "../src/MinecraftTextureMeta";

function quads(geometry: BufferGeometry, width: number, height: number) {
    const positions = geometry.getAttribute("position"), uvs = geometry.getAttribute("uv");
    const result: number[][] = [];
    for (let i = 0; i < positions.count; i += 4) {
        result.push([
            positions.getX(i) + width / 2, height / 2 - positions.getY(i),
            positions.getX(i + 3) - positions.getX(i), positions.getY(i) - positions.getY(i + 3),
            uvs.getX(i), 1 - uvs.getY(i), uvs.getX(i + 3), 1 - uvs.getY(i + 3)
        ].map(value => Math.round(value * 1e6) / 1e6));
    }
    geometry.dispose();
    return result.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

test("GUI tiles use logical dimensions and crop the last row and column", t => {
    const geometry = createGuiTextureGeometry(19, 9, 64, 32, undefined, { type: "tile", width: 8, height: 4 });
    t.deepEqual(quads(geometry, 19, 9), [
        [0, 0, 8, 4, 0, 0, 1, 1], [8, 0, 8, 4, 0, 0, 1, 1], [16, 0, 3, 4, 0, 0, 0.375, 1],
        [0, 4, 8, 4, 0, 0, 1, 1], [8, 4, 8, 4, 0, 0, 1, 1], [16, 4, 3, 4, 0, 0, 0.375, 1],
        [0, 8, 8, 1, 0, 0, 1, 0.25], [8, 8, 8, 1, 0, 0, 1, 0.25], [16, 8, 3, 1, 0, 0, 0.375, 0.25]
    ]);
});

const nineSlice: GuiSpriteScaling = {
    type: "nine_slice", width: 16, height: 16, border: { left: 2, top: 3, right: 4, bottom: 5 }
};

test("GUI nine-slice clips undersized borders and leaves unchanged axes unsliced", t => {
    const draw = (width: number, height: number) =>
        quads(createGuiTextureGeometry(width, height, 160, 160, undefined, nineSlice), width, height);
    t.deepEqual(draw(5, 7), [
        [0, 0, 2, 3, 0, 0, 0.125, 0.1875],
        [2, 0, 1, 3, 0.125, 0, 0.1875, 0.1875],
        [3, 0, 2, 3, 0.875, 0, 1, 0.1875],
        [0, 3, 2, 1, 0, 0.1875, 0.125, 0.25],
        [2, 3, 1, 1, 0.125, 0.1875, 0.1875, 0.25],
        [3, 3, 2, 1, 0.875, 0.1875, 1, 0.25],
        [0, 4, 2, 3, 0, 0.8125, 0.125, 1],
        [2, 4, 1, 3, 0.125, 0.8125, 0.1875, 1],
        [3, 4, 2, 3, 0.875, 0.8125, 1, 1]
    ]);
    t.deepEqual(draw(16, 7), [
        [0, 0, 16, 3, 0, 0, 1, 0.1875],
        [0, 3, 16, 1, 0, 0.1875, 1, 0.25],
        [0, 4, 16, 3, 0, 0.8125, 1, 1]
    ]);
    t.deepEqual(draw(5, 16), [
        [0, 0, 2, 16, 0, 0, 0.125, 1],
        [2, 0, 1, 16, 0.125, 0, 0.1875, 1],
        [3, 0, 2, 16, 0.875, 0, 1, 1]
    ]);
    t.deepEqual(draw(16, 16), [[0, 0, 16, 16, 0, 0, 1, 1]]);
});

test("GUI stretch_inner stretches every noncorner segment while retaining corner size", t => {
    const geometry = createGuiTextureGeometry(23, 21, 160, 160, undefined, { ...nineSlice, stretch_inner: true });
    t.deepEqual(quads(geometry, 23, 21), [
        [0, 0, 2, 3, 0, 0, 0.125, 0.1875],
        [2, 0, 17, 3, 0.125, 0, 0.75, 0.1875],
        [19, 0, 4, 3, 0.75, 0, 1, 0.1875],
        [0, 3, 2, 13, 0, 0.1875, 0.125, 0.6875],
        [2, 3, 17, 13, 0.125, 0.1875, 0.75, 0.6875],
        [19, 3, 4, 13, 0.75, 0.1875, 1, 0.6875],
        [0, 16, 2, 5, 0, 0.6875, 0.125, 1],
        [2, 16, 17, 5, 0.125, 0.6875, 0.75, 1],
        [19, 16, 4, 5, 0.75, 0.6875, 1, 1]
    ]);
});
