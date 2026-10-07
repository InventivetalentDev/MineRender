import { GuiHelper, type GuiLayer, type GuiObject, type GuiRecipe, Renderer } from "minerender";
import { OrthographicCamera, Vector2 } from "three";

const renderer = new Renderer({
    camera: {
        type: "orthographic",
        position: [0, 0, 100]
    },
    render: {
        antialias: false,
        autoResize: false
    },
    composer: {
        enabled: false
    }
});
renderer.appendTo(document.body);
renderer.start();
window["renderer"] = renderer;

let gui: GuiObject | undefined;
const status = document.getElementById("gui-status")!;
const exampleInput = document.getElementById("gui-example") as HTMLSelectElement;
const spriteForm = document.getElementById("gui-sprite-options") as HTMLFormElement;
const spriteControls = document.getElementById("gui-sprite-controls") as HTMLFieldSetElement;
const spriteInput = document.getElementById("gui-sprite") as HTMLSelectElement;
const widthInput = document.getElementById("gui-width") as HTMLInputElement;
const heightInput = document.getElementById("gui-height") as HTMLInputElement;
const items = [
    { name: "apple", slot: 0 },
    { name: "diamond", slot: 1 },
    { name: "stone", slot: 2 },
    { name: "grass_block", slot: 3 },
    { name: "oak_stairs", slot: 4 },
    { name: "leather_helmet", slot: 5 },
    { name: "chest", slot: 6 },
    { name: "red_bed", slot: 7 },
    { name: "creeper_head", slot: 8 },
    { name: "potion", slot: 9 },
    { name: "tipped_arrow", slot: 10 },
    { name: "filled_map", slot: 11 },
    { name: "firework_star", slot: 12 },
    { name: "leather_chestplate", slot: 13, tints: { 0: 0xc060d0 } }
];
const chestLayers: GuiLayer[] = [
    { name: "container", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
    ...items.map(({ name, slot, tints }): GuiLayer => ({
        name,
        item: `minecraft:item/${name}`,
        position: GuiHelper.inventorySlot(slot, [8, 18]),
        tints
    }))
];
const shapedRecipe: GuiRecipe = {
    type: "minecraft:crafting_shaped",
    key: {
        "#": "minecraft:stick",
        X: "#minecraft:diamond_tool_materials"
    },
    pattern: ["XXX", " # ", " # "],
    result: { count: 1, id: "minecraft:diamond_pickaxe" }
};
const shapelessRecipe: GuiRecipe = {
    type: "minecraft:crafting_shapeless",
    ingredients: ["minecraft:blue_dye", "minecraft:red_dye"],
    result: { count: 2, id: "minecraft:purple_dye" }
};

function fitGui() {
    renderer.resize(window.innerWidth, window.innerHeight);
    if (!gui) return;

    const size = gui.bounds.getSize(new Vector2());
    const center = gui.bounds.getCenter(new Vector2());
    const camera = renderer.camera as OrthographicCamera;
    camera.position.set(center.x, -center.y, 100);
    camera.zoom = Math.min(window.innerWidth / (size.x + 32), window.innerHeight / (size.y + 32));
    camera.updateProjectionMatrix();
    renderer.dirty = true;
}

window.addEventListener("resize", fitGui);

async function setExample(example: string) {
    exampleInput.disabled = true;
    spriteControls.disabled = true;
    spriteForm.hidden = example !== "scaling";
    status.textContent = "Loading GUI layers…";
    try {
        const layers: GuiLayer[] = example === "scaling"
            ? [{
                name: "sprite",
                texture: `minecraft:gui/sprites/${spriteInput.value}`,
                size: [widthInput.valueAsNumber, heightInput.valueAsNumber]
            }]
            : example === "shaped"
            ? GuiHelper.recipe(shapedRecipe, {
                resolveIngredient: () => "minecraft:diamond"
            })
            : example === "shapeless" ? GuiHelper.recipe(shapelessRecipe) : chestLayers;
        const replacement = await renderer.scene.addGui(layers);
        if (gui) {
            gui.removeFromScene();
            gui.dispose();
        }
        gui = replacement;
        window["gui"] = gui;
        fitGui();
        status.textContent = "";
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Could not load GUI layers.";
        throw error;
    } finally {
        exampleInput.disabled = false;
        spriteControls.disabled = false;
    }
}

exampleInput.addEventListener("change", () => {
    setExample(exampleInput.value).catch(console.error);
});
spriteForm.addEventListener("submit", event => {
    event.preventDefault();
    setExample("scaling").catch(console.error);
});
setExample(exampleInput.value).catch(console.error);
