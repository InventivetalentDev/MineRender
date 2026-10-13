import { Skins, type SkinObject } from "minerender";
import { STEVE_TEXTURE } from "../../examples/shared";
import { fade, orbit, range } from "../motion";
import type { Shot } from "../types";

let skin: SkinObject;
let layout = "minecraft";

/** A cape from capes.dev, seen from behind; falls back to the repository's OptiFine cape when the lookup fails. */
export const capes: Shot = {
    id: "capes",
    seconds: 6,
    async prepare({ renderer, fsBase }) {
        skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        skin.toggleMeshVisibility("hat", false);
        let src: string | undefined;
        try {
            src = await Skins.capeFromCapesDev("jeb_", "minecraft");
            layout = "minecraft";
        } catch (error) {
            console.warn("capes.dev lookup failed", error);
        }
        if (!src && fsBase) {
            src = `${fsBase}/img/optifine_cape.png`;
            layout = "optifine";
        }
        if (src) await skin.setCapeTexture(src, layout as "minecraft" | "optifine");
        else console.warn("[capes] no cape texture available");
    },
    update({ camera, overlay, renderer, portrait }, t) {
        // A gentle sway, as if walking.
        const cape = skin.getGroupByName("cape");
        if (cape) cape.rotation.x = 0.35 + Math.sin(t * 2.4) * 0.12;
        skin.getGroupByName("rightArm")?.rotation.set(Math.sin(t * 2.4) * 0.5, 0, 0);
        skin.getGroupByName("leftArm")?.rotation.set(-Math.sin(t * 2.4) * 0.5, 0, 0);
        skin.getGroupByName("rightLeg")?.rotation.set(-Math.sin(t * 2.4) * 0.6, 0, 0);
        skin.getGroupByName("leftLeg")?.rotation.set(Math.sin(t * 2.4) * 0.6, 0, 0);
        renderer.dirty = true;
        // The player faces +Z; start behind and swing round to the side.
        orbit(camera, { target: [0, 17, 0], radius: 60, height: 10, angle: Math.PI - 0.5, speed: 0.14 }, t, portrait ? 1.25 : 1);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "<accent>Capes</accent>:\nvanilla, OptiFine, LabyMod layouts",
            captionOpacity: fade(t, 0.6, 99, 0.4),
            code: `const cape = await Skins.capeFromCapesDev("jeb_");\nawait skin.setCapeTexture(cape, "${layout}");`,
            codeOpacity: fade(t, 2.2, 99, 0.5)
        });
    }
};
