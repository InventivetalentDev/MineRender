import { AssetKey, DisplayPosition, ModelObject, Models, type ItemModelContext } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { esmRenderer, fillList, frameObject, scriptSnippet, selectControl, textControl } from "./shared";

export const ITEM_RENDERER = {
    camera: {
        position: [8, 6, 34] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

function itemKey(name: string): AssetKey {
    return new AssetKey("minecraft", name, "models", "item", "assets");
}

export const generated: Example = {
    id: "item-generated",
    title: "Item",
    description: "Flat item models get their 16×16 texture extruded into a one-pixel-thick model, the same way the game does it.",
    renderer: ITEM_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: ModelObject | undefined;
        const show = async (name: string) => {
            const model = await Models.getMerged(itemKey(name));
            if (!model) throw new Error(`Unknown item "${name}"`);
            if (signal.aborted) return;
            // Without instancing the scene returns the ModelObject itself, which can be removed again.
            const next = await renderer.scene.addModel(model, { instanceMeshes: false }) as ModelObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
        };
        await show("diamond_sword");
        const input = textControl(context, "Item", "diamond_sword", name => {
            if (name) context.track(show(name)).catch(console.warn);
        }, []);
        fillList(input, () => Models.getItemList(), entry => entry.replace(/\.json$/, ""));
    },
    code: {
        esm: `${esmRenderer("AssetKey", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "diamond_sword", "models", "item", "assets")
);
const sword = await renderer.scene.addModel(model!);`,
        script: scriptSnippet(`MineRender.Models.getMerged(
    new MineRender.AssetKey("minecraft", "diamond_sword", "models", "item", "assets")
).then(model => renderer.scene.addModel(model));`)
    }
};

const POSES: Array<[string, string]> = [
    [DisplayPosition.GUI, "Inventory (gui)"],
    [DisplayPosition.GROUND, "Dropped (ground)"],
    [DisplayPosition.FIXED, "Item frame (fixed)"],
    [DisplayPosition.THIRDPERSON_RIGHTHAND, "Held (thirdperson_righthand)"],
    [DisplayPosition.HEAD, "Worn (head)"],
    ["none", "No pose"]
];

const poses: Example = {
    id: "item-display",
    title: "Display poses",
    description: "Models carry display transforms for each context the game shows them in. Pick one to apply its rotation, translation, and scale.",
    renderer: {
        camera: {
            position: [10, 8, 40] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const model = await Models.getMerged(itemKey("diamond_pickaxe"));
        if (!model || signal.aborted) return;
        let current: ModelObject | undefined;
        const show = async (pose: string) => {
            const next = await renderer.scene.addModel(model, {
                instanceMeshes: false,
                displayPosition: pose === "none" ? undefined : pose as DisplayPosition
            }) as ModelObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
            renderer.dirty = true;
        };
        await show(DisplayPosition.GUI);
        selectControl(context, "Pose", POSES, DisplayPosition.GUI, pose => void context.track(show(pose)).catch(console.warn));
    },
    code: {
        esm: `${esmRenderer("AssetKey", "DisplayPosition", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "diamond_pickaxe", "models", "item", "assets")
);

// Apply the model's own "gui" display transform
await renderer.scene.addModel(model!, { displayPosition: DisplayPosition.GUI });`
    }
};

const blockItem: Example = {
    id: "item-block",
    title: "Block items",
    description: "Items that reference a block model render as the full 3D block.",
    renderer: {
        camera: {
            position: [24, 18, 28] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const model = await Models.getMerged(itemKey("enchanting_table"));
        if (!model || signal.aborted) return;
        await renderer.scene.addModel(model);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "enchanting_table", "models", "item", "assets")
);
await renderer.scene.addModel(model!);`
    }
};

/** A hand-written model in the vanilla JSON format: a chair with a tilted backrest and a cushion. */
const CHAIR_MODEL = {
    // Any unique key works; it identifies the texture atlas built for this model.
    key: new AssetKey("example", "chair", "models", "block", "assets"),
    textures: {
        planks: "minecraft:block/oak_planks",
        cushion: "minecraft:block/red_wool"
    },
    elements: [
        // seat
        { from: [2, 7, 2], to: [14, 9, 14], faces: allFaces("#planks") },
        // cushion
        { from: [3, 9, 3], to: [13, 10, 13], faces: allFaces("#cushion") },
        // backrest, tilted back around its bottom edge
        {
            from: [2, 9, 12], to: [14, 20, 14],
            rotation: { origin: [8, 9, 13], axis: "x", angle: 22.5 },
            faces: allFaces("#planks")
        },
        // legs
        { from: [2, 0, 2], to: [4, 7, 4], faces: allFaces("#planks") },
        { from: [12, 0, 2], to: [14, 7, 4], faces: allFaces("#planks") },
        { from: [2, 0, 12], to: [4, 7, 14], faces: allFaces("#planks") },
        { from: [12, 0, 12], to: [14, 7, 14], faces: allFaces("#planks") }
    ]
};

function allFaces(texture: string) {
    return Object.fromEntries(["north", "south", "east", "west", "up", "down"].map(face => [face, { texture }]));
}

const custom: Example = {
    id: "item-custom",
    title: "Custom model JSON",
    description: "Any model in the vanilla JSON format renders, not only files from the asset CDN. This chair is defined in the code on the right.",
    renderer: {
        camera: {
            position: [28, 22, 32] as [number, number, number],
            lookingAt: [0, 2, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        if (signal.aborted) return;
        await renderer.scene.addModel(CHAIR_MODEL as never, { instanceMeshes: false });
    },
    code: {
        esm: `${esmRenderer("AssetKey")}

const faces = (texture: string) =>
    Object.fromEntries(["north", "south", "east", "west", "up", "down"].map(f => [f, { texture }]));

const chair = {
    key: new AssetKey("example", "chair", "models", "block"),   // identifies the model's texture atlas
    textures: {
        planks: "minecraft:block/oak_planks",
        cushion: "minecraft:block/red_wool"
    },
    elements: [
        { from: [2, 7, 2], to: [14, 9, 14], faces: faces("#planks") },      // seat
        { from: [3, 9, 3], to: [13, 10, 13], faces: faces("#cushion") },    // cushion
        {                                                                   // backrest
            from: [2, 9, 12], to: [14, 20, 14],
            rotation: { origin: [8, 9, 13], axis: "x", angle: 22.5 },
            faces: faces("#planks")
        },
        { from: [2, 0, 2], to: [4, 7, 4], faces: faces("#planks") },        // legs
        { from: [12, 0, 2], to: [14, 7, 4], faces: faces("#planks") },
        { from: [2, 0, 12], to: [4, 7, 14], faces: faces("#planks") },
        { from: [12, 0, 12], to: [14, 7, 14], faces: faces("#planks") }
    ]
};

await renderer.scene.addModel(chair);`
    }
};

/** Item state presets: label, item, and the context passed to Models.getMerged. */
const ITEM_STATES: Array<[string, string, ItemModelContext]> = [
    ["Dyed leather chestplate", "leather_chestplate", { components: { "minecraft:dyed_color": 0x3f76e4 } }],
    ["Shield with a pattern", "shield", { components: {
        "minecraft:base_color": "blue",
        "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }]
    } }],
    ["Banner with patterns", "red_banner", { components: {
        "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_bottom", color: "white" }, { pattern: "minecraft:cross", color: "black" }]
    } }],
    ["Potion with a custom color", "potion", { components: { "minecraft:potion_contents": { custom_color: 0xd557ef } } }],
    ["Bundle with a selected item", "bundle", {
        properties: { "minecraft:bundle/has_selected_item": true },
        itemReferences: { "minecraft:bundle/selected_item": itemKey("apple") }
    }],
    ["Crossbow loaded with an arrow", "crossbow", { properties: { "minecraft:charge_type": "arrow" } }],
    ["Shulker box", "purple_shulker_box", {}]
];

const components: Example = {
    id: "item-components",
    title: "Item state",
    description: "Item definitions choose their model and colors from data components, item-model properties and stack counts, the way the game does. Banners, shields, shulker boxes and bundles draw through the same path.",
    renderer: ITEM_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: ModelObject | undefined;
        let token = 0;
        const show = async (label: string) => {
            const run = ++token;
            const [, name, state] = ITEM_STATES.find(entry => entry[0] === label)!;
            const model = await Models.getMerged(itemKey(name), state);
            if (!model) throw new Error(`Unknown item "${name}"`);
            if (signal.aborted || run !== token) return;
            const next = await renderer.scene.addModel(model, { instanceMeshes: false, displayPosition: DisplayPosition.GUI }) as ModelObject;
            if (signal.aborted || run !== token) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
            frameObject(renderer, next, 1.6);
        };
        selectControl(context, "Item", ITEM_STATES.map(([label]) => [label, label]), ITEM_STATES[0][0], label => {
            context.track(show(label)).catch(console.warn);
        });
        await show(ITEM_STATES[0][0]);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "DisplayPosition", "Models")}

const item = (name: string) => new AssetKey("minecraft", name, "models", "item", "assets");

// Data components select the model and its colors
const shield = await Models.getMerged(item("shield"), {
    components: {
        "minecraft:base_color": "blue",
        "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }]
    }
});
await renderer.scene.addModel(shield!, { displayPosition: DisplayPosition.GUI });

// Dyed armor, potion colors, and item-model properties work the same way
await Models.getMerged(item("leather_chestplate"), { components: { "minecraft:dyed_color": 0x3f76e4 } });
await Models.getMerged(item("crossbow"), { properties: { "minecraft:charge_type": "arrow" } });

// Nodes that draw another item take it through itemReferences
await Models.getMerged(item("bundle"), {
    properties: { "minecraft:bundle/has_selected_item": true },
    itemReferences: { "minecraft:bundle/selected_item": item("apple") }
});`
    }
};

export const items: ExampleGroup = {
    id: "items",
    title: "Items & models",
    lead: "Item definitions with their components, generated item models, block items, and hand-written model JSON all go through the same model pipeline.",
    playgrounds: [{ url: "https://beta.minerender.org/demo/item/", label: "Item playground" }, { url: "https://beta.minerender.org/demo/custom_model/", label: "Custom model playground" }],
    examples: [{ ...generated, title: "Generated item models" }, poses, components, blockItem, custom],
    notes: [
        "Item previews default to the GUI display context. Chests, beds, mob heads, shulker boxes, banners, shields, tridents and conduits use their special renderers.",
        "Item registry defaults are not loaded, so supply the components a selector reads. Explicit tints override the automatic colors."
    ]
};
