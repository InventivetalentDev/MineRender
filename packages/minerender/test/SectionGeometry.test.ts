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
        templateData: [template(0, true), template(1)], atlases: [{ width: 2, height: 2 }, { width: 2, height: 2 }], maxAtlasSize: 4
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
    const positions = Array.from({ length: 3 }, (_, axis) => Array.from(page.positions).filter((_, index) => index % 3 === axis));
    t.deepEqual(positions.map(axis => Math.min(...axis)), [-8, -8, -8]);
    t.deepEqual(positions.map(axis => Math.max(...axis)), [24, 8, 24]);
    t.true(Math.abs(page.normals[2] - 1) < 1e-6);
    t.deepEqual(Array.from(page.colors.slice(0, 3)), [0.25, 0.5, 0.75]);
    t.deepEqual(Array.from(page.colors.slice(-3)), [1, 1, 1]);
    t.deepEqual([page.width, page.height], [4, 2]);
    t.deepEqual(page.placements, [{ atlas: 0, x: 0, y: 0 }, { atlas: 1, x: 2, y: 0 }]);
    t.deepEqual(Array.from(page.uvs.slice(0, 2)), [0, 1]);
    t.deepEqual(Array.from(page.uvs.slice(40, 42)), [0.5, 1]);
    t.deepEqual(Array.from(page.uvBounds.slice(0, 4)), [0.125, 0.25, 0.375, 0.75]);
    t.deepEqual(Array.from(page.uvBounds.slice(80, 84)), [0.5, 0, 1, 1]);
    t.deepEqual(Array.from(page.indices.slice(0, 6)), [0, 2, 1, 2, 3, 1]);
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
    t.deepEqual(pages.map(page => page.placements), [[{ atlas: 0, x: 0, y: 0 }], [{ atlas: 1, x: 0, y: 0 }]]);
});

test("section geometry exposes every output array buffer for transfer", t => {
    const source = input();
    source.maxAtlasSize = 2;
    const pages = buildSectionGeometry(source);
    const buffers = sectionGeometryTransferables(pages);
    t.is(buffers.length, pages.length * 6);
    let index = 0;
    for (const page of pages) {
        for (const array of [page.positions, page.normals, page.uvs, page.uvBounds, page.colors, page.indices]) t.is(buffers[index++], array.buffer);
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

test("section geometry validates every template array against its quad count", t => {
    const source = input();
    const data = source.templateData[0];
    for (const field of ["positions", "normals", "uvs", "uvBounds", "colors", "indices", "cullFaces"] as const) {
        t.throws(() => buildSectionGeometry({ ...source, templateData: [{ ...data, [field]: data[field].slice(1) }, source.templateData[1]] }), {
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
