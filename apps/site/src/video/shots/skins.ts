import type { SkinObject } from "minerender";
import { ALEX_TEXTURE, STEVE_TEXTURE } from "../../examples/shared";
import { Cues, fade, lerp, orbit, smooth } from "../motion";
import type { Shot } from "../types";

/** Second-layer parts toggled on the timeline. The hat stays hidden: the default skins do not use it. */
const OVERLAY_PARTS = ["jacket", "leftSleeve", "rightSleeve", "leftTrousers", "rightTrousers"];

let steve: SkinObject;
let alex: SkinObject;
let cues: Cues;
let captionText = "Skins";

/** Steve → Alex, slim detection, layer toggles, and a wave. Both skins are built up front so the swap is exact. */
export const skins: Shot = {
    id: "skins",
    seconds: 9,
    async prepare({ renderer }) {
        steve = await renderer.scene.addSkin(STEVE_TEXTURE);
        alex = await renderer.scene.addSkin(ALEX_TEXTURE);
        for (const skin of [steve, alex]) {
            skin.rotation.y = 0.35;
            skin.toggleMeshVisibility("hat", false);
        }
        alex.visible = false;
        captionText = "Skins";
        cues = new Cues()
            .at(2.2, () => {
                captionText = "Classic and <accent>slim</accent>, detected from the texture";
                steve.visible = false;
                alex.visible = true;
            })
            .at(4.4, () => {
                captionText = "Every layer is a <accent>named mesh</accent>";
                for (const part of OVERLAY_PARTS) alex.toggleMeshVisibility(part, false);
            })
            .at(5.4, () => { for (const part of OVERLAY_PARTS) alex.toggleMeshVisibility(part, true); })
            .at(6.4, () => { captionText = "Pose any part"; });
    },
    update({ camera, overlay, renderer, portrait }, t) {
        cues.run(t);
        const wave = smooth(t, 6.4, 7.0);
        for (const skin of [steve, alex]) {
            skin.getGroupByName("rightArm")?.rotation.set(lerp(0, -2.6 + Math.sin(t * 7) * 0.25, wave), 0, lerp(0, -0.25, wave));
            skin.getGroupByName("head")?.rotation.set(lerp(0, -0.15, wave), lerp(0, 0.3, wave), 0);
            skin.getGroupByName("leftArm")?.rotation.set(lerp(0, 0.35, wave), 0, 0);
        }
        renderer.dirty = true;
        orbit(camera, { target: [0, 16, 0], radius: 58, height: 5, angle: 0.5, speed: 0.08 }, t, portrait ? 1.25 : 1);
        overlay.set({
            surface: 1,
            caption: captionText,
            captionOpacity: fade(t, 0.6, 99, 0.4)
        });
    }
};
