import { AssetKey, BasicAssetKey, BlockStates, Entities, SceneExporter } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { STEVE_TEXTURE, buttonControl, download, esmRenderer, standOn, statusControl } from "./shared";
import { pose } from "./skins";

async function buildScene(context: Parameters<Example["setup"]>[0]): Promise<void> {
    const { renderer, signal } = context;
    const scene = renderer.scene;
    const grass = await BlockStates.get(AssetKey.parse("blockstates", "grass_block"));
    if (!grass || signal.aborted) return;
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            const block = await scene.addBlock(grass);
            if (signal.aborted) return;
            block.setPosition(block.getPosition().set(x * 16, -16, z * 16));
        }
    }
    const skin = await scene.addSkin(STEVE_TEXTURE);
    if (signal.aborted) return;
    skin.position.set(-6, 0, 4);
    skin.rotation.y = 0.4;
    pose(skin);
    const model = await Entities.getEntity(new BasicAssetKey("minecraft", "pig"));
    if (!model || signal.aborted) return;
    const pig = await scene.addEntity(model, { instanceMeshes: false });
    if (signal.aborted || !("position" in pig)) return;
    pig.position.set(10, 0, -10);
    pig.rotation.y = -0.9;
    standOn(pig);
    renderer.dirty = true;
}

const EXPORT_RENDERER = {
    camera: {
        position: [60, 44, 76] as [number, number, number],
        lookingAt: [0, 8, 0] as [number, number, number]
    }
};

const screenshot: Example = {
    id: "export-image",
    title: "Screenshot",
    description: "toImage renders a fresh frame and returns a data URL. Trimming removes the transparent border.",
    renderer: EXPORT_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer } = context;
        await buildScene(context);
        const status = statusControl(context);
        const save = (trim: boolean) => {
            const url = renderer.toImage(trim);
            const link = document.createElement("a");
            link.href = url;
            link.download = trim ? "minerender-trimmed.png" : "minerender.png";
            link.click();
            status.textContent = trim ? "Saved the trimmed frame." : "Saved the full frame.";
        };
        buttonControl(context, "Save PNG", () => save(false));
        buttonControl(context, "Save trimmed PNG", () => save(true));
        context.controls.appendChild(status);
    },
    code: {
        esm: `${esmRenderer()}

// ... add content to renderer.scene

// Full canvas as PNG
const png = renderer.toImage();

// Trimmed to the drawn pixels, as JPEG at 90% quality
const jpeg = renderer.toImage(true, "image/jpeg", 0.9);

// Larger drawing buffer for higher-resolution captures
new Renderer({ render: { pixelRatio: 2 } });`
    }
};

const model3d: Example = {
    id: "export-3d",
    title: "glTF, OBJ and PLY",
    description: "SceneExporter writes the visible meshes with their instance placements. glTF keeps the atlas textures and tints; OBJ and PLY carry geometry only.",
    renderer: EXPORT_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer } = context;
        await buildScene(context);
        const status = statusControl(context);
        const run = async (label: string, work: () => Promise<void>) => {
            status.textContent = `Exporting ${label}…`;
            try {
                await work();
                status.textContent = `Saved ${label}.`;
            } catch (error) {
                console.warn(error);
                status.textContent = error instanceof Error ? error.message : `Could not export ${label}.`;
            }
        };
        buttonControl(context, "GLB", () => void run("GLB", async () => {
            const glb = await SceneExporter.toGLTF(renderer.scene, { binary: true });
            download("minerender.glb", glb as ArrayBuffer, "model/gltf-binary");
        }));
        buttonControl(context, "OBJ", () => void run("OBJ", async () => {
            download("minerender.obj", SceneExporter.toObj(renderer.scene), "text/plain");
        }));
        buttonControl(context, "PLY", () => void run("PLY", async () => {
            download("minerender.ply", SceneExporter.toPLY(renderer.scene), "text/plain");
        }));
        context.controls.appendChild(status);
    },
    code: {
        esm: `${esmRenderer("SceneExporter")}

// ... add content to renderer.scene

// Binary glTF with textures (browser only)
const glb = await SceneExporter.toGLTF(renderer.scene, { binary: true });
// or a glTF JSON object
const gltf = await SceneExporter.toGLTF(renderer.scene);

// Geometry-only formats
const obj = SceneExporter.toObj(renderer.scene);
const ply = SceneExporter.toPLY(renderer.scene);

// Any Object3D works as the root, for example a single skin
const skinOnly = SceneExporter.toObj(skin);`
    }
};

export const exports: ExampleGroup = {
    id: "export",
    title: "Export",
    lead: "Save a frame as an image or the scene as a 3D model.",
    examples: [screenshot, model3d]
};
