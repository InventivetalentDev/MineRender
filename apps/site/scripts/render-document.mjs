// Renders the video's scene document to a PNG with the Node renderer (no browser involved), so the
// video can show a real server-side render. Usage: node scripts/render-document.mjs <output.png>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SceneDocumentLoader } from "minerender";
import { NodeRenderer, shutdown } from "minerender/node";
import document from "../src/video/scene-document.json" with { type: "json" };

const output = process.argv[2];
if (!output) {
    console.error("Usage: node scripts/render-document.mjs <output.png>");
    process.exit(2);
}

const renderer = await NodeRenderer.create({
    width: 1200,
    height: 900,
    camera: { position: document.camera.position, lookingAt: document.camera.target },
    render: { pixelRatio: 2 }
});
try {
    await SceneDocumentLoader.load(renderer.scene, document);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, await renderer.renderToBuffer({ trim: true }));
    console.log(`Rendered ${document.objects.length} objects to ${output}`);
} finally {
    renderer.dispose();
    shutdown();
}
