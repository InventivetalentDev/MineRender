import { GuiHelper, type GuiLayer, type GuiObject, Renderer } from "minerender";
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
const items = [
    { name: "apple", slot: 0 },
    { name: "diamond", slot: 1 },
    { name: "stone", slot: 2 },
    { name: "grass_block", slot: 3, tints: { 0: 0x91bd59 } },
    { name: "oak_stairs", slot: 4 },
    { name: "leather_helmet", slot: 5, tints: { 0: 0xc060d0 } }
];
const layers: GuiLayer[] = [
    { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
    ...items.map(({ name, slot, tints }): GuiLayer => ({
        name,
        item: `minecraft:item/${name}`,
        position: GuiHelper.inventorySlot(slot, [8, 18]),
        tints
    }))
];

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
renderer.scene.addGui(layers).then(object => {
    gui = object;
    window["gui"] = gui;
    fitGui();
    status.textContent = "";
}).catch(error => {
    status.textContent = error instanceof Error ? error.message : "Could not load GUI layers.";
    console.error(error);
});
