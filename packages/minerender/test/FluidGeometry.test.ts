import test from "ava";
import { buildFluidQuads, createFluidGeometry, FluidKind, FluidSample, FluidSampler, getBlockFluidState, getFluidKind, resolveBlockFluidState } from "../src/model/fluid/FluidGeometry";
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
