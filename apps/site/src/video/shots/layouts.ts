import { GuiHelper, type GuiObject, type GuiRecipe } from "minerender";
import type { OrthographicCamera } from "three";
import { Box2, Vector2 } from "three";
import { Cues, easeOut, fade, range } from "../motion";
import type { Shot, ShotContext } from "../types";

const PICKAXE: GuiRecipe = {
    type: "minecraft:crafting_shaped",
    key: { "#": "minecraft:stick", X: "#minecraft:diamond_tool_materials" },
    pattern: ["XXX", " # ", " # "],
    result: { id: "minecraft:diamond_pickaxe", count: 1 }
};

interface Placed {
    gui: GuiObject;
    /** GUI-space offset of the object's origin. */
    offset: [number, number];
    bounds: Box2;
}

let recipe: Placed;
let tooltip: Placed;
let bossBar: Placed;
let cues: Cues;
let captionText = "";
let baseZoom = 1;
const center = new Vector2();

async function place(context: ShotContext, layers: Awaited<ReturnType<typeof GuiHelper.tooltip>>, offset: [number, number]): Promise<Placed> {
    const gui = await context.renderer.scene.addGui(layers);
    // One GUI pixel is one scene unit; GUI y grows downwards.
    gui.setPosition(gui.getPosition().set(offset[0], -offset[1], 0));
    const bounds = gui.bounds.clone().translate(new Vector2(offset[0], offset[1]));
    gui.visible = false;
    return { gui, offset, bounds };
}

/** A crafting recipe, a tooltip, and a boss bar from GuiHelper, placed next to each other. */
export const guiLayouts: Shot = {
    id: "gui-layouts",
    seconds: 7,
    renderer: {
        camera: {
            type: "orthographic",
            position: [0, 0, 100],
            lookingAt: [0, 0, 0]
        }
    },
    async prepare(context) {
        const { width, height, portrait } = context;
        recipe = await place(context, GuiHelper.recipe(PICKAXE, { resolveIngredient: () => "minecraft:diamond" }), [0, 0]);
        const recipeSize = recipe.bounds.getSize(new Vector2());
        tooltip = await place(context, await GuiHelper.tooltip([
            [{ text: "Diamond Pickaxe", color: 0x55ffff }],
            [{ text: "Efficiency IV", color: 0xaaaaaa }],
            [{ text: "Unbreaking III", color: 0xaaaaaa }],
            "",
            [{ text: "When in Main Hand:", color: 0xaaaaaa }],
            [{ text: " 5 Attack Damage", color: 0x5555ff }]
        ]), portrait ? [8, recipeSize.y + 12] : [recipeSize.x + 14, 12]);
        bossBar = await place(context, await GuiHelper.bossBar({ color: "purple", progress: 0.65 }), [Math.round(recipeSize.x / 2 - 91), -22]);
        recipe.gui.visible = true;
        const all = recipe.bounds.clone().union(tooltip.bounds).union(bossBar.bounds);
        const size = all.getSize(new Vector2());
        all.getCenter(center);
        // Leave the left part of the frame for the caption and the bottom band for the code.
        baseZoom = portrait ? Math.min(width / (size.x + 40), height / (size.y + 40)) : Math.min(width * 0.6 / size.x, height * 0.64 / size.y);
        captionText = "Recipes, tooltips, boss bars:\n<accent>layers</accent> from GuiHelper";
        cues = new Cues()
            .at(2.0, () => { tooltip.gui.visible = true; })
            .at(3.6, () => { bossBar.gui.visible = true; });
    },
    update({ camera: perspective, overlay, renderer, width, height, portrait }, t) {
        cues.run(t);
        renderer.dirty = true;
        const camera = perspective as unknown as OrthographicCamera;
        camera.zoom = baseZoom * (0.92 + 0.08 * easeOut(range(t, 0, 1.2)));
        // Leave the left part of the frame for the caption.
        camera.position.set(center.x - (portrait ? 0 : width / camera.zoom * 0.17), -center.y - (portrait ? 0 : height / camera.zoom * 0.08), 100);
        camera.updateProjectionMatrix();
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: captionText,
            captionOpacity: fade(t, 0.6, 99, 0.4),
            code: "const layers = GuiHelper.recipe(recipe, {\n    resolveIngredient: () => \"minecraft:diamond\"\n});\nawait scene.addGui(layers);",
            codeOpacity: fade(t, 4.6, 99, 0.5)
        });
    }
};
