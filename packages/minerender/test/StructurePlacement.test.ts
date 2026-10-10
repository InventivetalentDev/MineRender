import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test, { ExecutionContext } from "ava";
import { Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { BlockStates } from "../src/assets/BlockStates";
import { Block } from "../src/model/block/Block";
import { MultiBlockBlock, MultiBlockStructure } from "../src/model/multiblock/MultiBlockStructure";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { BatchedExecutor } from "../src/util/BatchedExecutor";
import { MineRenderWorld } from "../src/world/MineRenderWorld";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}
const structure = (blocks: MultiBlockBlock[]): MultiBlockStructure => ({ size: [4, 1, 1], blocks });
const block = (x: number, type = "stone"): MultiBlockBlock => ({ position: [x, 0, 0], type });

function fixture(t: ExecutionContext, place: (block: MultiBlockBlock) => Promise<void>) {
    const original = BlockStates.getAll;
    const preloads: AssetKey[][] = [];
    BlockStates.getAll = async keys => { preloads.push([...keys]); return []; };
    t.teardown(() => { BlockStates.getAll = original; });
    const world = new MineRenderWorld(new MineRenderScene());
    world["placeBlock"] = async (position: Vector3, value: Block) => {
        await place({ ...value, position: position.toArray() });
        return undefined;
    };
    return { world, preloads };
}

test.serial("placement deduplicates non-air preloads and keeps duplicate positions ordered while other positions progress", async t => {
    t.timeout(3000);
    const executor = new BatchedExecutor(1, 2);
    const gate = deferred(), otherStarted = deferred();
    t.teardown(() => { gate.resolve(); executor.stop(); });
    const started: MultiBlockBlock[] = [];
    let active = 0, peak = 0;
    const { world, preloads } = fixture(t, async value => {
        started.push(value);
        peak = Math.max(peak, ++active);
        if (value.position[0] === 0 && value.type === "stone") await gate.promise;
        if (value.position[0] === 1) otherStarted.resolve();
        active--;
    });
    const input = [block(0), block(0, "dirt"), block(1, "minecraft:stone"), block(0, "minecraft:air"), block(2, "cave_air"), block(3, "custom:air")];
    const pending = world.placeMultiBlock(structure(input), true, executor);
    await otherStarted.promise;
    t.deepEqual(started, [input[0], input[2]]);
    gate.resolve();
    await pending;
    t.deepEqual(started.filter(value => value.position[0] === 0), [input[0], input[1], input[3]]);
    t.is(started.length, input.length);
    t.is(peak, 2);
    t.deepEqual(preloads.map(keys => keys.map(key => key.toNamespacedString())), [["minecraft:stone", "minecraft:dirt", "custom:air"]]);
    t.is(await executor.submit(() => "reusable"), "reusable");
});

test.serial("a failed placement waits for its active wave and leaves later waves unstarted", async t => {
    t.timeout(3000);
    const executor = new BatchedExecutor(1, 2);
    const gate = deferred(), otherStarted = deferred();
    t.teardown(() => { gate.resolve(); executor.stop(); });
    const error = new Error("placement failed");
    const started: number[] = [];
    const { world } = fixture(t, async value => {
        started.push(value.position[0]);
        if (value.position[0] === 0) throw error;
        if (value.position[0] === 1) { otherStarted.resolve(); await gate.promise; }
    });
    let settled = false;
    const pending = world.placeMultiBlock(structure([block(0), block(1), block(2), block(3)]), true, executor);
    pending.then(() => { settled = true; }, () => { settled = true; });
    await otherStarted.promise;
    await delay(20);
    t.false(settled);
    t.deepEqual(started, [0, 1]);
    gate.resolve();
    await t.throwsAsync(pending, { is: error });
    t.deepEqual(started, [0, 1]);
    t.is(await executor.submit(() => "still reusable"), "still reusable");
});

test.serial("sequential placement keeps input order and does not use a supplied executor", async t => {
    t.timeout(3000);
    const executor = new BatchedExecutor(1, 2);
    executor.stop();
    const gate = deferred(), firstStarted = deferred();
    t.teardown(() => gate.resolve());
    const started: MultiBlockBlock[] = [];
    const { world } = fixture(t, async value => {
        started.push(value);
        if (started.length === 1) { firstStarted.resolve(); await gate.promise; }
    });
    const input = [block(0), block(1, "dirt"), block(0, "air")];
    const pending = world.placeMultiBlock(structure(input), false, executor);
    await firstStarted.promise;
    await delay(20);
    t.deepEqual(started, [input[0]]);
    gate.resolve();
    await pending;
    t.deepEqual(started, input);
});

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());
