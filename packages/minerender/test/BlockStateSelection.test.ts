import test from "ava";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import type { BlockStateVariant } from "../src/model/block/BlockState";
import type { BlockStateProperties } from "../src/model/block/BlockStateProperties";
import { AssetKey } from "../src/assets/AssetKey";
import { BlockStates } from "../src/assets/BlockStates";

class SelectionBlock extends BlockObject {
    selected: BlockStateVariant[] = [];
    rebuilds = 0;

    select(state: BlockStateProperties) { return this.mapStateToVariant(state); }
    async recreateModels() { this.rebuilds++; this.selected = await this.select(this.state); }
}

test.serial("initial properties override defaults before models are built once", async t => {
    const original = BlockStates.getDefaultState;
    t.teardown(() => { BlockStates.getDefaultState = original; });
    let defaultLoads = 0;
    BlockStates.getDefaultState = async () => {
        defaultLoads++;
        return {
            axis: { default: "y", type: "enum", valueType: "string", values: ["x", "y"] },
            waterlogged: { default: "false", type: "boolean", valueType: "boolean", values: ["false", "true"] }
        };
    };
    const base = { model: "test:block/base" };
    const horizontal = { model: "test:block/horizontal" };
    const vertical = { model: "test:block/vertical" };
    const state = { key: AssetKey.parse("blockstates", "test:log"), multipart: [
        { apply: base },
        { when: { axis: "x", waterlogged: "false" }, apply: horizontal },
        { when: { axis: "y", waterlogged: "false" }, apply: vertical }
    ] };
    const saved = new SelectionBlock(state, { initialState: { axis: "x" } });
    await saved.init();
    t.deepEqual(saved.selected, [base, horizontal]);
    t.deepEqual(saved.state, { axis: "x", waterlogged: "false" });
    t.is(saved.rebuilds, 1);
    const empty = new SelectionBlock(state, { initialState: {} });
    await empty.init();
    t.deepEqual(empty.selected, [base, vertical]);
    t.is(empty.rebuilds, 1);
    const defaults = new SelectionBlock(state);
    await defaults.init();
    t.deepEqual(defaults.selected, [base, vertical]);
    t.is(defaults.rebuilds, 1);
    t.is(defaultLoads, 3);
    const noDefaults = new SelectionBlock(state, { applyDefaultState: false, initialState: {} });
    await noDefaults.init();
    t.deepEqual(noDefaults.selected, [base]);
    t.is(noDefaults.rebuilds, 1);
    t.is(defaultLoads, 3);
});

test.serial("multipart OR groups require every property within a matching branch", async t => {
    const variant = { model: "test:block/corner" };
    const block = new SelectionBlock({ multipart: [{
        when: { OR: [{ north: "true", east: "false" }, { south: "true", west: "false" }] },
        apply: variant
    }] });

    t.deepEqual(await block.select({ north: "true", east: "false" }), [variant]);
    t.deepEqual(await block.select({ south: "true", west: "false" }), [variant]);
    t.deepEqual(await block.select({ north: "true", east: "true", south: "false", west: "false" }), []);
    t.deepEqual(await block.select({ north: "true" }), []);
});

test.serial("nested AND and OR conditions support pipe values and preserve unconditional parts", async t => {
    const base = { model: "test:block/base" };
    const conditional = { model: "test:block/attachment" };
    const block = new SelectionBlock({ multipart: [
        { apply: base },
        { when: { AND: [
            { enabled: "true" },
            { OR: [{ facing: "north|south", mode: "up" }, { facing: "east", mode: "down" }] }
        ] }, apply: conditional }
    ] });

    t.deepEqual(await block.select({ enabled: "true", facing: "south", mode: "up" }), [base, conditional]);
    t.deepEqual(await block.select({ enabled: "true", facing: "east", mode: "down" }), [base, conditional]);
    t.deepEqual(await block.select({ enabled: "false", facing: "south", mode: "up" }), [base]);
    t.deepEqual(await block.select({ enabled: "true", facing: "south" }), [base]);
    t.deepEqual(await block.select({}), [base]);
});

test.serial("default and state-specific variants select weighted intervals with omitted weights equal to one", async t => {
    const originalRandom = Math.random;
    t.teardown(() => { Math.random = originalRandom; });
    const choices = [{ model: "test:block/a" }, { model: "test:block/b", weight: 2 }, { model: "test:block/c", weight: 1 }];
    const defaults = new SelectionBlock({ variants: { "": choices } });
    const states = new SelectionBlock({ variants: { "facing=north,powered=true": choices } });
    const samples = [[0, 0], [0.25 - Number.EPSILON, 0], [0.25, 1], [0.75 - Number.EPSILON, 1], [0.75, 2], [1 - Number.EPSILON, 2]];

    for (const [roll, index] of samples) {
        Math.random = () => roll;
        t.deepEqual(await defaults.select({}), [choices[index]]);
        t.deepEqual(await states.select({ facing: "north", powered: "true" }), [choices[index]]);
    }
    t.deepEqual(await states.select({ facing: "north" }), []);
    t.deepEqual(await states.select({ facing: "south", powered: "true" }), []);
});

test.serial("multipart apply arrays choose one weighted model per matching part", async t => {
    const originalRandom = Math.random;
    t.teardown(() => { Math.random = originalRandom; });
    const base = { model: "test:block/base" };
    const north = [{ model: "test:block/north_a", weight: 3 }, { model: "test:block/north_b" }];
    const south = [{ model: "test:block/south_a" }, { model: "test:block/south_b" }];
    const block = new SelectionBlock({ multipart: [
        { apply: base },
        { when: { north: "true" }, apply: north },
        { when: { south: "true" }, apply: south },
        { when: { west: "true" }, apply: { model: "test:block/west" } }
    ] });
    const state = { north: "true", south: "true", west: "false" };

    Math.random = () => 0;
    t.deepEqual(await block.select(state), [base, north[0], south[0]]);
    Math.random = () => 0.75;
    t.deepEqual(await block.select(state), [base, north[1], south[1]]);
});

test.serial("empty variant arrays and nonpositive or noninteger weights reject clearly", async t => {
    const empty = new SelectionBlock({ variants: { "": [] } });
    await t.throwsAsync(empty.select({}), { message: /must not be empty/ });
    for (const weight of [0, -1, 0.5, Infinity, NaN]) {
        const block = new SelectionBlock({ variants: { "": [{ model: "test:block/invalid", weight }] } });
        await t.throwsAsync(block.select({}), { message: /Invalid blockstate variant weight/ });
    }
});

test.serial("initialization without metadata skips grouped conditions and retains flat preview defaults", async t => {
    const base = { model: "test:block/base" };
    const conditional = { model: "test:block/attachment" };
    const block = new SelectionBlock({ multipart: [
        { apply: base },
        { when: { AND: [
            { enabled: "true|false" },
            { OR: [{ facing: "north|south", mode: "up" }, { facing: "east", mode: "down" }] }
        ] }, apply: conditional }
    ] });

    await block.init();
    t.deepEqual(block.state, {});
    t.deepEqual(block.selected, [base]);
    await block.setState({ enabled: "true", facing: "north", mode: "up" });
    t.deepEqual(block.selected, [base, conditional]);

    const flat = new SelectionBlock({ multipart: [
        { when: { OR: [{ other: "true" }] }, apply: base },
        { when: { facing: "north|south", powered: "true|false" }, apply: conditional }
    ] });
    await flat.init();
    t.deepEqual(flat.state, { facing: "north", powered: "true" });
    t.deepEqual(flat.selected, [conditional]);

    const unconditional = new SelectionBlock({ multipart: [{ apply: base }] });
    await unconditional.init();
    t.deepEqual(unconditional.state, {});
    t.deepEqual(unconditional.selected, [base]);
});
