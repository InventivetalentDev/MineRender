import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test, { ExecutionContext } from "ava";
import { BoxGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, Matrix4, Mesh, ShaderMaterial, Texture } from "three";
import { CanvasImage } from "../src/canvas/CanvasImage";
import { CompatCanvas } from "../src/canvas/CanvasCompat";
import { Env, EnvProvider } from "../src/Env";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { Ticker } from "../src/Ticker";
import { buildSectionGeometry, SectionGeometryInput, SectionGeometryPage } from "../src/world/SectionGeometry";
import { SectionWorker } from "../src/world/SectionWorker";
import { SectionMesh, SectionMeshTemplate } from "../src/world/SectionMesh";

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());

function fixture(t: ExecutionContext, createWorker?: EnvProvider["createWorker"], drawImage = () => {},
                 clearRect: (x: number, y: number, width: number, height: number) => void = () => {}) {
    const provider = Env["_provider"];
    const worker = SectionWorker["instance"], initialized = SectionWorker["initialized"];
    SectionWorker["instance"] = undefined;
    SectionWorker["initialized"] = false;
    Env.register({ name: "test", createWorker, createCanvas: (width, height) => ({
        width, height, getContext: () => ({ drawImage, clearRect })
    } as unknown as CompatCanvas) } as EnvProvider);
    const geometries: BoxGeometry[] = [];
    t.teardown(() => {
        SectionWorker["instance"]?.terminate();
        SectionWorker["instance"] = worker;
        SectionWorker["initialized"] = initialized;
        Env["_provider"] = provider;
        for (const geometry of geometries) geometry.dispose();
    });
    return (layer: 0 | 1 = 0): SectionMeshTemplate => {
        const geometry = new BoxGeometry(16, 16, 16);
        geometries.push(geometry);
        return { geometry, atlas: new TextureAtlas({}, new CanvasImage(2, 2), {}, {}, false, {}, layer === 1, layer === 1),
            cullFaces: new Uint8Array([1, 2, 4, 8, 16, 32]), occludes: layer === 0, layer };
    };
}

test.serial("section faces retain baked rotation, tint and atlas UVs without changing shared templates", t => {
    const create = fixture(t);
    const first = create(), second = create();
    first.geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
    first.geometry.setAttribute("color", new Float32BufferAttribute(Array.from({ length: 24 }, () => [0.25, 0.5, 0.75]).flat(), 3));
    first.geometry.setAttribute("uvBounds", new Float32BufferAttribute(Array.from({ length: 24 }, () => [0.25, 0.25, 0.75, 0.75]).flat(), 4));
    const source = first.geometry.toJSON();
    let sourceDisposals = 0;
    first.geometry.addEventListener("dispose", () => { sourceDisposals++; });
    const section = SectionMesh.build([
        { index: 1, template: first, cullMask: 1 },
        { index: 16, template: second, cullMask: 0 },
        { index: 256, template: first, cullMask: 63 }
    ], 4);
    t.is(section.children.length, 1);
    const mesh = section.children[0] as Mesh;
    const geometry = mesh.geometry;
    const material = mesh.material as ShaderMaterial;
    const texture = material.uniforms.map.value as Texture;
    t.is(geometry.getAttribute("position").count, 44);
    t.is(geometry.getIndex()!.count, 66);
    t.deepEqual(geometry.boundingBox!.min.toArray(), [-8, -8, -8]);
    t.deepEqual(geometry.boundingBox!.max.toArray(), [24, 8, 24]);
    t.true(Math.abs(geometry.getAttribute("normal").getZ(0) - 1) < 1e-6);
    t.deepEqual(Array.from(geometry.getAttribute("color").array).slice(0, 3), [0.25, 0.5, 0.75]);
    t.deepEqual(Array.from(geometry.getAttribute("color").array).slice(-3), [1, 1, 1]);
    t.deepEqual([texture.image.width, texture.image.height], [4, 2]);
    t.deepEqual([geometry.getAttribute("uv").getX(0), geometry.getAttribute("uv").getY(0)], [0, 1]);
    t.deepEqual([geometry.getAttribute("uv").getX(20), geometry.getAttribute("uv").getY(20)], [0.5, 1]);
    t.deepEqual(Array.from(geometry.getAttribute("uvBounds").array).slice(0, 4), [0.125, 0.25, 0.375, 0.75]);
    t.deepEqual(Array.from(geometry.getAttribute("uvBounds").array).slice(80, 84), [0.5, 0, 1, 1]);
    t.deepEqual(first.geometry.toJSON(), source);
    const disposed = { geometry: 0, material: 0, texture: 0 };
    geometry.addEventListener("dispose", () => { disposed.geometry++; });
    material.addEventListener("dispose", () => { disposed.material++; });
    texture.addEventListener("dispose", () => { disposed.texture++; });
    let sectionDisposals = 0;
    section.addEventListener("dispose", () => { sectionDisposals++; });
    section.dispose();
    t.is(sectionDisposals, 1);
    section.dispose();
    t.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
    t.is(sourceDisposals, 0);
    t.is(section.children.length, 0);
    t.deepEqual([first.atlas.image.width, first.atlas.image.height], [2, 2]);
});

test.serial("section atlases page at the size limit, share repeated sources and keep untagged faces", t => {
    const create = fixture(t);
    const templates = [create(), create(), create()];
    const section = SectionMesh.build([...templates, templates[0]].map((template, index) => ({
        index, template: { ...template, cullFaces: new Uint8Array([0, 2, 4, 8, 16, 32]) }, cullMask: 63
    })), 2);
    t.teardown(() => section.dispose());
    t.is(section.children.length, 3);
    t.deepEqual(section.children.map(child => (child as Mesh).geometry.getIndex()!.count), [12, 6, 6]);
    for (const child of section.children) {
        const canvas = ((child as Mesh).material as ShaderMaterial).uniforms.map.value.image;
        t.deepEqual([canvas.width, canvas.height], [2, 2]);
    }
    const empty = SectionMesh.build([{ index: 0, template: templates[0], cullMask: 63 }], 2);
    t.is(empty.children.length, 0);
    empty.dispose();
});

test.serial("section materials blend only translucent pages", t => {
    const create = fixture(t);
    const section = SectionMesh.build([
        { index: 0, template: create(1), cullMask: 0 },
        { index: 1, template: create(0), cullMask: 0 }
    ]);
    t.teardown(() => section.dispose());
    t.is(section.children.length, 2);
    const materials = section.children.map(child => (child as Mesh).material as ShaderMaterial);
    t.deepEqual(materials.map(material => material.transparent), [false, true]);
    t.deepEqual(materials.map(material => material.side), [FrontSide, FrontSide]);
});

for (const transparent of [false, true]) {
    test.serial(`section fluid materials are double-sided with depth writes ${transparent ? "disabled" : "enabled"}`, t => {
        fixture(t);
        const atlas = new TextureAtlas({}, new CanvasImage(4, 2), { still: [2, 2], flow: [2, 2] },
            { still: [0, 0], flow: [2, 0] }, false, {}, transparent, transparent);
        const cells = new Uint8Array(18 ** 3);
        cells[18 * 18 + 18 + 1] = 16;
        const section = SectionMesh.build([], 4, { cells, water: atlas });
        t.teardown(() => section.dispose());
        t.is(section.children.length, 1);
        const material = (section.children[0] as Mesh).material as ShaderMaterial;
        t.is(material.transparent, transparent);
        t.is(material.side, DoubleSide);
        t.true(material.forceSinglePass);
        t.is(material.depthWrite, !transparent);
        t.true(material.vertexColors);
    });
}

test.serial("animated section pages redraw once per tick, dirty their scene and unsubscribe on disposal", t => {
    let draws = 0;
    const calls: (string | number)[][] = [];
    const create = fixture(t, undefined, () => { draws++; calls.push(["drawImage"]); },
        (...rectangle) => { calls.push(["clearRect", ...rectangle]); });
    const animated = create(), fixed = create();
    animated.atlas = new TextureAtlas({}, new CanvasImage(2, 2), {}, {}, true, { all: () => true }, false);
    const section = SectionMesh.build([
        { index: 0, template: animated, cullMask: 0 },
        { index: 1, template: fixed, cullMask: 0 },
        { index: 2, template: animated, cullMask: 0 }
    ]);
    t.teardown(() => section.dispose());
    const scene = Object.assign(new Group(), { isMineRenderScene: true, dirty: false });
    scene.add(new Group().add(section));
    t.is(section.children.length, 2);
    t.is(draws, 2);
    t.is(fixed.atlas.ticker, undefined);
    const textures = section.children.map(child => ((child as Mesh).material as ShaderMaterial).uniforms.map.value as Texture);
    const versions = textures.map(texture => texture.version);
    const ticker = animated.atlas.ticker!;
    for (let tick = 1; tick <= 2; tick++) {
        calls.length = 0;
        scene.dirty = false;
        Ticker.tickers.get(ticker)!();
        t.deepEqual(calls, [["clearRect", 0, 0, 2, 2], ["drawImage"]]);
        t.is(draws, 2 + tick);
        t.deepEqual(textures.map(texture => texture.version), [versions[0], versions[1] + tick]);
        t.true(scene.dirty);
    }
    section.dispose();
    t.is(animated.atlas.ticker, undefined);
    t.false(Ticker.tickers.has(ticker));
});

test.serial("section meshes copy templates with fewer than six quads", t => {
    const template = fixture(t)();
    for (const name of ["position", "normal", "uv"]) {
        const attribute = template.geometry.getAttribute(name);
        template.geometry.setAttribute(name, new Float32BufferAttribute(attribute.array.slice(0, attribute.itemSize * 8), attribute.itemSize));
    }
    template.geometry.setIndex(Array.from(template.geometry.getIndex()!.array).slice(0, 12));
    template.cullFaces = new Uint8Array(2);
    const section = SectionMesh.build([{ index: 0, template, cullMask: 63 }]);
    t.teardown(() => section.dispose());
    const geometry = (section.children[0] as Mesh).geometry;
    t.is(geometry.getAttribute("position").count, 8);
    t.deepEqual(Array.from(geometry.getIndex()!.array), [0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
});

test.serial("section meshes validate quad vertex and index counts", t => {
    const create = fixture(t);
    const incomplete = create(), mismatch = create();
    incomplete.geometry.setIndex([0, 1, 2]);
    mismatch.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const template of [incomplete, mismatch]) {
        t.throws(() => SectionMesh.build([{ index: 0, template, cullMask: 0 }]), {
            instanceOf: RangeError, message: "Section template geometry must hold four vertices and six indices per quad"
        });
    }
});

function geometryData(section: SectionMesh) {
    return section.children.map(child => {
        const geometry = (child as Mesh).geometry;
        return {
            attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array])),
            indices: geometry.getIndex()!.array, box: geometry.boundingBox, sphere: geometry.boundingSphere
        };
    });
}

test.serial("async section builds use the shared worker without copying its geometry buffers", async t => {
    const target = new EventTarget();
    const results: SectionGeometryPage[][] = [];
    let workers = 0;
    const worker = Object.assign(target, {
        postMessage({ id, input }: { id: number; input: SectionGeometryInput }) {
            queueMicrotask(() => {
                const pages = buildSectionGeometry(input);
                results.push(pages);
                target.dispatchEvent(new MessageEvent("message", { data: { id, type: "pages", pages } }));
            });
        },
        terminate() {}
    }) as unknown as Worker;
    const create = fixture(t, () => { workers++; return worker; });
    const first = create(), second = create();
    first.geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
    const entries = [{ index: 1, template: first, cullMask: 1 }, { index: 16, template: second, cullMask: 0 }];
    const fluids = { cells: new Uint8Array(18 ** 3), water: new TextureAtlas({}, new CanvasImage(2, 2),
        { still: [1, 2], flow: [1, 2] }, { still: [0, 0], flow: [1, 0] }, false, {}, true, true) };
    fluids.cells[18 * 18 + 18 + 1] = 16;
    const expected = [SectionMesh.build(entries, 4, fluids), SectionMesh.build([...entries].reverse(), 4, fluids)];
    const actual = await Promise.all([SectionMesh.buildAsync(entries, 4, fluids), SectionMesh.buildAsync([...entries].reverse(), 4, fluids)]);
    t.teardown(() => [...expected, ...actual].forEach(section => section.dispose()));
    t.is(workers, 1);
    t.deepEqual(actual.map(geometryData), expected.map(geometryData));
    for (let i = 0; i < actual.length; i++) {
        const geometry = (actual[i].children[0] as Mesh).geometry;
        const page = results[i][0];
        for (const [name, values] of Object.entries({ position: page.positions, normal: page.normals,
            uv: page.uvs, uvBounds: page.uvBounds, color: page.colors })) {
            t.is(geometry.getAttribute(name).array.buffer, values.buffer);
        }
        t.is(geometry.getIndex()!.array.buffer, page.indices.buffer);
    }
});

test.serial("async section builds fall back after a worker error and disable the shared worker", async t => {
    const target = new EventTarget();
    let workers = 0, terminations = 0;
    const worker = Object.assign(target, {
        postMessage() { queueMicrotask(() => target.dispatchEvent(new Event("error"))); },
        terminate() { terminations++; }
    }) as unknown as Worker;
    const create = fixture(t, () => { workers++; return worker; });
    const entries = [{ index: 256, template: create(), cullMask: 4 }];
    const expected = SectionMesh.build(entries);
    const actual = await SectionMesh.buildAsync(entries);
    const later = await SectionMesh.buildAsync(entries);
    t.teardown(() => [expected, actual, later].forEach(section => section.dispose()));
    t.deepEqual(geometryData(actual), geometryData(expected));
    t.deepEqual(geometryData(later), geometryData(expected));
    t.is(SectionWorker.shared(), undefined);
    t.is(workers, 1);
    t.is(terminations, 1);
});

test.serial("async section builds fall back after a message error and disable the shared worker", async t => {
    const target = new EventTarget();
    let terminations = 0;
    const worker = Object.assign(target, {
        postMessage() { queueMicrotask(() => target.dispatchEvent(new MessageEvent("messageerror", { data: null }))); },
        terminate() { terminations++; }
    }) as unknown as Worker;
    const create = fixture(t, () => worker);
    const entries = [{ index: 4095, template: create(), cullMask: 2 }];
    const expected = SectionMesh.build(entries), actual = await SectionMesh.buildAsync(entries);
    t.teardown(() => [expected, actual].forEach(section => section.dispose()));
    t.deepEqual(geometryData(actual), geometryData(expected));
    t.is(SectionWorker.shared(), undefined);
    t.is(terminations, 1);
});

test.serial("async section builds fall back for a rejected build without disabling the worker", async t => {
    const target = new EventTarget();
    const worker = Object.assign(target, {
        postMessage({ id }: { id: number }) {
            queueMicrotask(() => target.dispatchEvent(new MessageEvent("message", {
                data: { id, type: "error", message: "Build failed" }
            })));
        },
        terminate() {}
    }) as unknown as Worker;
    const create = fixture(t, () => worker);
    const entries = [{ index: 17, template: create(), cullMask: 0 }];
    const expected = SectionMesh.build(entries), actual = await SectionMesh.buildAsync(entries);
    t.teardown(() => [expected, actual].forEach(section => section.dispose()));
    t.deepEqual(geometryData(actual), geometryData(expected));
    t.not(SectionWorker.shared(), undefined);
});

test.serial("async section builds match synchronous geometry without a worker and validate before creating one", async t => {
    const create = fixture(t);
    const entries = [{ index: 4095, template: create(), cullMask: 16 }];
    const expected = SectionMesh.build(entries), actual = await SectionMesh.buildAsync(entries);
    t.teardown(() => [expected, actual].forEach(section => section.dispose()));
    t.deepEqual(geometryData(actual), geometryData(expected));
    t.is(SectionWorker.shared(), undefined);
    let workers = 0;
    Env.provider.createWorker = () => { workers++; return undefined; };
    t.is(SectionWorker.shared(), undefined);
    t.is(workers, 0);
    SectionWorker["initialized"] = false;
    await t.throwsAsync(SectionMesh.buildAsync(entries, 0), { instanceOf: RangeError,
        message: "Section atlas size must be a positive integer" });
    t.is(workers, 0);
});
