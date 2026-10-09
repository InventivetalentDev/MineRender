import { runExample } from "../examples";
import { fade, orbit } from "../motion";
import type { Shot } from "../types";

/** The composed hero scene: blocks, player, item, and mob in one renderer. */
export const sceneComposed: Shot = {
    id: "scene-composed",
    seconds: 8,
    async prepare(context) {
        await runExample(context, "scene-composed");
    },
    update({ camera, overlay, portrait }, t) {
        orbit(camera, { target: [0, 12, 0], radius: 116, height: 40, angle: 0.65, speed: 0.1 }, t, portrait ? 1.4 : 1);
        overlay.set({
            surface: 1,
            caption: "Everything in\n<accent>one scene</accent>",
            captionOpacity: fade(t, 0.6, 99, 0.5),
            code: "const scene = renderer.scene;\nawait scene.addBlock(grass);\nawait scene.addSkin(\"Notch\");\nawait scene.addEntity(creeper);",
            codeOpacity: fade(t, 3.0, 99, 0.5)
        });
    }
};
