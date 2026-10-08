import test from "ava";
import { AssetKey, AssetLoader, AssetSource, Caching, DisplayPosition, Models, PersistentCache, shutdown } from "../src";
import type { ItemModel, ItemTintSource, MinecraftAsset, Maybe, SpecialItemRenderer } from "../src";

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
    for (const name of ["mcassets", "mcassets-fallback"]) {
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

test.serial("special items retain their renderer and inherit the base pose through cache hits", async t => {
    const renderers: SpecialItemRenderer[] = [
        { type: "minecraft:chest", texture: "pack:normal", openness: 0.5 },
        { type: "minecraft:bed", texture: "minecraft:red" },
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
    for (let index = 0; index < renderers.length; index++) {
        const key = itemKey(`special_${index}`);
        key.root = "https://assets.example/1.21.11";
        for (let attempt = 0; attempt < 2; attempt++) {
            const model = (await Models.getMerged(key))! as ItemModel;
            t.deepEqual(model.special, renderers[index]);
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

test.serial("bundle previews keep selected items and display contexts separate through persistent cache hits", async t => {
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
    let calls = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        const closed = (await Models.getMerged(key))! as ItemModel;
        t.is(closed.parts, undefined);
        t.is(closed.textures?.layer0, "item/bundle");
        const apple = (await Models.getMerged(key, { bundleSelectedItem: appleKey }))! as ItemModel;
        t.deepEqual(apple.parts!.map(part => part.key?.toNamespacedString()), [
            "minecraft:item/bundle_open_back", "pack:item/apple", "minecraft:item/bundle_open_front"
        ]);
        t.deepEqual(apple.parts![1].tints, tints);
        t.is(apple.parts![1].gui_light, "front");
        t.deepEqual([apple.parts![0].display?.gui?.translation, apple.parts![2].display?.gui?.translation], [[0, 0, -16], [0, 0, 16]]);
        const stone = (await Models.getMerged(key, { displayContext: DisplayPosition.GUI, bundleSelectedItem: stoneKey }))! as ItemModel;
        t.is(stone.parts![1].key?.toNamespacedString(), "minecraft:block/stone");
        t.deepEqual(stone.parts![1].display?.gui?.scale, [0.625, 0.625, 0.625]);
        t.is(stone.parts![1].tints, undefined);
        for (const displayContext of [DisplayPosition.GROUND, "none"] as const) {
            const other = (await Models.getMerged(key, { displayContext, bundleSelectedItem: appleKey }))! as ItemModel;
            t.is(other.parts, undefined);
            t.is(other.textures?.layer0, "item/bundle");
        }
        t.deepEqual(await Models.getMerged(key, { displayContext: DisplayPosition.GUI, bundleSelectedItem: appleKey }), apple);
        t.deepEqual(await Models.getMerged(key), closed);
        if (attempt) t.is(source.calls.length, calls);
        calls = source.calls.length;
        Caching.clear();
    }
});

test.serial("selected bundle items preserve their renderer and inherit or explicitly override the asset root", async t => {
    const special: SpecialItemRenderer = { type: "minecraft:chest", texture: "pack:normal", openness: 0.25 };
    const source = new FixtureSource({
        ...bundleAssets(),
        "items/chest": { model: { type: "minecraft:special", base: "pack:item/chest_base", model: special } },
        "models/item/chest_base": { parent: "minecraft:builtin/entity", display: { gui: { scale: [0.5, 0.5, 0.5] } } }
    });
    AssetLoader.addSource("test-items", source);
    const key = itemKey("bundle");
    key.root = "https://pack.example/bundle";
    const inheritedKey = Object.freeze(itemKey("chest"));
    const inherited = (await Models.getMerged(key, { bundleSelectedItem: inheritedKey }))! as ItemModel;
    t.is(inherited.parts![1].key?.root, key.root);
    t.is(inheritedKey.root, undefined);
    t.deepEqual(inherited.parts![1].special, special);
    t.deepEqual(inherited.parts![1].display?.gui?.scale, [0.5, 0.5, 0.5]);

    const selectedKey = itemKey("chest");
    selectedKey.root = "https://pack.example/first";
    const pending = Models.getMerged(key, { bundleSelectedItem: selectedKey });
    selectedKey.root = "https://pack.example/second";
    const first = (await pending)! as ItemModel;
    const second = (await Models.getMerged(key, { bundleSelectedItem: selectedKey }))! as ItemModel;
    t.deepEqual([first.parts![1].key?.root, second.parts![1].key?.root], ["https://pack.example/first", "https://pack.example/second"]);
    t.true(first.parts!.filter((_, index) => index !== 1).every(part => part.key?.root === key.root));
    const calls = source.calls.length;
    Caching.clear();
    selectedKey.root = "https://pack.example/first";
    const cached = (await Models.getMerged(key, { bundleSelectedItem: selectedKey }))! as ItemModel;
    t.is(cached.parts![1].key?.serialize(), first.parts![1].key?.serialize());
    t.deepEqual(cached.parts![1].special, special);
    t.is(source.calls.length, calls);
    t.deepEqual(source.calls.filter(call => call.assetType === "items" && call.path === "chest").map(call => call.root), [
        key.root, "https://pack.example/first", "https://pack.example/second"
    ]);
});

test.serial("bundle selection does not recurse into selected bundles and keeps unrelated condition defaults", async t => {
    const source = new FixtureSource({
        ...bundleAssets(),
        "items/selected_only": { model: { type: "minecraft:bundle/selected_item" } },
        "items/contextual": { model: {
            type: "minecraft:condition", property: "minecraft:using_item", on_true: reference("item/wrong"),
            on_false: { type: "minecraft:select", property: "minecraft:display_context",
                cases: [{ when: "ground", model: reference("item/ground") }], fallback: reference("item/gui") }
        } },
        "models/item/ground": { textures: { layer0: "ground" } },
        "models/item/gui": { textures: { layer0: "gui" } }
    });
    AssetLoader.addSource("test-items", source);
    const empty = (await Models.getMerged(itemKey("selected_only")))! as ItemModel;
    t.deepEqual(empty.parts, []);
    const bundle = (await Models.getMerged(itemKey("bundle"), { bundleSelectedItem: itemKey("bundle") }))! as ItemModel;
    t.is(bundle.parts!.length, 3);
    t.is(bundle.parts![1].parts, undefined);
    t.is(bundle.parts![1].textures?.layer0, "item/bundle");
    const ground = await Models.getMerged(itemKey("selected_only"), {
        displayContext: DisplayPosition.GROUND, bundleSelectedItem: itemKey("contextual")
    });
    t.is(ground?.textures?.layer0, "ground");
    await t.throwsAsync(Models.getMerged(itemKey("bundle"), { bundleSelectedItem: itemKey("missing") }), { message: /missing/ });
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
        type: "minecraft:special", base: "item/base", model: { type: "minecraft:shield" }
    } } }));
    await t.throwsAsync(Models.getMerged(itemKey("invalid")), { message: /Unsupported special item renderer minecraft:shield/ });
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
