import { BasicAssetKey, Entities, type EntityObject } from "minerender";
import { Cues, fade, orbit, range } from "../motion";
import type { Shot, ShotContext } from "../types";

async function addEntity(context: ShotContext, model: string, when: string[], tints?: Record<string, number>): Promise<EntityObject> {
    const entity = await Entities.getEntity(new BasicAssetKey("minecraft", model), undefined, { when });
    if (!entity) throw new Error(`Unknown entity "${model}"`);
    const object = await context.renderer.scene.addEntity(entity, { instanceMeshes: false, tints }) as EntityObject;
    object.rotation.y = 0.4;
    object.visible = false;
    return object;
}

const WOOL = [0xf9801d, 0x80c71f, 0xf38baa];

let stages: EntityObject[] = [];
let cues: Cues;
let captionText = "";
let codeText = "";

/** Creeper → charged creeper (the powered pass), then a sheep cycling wool tints. Every state is built up front. */
export const entityStates: Shot = {
    id: "entity-states",
    seconds: 7,
    async prepare(context) {
        stages = [
            await addEntity(context, "creeper", []),
            await addEntity(context, "creeper", ["powered"]),
            ...await Promise.all(WOOL.map(color => addEntity(context, "sheep", ["not_sheared"], { wool_color: color })))
        ];
        const show = (index: number) => stages.forEach((entity, i) => { entity.visible = i === index; });
        show(0);
        captionText = "Entity <accent>states</accent>";
        codeText = "";
        cues = new Cues()
            .at(1.6, () => {
                show(1);
                captionText = "Entity <accent>states</accent>:\nthe dataset's extra passes";
                codeText = "await Entities.getEntity(creeper, undefined, {\n    when: [\"powered\"]\n});";
            })
            .at(3.9, () => {
                show(2);
                captionText = "Entity <accent>states</accent>:\ntint labels take colours";
                codeText = "await scene.addEntity(sheep, {\n    tints: { wool_color: 0xf9801d }\n});";
            })
            .at(5.0, () => show(3))
            .at(6.0, () => show(4));
    },
    update({ camera, overlay, renderer, portrait }, t) {
        cues.run(t);
        renderer.dirty = true;
        orbit(camera, { target: [0, 14, 0], radius: 62, height: 14, angle: 0.3, speed: 0.1 }, t, portrait ? 1.3 : 1);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: captionText,
            captionOpacity: fade(t, 0.6, 99, 0.4),
            code: codeText,
            codeOpacity: codeText ? 1 : 0
        });
    }
};
