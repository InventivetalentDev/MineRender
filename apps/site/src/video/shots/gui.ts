import { GuiHelper, type GuiLayer, type GuiObject, type ItemModelContext } from "minerender";
import type { OrthographicCamera } from "three";
import { Vector2, Vector3 } from "three";
import { easeOut, fade, range } from "../motion";
import type { Shot } from "../types";

/** Chest contents: item, slot, tints, and the item context (stack counts, damage, components). */
const ITEMS: Array<[string, number, Record<number, number>?, ItemModelContext?]> = [
    ["diamond_pickaxe", 0, undefined, { components: { "minecraft:damage": 900, "minecraft:enchantments": { "minecraft:efficiency": 5 } } }],
    ["diamond_axe", 1, undefined, { components: { "minecraft:damage": 300 } }], ["diamond_shovel", 2], ["grass_block", 3, { 0: 0x91bd59 }, { count: 64 }],
    ["oak_stairs", 4, undefined, { count: 12 }], ["torch", 5, undefined, { count: 37 }],
    ["bow", 9, undefined, { components: { "minecraft:damage": 120 } }], ["fishing_rod", 10], ["shears", 11], ["crafting_table", 12], ["golden_apple", 13, undefined, { count: 3 }],
    ["leather_helmet", 18, { 0: 0xc060d0 }], ["iron_chestplate", 19, undefined, { components: { "minecraft:damage": 200 } }], ["emerald", 20, undefined, { count: 64 }], ["cake", 21]
];

let gui: GuiObject;
const baseScale = new WeakMap<object, Vector3>();
const ONE = new Vector3(1, 1, 1);
let baseZoom = 1;
let center = new Vector2();

/** A chest inventory built from layers; the items drop in one by one. */
export const guiChest: Shot = {
    id: "gui-chest",
    seconds: 6,
    renderer: {
        camera: {
            type: "orthographic",
            position: [0, 0, 100],
            lookingAt: [0, 0, 0]
        }
    },
    async prepare({ renderer, width, height }) {
        const layers: GuiLayer[] = [
            { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
            { name: "title", text: [{ text: "Large Chest", color: 0x404040 }], position: [8, 6] },
            { name: "inventory", text: [{ text: "Inventory", color: 0x404040 }], position: [8, 128] },
            ...ITEMS.map(([item, slot, tints, context]): GuiLayer => ({
                name: item,
                item: `minecraft:item/${item}`,
                position: GuiHelper.inventorySlot(slot, [8, 18]),
                tints,
                context
            }))
        ];
        gui = await renderer.scene.addGui(layers);
        const size = gui.bounds.getSize(new Vector2());
        center = gui.bounds.getCenter(new Vector2());
        baseZoom = Math.min(width / (size.x + 48), height / (size.y + 48));
        for (const [item] of ITEMS) {
            const group = gui.getGroupByName(item);
            if (!group) continue;
            group.visible = false;
            baseScale.set(group, group.scale.clone());
        }
    },
    update({ camera: perspective, overlay, renderer, width, portrait }, t) {
        const camera = perspective as unknown as OrthographicCamera;
        for (const [index, [item]] of ITEMS.entries()) {
            const group = gui.getGroupByName(item);
            if (!group) continue;
            const appear = range(t, 1.0 + index * 0.18, 1.3 + index * 0.18);
            group.visible = appear > 0;
            const s = 0.6 + 0.4 * easeOut(appear);
            group.scale.set(s, s, 1).multiply(baseScale.get(group) ?? ONE);
        }
        renderer.dirty = true;
        camera.zoom = baseZoom * (0.9 + 0.1 * easeOut(range(t, 0, 1.2)));
        // Leave the left third for the caption.
        camera.position.set(center.x - (portrait ? 0 : width / camera.zoom * 0.18), -center.y, 100);
        camera.updateProjectionMatrix();
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "GUIs from <accent>layers</accent>:\ntextures, items, text,\ncounts and durability",
            captionOpacity: fade(t, 0.6, 99, 0.4)
        });
    }
};
