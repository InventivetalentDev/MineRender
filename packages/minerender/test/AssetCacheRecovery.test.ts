import test from "ava";
import { AssetKey, AssetLoader, BasicAssetKey, BlockStates, Caching, Entities, shutdown } from "../src";
import type { EntityModelLayer } from "../src/entity/EntityModel";

const originalGet = AssetLoader.get;
test.beforeEach(() => Caching.clear());
test.afterEach.always(() => { AssetLoader.get = originalGet; Caching.clear(); });
test.after.always(() => shutdown());

const entityKey = new BasicAssetKey("minecraft", "pig");
const main: EntityModelLayer = {
    texture: [64, 32],
    root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} }
};
const entityLayer = { key: entityKey, texture: new AssetKey("minecraft", "pig", "textures", "entity", "assets", ".png"), layer: main };

const cases = [
    { name: "blockstate list", load: () => BlockStates.getList(), asset: { directories: [], files: ["stone"] }, expected: ["stone"], missing: [] },
    { name: "entity model files", load: () => Entities.getEntity(entityKey, entityKey), asset: { id: "minecraft:pig", layers: { main } }, expected: { ...entityLayer, id: "minecraft:pig", layers: { main: entityLayer } }, missing: undefined },
    { name: "entity list", load: () => Entities.getEntityList(), asset: { directories: [], files: ["pig.json"] }, expected: ["pig"], missing: [] }
];

for (const fixture of cases) {
    test.serial(`${fixture.name} shares pending loads and recovers after failures or misses`, async t => {
        const failure = new Error("temporary failure");
        let reject!: (error: Error) => void;
        const pending = new Promise<never>((_, rejectPromise) => { reject = rejectPromise; });
        let calls = 0;
        AssetLoader.get = (async () => {
            calls++;
            if (calls === 1) return pending;
            return calls === 2 ? undefined : fixture.asset;
        }) as typeof AssetLoader.get;

        const first = fixture.load();
        const second = fixture.load();
        t.is(calls, 1);
        const failures = [t.throwsAsync(first, { is: failure }), t.throwsAsync(second, { is: failure })];
        reject(failure);
        await Promise.all(failures);

        t.deepEqual(await fixture.load(), fixture.missing);
        t.deepEqual(await fixture.load(), fixture.expected);
        t.deepEqual(await fixture.load(), fixture.expected);
        t.is(calls, 3);

        Caching.clear();
        t.deepEqual(await fixture.load(), fixture.expected);
        t.is(calls, 4);
    });
}
