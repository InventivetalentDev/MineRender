import test from "ava";
import { AssetLoader, BlockStates, Caching, Entities, shutdown } from "../src";

const originalGet = AssetLoader.get;
test.beforeEach(() => Caching.clear());
test.afterEach.always(() => { AssetLoader.get = originalGet; Caching.clear(); });
test.after.always(() => shutdown());

const cases = [
    { name: "blockstate list", load: () => BlockStates.getList(), asset: { directories: [], files: ["stone"] }, expected: ["stone"], missing: [] },
    { name: "default blockstates", load: () => BlockStates.getDefaultStates(), asset: { "minecraft:stone": {} }, expected: { "minecraft:stone": {} }, missing: undefined },
    { name: "entity models", load: () => Entities.getEntityModels(), asset: { "minecraft:pig": [] }, expected: { "minecraft:pig": [] }, missing: undefined },
    { name: "block entity models", load: () => Entities.getBlockEntityModels(), asset: { "minecraft:chest": [] }, expected: { "minecraft:chest": [] }, missing: undefined }
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
