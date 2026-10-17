import { AssetLoader, AssetParser, AssetSource, Caching, MineRenderScene, MineRenderWorld,
    type AssetKey, type MinecraftAsset, type MineRenderDataManifest, type Model, type TextureAsset } from "minerender";

const NAMESPACE = "transparency";
type SlabColor = "red" | "blue";

function texture(color: SlabColor): TextureAsset {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(64, 64);
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const grid = x % 16 === 0 || y % 16 === 0;
            const low = grid ? 40 : 0;
            pixels.data.set(color === "red" ? [255, low, low, 128] : [low, low, 255, 128], (y * 64 + x) * 4);
        }
    }
    context.putImageData(pixels, 0, 0);
    context.strokeStyle = color === "red" ? "#ffc4c4" : "#c4d4ff";
    context.lineWidth = 2;
    context.strokeRect(1, 1, 62, 62);
    context.fillStyle = "#ffffff";
    context.font = "bold 20px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(color === "red" ? "A" : "B", 32, 33);
    const encoded = atob(canvas.toDataURL("image/png").split(",")[1]);
    return { width: 64, height: 64, type: "png", data: Uint8Array.from(encoded, character => character.charCodeAt(0)) };
}

function model(color: SlabColor): Model {
    return {
        textures: { surface: `${NAMESPACE}:block/${color}` },
        elements: [{ from: [color === "red" ? -6 : 2, -2, 7.9], to: [color === "red" ? 14 : 22, 18, 8.1], shade: false,
            faces: { north: { texture: "#surface", uv: [0, 0, 16, 16] }, south: { texture: "#surface", uv: [0, 0, 16, 16] } } }]
    };
}

class FixtureSource extends AssetSource {
    private readonly textures = { red: texture("red"), blue: texture("blue") };

    constructor() { super(); }

    public blocks(): boolean { return true; }

    public async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T | undefined> {
        let asset: unknown;
        if (key.namespace === "minerender-data") {
            if (key.path === "manifest") {
                const dataset = (file: string) => ({ file: `${file}.json`, sha256: "0".repeat(64), bytes: 2, provenance: {} });
                const manifest: MineRenderDataManifest = {
                    schemaVersion: 1, minecraftVersion: AssetLoader.version, dataVersion: 0,
                    datasets: { blockStates: dataset("block-states"), fluids: dataset("fluids"), blockTints: dataset("block-tints") },
                    unavailable: {}, extractor: { repository: "fixture", revision: "fixture", sha256: "0".repeat(64) }
                };
                asset = manifest;
            } else if (["block-states", "fluids", "block-tints"].includes(key.path)) asset = {};
        } else if (key.namespace === "entity-models" && key.path === "blocks") asset = {};
        else if (key.namespace === NAMESPACE && (key.path === "red" || key.path === "blue")) {
            if (parser === AssetParser.BLOCKSTATE) asset = { variants: { "": { model: `${NAMESPACE}:block/${key.path}` } } };
            else if (parser === AssetParser.MODEL) asset = model(key.path);
            else if (parser === AssetParser.IMAGE) asset = { ...this.textures[key.path] };
        }
        return asset as T | undefined;
    }
}

let installed = false;

/** Installs local fixture assets and prevents fallback requests to hosted sources. */
export function installFixtureAssets(): void {
    if (installed) return;
    AssetLoader.addSource("transparency-fixture", new FixtureSource());
    Caching.clear();
    installed = true;
}

/** Places the same two translucent slabs within one section or across its boundary. */
export async function createFixture(splitSections: boolean, reversePlacement: boolean): Promise<{
    scene: MineRenderScene; world: MineRenderWorld<true>; targetZ: number;
}> {
    installFixtureAssets();
    const scene = new MineRenderScene();
    const world = new MineRenderWorld(scene, { sectionMeshing: true });
    const redZ = splitSections ? 15 : 0;
    const placements: { color: SlabColor; z: number }[] = [{ color: "red", z: redZ }, { color: "blue", z: redZ + 1 }];
    if (reversePlacement) placements.reverse();
    for (const { color, z } of placements) await world.setBlockAt(0, 0, z, { type: `${NAMESPACE}:${color}` });
    return { scene, world, targetZ: splitSections ? 248 : 8 };
}
