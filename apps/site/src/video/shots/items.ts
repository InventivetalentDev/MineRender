import { AssetKey, DisplayPosition, type ItemModelContext, type ModelObject, Models } from "minerender";
import { Cues, easeOut, fade, lerp, range, smooth } from "../motion";
import type { Shot, ShotContext } from "../types";

const itemKey = (name: string) => new AssetKey("minecraft", name, "models", "item", "assets");

/** Items shown in a row, each with the component or property state that selects its look. */
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

/** The pickaxe's display poses, cycled before the row is revealed. */
const POSES: Array<[DisplayPosition, string]> = [
    [DisplayPosition.GUI, "gui"], [DisplayPosition.GROUND, "ground"], [DisplayPosition.THIRDPERSON_RIGHTHAND, "thirdperson_righthand"], [DisplayPosition.HEAD, "head"]
];
const POSE_STEP = 0.7;
const ROW_FROM = POSES.length * POSE_STEP + 0.4;

async function addItem(context: ShotContext, name: string, state: ItemModelContext | undefined, pose: DisplayPosition, [x, y]: [number, number]): Promise<ModelObject> {
    const model = await Models.getMerged(itemKey(name), state);
    if (!model) throw new Error(`Unknown item "${name}"`);
    const object = await context.renderer.scene.addModel(model, { instanceMeshes: false, displayPosition: pose }) as ModelObject;
    object.position.set(x, y, 0);
    object.visible = false;
    return object;
}

let row: ModelObject[] = [];
let poses: ModelObject[] = [];
let cues: Cues;
let captionText = "";
let codeText = "";

/** Display poses on one item, then a row of items whose models and colours come from components. */
export const itemState: Shot = {
    id: "items",
    seconds: 10,
    async prepare(context) {
        poses = await Promise.all(POSES.map(([pose]) => addItem(context, "diamond_pickaxe", undefined, pose, slot(0, context.portrait))));
        row = await Promise.all(LINEUP.map(([name, state], index) => addItem(context, name, state, DisplayPosition.GUI, slot(index, context.portrait))));
        cues = new Cues();
        for (const [index, [, label]] of POSES.entries()) {
            cues.at(index * POSE_STEP, () => {
                poses.forEach((object, i) => { object.visible = i === index; });
                captionText = `Display <accent>poses</accent>\n${label}`;
            });
        }
        cues.at(ROW_FROM - 0.3, () => {
            poses.forEach(object => { object.visible = false; });
            captionText = "Items from <accent>components</accent>:\nglint, dyes, patterns, heads";
            codeText = "await Models.getMerged(item(\"diamond_pickaxe\"), {\n    components: {\n        \"minecraft:enchantments\": { \"minecraft:efficiency\": 5 }\n    }\n});";
        });
        captionText = "";
        codeText = "";
    },
    update({ camera, overlay, renderer, portrait }, t) {
        cues.run(t);
        for (const [index, object] of row.entries()) {
            const appear = range(t, ROW_FROM + index * 0.25, ROW_FROM + 0.4 + index * 0.25);
            object.visible = appear > 0;
            const s = Math.max(easeOut(appear), 0.001);
            object.scale.set(s, s, s);
        }
        renderer.dirty = true;
        // Close on the pickaxe while it cycles poses, then back out to the whole grid.
        const [px, py] = slot(0, portrait);
        const out = smooth(t, ROW_FROM - 0.4, ROW_FROM + 1.2);
        const distance = lerp(34, portrait ? 225 : 118, out);
        camera.position.set(lerp(px + 8, 10, out), lerp(py + 6, 4, out), distance);
        camera.lookAt(lerp(px, 0, out), lerp(py, portrait ? -8 : -5, out), 0);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: captionText,
            captionOpacity: captionText ? 1 : 0,
            code: codeText,
            codeOpacity: codeText ? fade(t, ROW_FROM + 1.2, 99, 0.5) : 0
        });
    }
};
