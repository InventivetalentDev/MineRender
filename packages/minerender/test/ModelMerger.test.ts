import test from "ava";
import { Models } from "../src/assets/Models";
import { ModelMerger } from "../src/model/ModelMerger";
import type { Model } from "../src/model/Model";
import type { ModelElement } from "../src/model/ModelElement";

const originalGetRaw = Models.getRaw;
test.afterEach.always(() => { Models.getRaw = originalGetRaw; });

function element(size: number): ModelElement {
    return { from: [0, 0, 0], to: [size, size, size], faces: { north: { texture: "#side" } } };
}

function parents(models: Record<string, Model>) {
    Models.getRaw = async key => models[key.toNamespacedString()];
}

test.serial("child geometry replaces ancestor elements while texture dictionaries inherit and override", async t => {
    const grandparent: Model = {
        elements: [element(16)],
        textures: { particle: "#side", side: "block/stone", bottom: "block/dirt" }
    };
    const parent: Model = {
        parent: "minecraft:block/base",
        elements: [element(8)],
        textures: { side: "block/andesite" }
    };
    const child: Model = {
        parent: "minecraft:block/parent",
        elements: [element(4)],
        textures: { bottom: "block/grass_block_top" }
    };
    const originals = structuredClone([grandparent, parent, child]);
    parents({ "minecraft:block/base": grandparent, "minecraft:block/parent": parent });

    const merged = await ModelMerger.mergeWithParents(child);
    t.deepEqual(merged.elements, [element(4)]);
    t.deepEqual(merged.textures, { particle: "#side", side: "block/andesite", bottom: "block/grass_block_top" });
    t.deepEqual([grandparent, parent, child], originals);
});

test.serial("omitted elements inherit the nearest ancestor geometry", async t => {
    const grandparent: Model = { elements: [element(16)] };
    const parent: Model = { parent: "minecraft:block/base", elements: [element(8)] };
    parents({ "minecraft:block/base": grandparent, "minecraft:block/parent": parent });

    const merged = await ModelMerger.mergeWithParents({ parent: "minecraft:block/parent" });
    t.deepEqual(merged.elements, [element(8)]);

    parents({ "minecraft:block/base": grandparent, "minecraft:block/parent": { parent: "minecraft:block/base" } });
    t.deepEqual((await ModelMerger.mergeWithParents({ parent: "minecraft:block/parent" })).elements, [element(16)]);
});

test.serial("explicit empty elements clear inherited geometry and remain empty in descendants", async t => {
    const parent: Model = { elements: [element(16)], textures: { side: "block/stone" } };
    const empty: Model = { parent: "minecraft:block/base", elements: [] };
    parents({ "minecraft:block/base": parent, "minecraft:block/empty": empty });

    const merged = await ModelMerger.mergeWithParents(empty);
    t.deepEqual(merged.elements, []);
    t.deepEqual(merged.textures, parent.textures);
    t.deepEqual((await ModelMerger.mergeWithParents({ parent: "minecraft:block/empty" })).elements, []);
    t.deepEqual(parent.elements, [element(16)]);
});

test.serial("display contexts inherit as whole entries, including explicit empty and identity poses", async t => {
    const parent: Model = { display: {
        gui: { translation: [1, 2, 3], rotation: [30, 45, 0], scale: [2, 2, 2] },
        ground: { translation: [0, 4, 0], scale: [0.5, 0.5, 0.5] },
        head: { rotation: [0, 90, 0] },
        fixed: { translation: [3, 4, 5] }
    } };
    const child: Model = { parent: "test:item/base", display: {
        gui: { translation: [6, 7, 8] },
        head: {},
        fixed: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    } };
    const originals = structuredClone([parent, child]);
    parents({ "test:item/base": parent, "test:item/child": child });

    const merged = await ModelMerger.mergeWithParents({ parent: "test:item/child" });
    t.deepEqual(merged.display, { ...child.display, ground: parent.display!.ground });
    t.deepEqual([parent, child], originals);
});

test.serial("left-hand fallback uses each raw model's right-hand pose before parent inheritance", async t => {
    const parent: Model = { display: {
        firstperson_righthand: { translation: [1, 2, 3] },
        firstperson_lefthand: { translation: [4, 5, 6] },
        thirdperson_righthand: { rotation: [0, 30, 0] }
    } };
    const child: Model = { parent: "test:item/base", display: {
        firstperson_righthand: { scale: [2, 2, 2] },
        thirdperson_lefthand: {}
    } };
    const originals = structuredClone([parent, child]);
    parents({ "test:item/base": parent, "test:item/child": child });

    const merged = await ModelMerger.mergeWithParents({ parent: "test:item/child" });
    t.deepEqual(merged.display, {
        firstperson_righthand: { scale: [2, 2, 2] },
        firstperson_lefthand: { scale: [2, 2, 2] },
        thirdperson_righthand: { rotation: [0, 30, 0] },
        thirdperson_lefthand: {}
    });
    const inherited = await ModelMerger.mergeWithParents({ parent: "test:item/base" });
    t.deepEqual(inherited.display!.thirdperson_lefthand, parent.display!.thirdperson_righthand);
    t.deepEqual([parent, child], originals);
});
