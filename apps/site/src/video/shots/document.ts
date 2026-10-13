import { type LoadedSceneDocument, type SceneDocument, SceneDocumentLoader } from "minerender";
import document from "../scene-document.json";
import { easeOut, fade, orbit, range } from "../motion";
import type { Shot } from "../types";

/** The document shown on screen: the real file, shortened to fit. */
const SNIPPET = `{ "format": "minerender-scene", "version": 1, "objects": [
    { "id": "grass", "type": "block", "asset": "minecraft:grass_block" },
    { "id": "player", "type": "skin", "skin": "steve.png",
      "pose": { "rightArm": [-2.4, 0, -0.2] } },
    { "id": "creeper", "type": "entity", "asset": "minecraft:creeper",
      "when": ["powered"] },
    { "id": "pickaxe", "type": "item", "asset": "minecraft:diamond_pickaxe",
      "context": { "components": { "minecraft:enchantments": { ... } } } }
] }`;

let loaded: LoadedSceneDocument;
const REVEAL_FROM = 1.2;
const REVEAL_STEP = 0.45;

/** One JSON document loaded into the scene, its objects appearing in order. */
export const sceneDocument: Shot = {
    id: "document",
    seconds: 8,
    async prepare({ renderer }) {
        loaded = await SceneDocumentLoader.load(renderer.scene, document as SceneDocument);
        for (const object of loaded.objects) object.root.visible = false;
    },
    update({ camera, overlay, renderer, portrait }, t) {
        for (const [index, object] of loaded.objects.entries()) {
            const appear = range(t, REVEAL_FROM + index * REVEAL_STEP, REVEAL_FROM + 0.4 + index * REVEAL_STEP);
            object.root.visible = appear > 0;
            const s = Math.max(easeOut(appear), 0.001);
            object.root.scale.set(s, s, s);
        }
        renderer.dirty = true;
        // Seen from the front so the row spreads out, offset so the scene sits under the JSON on the left.
        orbit(camera, { target: portrait ? [4, 30, 0] : [34, 28, 0], radius: 150, height: 38, angle: -0.15, speed: 0.05 }, t, portrait ? 1.6 : 1);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "A whole scene from\none JSON <accent>document</accent>",
            captionOpacity: fade(t, 0.6, 99, 0.4),
            code: SNIPPET,
            codePosition: portrait ? "right" : "top",
            codeOpacity: fade(t, 0.8, 99, 0.5)
        });
    }
};
