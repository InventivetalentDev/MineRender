import { fade, range } from "../motion";
import type { Shot } from "../types";

const CODE = `import { NodeRenderer } from "minerender/node";

const renderer = await NodeRenderer.create({
    width: 1200, height: 900
});
await SceneDocumentLoader.load(
    renderer.scene, document);
await writeFile("scene.png",
    await renderer.renderToBuffer());`;

let image: string | undefined;

/** The same document rendered by the Node renderer in the driver process; the PNG is shown as-is. */
export const nodeRender: Shot = {
    id: "node",
    seconds: 6,
    async prepare({ nodeImage }) {
        image = nodeImage;
        if (!image) console.warn("[node] no Node render available; preview mode shows the code only");
        else await new Promise<void>((resolve, reject) => {
            const probe = new Image();
            probe.onload = () => resolve();
            probe.onerror = () => reject(new Error(`Could not load ${image}`));
            probe.src = image!;
        });
    },
    update({ overlay }, t) {
        overlay.set({
            surface: 0,
            caption: "The same document,\nrendered in <accent>Node</accent>\nno browser, PNG out",
            captionOpacity: fade(t, 0.3, 99, 0.4),
            captionPosition: "upper",
            code: CODE,
            codePosition: "left",
            codeOpacity: fade(t, 1.6, 99, 0.5),
            image,
            imageOpacity: fade(t, 0.8, 99, 0.6)
        });
    }
};
