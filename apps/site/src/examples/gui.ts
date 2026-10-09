import { GuiHelper, GuiLayer, GuiObject, GuiRecipe } from "minerender";
import { OrthographicCamera, Vector2 } from "three";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, selectControl } from "./shared";

const GUI_RENDERER = {
    camera: {
        type: "orthographic" as const,
        position: [0, 0, 100] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

/** Fits an orthographic camera to the GUI's bounds (GUI y grows down, scene y grows up). */
function fitGui(context: ExampleContext, gui: GuiObject, margin = 24): void {
    const { renderer } = context;
    const camera = renderer.camera as OrthographicCamera;
    const size = gui.bounds.getSize(new Vector2());
    const center = gui.bounds.getCenter(new Vector2());
    const canvas = renderer.renderer.domElement;
    camera.position.set(center.x, -center.y, 100);
    camera.zoom = Math.min(canvas.clientWidth / (size.x + margin * 2), canvas.clientHeight / (size.y + margin * 2));
    camera.updateProjectionMatrix();
    if (renderer.controls) {
        renderer.controls.target.set(center.x, -center.y, 0);
        renderer.controls.update();
        renderer.controls.saveState();
    }
    renderer.dirty = true;
}

/** Chest contents: [item model, slot, tints by tint index]. */
const CONTENTS: Record<string, Array<[string, number, Record<number, number>?]>> = {
    "Tools": [["diamond_pickaxe", 0], ["diamond_axe", 1], ["diamond_shovel", 2], ["bow", 9], ["fishing_rod", 10], ["shears", 11], ["emerald", 27]],
    "Blocks": [["grass_block", 0, { 0: 0x91bd59 }], ["stone", 1], ["oak_stairs", 2], ["oak_planks", 3], ["glass", 9], ["crafting_table", 10], ["oak_fence", 11], ["torch", 12]],
    "Armor": [["leather_helmet", 0, { 0: 0xc060d0 }], ["iron_chestplate", 1], ["golden_leggings", 2], ["diamond_boots", 3], ["leather_chestplate", 9, { 0: 0x3c44aa }]],
    "Food": [["apple", 0], ["bread", 1], ["cooked_beef", 2], ["golden_apple", 11], ["cake", 20], ["honey_bottle", 53]],
    "Empty": []
};

const chest: Example = {
    id: "gui-chest",
    title: "Inventory layout",
    description: "A GUI is an ordered list of layers: a crop of the container texture, then item models in their GUI display pose, positioned with the slot helper. Blocks keep their 3D look. One GUI pixel is one scene unit.",
    renderer: GUI_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: GuiObject | undefined;
        let token = 0;
        const show = async (name: string) => {
            const run = ++token;
            const layers: GuiLayer[] = [
                { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
                ...CONTENTS[name].map(([item, slot, tints]): GuiLayer => ({
                    name: item,
                    item: `minecraft:item/${item}`,
                    position: GuiHelper.inventorySlot(slot, [8, 18]),
                    tints
                }))
            ];
            const next = await renderer.scene.addGui(layers);
            if (signal.aborted || run !== token) {
                next.removeFromScene();
                next.dispose();
                return;
            }
            current?.removeFromScene();
            current?.dispose();
            current = next;
            fitGui(context, next);
        };
        selectControl(context, "Contents", Object.keys(CONTENTS).map(name => [name, name]), "Tools", name => {
            context.track(show(name)).catch(console.warn);
        });
        await show("Tools");
    },
    code: {
        esm: `import { GuiHelper, Renderer } from "minerender";

const renderer = new Renderer({
    camera: { type: "orthographic", position: [0, 0, 100] }
});
renderer.appendTo(document.getElementById("render")!);
renderer.start();

const gui = await renderer.scene.addGui([
    // Crop the chest window out of the container texture
    { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
    // Item models in slots 0 to 2; the grid starts at (8, 18) in this texture
    { item: "minecraft:item/diamond_pickaxe", position: GuiHelper.inventorySlot(0, [8, 18]) },
    { item: "minecraft:item/grass_block", position: GuiHelper.inventorySlot(1, [8, 18]), tints: { 0: 0x91bd59 } },
    { item: "minecraft:item/leather_helmet", position: GuiHelper.inventorySlot(2, [8, 18]), tints: { 0: 0xc060d0 } }
]);

// gui.bounds is in GUI pixels (y down); fit the camera to it
const size = gui.bounds.getSize(new Vector2());
const center = gui.bounds.getCenter(new Vector2());
renderer.camera.position.set(center.x, -center.y, 100);
renderer.camera.zoom = Math.min(width / (size.x + 48), height / (size.y + 48));
renderer.camera.updateProjectionMatrix();
renderer.dirty = true;`
    }
};

const hotbar: Example = {
    id: "gui-hotbar",
    title: "Any texture region",
    description: "Layers can crop any part of any texture, which covers HUD elements and custom screens.",
    renderer: GUI_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const items = ["diamond_sword", "bow", "torch", "cooked_beef", "oak_planks", "grass_block", "water_bucket", "ender_pearl", "emerald"];
        const gui = await renderer.scene.addGui([
            { name: "hotbar", texture: "minecraft:gui/sprites/hud/hotbar", position: [0, 0] },
            ...items.map((item, index): GuiLayer => ({
                name: item,
                item: `minecraft:item/${item}`,
                position: GuiHelper.inventorySlot(index, [3, 3], [20, 20], 9),
                tints: item === "grass_block" ? { 0: 0x91bd59 } : undefined
            })),
            { name: "selection", texture: "minecraft:gui/sprites/hud/hotbar_selection", position: [-1, -1] }
        ]);
        if (signal.aborted) return;
        fitGui(context, gui, 12);
    },
    code: {
        esm: `${esmRenderer("GuiHelper")}

await renderer.scene.addGui([
    { texture: "minecraft:gui/sprites/hud/hotbar" },
    // Slots are 20 pixels apart in the hotbar, nine per row
    { item: "minecraft:item/diamond_sword", position: GuiHelper.inventorySlot(0, [3, 3], [20, 20], 9) },
    { item: "minecraft:item/bow", position: GuiHelper.inventorySlot(1, [3, 3], [20, 20], 9) },
    { texture: "minecraft:gui/sprites/hud/hotbar_selection", position: [-1, -1] }
]);`
    }
};

const RECIPES: Record<string, { label: string; recipe: GuiRecipe; resolve?: string }> = {
    pickaxe: {
        label: "Diamond pickaxe (shaped)",
        recipe: {
            type: "minecraft:crafting_shaped",
            key: { "#": "minecraft:stick", X: "#minecraft:diamond_tool_materials" },
            pattern: ["XXX", " # ", " # "],
            result: { id: "minecraft:diamond_pickaxe" }
        },
        resolve: "minecraft:diamond"
    },
    cake: {
        label: "Cake (shaped)",
        recipe: {
            type: "minecraft:crafting_shaped",
            key: { A: "minecraft:milk_bucket", B: "minecraft:sugar", C: "minecraft:wheat", E: "minecraft:egg" },
            pattern: ["AAA", "BEB", "CCC"],
            result: { id: "minecraft:cake" }
        }
    },
    dye: {
        label: "Purple dye (shapeless)",
        recipe: {
            type: "minecraft:crafting_shapeless",
            ingredients: ["minecraft:blue_dye", "minecraft:red_dye"],
            result: { id: "minecraft:purple_dye", count: 2 }
        }
    }
};

const recipe: Example = {
    id: "gui-recipe",
    title: "Crafting recipes",
    description: "GuiHelper.recipe turns a vanilla recipe JSON into crafting-table layers. Tags and alternatives need a concrete item from the caller. Stack counts are not drawn.",
    renderer: GUI_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: GuiObject | undefined;
        let token = 0;
        const show = async (id: string) => {
            const run = ++token;
            const { recipe, resolve } = RECIPES[id];
            const layers = GuiHelper.recipe(recipe, { resolveIngredient: () => resolve ?? "minecraft:stone" });
            const next = await renderer.scene.addGui(layers);
            if (signal.aborted || run !== token) {
                next.removeFromScene();
                next.dispose();
                return;
            }
            current?.removeFromScene();
            current?.dispose();
            current = next;
            fitGui(context, next);
        };
        selectControl(context, "Recipe", Object.entries(RECIPES).map(([id, { label }]) => [id, label]), "pickaxe", id => {
            context.track(show(id)).catch(console.warn);
        });
        await show("pickaxe");
    },
    code: {
        esm: `${esmRenderer("GuiHelper")}

// data/minecraft/recipe/diamond_pickaxe.json
const recipe = {
    type: "minecraft:crafting_shaped",
    key: { "#": "minecraft:stick", X: "#minecraft:diamond_tool_materials" },
    pattern: ["XXX", " # ", " # "],
    result: { id: "minecraft:diamond_pickaxe", count: 1 }
};

const gui = await renderer.scene.addGui(GuiHelper.recipe(recipe, {
    // Tags such as #minecraft:diamond_tool_materials need a concrete item
    resolveIngredient: () => "minecraft:diamond"
}));`
    }
};

export const guis: ExampleGroup = {
    id: "guis",
    title: "GUIs",
    lead: "Inventory screens, HUD elements and crafting recipes built from texture crops and item models, rendered flat with an orthographic camera.",
    playgrounds: [{ url: "https://beta.minerender.org/demo/gui/", label: "GUI playground" }],
    examples: [chest, hotbar, recipe]
};
