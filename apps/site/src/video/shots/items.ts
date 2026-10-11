import { AssetKey, DisplayPosition, type ItemModelContext, type ModelObject, Models } from "minerender";
import type { OrthographicCamera } from "three";
import { easeOut, fade, range } from "../motion";
import type { Shot, ShotContext } from "../types";

const itemKey = (name: string) => new AssetKey("minecraft", name, "models", "item", "assets");

/** Items shown in a grid, each with the component or property state that selects its look. */
const LINEUP: Array<[string, ItemModelContext | undefined]> = [
    ["diamond_pickaxe", { components: { "minecraft:enchantments": { "minecraft:efficiency": 5 } } }],
    ["shield", { components: {
        "minecraft:base_color": "blue",
        "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }]
    } }],
    ["leather_chestplate", { components: { "minecraft:dyed_color": 0x3f76e4 } }],
    ["potion", { components: { "minecraft:potion_contents": { custom_effects: [{ id: "minecraft:speed", amplifier: 1 }] } } }],
    ["player_head", { components: { "minecraft:profile": { name: "jeb_" } } }],
    ["copper_golem_statue", { components: { "minecraft:block_state": { copper_golem_pose: "star" } } }],
    ["bundle", {
        properties: { "minecraft:bundle/has_selected_item": true },
        itemReferences: { "minecraft:bundle/selected_item": itemKey("apple") }
    }],
    ["clock", { properties: { "minecraft:time": 0.3, "minecraft:context_dimension": "minecraft:overworld" }, components: { "minecraft:enchantment_glint_override": true } }]
];
const SPACING = 30;
const ROW_GAP = 26;
/** Grid position of an item: four columns in landscape, two in portrait. */
function slot(index: number, portrait: boolean): [number, number] {
    const columns = portrait ? 2 : 4;
    const rows = LINEUP.length / columns;
    return [
        (index % columns - (columns - 1) / 2) * SPACING,
        ((rows - 1) / 2 - Math.floor(index / columns)) * ROW_GAP
    ];
}
/** Scene units visible top to bottom, so the grid sits above the caption and code. */
const VISIBLE_HEIGHT = { landscape: 118, portrait: 235 };

async function addItem(context: ShotContext, name: string, state: ItemModelContext | undefined, [x, y]: [number, number]): Promise<ModelObject> {
    const model = await Models.getMerged(itemKey(name), state);
    if (!model) throw new Error(`Unknown item "${name}"`);
    const object = await context.renderer.scene.addModel(model, { instanceMeshes: false, displayPosition: DisplayPosition.GUI }) as ModelObject;
    object.position.set(x, y, 0);
    object.visible = false;
    return object;
}

let grid: ModelObject[] = [];

/**
 * A grid of items whose models and colours come from components. GUI poses are built for vanilla's
 * orthographic inventory (the open bundle spreads its layers 32 units deep), so the camera is orthographic too.
 */
export const itemState: Shot = {
    id: "items",
    seconds: 7,
    renderer: {
        camera: {
            type: "orthographic",
            position: [0, 0, 200],
            lookingAt: [0, 0, 0]
        }
    },
    async prepare(context) {
        grid = await Promise.all(LINEUP.map(([name, state], index) => addItem(context, name, state, slot(index, context.portrait))));
    },
    update({ camera: perspective, overlay, renderer, height, portrait }, t) {
        const camera = perspective as unknown as OrthographicCamera;
        for (const [index, object] of grid.entries()) {
            const appear = range(t, 0.3 + index * 0.25, 0.7 + index * 0.25);
            object.visible = appear > 0;
            const s = Math.max(easeOut(appear), 0.001);
            object.scale.set(s, s, s);
        }
        renderer.dirty = true;
        camera.zoom = height / VISIBLE_HEIGHT[portrait ? "portrait" : "landscape"];
        camera.position.set(0, portrait ? -8 : -5, 200);
        camera.updateProjectionMatrix();
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "Items from <accent>components</accent>:\nglint, dyes, patterns, heads",
            captionOpacity: fade(t, 0.6, 99, 0.4),
            code: "await Models.getMerged(item(\"diamond_pickaxe\"), {\n    components: {\n        \"minecraft:enchantments\": { \"minecraft:efficiency\": 5 }\n    }\n});",
            codeOpacity: fade(t, 2.4, 99, 0.5)
        });
    }
};
