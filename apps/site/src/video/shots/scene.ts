import { SceneExporter } from "minerender";
import { runExample } from "../examples";
import { fade, orbit } from "../motion";
import type { Shot } from "../types";

const EXPORT_AT = 5.2;
let glbBytes = 0;

/** The composed hero scene: blocks, player, item, and mob in one renderer, then exported as GLB. */
export const sceneComposed: Shot = {
    id: "scene-composed",
    seconds: 10,
    async prepare(context) {
        await runExample(context, "scene-composed");
        const glb = await SceneExporter.toGLTF(context.renderer.scene, { binary: true }) as ArrayBuffer;
        glbBytes = glb.byteLength;
    },
    update({ camera, overlay, portrait }, t) {
        orbit(camera, { target: [0, 12, 0], radius: 116, height: 40, angle: 0.65, speed: 0.1 }, t, portrait ? 1.4 : 1);
        const exporting = t >= EXPORT_AT;
        overlay.set({
            surface: 1,
            caption: exporting ? "...and out again as\n<accent>glTF</accent>, OBJ or PLY" : "Everything in\n<accent>one scene</accent>",
            captionOpacity: exporting ? fade(t, EXPORT_AT, 99, 0.4) : fade(t, 0.6, EXPORT_AT, 0.4),
            code: exporting
                ? "const glb = await SceneExporter.toGLTF(scene, { binary: true });"
                : "const scene = renderer.scene;\nawait scene.addBlock(grass);\nawait scene.addSkin(\"Notch\");\nawait scene.addEntity(creeper);",
            codeOpacity: exporting ? fade(t, EXPORT_AT + 0.2, 99, 0.4) : fade(t, 3.0, EXPORT_AT, 0.4),
            stat: `scene.glb · ${(glbBytes / 1024).toFixed(0)} KB`,
            statOpacity: fade(t, EXPORT_AT + 1.0, 99, 0.4)
        });
    }
};
