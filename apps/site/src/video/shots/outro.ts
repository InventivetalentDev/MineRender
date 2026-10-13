import { SITE } from "../brand";
import { range } from "../motion";
import type { Shot } from "../types";

export const outro: Shot = {
    id: "outro",
    seconds: 4,
    async prepare() {
        // Nothing to load; the title is the whole frame.
    },
    update({ overlay }, t) {
        overlay.set({
            surface: 0,
            heading: SITE,
            brand: 0,
            subheading: "npm install minerender@beta",
            title: range(t, 0.2, 1.0),
            titleSize: "compact",
            // The track mixed in by scripts/mix-music.mjs; Mojang asks for the "courtesy of" line.
            credit: "Music: Lilypad by Amos Roddy · Music courtesy of Mojang Studios",
            creditOpacity: range(t, 0.8, 1.6)
        });
    }
};
