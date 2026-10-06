import { GuiHelper, GuiLayer, GuiObject } from "minerender";
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

const CONTENTS: Record<string, Array<[string, number]>> = {
    "Tools": [["diamond_pickaxe", 0], ["diamond_axe", 1], ["diamond_shovel", 2], ["bow", 9], ["fishing_rod", 10], ["emerald", 27]],
    "Food": [["apple", 0], ["bread", 1], ["cooked_beef", 2], ["golden_apple", 11], ["cake", 20], ["honey_bottle", 53]],
    "Empty": []
};

const chest: Example = {
    id: "gui-chest",
    title: "Inventory layout",
    description: "A GUI is an ordered list of texture layers: a crop of the container texture, then item sprites positioned with the slot helper. One GUI pixel is one scene unit.",
    renderer: GUI_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: GuiObject | undefined;
        const show = async (name: string) => {
            const layers: GuiLayer[] = [
                { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
                ...CONTENTS[name].map(([item, slot]): GuiLayer => ({
                    name: item,
                    texture: `minecraft:item/${item}`,
                    position: GuiHelper.inventorySlot(slot, [8, 18]),
                    size: [16, 16]
                }))
            ];
            const next = await renderer.scene.addGui(layers);
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
            fitGui(context, next);
        };
        selectControl(context, "Contents", Object.keys(CONTENTS).map(name => [name, name]), "Tools", name => {
            show(name).catch(console.warn);
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
    // Item sprites in slots 0 and 1; the grid starts at (8, 18) in this texture
    { texture: "minecraft:item/diamond_pickaxe", position: GuiHelper.inventorySlot(0, [8, 18]), size: [16, 16] },
    { texture: "minecraft:item/apple", position: GuiHelper.inventorySlot(1, [8, 18]), size: [16, 16] }
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
    description: "Layers can crop any part of any texture, so HUD elements and custom screens compose the same way.",
    renderer: GUI_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const items = ["diamond_sword", "bow", "block/torch", "cooked_beef", "stick", "flint", "water_bucket", "ender_pearl", "emerald"];
        const gui = await renderer.scene.addGui([
            { name: "hotbar", texture: "minecraft:gui/sprites/hud/hotbar", position: [0, 0] },
            ...items.map((item, index): GuiLayer => ({
                name: item,
                // Most item sprites live under item/; blocks such as the torch use their block texture
                texture: item.includes("/") ? `minecraft:${item}` : `minecraft:item/${item}`,
                position: GuiHelper.inventorySlot(index, [3, 3], [20, 20], 9),
                size: [16, 16]
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
    { texture: "minecraft:item/diamond_sword", position: GuiHelper.inventorySlot(0, [3, 3], [20, 20], 9), size: [16, 16] },
    { texture: "minecraft:item/bow", position: GuiHelper.inventorySlot(1, [3, 3], [20, 20], 9), size: [16, 16] },
    { texture: "minecraft:gui/sprites/hud/hotbar_selection", position: [-1, -1] }
]);`
    }
};

export const guis: ExampleGroup = {
    id: "guis",
    title: "GUIs",
    lead: "Inventory screens and HUD elements built from cropped texture layers, rendered flat with an orthographic camera.",
    examples: [chest, hotbar]
};
