import { Matrix4, MeshBasicMaterial } from "three";
import { AssetKey } from "../assets/AssetKey";
import { Entities } from "../assets/Entities";
import type { EntityModel } from "../entity/EntityModel";
import type { SpecialItemRenderer, TripleArray } from "./Model";

export interface SpecialItemPart {
    model: EntityModel;
    transform: Matrix4;
    rotations: Record<string, TripleArray>;
}

export class SpecialItems {

    /** Resolves the static entity parts drawn by a special item renderer, in model units. */
    public static async getParts(special: SpecialItemRenderer, root?: string): Promise<SpecialItemPart[]> {
        const texture = (id: string, directory: string) => {
            const key = AssetKey.parse("textures", id);
            return new AssetKey(key.namespace, [directory, key.getFullPath()].filter(Boolean).join("/"),
                "textures", "entity", "assets", ".png", root);
        };
        const load = async (id: string, textureKey: AssetKey | undefined, transform: Matrix4,
                            rotations: Record<string, TripleArray> = {}): Promise<SpecialItemPart> => {
            const key = new AssetKey("minecraft", id, undefined, undefined, "entity-models", ".json", root);
            const model = await Entities.getEntity(key, textureKey, { layer: "main" });
            if (!model) throw new Error(`Missing entity model minecraft:${id} for special item ${special.type}`);
            return { model, transform, rotations };
        };
        switch (special.type) {
            case "minecraft:chest":
            case "chest": {
                const angle = -(special.openness ?? 0) * Math.PI / 2;
                const chest = await load("chest", texture(special.texture, "chest"), new Matrix4(), {
                    lid: [angle, 0, 0], lock: [angle, 0, 0]
                });
                chest.model = { ...chest.model, render: "solid", layers: undefined };
                return [chest];
            }
            case "minecraft:bed":
            case "bed": {
                const transform = new Matrix4().makeTranslation(0, 9, 0)
                    .multiply(new Matrix4().makeRotationX(Math.PI / 2))
                    .multiply(new Matrix4().makeTranslation(8, 8, 8))
                    .multiply(new Matrix4().makeRotationZ(Math.PI))
                    .multiply(new Matrix4().makeTranslation(-8, -8, -8));
                const key = texture(special.texture, "bed");
                return Promise.all([
                    load("bed_head", key, transform),
                    load("bed_foot", key, new Matrix4().makeTranslation(0, 0, -16).multiply(transform))
                ]);
            }
            case "minecraft:head":
            case "head": {
                const models: Record<string, string> = {
                    skeleton: "skeleton_skull", wither_skeleton: "wither_skeleton_skull", zombie: "zombie_head",
                    creeper: "creeper_head", dragon: "dragon_skull", piglin: "piglin_head"
                };
                const id = Object.prototype.hasOwnProperty.call(models, special.kind) ? models[special.kind] : undefined;
                if (!id) throw new Error(`Unsupported special item head kind ${special.kind}`);
                const animation = (special.animation ?? 0) * Math.PI * 0.2;
                const rotations: Record<string, TripleArray> = { head: [0, Math.PI, 0] };
                if (special.kind === "dragon") rotations.jaw = [(Math.sin(animation) + 1) * 0.2, 0, 0];
                if (special.kind === "piglin") {
                    rotations.left_ear = [0, 0, -(Math.cos(animation * 1.2) + 2.5) * 0.2];
                    rotations.right_ear = [0, 0, (Math.cos(animation) + 2.5) * 0.2];
                }
                return [await load(id, special.texture ? texture(special.texture, "") : undefined,
                    new Matrix4().makeTranslation(8, 0, 8).multiply(new Matrix4().makeScale(-1, -1, 1)), rotations)];
            }
        }
    }

    /** An owned material with model-preview shading; its entity texture remains shared. */
    public static createMaterial(source: MeshBasicMaterial, shade: boolean): MeshBasicMaterial {
        const material = source.clone();
        if (shade) {
            material.onBeforeCompile = shader => {
                shader.vertexShader = `varying float itemLight;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `
                    #include <begin_vertex>
                    vec3 N = inverseTransformDirection(normalMatrix * normal, viewMatrix);
                    itemLight = (1.0 + N.y) * 0.25 - N.x * N.x * 0.15 + N.z * N.z * 0.05 + 0.5;
                `);
                shader.fragmentShader = `varying float itemLight;\n${shader.fragmentShader}`.replace(
                    "#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= itemLight;");
            };
            material.customProgramCacheKey = () => "special-item-side";
        }
        return material;
    }

}
