import test from "ava";
import { AssetKey, AssetLoader, AssetSource, Caching, DisplayPosition, ItemTints, Models, PersistentCache, shutdown } from "../src";
import type { ItemModel, ItemModelContext, ItemTintSource, MinecraftAsset, Maybe, SpecialItemRenderer } from "../src";

class MemoryCache extends PersistentCache<Map<string, string>> {
    constructor() { super(new Map()); }
    async get<T>(key: string): Promise<T> {
        const value = this.backing.get(key);
        return value === undefined ? undefined as T : JSON.parse(value);
    }
    async put<T>(key: string, value: T): Promise<T> { this.backing.set(key, JSON.stringify(value)); return value; }
    async delete<T>(key: string): Promise<void> { this.backing.delete(key); }
    async clear(): Promise<void> { this.backing.clear(); }
    async length(): Promise<number> { return this.backing.size; }
    async keys(): Promise<string[]> { return [...this.backing.keys()]; }
    async forEach<T>(callback: (value: T, key: string) => void): Promise<void> {
        this.backing.forEach((value, key) => callback(JSON.parse(value), key));
    }
}

class FixtureSource extends AssetSource {
    readonly calls: AssetKey[] = [];
    constructor(private readonly assets: Record<string, unknown>) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<Maybe<T>> {
        this.calls.push(key);
        const asset = this.assets[`${key.assetType}/${key.getFullPath()}`];
        return asset === undefined ? undefined : JSON.parse(JSON.stringify(asset));
    }
}

const reference = (model: string) => ({ type: "minecraft:model", model });
const itemKey = (name: string) => new AssetKey("minecraft", name, "models", "item");
const bundleAssets = (): Record<string, unknown> => ({
    "items/bundle": { model: {
        type: "minecraft:select", property: "minecraft:display_context",
        cases: [{ when: "gui", model: {
            type: "minecraft:condition", property: "minecraft:bundle/has_selected_item",
            on_false: reference("minecraft:item/bundle"),
            on_true: { type: "minecraft:composite", models: [
                reference("minecraft:item/bundle_open_back"), { type: "minecraft:bundle/selected_item" },
                reference("minecraft:item/bundle_open_front")
            ] }
        } }],
        fallback: reference("minecraft:item/bundle")
    } },
    "models/item/bundle": { textures: { layer0: "item/bundle" } },
    "models/item/bundle_open_back": { textures: { layer0: "item/bundle_open_back" }, display: { gui: { translation: [0, 0, -16] } } },
    "models/item/bundle_open_front": { textures: { layer0: "item/bundle_open_front" }, display: { gui: { translation: [0, 0, 16] } } }
});
const originalCache = Models["_persistentCache"];
let defaults: Array<{ name: string; source: AssetSource }>;

test.beforeEach(() => {
    Caching.clear();
    Models["_persistentCache"] = new MemoryCache();
    defaults = [];
    for (const name of ["mcassets"]) {
        const source = AssetLoader.removeSource(name);
        if (source) defaults.push({ name, source });
    }
});
test.afterEach.always(() => {
    for (const name of ["test-items", "test-pack"]) AssetLoader.removeSource(name);
    for (const { name, source } of defaults.reverse()) AssetLoader.addSource(name, source);
    Models["_persistentCache"] = originalCache;
    Caching.clear();
});
test.after.always(() => shutdown());

test.serial("modern definitions win within a source, while higher-priority legacy packs still override", async t => {
    const source = new FixtureSource({
        "items/stone": { model: reference("minecraft:block/stone") },
        "models/block/stone": { textures: { all: "block/stone" } },
        "models/item/stone": { textures: { all: "legacy" } }
    });
    AssetLoader.addSource("test-items", source);
    t.is((await Models.getMerged(itemKey("stone")))?.textures?.all, "block/stone");
    t.false(source.calls.some(key => key.assetType === "models" && key.type === "item"));

    Caching.clear();
    await Models.clearCache();
    source.calls.length = 0;
    AssetLoader.addSource("test-pack", new FixtureSource({ "models/item/stone": { textures: { all: "pack" } } }));
    t.is((await Models.getMerged(itemKey("stone")))?.textures?.all, "pack");
    t.is(source.calls.length, 0);
});

test.serial("item references load raw models and preserve the requested root through parents and cache hits", async t => {
    const source = new FixtureSource({
        "items/diamond_sword": { model: reference("minecraft:item/diamond_sword") },
        "models/item/diamond_sword": { parent: "item/generated", textures: { layer0: "item/diamond_sword" } },
        "models/item/generated": { textures: { particle: "#layer0" } }
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("diamond_sword");
    key.root = "https://assets.example/1.21.11";
    const model = await Models.getMerged(key);
    t.is(model?.textures?.layer0, "item/diamond_sword");
    t.is(model?.textures?.particle, "#layer0");
    t.deepEqual(model?.key, key);
    t.true(source.calls.every(call => call.root === key.root && call.extension === ".json"));
    t.is(source.calls.filter(call => call.assetType === "items").length, 1);

    Caching.clear();
    const cached = await Models.getMerged(key);
    t.deepEqual(cached?.key, key);
    t.is(cached?.key?.serialize(), key.serialize());
});

test.serial("item aliases retain texture origins and per-item tints without changing shared raw models", async t => {
    const tints: ItemTintSource[] = [
        { type: "minecraft:grass", temperature: 0.5, downfall: 1 },
        { type: "minecraft:constant", value: 0 },
        { type: "minecraft:dye", default: [0.5, 0.25, 1] }
    ];
    const source = new FixtureSource({
        "items/grass": { model: { type: "minecraft:condition", on_false: { ...reference("minecraft:block/grass_block"), tints } } },
        "items/plain_grass": { model: reference("minecraft:block/grass_block") },
        "models/block/grass_block": { parent: "minecraft:block/grass_base" },
        "models/block/grass_base": { textures: { bottom: "block/dirt" } }
    });
    AssetLoader.addSource("test-items", source);
    const key = new AssetKey("custom", "grass", "models", "item", "assets", ".json", "https://pack.example/custom");
    const plainKey = new AssetKey("custom", "plain_grass", "models", "item", "assets", ".json", key.root);
    const definitionKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
    await Models["_persistentCache"]!.put(AssetLoader.persistentKey(definitionKey.serialize()), { key, textures: { bottom: "stale" } });
    for (let attempt = 0; attempt < 2; attempt++) {
        const model = (await Models.getMerged(key))! as ItemModel;
        t.deepEqual(model.tints, tints);
        t.is(model.key?.toNamespacedString(), "minecraft:block/grass_block");
        const textureKey = AssetKey.parse("textures", model.textures!.bottom, model.key);
        t.is(textureKey.toNamespacedString(), "minecraft:block/dirt");
        t.is(textureKey.root, key.root);
        t.is(((await Models.getMerged(plainKey))! as ItemModel).tints, undefined);
        t.is(((await Models.getRaw(model.key!))! as ItemModel).tints, undefined);
        Caching.clear();
    }
    t.is(source.calls.filter(key => key.assetType === "items").length, 2);
    t.true(source.calls.every(call => call.root === key.root));
});

test.serial("item tint components survive snapshots, composites, legacy parents, and persistent cache hits", async t => {
    const dye: ItemTintSource[] = [{ type: "dye", default: 0xffffff }];
    const source = new FixtureSource({
        "items/colored": { model: { type: "composite", models: [
            { ...reference("item/base"), tints: [{ type: "custom_model_data", default: 0xffffff }] },
            { type: "composite", models: [
                { ...reference("item/base"), tints: [{ type: "custom_model_data", index: 1, default: 0xffffff }] },
                { type: "bundle/selected_item" }
            ] }
        ] } },
        "items/selected": { model: { ...reference("item/base"), tints: dye } },
        "models/item/base": { parent: "item/parent", components: { "minecraft:dyed_color": 0x123456 }, textures: { layer0: "item/base" } },
        "models/item/parent": { components: { "custom:unrelated": true, "minecraft:dyed_color": 0xabcdef } },
        "models/item/legacy": { parent: "item/parent", tints: dye, components: { "minecraft:dyed_color": 0x123456 } }
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("colored");
    const components = { custom_model_data: { colors: [0xff0000, 0x0000ff] }, dyed_color: 0x00ff00 };
    const context = { components, itemReferences: { "bundle/selected_item": itemKey("selected") } };
    const previousKey = new AssetKey(key.namespace, key.path, "items").serialize()
        + Models["contextKey"](Models["snapshotContext"](key, context)).replace("|item-v4:", "|item-v3:");
    await Models["_persistentCache"]!.put(`item-v3:${AssetLoader.persistentKey(previousKey)}`, { key, textures: { layer0: "stale" } });
    const pending = Models.getMerged(key, context);
    components.custom_model_data.colors[0] = 0xffff00;
    const first = (await pending)! as ItemModel;
    const canonical = { components: { "minecraft:dyed_color": 0x00ff00,
        "minecraft:custom_model_data": { colors: [0xff0000, 0x0000ff] } }, itemReferences: context.itemReferences };
    t.is(await Models.getMerged(key, canonical), first);
    const palette = async (model: ItemModel) => Promise.all([
        ItemTints.get(model.parts![0]), ItemTints.get(model.parts![1].parts![0]), ItemTints.get(model.parts![1].parts![1])
    ]);
    t.deepEqual(await palette(first), [{ 0: 0xff0000 }, { 0: 0x0000ff }, { 0: 0xffffff }]);
    t.deepEqual(first.parts![0].components, canonical.components);
    t.deepEqual(first.parts![1].parts![1].components, {});
    const changed = (await Models.getMerged(key, context))! as ItemModel;
    t.deepEqual(await palette(changed), [{ 0: 0xffff00 }, { 0: 0x0000ff }, { 0: 0xffffff }]);
    const legacy = (await Models.getMerged(itemKey("legacy"), context))! as ItemModel;
    t.deepEqual(await ItemTints.get(legacy), { 0: 0x00ff00 });
    t.deepEqual(legacy.components, changed.parts![0].components);
    t.deepEqual(await ItemTints.get((await Models.getMerged(itemKey("legacy")))!), { 0: 0xffffff });
    t.deepEqual(((await Models.getRaw(itemKey("base")))! as ItemModel).components, { "minecraft:dyed_color": 0x123456 });
    const calls = source.calls.length;
    Caching.clear();
    t.deepEqual(await palette((await Models.getMerged(key, canonical))! as ItemModel), await palette(first));
    t.deepEqual(await palette((await Models.getMerged(key, context))! as ItemModel), await palette(changed));
    t.deepEqual(await ItemTints.get((await Models.getMerged(itemKey("legacy"), context))!), { 0: 0x00ff00 });
    t.is(source.calls.length, calls);
});

test.serial("static item previews resolve idle, GUI, fallback, and zero-threshold branches", async t => {
    const fixtures = [
        { type: "minecraft:condition", property: "minecraft:using_item", on_false: reference("item/preview"), on_true: reference("item/wrong") },
        { type: "minecraft:select", property: "minecraft:display_context", cases: [{ when: ["gui", "ground"], model: reference("item/preview") }], fallback: reference("item/wrong") },
        { type: "minecraft:select", property: "minecraft:trim_material", fallback: reference("item/preview") },
        { type: "minecraft:range_dispatch", entries: [{ threshold: 1, model: reference("item/wrong") }], fallback: reference("item/preview") },
        { type: "minecraft:range_dispatch", entries: [{ threshold: 0, model: reference("item/preview") }, { threshold: -1, model: reference("item/wrong") }, { threshold: 1, model: reference("item/wrong") }] }
    ];
    AssetLoader.addSource("test-items", new FixtureSource({
        ...Object.fromEntries(fixtures.map((model, index) => [`items/preview_${index}`, { model }])),
        "models/item/preview": { textures: { layer0: "preview" } }
    }));
    for (let index = 0; index < fixtures.length; index++) {
        t.is((await Models.getMerged(itemKey(`preview_${index}`)))?.textures?.layer0, "preview");
    }
});

test.serial("item-preview properties select typed branches and scaled ranges with canonical cache keys", async t => {
    const source = new FixtureSource({
        "items/stateful": { model: { type: "composite", models: [
            { type: "condition", property: "using_item", on_false: reference("item/idle"), on_true: {
                type: "range_dispatch", property: "minecraft:use_duration", scale: 0.05,
                entries: [0, 0.65, 0.9].map((threshold, index) => ({ threshold, model: reference(`item/pulling_${index}`) }))
            } },
            { type: "select", property: "custom:finish", cases: [
                { when: ["matte", "plain"], model: reference("item/matte") },
                { when: "glossy", model: reference("item/glossy") }
            ], fallback: reference("item/default") }
        ] } },
        ...Object.fromEntries(["idle", "pulling_0", "pulling_1", "pulling_2", "matte", "glossy", "default"]
            .map(name => [`models/item/${name}`, { textures: { layer0: name } }]))
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("stateful");
    const layers = (model: ItemModel) => model.parts!.map(part => part.textures?.layer0);
    const idle = (await Models.getMerged(key))! as ItemModel;
    t.deepEqual(layers(idle), ["idle", "default"]);
    t.is(await Models.getMerged(key, { displayContext: DisplayPosition.GUI, properties: {}, itemReferences: {} }), idle);
    for (const [duration, stage] of [[0, 0], [12.99, 0], [13, 1], [17.99, 1], [18, 2]]) {
        const model = (await Models.getMerged(key, { properties: { using_item: true, use_duration: duration, "custom:finish": "plain" } }))! as ItemModel;
        t.deepEqual(layers(model), [`pulling_${stage}`, "matte"]);
    }
    t.deepEqual(layers((await Models.getMerged(key, { properties: { using_item: false, use_duration: 18, "custom:finish": "glossy" } }))! as ItemModel), ["idle", "glossy"]);
    t.deepEqual(layers((await Models.getMerged(key, { properties: { "custom:finish": "unknown" } }))! as ItemModel), ["idle", "default"]);

    const context = { properties: { using_item: true, use_duration: 13, "custom:finish": "matte" },
        itemReferences: { unused: itemKey("unused"), "custom:unused": itemKey("other") } };
    const canonical = { properties: { "custom:finish": "matte", "minecraft:use_duration": 13, "minecraft:using_item": true },
        itemReferences: { "custom:unused": itemKey("other"), "minecraft:unused": itemKey("unused") } };
    const active = (await Models.getMerged(key, context))! as ItemModel;
    t.deepEqual(layers(active), ["pulling_1", "matte"]);
    t.is(await Models.getMerged(key, canonical), active);
    const calls = source.calls.length;
    Caching.clear();
    t.deepEqual(await Models.getMerged(key, canonical), active);
    t.deepEqual(await Models.getMerged(key), idle);
    t.is(source.calls.length, calls);

    for (const [properties, message] of [
        [{ using_item: "false" }, /requires a boolean/],
        [{ "custom:finish": false }, /requires a string/],
        [{ using_item: true, use_duration: "13" }, /requires a number/]
    ] as Array<[ItemModelContext["properties"], RegExp]>) {
        await t.throwsAsync(Models.getMerged(key, { properties }), { message });
    }
});

test.serial("invalid item-preview inputs reject before requesting assets", async t => {
    const source = new FixtureSource({});
    AssetLoader.addSource("test-items", source);
    const contexts = [
        { properties: { "Invalid ID": true } },
        { properties: { using_item: true, "minecraft:using_item": true } },
        { properties: { use_duration: NaN } },
        { properties: { use_duration: Infinity } },
        { properties: { using_item: null } },
        { properties: [] },
        { components: { custom_model_data: { floats: [Infinity] } } },
        { components: { custom_model_data: {}, "minecraft:custom_model_data": {} } },
        { components: { "Invalid ID": {} } },
        { components: { custom_data: { nested: undefined } } },
        { components: { custom_data: new Date() } },
        { components: [] },
        { count: -1 },
        { count: 1.5 },
        { count: NaN },
        { count: null },
        { itemReferences: { "Invalid ID": itemKey("apple") } },
        { itemReferences: { "bundle/selected_item": itemKey("apple"), "minecraft:bundle/selected_item": itemKey("apple") } },
        { itemReferences: { "bundle/selected_item": AssetKey.parse("models", "minecraft:block/stone") } },
        { itemReferences: { "bundle/selected_item": "minecraft:item/apple" } },
        { itemReferences: { "bundle/selected_item": itemKey("Invalid ID") } },
        { displayContext: "invalid" }
    ];
    for (const context of contexts) await t.throwsAsync(Models.getMerged(itemKey("preview"), context as ItemModelContext));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await t.throwsAsync(Models.getMerged(itemKey("preview"), { components: { custom_data: cyclic } }), { message: /circular/ });
    t.is(source.calls.length, 0);
});

test.serial("custom model data evaluates each node index and snapshots nested component cache inputs", async t => {
    const source = new FixtureSource({
        "items/data": { model: { type: "composite", models: [
            ...[undefined, 1, 8].map(index => ({ type: "condition", property: "custom_model_data", index,
                on_true: reference("item/yes"), on_false: reference("item/no") })),
            ...[undefined, 1, 8].map(index => ({ type: "select", property: "minecraft:custom_model_data", index,
                cases: ["left", "right"].map(when => ({ when, model: reference(`item/${when}`) })), fallback: reference("item/missing") })),
            ...[undefined, 1, 8].map(index => ({ type: "range_dispatch", property: "custom_model_data", index, scale: 2,
                entries: [{ threshold: 10, model: reference("item/high") }], fallback: reference("item/low") }))
        ] } },
        ...Object.fromEntries(["yes", "no", "left", "right", "missing", "high", "low"]
            .map(name => [`models/item/${name}`, { textures: { layer0: name } }]))
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("data");
    const components = { custom_model_data: { flags: [false, true], strings: ["left", "right"], floats: [2, 7] },
        "custom:payload": { nested: { a: 1, b: [2, 3] } } };
    const pending = Models.getMerged(key, { components });
    components.custom_model_data.flags[0] = true;
    components.custom_model_data.strings[0] = "right";
    components.custom_model_data.floats[1] = 0;
    components["custom:payload"].nested.b.reverse();
    const model = (await pending)! as ItemModel;
    t.deepEqual(model.parts!.map(part => part.textures?.layer0), ["no", "yes", "no", "left", "right", "missing", "low", "high", "low"]);
    const canonical = { "custom:payload": { nested: { b: [2, 3], a: 1 } },
        "minecraft:custom_model_data": { floats: [2, 7], strings: ["left", "right"], flags: [false, true] } };
    t.is(await Models.getMerged(key, { components: canonical }), model);
    const changed = (await Models.getMerged(key, { components }))! as ItemModel;
    t.deepEqual(changed.parts!.map(part => part.textures?.layer0), ["yes", "yes", "no", "right", "right", "missing", "low", "low", "low"]);
    const calls = source.calls.length;
    Caching.clear();
    t.deepEqual(await Models.getMerged(key, { components: canonical }), model);
    t.deepEqual(await Models.getMerged(key, { components }), changed);
    t.is(source.calls.length, calls);
    const absent = (await Models.getMerged(key))! as ItemModel;
    t.deepEqual(absent.parts!.map(part => part.textures?.layer0), ["no", "no", "no", "missing", "missing", "missing", "low", "low", "low"]);
});

test.serial("component selectors use named scalar and structured values while has_component checks presence", async t => {
    const values = [false, 3, "", { nested: { second: [1, 2], first: true } }, [{ id: "minecraft:arrow" }, { id: "minecraft:firework_rocket" }]];
    const source = new FixtureSource({
        "items/components": { model: { type: "composite", models: [
            ...values.map((when, index) => ({ type: "select", property: "component", component: `custom:value_${index}`,
                cases: [{ when, model: reference("item/match") }], fallback: reference("item/missing") })),
            { type: "condition", property: "has_component", component: "custom:value_0",
                on_true: reference("item/match"), on_false: reference("item/missing") }
        ] } },
        "items/alternatives": { model: { type: "select", property: "component", component: "custom:value",
            cases: [{ when: [{ value: 1 }, { value: 2 }], model: reference("item/match") }], fallback: reference("item/missing") } },
        "items/nondefault": { model: { type: "condition", property: "has_component", component: "custom:value", ignore_default: true,
            on_true: reference("item/match"), on_false: reference("item/missing") } },
        "models/item/match": { textures: { layer0: "match" } },
        "models/item/missing": { textures: { layer0: "missing" } }
    });
    AssetLoader.addSource("test-items", source);
    const components = Object.fromEntries(values.map((value, index) => [`custom:value_${index}`, value]));
    components["custom:value_3"] = { nested: { first: true, second: [1, 2] } };
    const model = (await Models.getMerged(itemKey("components"), { components }))! as ItemModel;
    t.deepEqual(model.parts!.map(part => part.textures?.layer0), Array(6).fill("match"));
    const reordered = (await Models.getMerged(itemKey("components"), { components: {
        ...components, "custom:value_4": [...values[4] as Array<unknown>].reverse()
    } }))! as ItemModel;
    t.is(reordered.parts![4].textures?.layer0, "missing");
    const absent = (await Models.getMerged(itemKey("components")))! as ItemModel;
    t.deepEqual(absent.parts!.map(part => part.textures?.layer0), Array(6).fill("missing"));
    t.is((await Models.getMerged(itemKey("alternatives"), { components: { "custom:value": { value: 2 } } }))?.textures?.layer0, "match");
    await t.throwsAsync(Models.getMerged(itemKey("nondefault"), { components: { "custom:value": false } }), { message: /ignore_default requires an explicit properties override/ });
    t.is((await Models.getMerged(itemKey("nondefault"), { properties: { has_component: false } }))?.textures?.layer0, "missing");
});

test.serial("damage and count ranges normalize, clamp, honor overrides, and invalidate earlier preview caches", async t => {
    const source = new FixtureSource({
        "items/amounts": { model: { type: "composite", models: [
            { type: "range_dispatch", property: "damage", entries: [{ threshold: 0, model: reference("item/zero") }, { threshold: 0.5, model: reference("item/half") }, { threshold: 1, model: reference("item/full") }], fallback: reference("item/missing") },
            { type: "range_dispatch", property: "damage", normalize: false, entries: [{ threshold: 50, model: reference("item/half") }], fallback: reference("item/zero") },
            { type: "range_dispatch", property: "count", entries: [{ threshold: 0.5, model: reference("item/half") }, { threshold: 1, model: reference("item/full") }], fallback: reference("item/zero") },
            { type: "range_dispatch", property: "count", normalize: false, entries: [{ threshold: 8, model: reference("item/full") }], fallback: reference("item/zero") }
        ] } },
        ...Object.fromEntries(["zero", "half", "full", "missing"].map(name => [`models/item/${name}`, { textures: { layer0: name } }]))
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("amounts");
    const definitionKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
    await Models["_persistentCache"]!.put(`item-v2:${AssetLoader.persistentKey(definitionKey.serialize())}`, { key, textures: { layer0: "stale" } });
    const layers = async (context: ItemModelContext = {}) => ((await Models.getMerged(key, context))! as ItemModel).parts!.map(part => part.textures?.layer0);
    t.deepEqual(await layers(), ["missing", "zero", "full", "zero"]);
    t.deepEqual(await layers({ count: 4, components: { damage: 50, max_damage: 100, max_stack_size: 8 } }), ["half", "half", "half", "zero"]);
    t.deepEqual(await layers({ count: 80, components: { damage: 150, max_damage: 100, max_stack_size: 8 } }), ["full", "half", "full", "full"]);
    t.deepEqual(await layers({ count: 0, components: { damage: -5, max_damage: 100, max_stack_size: 8 } }), ["zero", "zero", "zero", "zero"]);
    t.deepEqual(await layers({ count: 8, components: { damage: 100, max_damage: 100, max_stack_size: 8 }, properties: { damage: 0, count: 0 } }), ["zero", "zero", "zero", "zero"]);
    const calls = source.calls.length;
    Caching.clear();
    t.deepEqual(await layers({ count: 4, components: { max_stack_size: 8, max_damage: 100, damage: 50 } }), ["half", "half", "half", "zero"]);
    t.deepEqual(await layers(), ["missing", "zero", "full", "zero"]);
    t.is(source.calls.length, calls);
});

test.serial("block-state and charge selectors derive values from components unless overridden", async t => {
    const source = new FixtureSource({
        "items/selectors": { model: { type: "composite", models: [
            { type: "select", property: "block_state", block_state_property: "facing", cases: [{ when: "east", model: reference("item/east") }, { when: "", model: reference("item/empty") }], fallback: reference("item/missing") },
            { type: "select", property: "charge_type", cases: ["none", "arrow", "rocket"].map(when => ({ when, model: reference(`item/${when}`) })), fallback: reference("item/missing") }
        ] } },
        ...Object.fromEntries(["east", "empty", "missing", "none", "arrow", "rocket"].map(name => [`models/item/${name}`, { textures: { layer0: name } }]))
    });
    AssetLoader.addSource("test-items", source);
    const layers = async (context: ItemModelContext = {}) => ((await Models.getMerged(itemKey("selectors"), context))! as ItemModel).parts!.map(part => part.textures?.layer0);
    t.deepEqual(await layers(), ["missing", "none"]);
    t.deepEqual(await layers({ components: { block_state: { facing: "east" }, charged_projectiles: [] } }), ["east", "none"]);
    t.deepEqual(await layers({ components: { block_state: {}, charged_projectiles: [{ id: "minecraft:arrow" }] } }), ["missing", "arrow"]);
    const components = { block_state: { facing: "east" }, charged_projectiles: [{ id: "minecraft:arrow" }, { id: "firework_rocket" }] };
    t.deepEqual(await layers({ components }), ["east", "rocket"]);
    t.deepEqual(await layers({ components, properties: { block_state: "", charge_type: "none" } }), ["empty", "none"]);
});

test.serial("special items retain their renderer and inherit the base pose through cache hits", async t => {
    const renderers: SpecialItemRenderer[] = [
        { type: "minecraft:chest", texture: "pack:normal", openness: 0.5 },
        { type: "minecraft:bed", texture: "minecraft:red" },
        { type: "shulker_box", texture: "shulker" },
        { type: "minecraft:shulker_box", texture: "pack:shulker_blue", openness: 1.5, orientation: "west" },
        { type: "banner", color: "light_blue" },
        { type: "minecraft:banner", color: "black" },
        { type: "shield" },
        { type: "minecraft:shield" },
        { type: "trident" },
        { type: "minecraft:trident" },
        { type: "conduit" },
        { type: "minecraft:conduit" },
        { type: "minecraft:head", kind: "dragon", texture: "pack:dragon", animation: 0.25 }
    ];
    const display = { gui: { rotation: [30, 45, 0], scale: [0.625, 0.625, 0.625] } };
    const source = new FixtureSource({
        ...Object.fromEntries(renderers.map((model, index) => [`items/special_${index}`, { model: {
            type: "minecraft:condition", on_false: { type: "minecraft:special", base: "pack:item/base", model }
        } }])),
        "models/item/base": { parent: "pack:item/template", textures: { particle: "block/custom" } },
        "models/item/template": { parent: "minecraft:builtin/entity", display, gui_light: "front" }
    });
    AssetLoader.addSource("test-items", source);
    const components = { banner_patterns: [{ pattern: "cross", color: "white" }], base_color: "red" };
    for (let index = 0; index < renderers.length; index++) {
        const key = itemKey(`special_${index}`);
        key.root = "https://assets.example/1.21.11";
        for (let attempt = 0; attempt < 2; attempt++) {
            const model = (await Models.getMerged(key, { components }))! as ItemModel;
            t.deepEqual(model.special, renderers[index]);
            t.deepEqual(model.components, { "minecraft:banner_patterns": components.banner_patterns, "minecraft:base_color": "red" });
            t.deepEqual(model.display?.gui, display.gui);
            t.is(model.gui_light, "front");
            t.is(model.key?.toNamespacedString(), "pack:item/base");
            t.is(model.key?.root, key.root);
            Caching.clear();
        }
    }
    t.is(source.calls.filter(key => key.assetType === "items").length, renderers.length);
    t.false(source.calls.some(key => key.getFullPath() === "builtin/entity"));
    t.true(source.calls.every(key => key.root === "https://assets.example/1.21.11"));
});

test.serial("composite items retain ordered nested parts, independent inheritance, and keys through cache hits", async t => {
    const firstTint: ItemTintSource[] = [{ type: "minecraft:constant", value: 0xff0000 }];
    const lastTint: ItemTintSource[] = [{ type: "minecraft:constant", value: 0x0000ff }];
    const special: SpecialItemRenderer = { type: "minecraft:chest", texture: "pack:normal", openness: 0.5 };
    const source = new FixtureSource({
        "items/composite": { model: { type: "minecraft:composite", models: [
            { ...reference("pack:item/front"), tints: firstTint },
            { type: "minecraft:composite", models: [
                { type: "minecraft:select", property: "minecraft:display_context", cases: [{
                    when: "gui", model: { type: "minecraft:condition", on_false: reference("other:item/side") }
                }] },
                { type: "minecraft:special", base: "pack:item/chest_base", model: special }
            ] },
            { ...reference("pack:item/front"), tints: lastTint }
        ] } },
        "models/item/front": { parent: "pack:item/front_parent", textures: { layer0: "item/front" } },
        "models/item/front_parent": { textures: { particle: "#layer0" }, gui_light: "front", display: { gui: { translation: [1, 2, 3] } } },
        "models/item/side": { parent: "other:item/side_parent", textures: { layer0: "item/side" } },
        "models/item/side_parent": { gui_light: "side", display: { gui: { translation: [4, 5, 6] } } },
        "models/item/chest_base": { parent: "minecraft:builtin/entity", display: { gui: { scale: [0.5, 0.5, 0.5] } } }
    });
    AssetLoader.addSource("test-items", source);
    const key = new AssetKey("custom", "composite", "models", "item", "assets", ".json", "https://pack.example/composite");
    for (let attempt = 0; attempt < 2; attempt++) {
        const model = (await Models.getMerged(key))! as ItemModel;
        const [first, nested, last] = model.parts!;
        const [side, chest] = nested.parts!;
        t.is(model.key?.serialize(), key.serialize());
        t.deepEqual(model.parts!.map(part => part.key?.toNamespacedString()), [
            "pack:item/front", "custom:item/composite", "pack:item/front"
        ]);
        t.deepEqual([first.tints, last.tints], [firstTint, lastTint]);
        t.deepEqual([first.gui_light, side.gui_light], ["front", "side"]);
        t.deepEqual([first.display?.gui?.translation, side.display?.gui?.translation], [[1, 2, 3], [4, 5, 6]]);
        t.deepEqual(chest.special, special);
        t.deepEqual(chest.display?.gui?.scale, [0.5, 0.5, 0.5]);
        t.is(first.textures?.particle, "#layer0");
        for (const part of [first, nested, last, side, chest]) t.is(part.key?.root, key.root);
        t.is(AssetKey.parse("textures", side.textures!.layer0, side.key).toNamespacedString(), "other:item/side");
        t.is(((await Models.getRaw(first.key!))! as ItemModel).tints, undefined);
        Caching.clear();
    }
    t.is(source.calls.filter(call => call.assetType === "items").length, 1);
    t.true(source.calls.every(call => call.root === key.root));
});

test.serial("trident item definitions keep flat display contexts and select held or throwing poses", async t => {
    const held = { rotation: [0, 60, 0], translation: [11, 17, -2], scale: [1, 1, 1] };
    const throwing = { rotation: [0, 90, 180], translation: [8, -17, 9], scale: [1, 1, 1] };
    AssetLoader.addSource("test-items", new FixtureSource({
        "items/trident": { model: {
            type: "minecraft:select", property: "minecraft:display_context",
            cases: [{ when: ["gui", "ground", "fixed", "on_shelf"], model: reference("minecraft:item/trident") }],
            fallback: { type: "minecraft:condition", property: "minecraft:using_item",
                on_false: { type: "minecraft:special", base: "minecraft:item/trident_in_hand", model: { type: "minecraft:trident" } },
                on_true: { type: "minecraft:special", base: "minecraft:item/trident_throwing", model: { type: "minecraft:trident" } }
            }
        } },
        "models/item/trident": { textures: { layer0: "item/trident" } },
        "models/item/trident_in_hand": { gui_light: "front", display: { thirdperson_righthand: held } },
        "models/item/trident_throwing": { gui_light: "front", display: { thirdperson_righthand: throwing } }
    }));
    const key = itemKey("trident");
    t.is(((await Models.getMerged(key))! as ItemModel).special, undefined);
    for (const displayContext of [DisplayPosition.GUI, DisplayPosition.GROUND, DisplayPosition.FIXED, DisplayPosition.ON_SHELF]) {
        const model = (await Models.getMerged(key, { displayContext, properties: { using_item: true } }))! as ItemModel;
        t.is(model.special, undefined);
        t.is(model.textures?.layer0, "item/trident");
    }
    for (const displayContext of [DisplayPosition.THIRDPERSON_RIGHTHAND, DisplayPosition.THIRDPERSON_LEFTHAND,
        DisplayPosition.FIRSTPERSON_RIGHTHAND, DisplayPosition.FIRSTPERSON_LEFTHAND, DisplayPosition.HEAD, "none"] as const) {
        for (const usingItem of [false, true]) {
            const model = (await Models.getMerged(key, { displayContext, properties: { "minecraft:using_item": usingItem } }))! as ItemModel;
            t.deepEqual(model.special, { type: "minecraft:trident" });
            t.is(model.key?.path, usingItem ? "trident_throwing" : "trident_in_hand");
            t.deepEqual(model.display?.thirdperson_righthand, usingItem ? throwing : held);
            t.is(model.gui_light, "front");
        }
    }
});

test.serial("empty composites remain empty and a missing child rejects the complete item", async t => {
    const assets: Record<string, unknown> = {
        "items/empty": { model: { type: "minecraft:composite", models: [] } },
        "items/broken": { model: { type: "minecraft:composite", models: [reference("item/first"), reference("item/missing")] } },
        "models/item/first": { textures: { layer0: "item/first" } }
    };
    AssetLoader.addSource("test-items", new FixtureSource(assets));
    t.deepEqual(((await Models.getMerged(itemKey("empty")))! as ItemModel).parts, []);
    await t.throwsAsync(Models.getMerged(itemKey("broken")), { message: /references missing model item\/missing/ });
    assets["models/item/missing"] = { textures: { layer0: "item/recovered" } };
    const recovered = (await Models.getMerged(itemKey("broken")))! as ItemModel;
    t.deepEqual(recovered.parts!.map(part => part.textures?.layer0), ["item/first", "item/recovered"]);
});

test.serial("bundle properties and references stay independent through display-context and persistent cache changes", async t => {
    const tints: ItemTintSource[] = [{ type: "minecraft:constant", value: 0xff8844 }];
    const source = new FixtureSource({
        ...bundleAssets(),
        "items/apple": { model: { ...reference("pack:item/apple"), tints } },
        "models/item/apple": { textures: { layer0: "item/apple" }, gui_light: "front" },
        "items/stone": { model: reference("minecraft:block/stone") },
        "models/block/stone": { parent: "minecraft:block/cube", textures: { all: "block/stone" } },
        "models/block/cube": { display: { gui: { scale: [0.625, 0.625, 0.625] } } },
        "models/item/stone": { textures: { layer0: "wrong-legacy-model" } }
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("bundle"), appleKey = itemKey("apple"), stoneKey = itemKey("stone");
    const properties = { "bundle/has_selected_item": true };
    const appleReferences = { "bundle/selected_item": appleKey };
    let calls = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        const closed = (await Models.getMerged(key))! as ItemModel;
        t.is(closed.parts, undefined);
        t.is(closed.textures?.layer0, "item/bundle");
        const referenceOnly = (await Models.getMerged(key, { itemReferences: appleReferences }))! as ItemModel;
        t.is(referenceOnly.parts, undefined);
        const propertyOnly = (await Models.getMerged(key, { properties }))! as ItemModel;
        t.deepEqual(propertyOnly.parts![1].parts, []);
        const apple = (await Models.getMerged(key, { properties, itemReferences: appleReferences }))! as ItemModel;
        t.deepEqual(apple.parts!.map(part => part.key?.toNamespacedString()), [
            "minecraft:item/bundle_open_back", "pack:item/apple", "minecraft:item/bundle_open_front"
        ]);
        t.deepEqual(apple.parts![1].tints, tints);
        t.is(apple.parts![1].gui_light, "front");
        t.deepEqual([apple.parts![0].display?.gui?.translation, apple.parts![2].display?.gui?.translation], [[0, 0, -16], [0, 0, 16]]);
        const stone = (await Models.getMerged(key, { displayContext: DisplayPosition.GUI, properties,
            itemReferences: { "bundle/selected_item": stoneKey } }))! as ItemModel;
        t.is(stone.parts![1].key?.toNamespacedString(), "minecraft:block/stone");
        t.deepEqual(stone.parts![1].display?.gui?.scale, [0.625, 0.625, 0.625]);
        t.is(stone.parts![1].tints, undefined);
        for (const displayContext of [DisplayPosition.GROUND, "none"] as const) {
            const other = (await Models.getMerged(key, { displayContext, properties, itemReferences: appleReferences }))! as ItemModel;
            t.is(other.parts, undefined);
            t.is(other.textures?.layer0, "item/bundle");
        }
        t.deepEqual(await Models.getMerged(key, { displayContext: DisplayPosition.GUI,
            properties: { ...properties, display_context: "ground" }, itemReferences: appleReferences }), apple);
        t.deepEqual(await Models.getMerged(key), closed);
        if (attempt) t.is(source.calls.length, calls);
        calls = source.calls.length;
        Caching.clear();
    }
});

test.serial("item-preview inputs are snapshotted and referenced items preserve their renderer and asset root", async t => {
    const special: SpecialItemRenderer = { type: "minecraft:chest", texture: "pack:normal", openness: 0.25 };
    const source = new FixtureSource({
        ...bundleAssets(),
        "items/chest": { model: { type: "minecraft:special", base: "pack:item/chest_base", model: special } },
        "models/item/chest_base": { parent: "minecraft:builtin/entity", display: { gui: { scale: [0.5, 0.5, 0.5] } } }
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("bundle");
    key.root = "https://pack.example/bundle";
    const properties = { "bundle/has_selected_item": true };
    const inheritedKey = Object.freeze(itemKey("chest"));
    const inherited = (await Models.getMerged(key, { properties, itemReferences: { "bundle/selected_item": inheritedKey } }))! as ItemModel;
    t.is(inherited.parts![1].key?.root, key.root);
    t.is(inheritedKey.root, undefined);
    t.deepEqual(inherited.parts![1].special, special);
    t.deepEqual(inherited.parts![1].display?.gui?.scale, [0.5, 0.5, 0.5]);

    const selectedKey = itemKey("chest");
    selectedKey.root = "https://pack.example/first";
    const itemReferences = { "bundle/selected_item": selectedKey };
    const pending = Models.getMerged(key, { properties, itemReferences });
    properties["bundle/has_selected_item"] = false;
    itemReferences["bundle/selected_item"] = itemKey("missing");
    selectedKey.root = "https://pack.example/second";
    const first = (await pending)! as ItemModel;
    properties["bundle/has_selected_item"] = true;
    itemReferences["bundle/selected_item"] = selectedKey;
    const second = (await Models.getMerged(key, { properties, itemReferences }))! as ItemModel;
    t.deepEqual([first.parts![1].key?.root, second.parts![1].key?.root], ["https://pack.example/first", "https://pack.example/second"]);
    t.true(first.parts!.filter((_, index) => index !== 1).every(part => part.key?.root === key.root));
    const calls = source.calls.length;
    Caching.clear();
    selectedKey.root = "https://pack.example/first";
    const cached = (await Models.getMerged(key, { properties, itemReferences }))! as ItemModel;
    t.is(cached.parts![1].key?.serialize(), first.parts![1].key?.serialize());
    t.deepEqual(cached.parts![1].special, special);
    t.is(source.calls.length, calls);
    t.deepEqual(source.calls.filter(call => call.assetType === "items" && call.path === "chest").map(call => call.root), [
        key.root, "https://pack.example/first", "https://pack.example/second"
    ]);
});

test.serial("referenced items retain display context but start with their own stack state and references", async t => {
    const source = new FixtureSource({
        ...bundleAssets(),
        "items/selected_only": { model: { type: "bundle/selected_item" } },
        "items/shield": { model: { type: "special", base: "item/shield", model: { type: "shield" } } },
        "models/item/shield": { parent: "builtin/entity" },
        "items/contextual": { model: {
            type: "minecraft:condition", property: "minecraft:using_item", on_true: reference("item/wrong"),
            on_false: { type: "condition", property: "custom_model_data", on_true: reference("item/wrong"), on_false: {
                type: "range_dispatch", property: "count", normalize: false,
                fallback: reference("item/wrong"), entries: [{ threshold: 1, model: {
                    type: "minecraft:select", property: "minecraft:display_context",
                    cases: [{ when: "ground", model: reference("item/ground") }], fallback: reference("item/gui")
                } }]
            } }
        } },
        "models/item/ground": { textures: { layer0: "ground" } },
        "models/item/gui": { textures: { layer0: "gui" } }
    });
    AssetLoader.addSource("test-items", source);
    const empty = (await Models.getMerged(itemKey("selected_only")))! as ItemModel;
    t.deepEqual(empty.parts, []);
    const properties = { "bundle/has_selected_item": true };
    const bundle = (await Models.getMerged(itemKey("bundle"), { properties,
        itemReferences: { "bundle/selected_item": itemKey("bundle") } }))! as ItemModel;
    t.is(bundle.parts!.length, 3);
    t.is(bundle.parts![1].parts, undefined);
    t.is(bundle.parts![1].textures?.layer0, "item/bundle");
    const ground = await Models.getMerged(itemKey("selected_only"), {
        displayContext: DisplayPosition.GROUND, properties: { using_item: true },
        count: 0, components: { custom_model_data: { flags: [true] } },
        itemReferences: { "bundle/selected_item": itemKey("contextual") }
    });
    t.is(ground?.textures?.layer0, "ground");
    const shield = (await Models.getMerged(itemKey("selected_only"), {
        components: { base_color: "red", banner_patterns: [{ pattern: "cross", color: "black" }] },
        itemReferences: { "bundle/selected_item": itemKey("shield") }
    }))! as ItemModel;
    t.deepEqual(shield.special, { type: "shield" });
    t.deepEqual(shield.components, {});
    t.deepEqual(((await Models.getMerged(itemKey("selected_only"), {
        itemReferences: { "bundle/selected_item": itemKey("selected_only") }
    }))! as ItemModel).parts, []);
    await t.throwsAsync(Models.getMerged(itemKey("bundle"), { properties,
        itemReferences: { "bundle/selected_item": itemKey("missing") } }), { message: /missing/ });
    t.false(source.calls.some(call => call.getFullPath() === "item/wrong"));
});

test.serial("unsupported or broken definitions reject instead of using lower-priority assets", async t => {
    const source = new FixtureSource({ "models/item/invalid": { textures: { layer0: "wrong" } } });
    AssetLoader.addSource("test-items", source);
    for (const model of [{ type: "minecraft:special" }, { type: "minecraft:composite" }, {}]) {
        AssetLoader.addSource("test-pack", new FixtureSource({ "items/invalid": { model } }));
        await t.throwsAsync(Models.getMerged(itemKey("invalid")), { message: /Unsupported item model .*minecraft:item\/invalid/ });
    }
    t.is(source.calls.length, 0);
    AssetLoader.addSource("test-pack", new FixtureSource({ "items/missing": { model: reference("item/missing_reference") } }));
    await t.throwsAsync(Models.getMerged(itemKey("missing")), { message: /references missing model item\/missing_reference/ });
    AssetLoader.addSource("test-pack", new FixtureSource({ "items/invalid": { model: {
        type: "minecraft:special", base: "item/base", model: { type: "minecraft:decorated_pot" }
    } } }));
    await t.throwsAsync(Models.getMerged(itemKey("invalid")), { message: /Unsupported special item renderer minecraft:decorated_pot/ });
    for (const color of [undefined, null, "rainbow", "toString", 0xff0000]) {
        AssetLoader.addSource("test-pack", new FixtureSource({ "items/invalid": { model: {
            type: "special", base: "item/base", model: { type: "banner", color }
        } } }));
        await t.throwsAsync(Models.getMerged(itemKey("invalid")), { message: /Unsupported special item renderer banner/ });
    }
    for (const options of [{ texture: "" }, { orientation: "sideways" }, { openness: "1" }, { openness: null }]) {
        AssetLoader.addSource("test-pack", new FixtureSource({ "items/invalid": { model: {
            type: "special", base: "item/base", model: { type: "minecraft:shulker_box", texture: "shulker", ...options }
        } } }));
        await t.throwsAsync(Models.getMerged(itemKey("invalid")), { message: /Unsupported special item renderer minecraft:shulker_box/ });
    }
});

test.serial("item lists use modern definitions and retain legacy source fallback", async t => {
    const source = new FixtureSource({
        "items/_list": { files: ["stone", "diamond_sword"], directories: [] },
        "models/item/_list": { files: ["diamond_sword"], directories: [] }
    });
    AssetLoader.addSource("test-items", source);
    t.deepEqual(await Models.getItemList(), ["stone", "diamond_sword"]);
    Caching.clear();
    source.calls.length = 0;
    AssetLoader.addSource("test-pack", new FixtureSource({ "models/item/_list": { files: ["pack_item"], directories: [] } }));
    t.deepEqual(await Models.getItemList(), ["pack_item"]);
    t.is(source.calls.length, 0);
});
