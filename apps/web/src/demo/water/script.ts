import { MineRenderWorld, Renderer, Ticker } from "minerender";
import { Color } from "three";

type Triple = [number, number, number];

const RGB_TOLERANCE = 8;
const presets: Record<string, { position: Triple; target: Triple }> = {
    above: { position: [150, 110, 190], target: [72, 0, 24] },
    edge: { position: [-70, 20, 150], target: [72, 12, 24] },
    below: { position: [40, -90, 110], target: [24, 16, 24] }
};
const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input"));
const animate = document.getElementById("animate") as HTMLInputElement;
const status = document.getElementById("status")!;
const measurements = document.getElementById("measurements")!;
const renderers: Renderer[] = [];
let syncing = false;

const water = { type: "minecraft:water", properties: { level: "0" } };
const stone = { type: "minecraft:stone" };

async function build(world: MineRenderWorld<boolean>) {
    await world.setBlockAt([-3, 1, 1], water);
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) await world.setBlockAt([x, 1, z], water);
    for (let x = 6; x < 12; x++) {
        for (let z = -1; z < 5; z++) {
            await world.setBlockAt([x, -1, z], stone);
            await world.setBlockAt([x, 0, z], x === 6 || x === 11 || z === -1 || z === 4 ? stone : water);
        }
    }
}

function decode(url: string): Promise<Uint8ClampedArray> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            resolve(context.getImageData(0, 0, image.width, image.height).data);
        };
        image.onerror = () => reject(new Error("Could not decode a captured view"));
        image.src = url;
    });
}

/** Counts pixels that differ between the two views; texture animation can add differences while it runs. */
async function measure() {
    const [blocks, sections] = await Promise.all(renderers.map(renderer => decode(renderer.toImage())));
    let differing = 0;
    for (let i = 0; i < blocks.length; i += 4) {
        if ([0, 1, 2].some(channel => Math.abs(blocks[i + channel] - sections[i + channel]) > RGB_TOLERANCE)) differing++;
    }
    measurements.textContent = `${differing.toLocaleString()} of ${(blocks.length / 4).toLocaleString()} pixels differ between the views (RGB tolerance: ${RGB_TOLERANCE}/255).`;
}

function show(name: string) {
    const { position, target } = presets[name];
    for (const renderer of renderers) {
        renderer.camera.position.set(...position);
        renderer.orbitControls!.target.set(...target);
        renderer.orbitControls!.update();
    }
    void measure();
}

async function init() {
    for (const [id, sectionMeshing] of [["blocks", false], ["sections", true]] as const) {
        const renderer = new Renderer({ controls: { enabled: true }, composer: { enabled: false } });
        renderer.appendTo(document.getElementById(id)!);
        renderer.scene.background = new Color(0x9ec9ff);
        renderers.push(renderer);
        await build(new MineRenderWorld(renderer.scene, { sectionMeshing }));
    }
    for (const renderer of renderers) {
        renderer.orbitControls!.addEventListener("change", () => {
            if (syncing) return;
            syncing = true;
            for (const other of renderers) {
                if (other === renderer) continue;
                other.camera.position.copy(renderer.camera.position);
                other.orbitControls!.target.copy(renderer.orbitControls!.target);
                other.orbitControls!.update();
            }
            syncing = false;
        });
        renderer.orbitControls!.addEventListener("end", () => void measure());
        renderer.start();
    }
    Ticker.stop();
    animate.addEventListener("change", () => animate.checked ? Ticker.start() : Ticker.stop());
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
        button.addEventListener("click", () => show(button.dataset.view!));
    }
    show("above");
    controls.forEach(control => { control.disabled = false; });
    status.textContent = "Loaded. Texture animation is paused so the views can be compared.";
}

init().catch(error => {
    status.textContent = `Could not load the water scene: ${error instanceof Error ? error.message : String(error)}`;
    console.error(error);
});
