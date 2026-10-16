import test from "ava";
import { BoxGeometry, Matrix4 } from "three";
import { buildSectionGeometry, SectionGeometryInput, SectionTemplateData, sectionGeometryTransferables } from "../src/world/SectionGeometry";

function template(atlas: number, rotated = false, quads = 6): SectionTemplateData {
    const geometry = new BoxGeometry(16, 16, 16);
    if (rotated) geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
    const result = {
        quads,
        positions: new Float32Array(geometry.getAttribute("position").array.slice(0, quads * 12)),
        normals: new Float32Array(geometry.getAttribute("normal").array.slice(0, quads * 12)),
        uvs: new Float32Array(geometry.getAttribute("uv").array.slice(0, quads * 8)),
        uvBounds: new Float32Array(Array.from({ length: quads * 4 }, () => rotated ? [0.25, 0.25, 0.75, 0.75] : [0, 0, 1, 1]).flat()),
        colors: new Float32Array(Array.from({ length: quads * 4 }, () => rotated ? [0.25, 0.5, 0.75] : [1, 1, 1]).flat()),
        indices: new Uint16Array(Array.from(geometry.getIndex()!.array).slice(0, quads * 6).map((index, offset) => index - Math.floor(offset / 6) * 4)),
        cullFaces: new Uint8Array([1, 2, 4, 8, 16, 32].slice(0, quads)),
        atlas, layer: 0
    };
    geometry.dispose();
    return result;
}

function input(): SectionGeometryInput {
    return {
        count: 3, indices: new Uint16Array([1, 16, 256]), templates: new Uint16Array([0, 1, 0]), cullMasks: new Uint8Array([1, 0, 63]),
        templateData: [template(0, true), template(1)], atlases: [{ width: 2, height: 2, animated: false }, { width: 2, height: 2, animated: false }], maxAtlasSize: 4
    };
}

test("section geometry retains baked rotation, tint and atlas UVs", t => {
    const source = input();
    const original = structuredClone(source);
    const pages = buildSectionGeometry(source);
    t.is(pages.length, 1);
    const page = pages[0];
    t.is(page.positions.length / 3, 44);
    t.is(page.indices.length, 66);
    t.deepEqual(Array.from(page.blockIndices), [...Array(5).fill(1), ...Array(6).fill(16)]);
    const positions = Array.from({ length: 3 }, (_, axis) => Array.from(page.positions).filter((_, index) => index % 3 === axis));
    t.deepEqual(positions.map(axis => Math.min(...axis)), [-8, -8, -8]);
    t.deepEqual(positions.map(axis => Math.max(...axis)), [24, 8, 24]);
    t.true(Math.abs(page.normals[2] - 1) < 1e-6);
    t.deepEqual(Array.from(page.colors.slice(0, 3)), [0.25, 0.5, 0.75]);
    t.deepEqual(Array.from(page.colors.slice(-3)), [1, 1, 1]);
    t.deepEqual(Array.from(page.shade), Array(44).fill(1));
    t.deepEqual([page.width, page.height], [4, 2]);
    t.deepEqual(page.placements, [{ atlas: 0, x: 0, y: 0 }, { atlas: 1, x: 2, y: 0 }]);
    t.deepEqual(Array.from(page.uvs.slice(0, 2)), [0, 1]);
    t.deepEqual(Array.from(page.uvs.slice(40, 42)), [0.5, 1]);
    t.deepEqual(Array.from(page.uvBounds.slice(0, 4)), [0.125, 0.25, 0.375, 0.75]);
    t.deepEqual(Array.from(page.uvBounds.slice(80, 84)), [0.5, 0, 1, 1]);
    t.deepEqual(Array.from(page.indices.slice(0, 6)), [0, 2, 1, 2, 3, 1]);
    t.deepEqual(source, original);
});

test("section geometry preserves visible shade flags without changing tint, light or ambient occlusion", t => {
    const source = input();
    source.light = new Uint8Array(5832).fill(10);
    source.ambientOcclusion = new Uint8Array(5832).fill(1);
    const [baseline] = buildSectionGeometry(source);
    source.templateData[0].shade = new Float32Array([0, 1, 0, 1, 0, 1].flatMap(value => Array(4).fill(value)));
    const original = structuredClone(source);
    const [page] = buildSectionGeometry(source);
    t.deepEqual(Array.from(page.shade), [...[1, 0, 1, 0, 1].flatMap(value => Array(4).fill(value)), ...Array(24).fill(1)]);
    t.deepEqual({ ...page, shade: baseline.shade }, baseline);
    t.deepEqual(source, original);
});

test("section geometry pages overflowing atlases and retains untagged faces", t => {
    const source = input();
    source.maxAtlasSize = 2;
    source.cullMasks.fill(63);
    for (const template of source.templateData) template.cullFaces[0] = 0;
    const pages = buildSectionGeometry(source);
    t.is(pages.length, 2);
    t.deepEqual(pages.map(page => [page.width, page.height]), [[2, 2], [2, 2]]);
    t.deepEqual(pages.map(page => page.indices.length), [12, 6]);
    t.deepEqual(pages.map(page => Array.from(page.blockIndices)), [[1, 256], [16]]);
    t.deepEqual(pages.map(page => page.placements), [[{ atlas: 0, x: 0, y: 0 }], [{ atlas: 1, x: 0, y: 0 }]]);
});

test("section geometry exposes every output array buffer for transfer", t => {
    const source = input();
    source.maxAtlasSize = 2;
    const pages = buildSectionGeometry(source);
    const buffers = sectionGeometryTransferables(pages);
    t.is(buffers.length, pages.length * 8);
    let index = 0;
    for (const page of pages) {
        for (const array of [page.positions, page.normals, page.uvs, page.uvBounds, page.colors, page.shade, page.indices, page.blockIndices]) t.is(buffers[index++], array.buffer);
    }
});

test("section geometry keeps both untagged quads under a full cull mask", t => {
    const source = input();
    source.count = 1;
    source.templateData = [template(0, false, 2)];
    source.templateData[0].cullFaces.fill(0);
    source.cullMasks.fill(63);
    const pages = buildSectionGeometry(source);
    t.is(pages.length, 1);
    t.is(pages[0].positions.length, 24);
    t.deepEqual(Array.from(pages[0].indices), [0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
});

test("section geometry packs solid pages before translucent pages", t => {
    const source = input();
    source.templateData[0].layer = 1;
    const pages = buildSectionGeometry(source);
    t.deepEqual(pages.map(page => page.layer), [0, 1]);
    t.deepEqual(pages.map(page => page.placements), [[{ atlas: 1, x: 0, y: 0 }], [{ atlas: 0, x: 0, y: 0 }]]);
    t.deepEqual(pages.map(page => page.indices.length), [36, 30]);
});

test("section geometry gives animated atlases separate pages after static pages in atlas order", t => {
    const source = input();
    source.templateData.push(template(2));
    source.atlases.push({ width: 2, height: 2, animated: true });
    source.atlases[0].animated = true;
    source.templates.set([2, 1, 0]);
    source.cullMasks.fill(0);
    const pages = buildSectionGeometry(source);
    t.deepEqual(pages.map(page => page.placements), [
        [{ atlas: 1, x: 0, y: 0 }], [{ atlas: 0, x: 0, y: 0 }], [{ atlas: 2, x: 0, y: 0 }]
    ]);
    t.deepEqual(pages.map(page => [page.width, page.height]), [[2, 2], [2, 2], [2, 2]]);
});

test("section fluid pages emit only inner cells and map both sprites and tint", t => {
    const source = input();
    source.count = 0;
    source.maxAtlasSize = 8;
    source.atlases.push({ width: 8, height: 4, animated: true });
    const cells = new Uint8Array(5832);
    const cell = (x: number, y: number, z: number) => (y + 1) * 324 + (z + 1) * 18 + x + 1;
    source.fluids = { cells, water: { atlas: 2, still: [0, 0, 2, 2], flow: [4, 0, 4, 4], tint: [0.25, 0.5, 0.75] } };
    cells[cell(-1, 3, 4)] = 16;
    t.deepEqual(buildSectionGeometry(source), []);
    cells[cell(-1, 3, 4)] = 0;
    cells[cell(0, 3, 4)] = 16;
    const [page] = buildSectionGeometry(source);
    t.is(page.layer, 2);
    t.deepEqual([page.width, page.height], [8, 4]);
    t.deepEqual(page.placements, [{ atlas: 2, x: 0, y: 0 }]);
    t.is(page.indices.length, 36);
    t.deepEqual(Array.from(page.shade), Array(24).fill(1));
    t.deepEqual(Array.from(page.blockIndices), Array(6).fill(832));
    t.is(page.positions[0], -8);
    t.is(page.positions[2], 56);
    t.deepEqual(Array.from(page.indices.slice(0, 6)), [0, 1, 2, 0, 2, 3]);
    for (let vertex = 0; vertex < page.positions.length / 3; vertex++) {
        const bounds = vertex < 8 ? [0, 0.5, 0.25, 1] : [0.5, 0, 1, 1];
        t.deepEqual(Array.from(page.uvBounds.slice(vertex * 4, vertex * 4 + 4)), bounds);
        t.true(page.uvs[vertex * 2] >= bounds[0] && page.uvs[vertex * 2] <= bounds[2]);
        t.true(page.uvs[vertex * 2 + 1] >= bounds[1] && page.uvs[vertex * 2 + 1] <= bounds[3]);
        t.deepEqual(Array.from(page.colors.slice(vertex * 3, vertex * 3 + 3)), [0.25, 0.5, 0.75]);
    }
    cells[cell(-1, 3, 4)] = cells[cell(-1, 4, 4)] = 16;
    const [border] = buildSectionGeometry(source);
    t.is(border.indices.length, 30);
    t.deepEqual(Array.from(border.blockIndices), Array(5).fill(832));
    t.true(border.positions[1] > page.positions[1]);
    t.true(Math.abs(border.positions[1] - (48 + 8 - 0.016)) < 1e-5);
    cells.fill(16);
    t.deepEqual(buildSectionGeometry(source), []);
    cells.fill(0);
    cells[cell(0, 3, 4)] = 16;
    cells[cell(1, 3, 4)] = 32 | 128;
    t.deepEqual(buildSectionGeometry(source).map(page => page.placements), [[{ atlas: 2, x: 0, y: 0 }]]);
    cells[cell(1, 3, 4)] = 32;
    source.atlases.push({ width: 8, height: 4, animated: false });
    source.fluids.lava = { ...source.fluids.water!, atlas: 3 };
    t.deepEqual(buildSectionGeometry(source).map(page => page.placements), [[{ atlas: 3, x: 0, y: 0 }], [{ atlas: 2, x: 0, y: 0 }]]);
});

test("section geometry rejects invalid fluid neighborhoods and missing fluid atlases", t => {
    const source = input();
    source.fluids = { cells: new Uint8Array(5831) };
    t.throws(() => buildSectionGeometry(source), {
        instanceOf: RangeError, message: "Section fluid cells must cover an 18×18×18 neighborhood"
    });
    source.fluids.cells = new Uint8Array(5832);
    source.fluids.cells[343] = 32;
    t.throws(() => buildSectionGeometry(source), {
        instanceOf: RangeError, message: "Section fluid input lacks the atlas for a present fluid"
    });
});

test("section geometry validates every template array against its quad count", t => {
    const source = input();
    const data = source.templateData[0];
    data.shade = new Float32Array(data.quads * 4).fill(1);
    for (const field of ["positions", "normals", "uvs", "uvBounds", "colors", "shade", "indices", "cullFaces"] as const) {
        t.throws(() => buildSectionGeometry({ ...source, templateData: [{ ...data, [field]: data[field]!.slice(1) }, source.templateData[1]] }), {
            instanceOf: RangeError, message: "Section template arrays do not match its quad count"
        });
    }
});

test("section geometry validates atlas sizes and entry array lengths", t => {
    const source = input();
    for (const maxAtlasSize of [0, 1.5, NaN]) {
        t.throws(() => buildSectionGeometry({ ...source, maxAtlasSize }), { instanceOf: RangeError, message: "Section atlas size must be a positive integer" });
    }
    t.throws(() => buildSectionGeometry({ ...source, maxAtlasSize: 1 }), { instanceOf: RangeError, message: "Model atlas exceeds the section atlas size limit" });
    for (const field of ["indices", "templates", "cullMasks"] as const) {
        t.throws(() => buildSectionGeometry({ ...source, [field]: source[field].slice(0, 2) }), { instanceOf: RangeError, message: "Section entry count exceeds its arrays" });
    }
    source.cullMasks.fill(63);
    t.deepEqual(buildSectionGeometry(source), []);
    t.deepEqual(buildSectionGeometry({ ...source, count: 0 }), []);
});

test("section light samples boundary faces after rotation and multiplies existing linear tint", t => {
    const source = input();
    source.count = 1;
    source.indices[0] = 0;
    source.cullMasks[0] = 0;
    source.light = new Uint8Array(5832).fill(255);
    source.light[343] = 5;
    source.light[343 - 18] = 10;
    source.light[343 + 18] = 0;
    const [page] = buildSectionGeometry(source);
    // The template's first two faces rotate from east/west to north/south.
    t.deepEqual(Array.from(page.colors.slice(0, 3)), Array.from(new Float32Array([0.25 / 3, 0.5 / 3, 0.75 / 3])));
    t.deepEqual(Array.from(page.colors.slice(12, 15)), [0, 0, 0]);
    t.deepEqual(Array.from(page.colors.slice(24, 27)), [0.25, 0.5, 0.75]);
    source.templateData[0].positions = source.templateData[0].positions.map(value => value / 2);
    const [inset] = buildSectionGeometry(source);
    t.deepEqual(Array.from(inset.colors.slice(0, 3)), Array.from(new Float32Array([0.25 / 9, 0.5 / 9, 0.75 / 9])));
});

test("section fluids use center and vertical light samples while retaining water tint", t => {
    const source = input();
    source.count = 0;
    source.fluids = { cells: new Uint8Array(5832), water: { atlas: 0, still: [0, 0, 2, 2], flow: [0, 0, 2, 2], tint: [0.25, 0.5, 0.75] } };
    source.fluids.cells[343] = 16;
    source.light = new Uint8Array(5832);
    source.light[343] = 5;
    source.light[343 + 324] = 10;
    const [page] = buildSectionGeometry(source);
    for (let vertex = 0; vertex < page.normals.length / 3; vertex++) {
        const brightness = page.normals[vertex * 3 + 1] < 0 ? 1 / 9 : 1 / 3;
        t.deepEqual(Array.from(page.colors.slice(vertex * 3, vertex * 3 + 3)),
            Array.from(new Float32Array([0.25, 0.5, 0.75].map(value => value * brightness))));
    }
});

test("section light rejects invalid lengths and levels", t => {
    for (const light of [new Uint8Array(7), new Uint8Array(5832).fill(16)]) {
        t.throws(() => buildSectionGeometry({ ...input(), light }), { instanceOf: RangeError,
            message: "Section light must cover an 18×18×18 neighborhood with levels from 0 to 15 or 255" });
    }
});

test("section ambient light sets a minimum for block and fluid colors while preserving full brightness", t => {
    const source = input();
    source.fluids = { cells: new Uint8Array(5832), water: { atlas: 0, still: [0, 0, 2, 2], flow: [0, 0, 2, 2], tint: [0.25, 0.5, 0.75] } };
    source.fluids.cells[343] = 16;
    const unlit = buildSectionGeometry(source);
    t.is(unlit.length, 2);
    for (const level of [0, 15, 255]) {
        const light = new Uint8Array(5832).fill(level);
        const pages = buildSectionGeometry({ ...source, light, ambientLight: 0.25 });
        t.deepEqual(pages.map(page => page.colors),
            unlit.map(page => page.colors.map(value => value * (level === 0 ? 0.25 : 1))));
        t.deepEqual(buildSectionGeometry({ ...source, light, ambientLight: 0 }), buildSectionGeometry({ ...source, light }));
    }
    for (const ambientLight of [-0.1, 1.1, NaN]) {
        t.throws(() => buildSectionGeometry({ ...source, ambientLight }), {
            instanceOf: RangeError, message: "Section ambient light must be a number from 0 to 1"
        });
    }
});

test("ambient occlusion shades boundary corners, blocks diagonal leaks and preserves saved light and tint", t => {
    const source = input();
    source.count = 1;
    source.indices[0] = 0;
    source.cullMasks[0] = 0;
    source.templateData[0] = template(0);
    source.templateData[0].colors.fill(0.5);
    source.light = new Uint8Array(5832).fill(10);
    source.ambientOcclusion = new Uint8Array(5832);
    const cell = (x: number, y: number, z: number) => (y + 1) * 324 + (z + 1) * 18 + x + 1;
    source.ambientOcclusion[cell(1, 1, 0)] = 1;
    source.ambientOcclusion[cell(0, 1, 1)] = 1;
    const original = structuredClone(source);
    const [page] = buildSectionGeometry(source);
    for (let vertex = 8; vertex < 12; vertex++) {
        const positiveX = page.positions[vertex * 3] > 0;
        const positiveZ = page.positions[vertex * 3 + 2] > 0;
        const ao = positiveX && positiveZ ? 0.4 : positiveX || positiveZ ? 0.8 : 1;
        t.true(Math.abs(page.colors[vertex * 3] - ao / 6) < 1e-7);
    }
    source.ambientOcclusion[cell(1, 1, 1)] = 1;
    t.deepEqual(buildSectionGeometry(source)[0].colors.slice(24, 36), page.colors.slice(24, 36));
    t.deepEqual(original.templateData, source.templateData);
    source.templateData[0].ambientOcclusion = false;
    t.true(buildSectionGeometry(source)[0].colors.every(value => Math.abs(value - 1 / 6) < 1e-7));
});

test("ambient occlusion interpolates boundary partial faces and skips inset or oblique faces", t => {
    const source = input();
    source.count = 1;
    source.indices[0] = 0;
    source.cullMasks[0] = 0;
    source.templateData[0] = template(0);
    source.ambientOcclusion = new Uint8Array(5832);
    source.ambientOcclusion[343 + 324 + 1] = 1;
    const data = source.templateData[0];
    for (let vertex = 0; vertex < data.positions.length / 3; vertex++) data.positions[vertex * 3] *= 0.5;
    const [page] = buildSectionGeometry(source);
    for (let vertex = 8; vertex < 12; vertex++) {
        t.true(Math.abs(page.colors[vertex * 3] - (page.positions[vertex * 3] > 0 ? 0.85 : 0.95)) < 1e-7);
    }
    t.true(page.colors.slice(0, 24).every(value => value === 1));
    for (let vertex = 8; vertex < 12; vertex++) {
        data.normals[vertex * 3] = Math.SQRT1_2;
        data.normals[vertex * 3 + 1] = Math.SQRT1_2;
    }
    t.true(buildSectionGeometry(source)[0].colors.slice(24, 36).every(value => value === 1));
});

test("ambient occlusion ignores fluid faces and rejects invalid neighborhoods", t => {
    const source = input();
    source.count = 0;
    source.fluids = { cells: new Uint8Array(5832), water: { atlas: 0, still: [0, 0, 2, 2], flow: [0, 0, 2, 2], tint: [0.25, 0.5, 0.75] } };
    source.fluids.cells[343] = 16;
    const baseline = buildSectionGeometry(source);
    source.ambientOcclusion = new Uint8Array(5832).fill(1);
    t.deepEqual(buildSectionGeometry(source), baseline);
    for (const ambientOcclusion of [new Uint8Array(27), new Uint8Array(5832).fill(2)]) {
        t.throws(() => buildSectionGeometry({ ...source, ambientOcclusion }), { instanceOf: RangeError,
            message: "Section ambient occlusion must cover an 18×18×18 neighborhood with zero or one per cell" });
    }
});


test("per-placement biome tints preserve unmarked quads and combine with saved light and ambient occlusion", t => {
    const source = input();
    source.count = 2;
    source.indices[0] = 0;
    source.indices[1] = 1;
    source.templates.fill(0);
    source.cullMasks.fill(0);
    source.templateData = [template(0)];
    source.templateData[0].colors.fill(0.5);
    source.templateData[0].biomeTint = new Uint8Array([0, 0, 1, 0, 0, 0]);
    source.biomeTints = new Float32Array([0.25, 0.5, 0.75, NaN, NaN, NaN]);
    source.light = new Uint8Array(5832).fill(10);
    source.ambientOcclusion = new Uint8Array(5832);
    source.ambientOcclusion[343 + 324 + 1] = 1;
    source.ambientOcclusion[343 + 324 + 18] = 1;
    const original = structuredClone(source);
    const [page] = buildSectionGeometry(source);
    for (let vertex = 8; vertex < 12; vertex++) {
        const positiveX = page.positions[vertex * 3] > 0;
        const positiveZ = page.positions[vertex * 3 + 2] > 0;
        const ao = positiveX && positiveZ ? 0.4 : positiveX || positiveZ ? 0.8 : 1;
        for (let channel = 0; channel < 3; channel++) {
            t.true(Math.abs(page.colors[vertex * 3 + channel] - [0.25, 0.5, 0.75][channel] * ao / 3) < 1e-7);
        }
    }
    t.true(Math.abs(page.colors[12 * 3] - 1 / 6) < 1e-7);
    const fallback = buildSectionGeometry({ ...source, biomeTints: undefined })[0];
    t.deepEqual(page.colors.slice(72), fallback.colors.slice(72));
    t.deepEqual(source, original);
    t.throws(() => buildSectionGeometry({ ...source, biomeTints: new Float32Array(3) }), { instanceOf: RangeError });
    source.templateData[0].biomeTint = new Uint8Array(1);
    t.throws(() => buildSectionGeometry(source), { instanceOf: RangeError });
});
