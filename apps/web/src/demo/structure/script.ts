import {
    AnvilParser,
    AssetKey,
    AssetLoader,
    AssetParser,
    NBTAsset,
    MineRenderWorld,
    MultiBlockStructure,
    NBTHelper,
    Renderer,
    SceneInspector,
    SchematicParser,
    StructureParser,
    Ticker
} from "minerender";
import { Box3, PerspectiveCamera, Vector3 } from "three";

const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000,
        position: [550, 400, 550]
    },
    controls: {
        enabled: true
    },
    render: {
        stats: true,
        fpsLimit: 0,
        antialias: true
    },
    composer: {
        enabled: false
    },
    debug: {
        grid: false,
        axes: false
    }
});
renderer.appendTo(document.body);
renderer.start();
window["renderer"] = renderer;

const info = {
    "objectCount": 0,
    "sceneObjectCount": 0,
    "instanceCount": 0,
    "renderCalls": 0,
    "1sTps": 0,
    "5sTps": 0
}

const sceneInspector = new SceneInspector(renderer);
sceneInspector.appendTo(document.getElementById('inspector'));


const world = new MineRenderWorld(renderer.scene);
window["world"] = world;

setInterval(() => {
    for (let k in info) {
        document.getElementById(k)!.innerText = "" + info[k];
    }
}, 500);

setInterval(() => {
    info["renderCalls"] = renderer.renderer.info.render.calls;
}, 1000);


setInterval(() => {
    info["1sTps"] = Ticker.tpsOneSecond;
    info["5sTps"] = Ticker.tpsFiveSeconds;

    info["objectCount"] = renderer.scene.stats.objectCount;
    info["sceneObjectCount"] = renderer.scene.stats.sceneObjectCount;
    info["instanceCount"] = renderer.scene.stats.instanceCount;
}, 1000);

const structureInput = document.getElementById("structure-input") as HTMLInputElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const chunkInput = document.getElementById("chunk-input") as HTMLSelectElement;
const chunkPicker = document.getElementById("chunk-picker")!;
const status = document.getElementById("load-status")!;
let region: { name: string; bytes: Uint8Array } | undefined;

function includeBlock(bounds: Box3, x: number, y: number, z: number) {
    const position = new Vector3(x, y, z).multiplyScalar(16);
    bounds.expandByPoint(position.clone().addScalar(-8));
    bounds.expandByPoint(position.addScalar(8));
}

function frame(bounds: Box3) {
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    const camera = renderer.camera as PerspectiveCamera;
    const vertical = camera.fov * Math.PI / 360;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
    camera.position.copy(center).addScaledVector(new Vector3(1, 0.75, 1).normalize(), distance);
    camera.near = Math.max(0.1, distance / 1000);
    camera.far = Math.max(2000, distance + radius * 4);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.controls?.target.copy(center);
    renderer.controls?.update();
    renderer.scene.dirty = true;
}

function loaded(label: string, count: number, dataVersion?: number) {
    status.textContent = `Loaded ${label}: ${count} blocks${dataVersion === undefined ? "" : ` · DataVersion ${dataVersion}`}.`;
}

async function load(label: string, task: () => Promise<void>) {
    structureInput.disabled = fileInput.disabled = chunkInput.disabled = true;
    if (renderer.controls) renderer.controls.enabled = false;
    status.textContent = `Loading ${label}…`;
    try {
        await task();
    } catch (error) {
        status.textContent = `Could not load ${label}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        structureInput.disabled = fileInput.disabled = false;
        chunkInput.disabled = !region;
        if (renderer.controls) renderer.controls.enabled = true;
    }
}

async function showStructure(structure: MultiBlockStructure, label: string) {
    const bounds = new Box3();
    for (const block of structure.blocks) includeBlock(bounds, ...block.position);
    await world.clear();
    await world.placeMultiBlock(structure);
    frame(bounds);
    region = undefined;
    chunkPicker.hidden = true;
    loaded(label, structure.blocks.length, structure.dataVersion);
}

async function showChunk() {
    const [x, z] = chunkInput.value.split(",").map(Number);
    const chunk = await AnvilParser.parseChunk(region!.bytes, x, z);
    if (!chunk) throw new Error("The selected chunk is empty.");
    const bounds = new Box3();
    let count = 0;
    for (const section of chunk.sections) {
        for (let index = 0; index < 4096; index++) {
            if (!section.data.get(index)) continue;
            includeBlock(bounds, chunk.x * 16 + (index & 15), section.y * 16 + (index >> 8), chunk.z * 16 + ((index >> 4) & 15));
            count++;
        }
    }
    await world.clear();
    await world.placeChunk(chunk);
    frame(bounds);
    loaded(`${region!.name}, chunk ${chunk.x}, ${chunk.z}`, count, chunk.dataVersion);
}

async function setStructure(structureName: string) {
    await load(structureName, async () => {
        const key = new AssetKey("minecraft", structureName, "structure", undefined, "data", ".nbt");
        const asset = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
        const structure = await StructureParser.parse(asset);
        await showStructure(structure, structureName);
        fileInput.value = "";
    });
}

window["setStructure"] = setStructure;
structureInput.addEventListener("change", () => setStructure(structureInput.value));
fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void load(file.name, async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "mca") {
            const chunks = AnvilParser.getChunkList(bytes);
            if (!chunks.length) throw new Error("This region contains no chunks.");
            region = { name: file.name, bytes };
            chunkInput.replaceChildren(...chunks.map(({ x, z }) => new Option(`${x}, ${z}`, `${x},${z}`)));
            chunkPicker.hidden = false;
            await showChunk();
        } else {
            if (extension !== "nbt" && extension !== "schematic") throw new Error("Choose an .nbt, .schematic, or .mca file.");
            const nbt = await NBTHelper.fromBuffer(bytes);
            const structure = extension === "schematic" ? await SchematicParser.parse(nbt) : await StructureParser.parse(nbt);
            await showStructure(structure, file.name);
        }
    });
});
chunkInput.addEventListener("change", () => { void load(region!.name, showChunk); });
void setStructure(structureInput.value);

const structureSuggestions = document.getElementById("structure-suggestions") as HTMLDataListElement;
setTimeout(() => {
    fetch(AssetLoader.ROOT + "/data/minecraft/structure/_list.json").then(res => res.json()).then(rootList => {
        console.log(rootList)
        rootList["directories"].forEach(dir => {
            fetch(AssetLoader.ROOT + "/data/minecraft/structure/" + dir + "/_list.json").then(res => res.json()).then(list => {
                console.log(list)
                list["files"].forEach(file => {
                    const option = document.createElement("option");
                    option.value = dir + "/" + file.replace("\.nbt", "");
                    structureSuggestions.appendChild(option);
                });
            }).catch(err => console.error(err))
        })
    }).catch(err => console.error(err))
}, 10)
