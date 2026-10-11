import { AssetKey, BlockStates } from "minerender";
import { fade, orbit, range } from "../motion";
import type { Shot } from "../types";

/** Cold open: one grass block on a turntable, then the title. */
export const open: Shot = {
    id: "open",
    seconds: 5,
    async prepare({ renderer }) {
        const state = await BlockStates.get(AssetKey.parse("blockstates", "grass_block"));
        if (!state) throw new Error("grass_block missing");
        await renderer.scene.addBlock(state);
    },
    update({ camera, overlay, portrait }, t) {
        // The title takes the upper part of the frame; the block turns below it, fully in view.
        // Block models are centred on their position.
        orbit(camera, { target: [0, portrait ? 6 : 11, 0], radius: 54, height: 16, angle: 0.6, speed: 0.35 }, t);
        overlay.set({
            surface: range(t, 0, 1.2),
            heading: "MineRender V2",
            subheading: "Minecraft, rendered in the browser",
            title: fade(t, 1.4, 99, 0.6),
            titlePosition: "upper"
        });
    }
};
