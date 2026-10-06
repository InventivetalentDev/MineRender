import { AssetKey, Models, Renderer } from "minerender";
import { Vector3 } from "three";

const renderer = new Renderer({
    camera: {
        position: [85, 65, 100],
        lookingAt: [0, 0, 0]
    },
    controls: {
        enabled: true
    },
    render: {
        antialias: false
    },
    composer: {
        enabled: false
    }
});
renderer.appendTo(document.body);
renderer.start();
window["renderer"] = renderer;

const controls = document.getElementById("exports") as HTMLFieldSetElement;
const status = document.getElementById("export-status")!;

function download(content: string | ArrayBuffer | object, filename: string, mime?: string) {
    const dataUrl = typeof content === "string" && content.startsWith("data:");
    const url = dataUrl ? content as string : URL.createObjectURL(new Blob([
        typeof content === "string" || content instanceof ArrayBuffer ? content : JSON.stringify(content)
    ], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (!dataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const exports: Record<string, () => void | Promise<void>> = {
    png: () => download(renderer.toImage(), "blocks.png"),
    trim: () => download(renderer.toImage(true), "blocks-cropped.png"),
    jpeg: () => download(renderer.toImage(false, "image/jpeg", 0.9), "blocks.jpg"),
    obj: () => download(renderer.toObj(), "blocks.obj", "text/plain"),
    ply: () => download(renderer.toPLY(), "blocks.ply", "application/octet-stream"),
    gltf: async () => download(await renderer.toGLTF(), "blocks.gltf", "model/gltf+json"),
    glb: async () => download(await renderer.toGLTF({ binary: true }), "blocks.glb", "model/gltf-binary")
};

for (const button of controls.querySelectorAll<HTMLButtonElement>("button")) {
    button.addEventListener("click", async () => {
        controls.disabled = true;
        status.textContent = `Exporting ${button.textContent}…`;
        try {
            await exports[button.dataset.export!]();
            status.textContent = "Download ready.";
        } catch (error) {
            status.textContent = error instanceof Error ? `Could not export: ${error.message}` : "Could not export the scene.";
            console.error(error);
        } finally {
            controls.disabled = false;
        }
    });
}

async function loadBlocks() {
    const [stone, grass] = await Promise.all([
        Models.getMerged(AssetKey.parse("models", "minecraft:block/stone")),
        Models.getMerged(AssetKey.parse("models", "minecraft:block/grass_block"))
    ]);
    if (!stone || !grass) throw new Error("A block model is missing.");

    for (const x of [-24, 24]) {
        const block = await renderer.scene.addModel(stone, { instanceMeshes: true, mergeMeshes: true });
        block.setPosition(new Vector3(x, 0, 0));
    }
    await renderer.scene.addModel(grass, { instanceMeshes: true, mergeMeshes: true, tints: { 0: 0x91bd59 } });
    controls.disabled = false;
    status.textContent = "Ready to export.";
}

loadBlocks().catch(error => {
    status.textContent = error instanceof Error ? `Could not load blocks: ${error.message}` : "Could not load blocks.";
    console.error(error);
});
