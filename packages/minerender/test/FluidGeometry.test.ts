import test from "ava";
import { DoubleSide, FrontSide, Material, Mesh, MeshBasicMaterial } from "three";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import { Materials } from "../src/Materials";
import { FluidModelObject } from "../src/model/fluid/FluidModelObject";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import { buildFluidBackQuads, buildFluidQuads, createFluidGeometry, FluidKind, FluidSample, FluidSampler, getBlockFluidState, getFluidKind, resolveBlockFluidState } from "../src/model/fluid/FluidGeometry";
import { AssetKey } from "../src/assets/AssetKey";
import { MineRenderData } from "../src/assets/MineRenderData";
import { installMineRenderDataFixtures } from "./helpers/minerender-data";

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const sampler = (entries: Record<string, FluidSample>): FluidSampler => (x, y, z) => entries[`${x},${y},${z}`] ?? {};

test.serial("fluid rules use each asset root and leave loaded rules independent of later requests", async t => {
    t.teardown(installMineRenderDataFixtures(root => ({ fluids: {
        "test:fluid": root.endsWith("/1.16.5")
            ? { kind: "water", levelProperty: "level", renderModel: false }
            : { kind: "lava", levelProperty: "depth", renderModel: true }
    } })));
    const old = AssetKey.parse("blockstates", "test:fluid");
    old.root = "https://assets.example/1.16.5";
    const current = AssetKey.parse("blockstates", "test:fluid");
    current.root = "https://assets.example/1.21.11";
    const rules = await MineRenderData.get("fluids", old.root);
    t.deepEqual(await getBlockFluidState(current, { depth: "3" }), { kind: "lava", level: 3, renderModel: true });
    t.deepEqual(await getBlockFluidState(old, { level: "7" }), { kind: "water", level: 7, renderModel: false });
    t.is(await getFluidKind(current), "lava");
    t.deepEqual(resolveBlockFluidState(old, { level: "4" }, rules), { kind: "water", level: 4, renderModel: false });
    t.deepEqual(resolveBlockFluidState(undefined, { waterlogged: "true" }, rules), { kind: "water", level: 0, renderModel: true });
    t.is(resolveBlockFluidState(undefined, {}, rules), undefined);
});

test("pure fluid quads match geometry for flowing, falling and solid-neighbor cells", t => {
    const cases: Record<string, FluidSample>[] = [
        { "0,0,0": { fluid: "water" }, "1,0,0": { fluid: "water", level: 4 } },
        { "0,0,0": { fluid: "water", level: 8 }, "0,-1,0": { fluid: "water", level: 8 } },
        { "0,0,0": { fluid: "water" }, "1,0,0": { solid: true }, "0,-1,0": { solid: true } }
    ];
    for (const cells of cases) {
        const sample = sampler(cells);
        const quads = buildFluidQuads("water", sample);
        const geometry = createFluidGeometry("water", sample);
        t.teardown(() => geometry.dispose());
        t.deepEqual(geometry.getAttribute("position").array, new Float32Array(quads.positions));
        t.deepEqual(geometry.getAttribute("normal").array, new Float32Array(quads.normals));
        t.deepEqual(geometry.getAttribute("uv").array, new Float32Array(quads.uvs));
        t.deepEqual(geometry.groups, quads.sprites.map((materialIndex, index) => ({ start: index * 6, count: 6, materialIndex })));
    }
});

test("source, flowing and falling levels use vanilla corner heights", t => {
    for (const fluid of ["water", "lava"] as FluidKind[]) {
        for (const [level, height] of [[0, 20 / 27], [1, 7 / 27], [7, 1 / 27], [8, 20 / 27], [15, 20 / 27]]) {
            const geometry = createFluidGeometry(fluid, sampler({ "0,0,0": { fluid, level } }));
            const positions = geometry.getAttribute("position");
            for (let i = 0; i < 4; i++) t.true(Math.abs(positions.getY(i) - ((height - 0.001) * 16 - 8)) < 1e-6);
            t.is(geometry.index!.count, 36);
        }
    }
});

test("fluid above fills the block height and removes the shared top face", t => {
    const geometry = createFluidGeometry("water", sampler({
        "0,0,0": { fluid: "water", level: 7 }, "0,1,0": { fluid: "water" }
    }));
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    t.is(Math.max(...Array.from({ length: positions.count }, (_, i) => positions.getY(i))), 8);
    t.false(Array.from({ length: normals.count }, (_, i) => normals.getY(i)).includes(1));
    t.is(geometry.index!.count, 30);
});

test("different fluid levels meet at identical corners without an internal side", t => {
    const sample = sampler({ "0,0,0": { fluid: "water" }, "1,0,0": { fluid: "water", level: 4 } });
    const left = createFluidGeometry("water", sample);
    const right = createFluidGeometry("water", (x, y, z) => sample(x + 1, y, z));
    const leftPosition = left.getAttribute("position"), rightPosition = right.getAttribute("position");
    t.is(leftPosition.getY(3), rightPosition.getY(0));
    t.is(leftPosition.getY(2), rightPosition.getY(1));
    t.true(Math.abs(leftPosition.getY(3) - ((28 / 39 - 0.001) * 16 - 8)) < 1e-6);
    t.deepEqual([left.index!.count, right.index!.count], [30, 30]);
});

test("still surfaces use the full sprite and eastward flow rotates the flowing sprite", t => {
    const origin: Record<string, FluidSample> = { "0,0,0": { fluid: "water" } };
    const still = createFluidGeometry("water", sampler(origin));
    t.is(still.groups[0].materialIndex, 0);
    t.deepEqual(Array.from(still.getAttribute("uv").array).slice(0, 8), [0, 1, 0, 0, 1, 0, 1, 1]);
    for (const neighbor of [{ "1,0,0": { fluid: "water", level: 4 } }, { "1,-1,0": { fluid: "water" } }]) {
        const flow = createFluidGeometry("water", sampler({ ...origin, ...neighbor } as Record<string, FluidSample>));
        t.is(flow.groups[0].materialIndex, 1);
        t.deepEqual(Array.from(flow.getAttribute("uv").array).slice(0, 8).map(round), [0.75, 0.75, 0.25, 0.75, 0.25, 0.25, 0.75, 0.25]);
    }
});

test("solid neighbors hide sides and bottom while a recessed top remains visible", t => {
    const enclosed: FluidSampler = (x, y, z) => x === 0 && y === 0 && z === 0 ? { fluid: "water" } : { solid: true };
    const recessed = createFluidGeometry("water", enclosed);
    t.is(recessed.index!.count, 6);
    const covered: FluidSampler = (x, y, z) => y === 1 ? { fluid: "water" } : enclosed(x, y, z);
    t.is(createFluidGeometry("water", covered).index!.count, 0);
    const differentFluid = createFluidGeometry("water", (x, y, z) => x === 1 && y === 0 && z === 0 ? { fluid: "lava" } : covered(x, y, z));
    t.is(differentFluid.index!.count, 6);
    t.is(differentFluid.getAttribute("normal").getX(0), 1);
});

test("inner faces reverse the sides and an exposed top but never the bottom", t => {
    const floating: FluidSampler = (x, y, z) => x === 0 && y === 0 && z === 0 ? { fluid: "water" } : {};
    const front = buildFluidQuads("water", floating);
    const back = buildFluidBackQuads("water", floating);
    t.is(front.sprites.length, 6);
    t.is(back.sprites.length, 5);
    // The winding gives the facing; the normal attribute keeps the front face's shading.
    const facing = (quads: typeof back) => quads.sprites.map((_, quad) => {
        const [a, b, c] = [0, 1, 2].map(corner => quads.positions.slice((quad * 4 + corner) * 3, (quad * 4 + corner) * 3 + 3));
        return Math.sign((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]));
    });
    t.deepEqual(facing(back).filter(up => up !== 0), [-1]);
    const top = facing(front).indexOf(1), underside = facing(back).indexOf(-1);
    for (const [corner, source] of [0, 3, 2, 1].entries()) {
        t.deepEqual(back.positions.slice((underside * 4 + corner) * 3, (underside * 4 + corner) * 3 + 3),
            front.positions.slice((top * 4 + source) * 3, (top * 4 + source) * 3 + 3));
        t.deepEqual(back.normals.slice((underside * 4 + corner) * 3, (underside * 4 + corner) * 3 + 3), [0, 1, 0]);
    }
    const enclosed: FluidSampler = (x, y, z) => x === 0 && y === 0 && z === 0 ? { fluid: "water" } : { solid: true };
    t.is(buildFluidBackQuads("water", enclosed).sprites.length, 0);
    const corner = buildFluidBackQuads("water", (x, y, z) => x === 1 && y === 1 && z === 1 ? {} : enclosed(x, y, z));
    t.deepEqual(facing(corner), [-1]);
    t.is(createFluidGeometry("water", floating, "back").index!.count, 30);
});

test.serial("per-block fluids draw inner faces first and sample inside their sprites", async t => {
    const originals = { atlas: UVMapper.getAtlas, material: Materials.createShadedCanvasMaterial };
    const objects: FluidModelObject[] = [];
    UVMapper.getAtlas = async model => new TextureAtlas(model, { width: 32, height: 16, canvas: {} } as CanvasImage,
        { still: [16, 16], flow: [16, 16] }, { still: [0, 0], flow: [16, 0] }, false, {}, model.key!.path === "water", model.key!.path === "water");
    Materials.createShadedCanvasMaterial = (_canvas, transparent) => new MeshBasicMaterial({ transparent, side: transparent ? DoubleSide : FrontSide });
    t.teardown(() => {
        UVMapper.getAtlas = originals.atlas;
        Materials.createShadedCanvasMaterial = originals.material;
        for (const object of objects) object.dispose();
    });
    const sprites = [[0.5 / 32, 0.5 / 16, 15.5 / 32, 15.5 / 16], [16.5 / 32, 0.5 / 16, 31.5 / 32, 15.5 / 16]].map(bounds => bounds.map(round));
    for (const kind of ["water", "lava"] as const) {
        for (const faces of ["front", "back"] as const) {
            const object = new FluidModelObject(kind, (x, y, z) => x === 0 && y === 0 && z === 0 ? { fluid: kind, level: 0 } : {}, undefined, undefined, faces);
            objects.push(object);
            await object.init();
            const meshes: Mesh[] = [];
            object.iterateAllMeshes(mesh => meshes.push(mesh));
            t.is(meshes.length, 1, `${kind} ${faces}`);
            const material = meshes[0].material as Material;
            t.is(material.side, FrontSide);
            t.is(material.depthWrite, kind === "lava");
            t.is(meshes[0].renderOrder, faces === "back" ? -1 : 0);
            const uv = meshes[0].geometry.getAttribute("uv"), bounds = meshes[0].geometry.getAttribute("uvBounds");
            const used = new Set<number>();
            for (let vertex = 0; vertex < uv.count; vertex++) {
                const sprite = sprites.findIndex(rect => rect.every((value, i) => value === round(bounds.getComponent(vertex, i))));
                t.not(sprite, -1);
                used.add(sprite);
                t.true(uv.getX(vertex) >= sprites[sprite][0] - 0.5 / 32 && uv.getX(vertex) <= sprites[sprite][2] + 0.5 / 32);
            }
            t.deepEqual([...used].sort(), [0, 1]);
        }
    }
});
