import { BasicAssetKey, Entities, type EntityObject } from "minerender";
import { Sphere, Vector3 } from "three";
import { easeOut, fade, frameSphere, lerp, range, smooth } from "../motion";
import type { Shot, ShotContext } from "../types";

async function addEntity(context: ShotContext, model: string, texture?: string): Promise<EntityObject> {
    const entity = await Entities.getEntity(new BasicAssetKey("minecraft", model), texture ? new BasicAssetKey("minecraft", texture) : undefined);
    if (!entity) throw new Error(`Unknown entity "${model}"`);
    return await context.renderer.scene.addEntity(entity, { instanceMeshes: false }) as EntityObject;
}

const LINEUP: Array<[string, string | undefined]> = [
    ["cat", "cat/tabby"], ["cat", "cat/siamese"], ["wolf", "wolf/wolf_snowy"], ["horse", "horse/horse_chestnut"],
    ["axolotl", "axolotl/axolotl_lucy"], ["frog", "frog/warm_frog"], ["rabbit", "rabbit/gold"], ["creeper", undefined]
];
const SPACING = 28;

let lineup: EntityObject[] = [];
/** Dataset transforms live in the root scale (usually a flip), so reveal scaling multiplies them. */
const baseScale = new WeakMap<EntityObject, Vector3>();

/** Mobs in a row, each with a texture variant, revealed as the camera dollies along. */
export const entityVariants: Shot = {
    id: "entity-variants",
    seconds: 7,
    async prepare(context) {
        lineup = [];
        for (const [index, [model, texture]] of LINEUP.entries()) {
            // Living entities stand with their feet at the origin, facing +Z.
            const entity = await addEntity(context, model, texture);
            entity.position.x += (index - (LINEUP.length - 1) / 2) * SPACING;
            entity.rotation.y = 0.25;
            entity.visible = false;
            baseScale.set(entity, entity.scale.clone());
            lineup.push(entity);
        }
    },
    update({ camera, overlay, renderer, portrait }, t) {
        for (const [index, entity] of lineup.entries()) {
            const appear = range(t, 0.3 + index * 0.35, 0.8 + index * 0.35);
            entity.visible = appear > 0;
            entity.scale.copy(baseScale.get(entity)!).multiplyScalar(Math.max(easeOut(appear), 0.001));
        }
        renderer.dirty = true;
        const x = lerp(-SPACING * 2.2, SPACING * 2.2, smooth(t, 0.5, 6.5));
        const distance = portrait ? 150 : 95;
        camera.position.set(x + 30, 36, distance);
        camera.lookAt(x, 10, 0);
        overlay.set({
            surface: 1,
            caption: "Every mob,\n<accent>every texture variant</accent>",
            captionOpacity: fade(t, 0.8, 99, 0.4)
        });
    }
};

let warden: EntityObject;
/** The warden is about 2.9 blocks tall; frame that rather than a bounding box that includes hidden passes. */
const wardenBounds = new Sphere(new Vector3(0, 24, 0), 30);

/** A vanilla keyframe animation played from the dataset. */
export const entityAnimation: Shot = {
    id: "entity-animation",
    seconds: 6,
    async prepare(context) {
        const key = new BasicAssetKey("minecraft", "warden");
        const [model, animations] = await Promise.all([Entities.getEntity(key), Entities.getAnimations(key)]);
        if (!model || !animations?.roar) throw new Error("warden or its roar animation missing");
        warden = await context.renderer.scene.addEntity(model, { instanceMeshes: false }) as EntityObject;
        warden.rotation.y = 0.4;
        // Vanilla's emissive passes (heart, bioluminescent layer, pulsating spots) are separate draws of the same
        // bones, so each gets its own copy of the clip; a clip targets one layer.
        const layers = [...new Set(Object.keys(model.layers ?? { main: model }).map(name => name.split("#")[0]))];
        warden.playAnimations(layers.map(layer => ({ ...animations.roar, layer })), { loop: true });
        warden.setAnimationTime(0);
    },
    update({ camera, overlay, renderer, portrait }, t) {
        warden.setAnimationTime(t);
        renderer.dirty = true;
        // Slow push-in while circling slightly.
        frameSphere(camera, wardenBounds, 0.5 + t * 0.06, 0.18, (portrait ? 1.6 : 1.35) - 0.15 * smooth(t, 0, 6));
        overlay.set({
            surface: range(t, 0, 0.3),
            caption: "Vanilla <accent>keyframe animations</accent>",
            captionOpacity: fade(t, 0.8, 99, 0.4),
            code: "warden.playAnimation(roar, { loop: true });\nrenderer.onFrame(({ delta }) =>\n    warden.advanceAnimation(delta));",
            codeOpacity: fade(t, 2.4, 99, 0.4)
        });
    }
};
