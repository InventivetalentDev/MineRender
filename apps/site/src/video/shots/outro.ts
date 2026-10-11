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
            heading: "beta.minerender.org",
            subheading: "npm install minerender@beta",
            title: range(t, 0.2, 1.0),
            titleSize: "compact"
        });
    }
};
