import { Euler, Matrix4, MeshBasicMaterial } from "three";
import { AssetKey } from "../assets/AssetKey";
import { Entities } from "../assets/Entities";
import { BannerPatterns, DYE_COLORS } from "../assets/BannerPatterns";
import { ModelTextures } from "../assets/ModelTextures";
import type { EntityLayer, EntityModel, EntityModelLayer } from "../entity/EntityModel";
import type { SpecialItemRenderer, TripleArray } from "./Model";

/** Entity geometry and placement for a special item preview. Named part rotations use radians. */
export interface SpecialItemPart {
    model: EntityModel;
    transform: Matrix4;
    rotations: Record<string, TripleArray>;
    /** Absolute named-part positions in the entity model's coordinate system. */
    positions?: Record<string, TripleArray>;
    /** Colors for the entity model's named texture passes. */
    tints?: Record<string, number>;
}

/** Loads entity geometry and texture passes for supported special item previews. */
export class SpecialItems {

    /** Resolves the static entity parts drawn by a special item renderer, in model units. */
    public static async getParts(special: SpecialItemRenderer, root?: string, components: Record<string, unknown> = {}): Promise<SpecialItemPart[]> {
        const texture = (id: string, directory: string) => {
            const key = AssetKey.parse("textures", id);
            return new AssetKey(key.namespace, [directory, key.getFullPath()].filter(Boolean).join("/"),
                "textures", "entity", "assets", ".png", root);
        };
        const load = async (id: string, textureKey: AssetKey | undefined, transform: Matrix4,
                            rotations: Record<string, TripleArray> = {}, layers = ["main"]): Promise<SpecialItemPart> => {
            const key = new AssetKey("minecraft", id, undefined, undefined, "entity-models", ".json", root);
            const model = await Entities.getEntity(key, textureKey, layers.length === 1 ? { layer: layers[0] } : {
                layers, textures: textureKey ? Object.fromEntries(layers.map(name => [name, textureKey])) : undefined
            });
            if (!model) throw new Error(`Missing entity model minecraft:${id} for special item ${special.type}`);
            return { model, transform, rotations };
        };
        switch (special.type) {
            case "minecraft:banner":
            case "banner":
            case "minecraft:shield":
            case "shield": {
                const banner = special.type === "banner" || special.type === "minecraft:banner";
                const color = banner ? BannerPatterns.getColor(special.color) : components["minecraft:base_color"] === undefined
                    ? undefined : BannerPatterns.getColor(components["minecraft:base_color"]);
                const patterns = await BannerPatterns.getLayers(components["minecraft:banner_patterns"], banner ? "banner" : "shield", root);
                const patterned = banner || color !== undefined || patterns.length > 0;
                const baseTexture = texture(banner ? "banner_base" : patterned ? "shield_base" : "shield_base_nopattern", "");
                const transform = banner ? new Matrix4().makeTranslation(8, 0, 8).multiply(new Matrix4().makeScale(2 / 3, -2 / 3, -2 / 3))
                    : new Matrix4().makeScale(1, -1, -1);
                const part = await load(banner ? "standing_banner" : "shield", baseTexture, transform, {}, banner ? ["main", "flag"] : ["main"]);
                const layers: Record<string, EntityLayer> = Object.fromEntries(Object.entries(part.model.layers ?? { main: part.model })
                    .map(([name, layer]) => [name, { ...layer, render: "solid" }]));
                let overlay: EntityModelLayer;
                if (banner) {
                    const flagLayer = layers.flag;
                    const flag = flagLayer?.layer.root.children.flag;
                    if (!flag) throw new Error("Banner entity model is missing its flag layer");
                    overlay = { ...flagLayer.layer, root: { ...flagLayer.layer.root, children: { ...flagLayer.layer.root.children,
                        flag: { ...flag, pose: { ...flag.pose, rotation: [-0.0025 * Math.PI, flag.pose.rotation[1], flag.pose.rotation[2]] } }
                    } } };
                    layers.flag = { ...flagLayer, layer: overlay };
                } else {
                    const main = layers.main.layer;
                    const plate = main.root.children.plate;
                    if (!plate) throw new Error("Shield entity model is missing its plate");
                    overlay = { ...main, root: { ...main.root, cubes: [], children: { plate } } };
                }
                const tints: Record<string, number> = {};
                if (patterned) {
                    const draws = [{ texture: texture(`${banner ? "banner" : "shield"}/base`, ""), color: color ?? DYE_COLORS.white }, ...patterns];
                    draws.forEach((draw, index) => {
                        const name = index === 0 ? "pattern_base" : `pattern_${index - 1}`;
                        layers[name] = { key: draw.texture, texture: draw.texture, layer: overlay, render: "no_outline", tint: name };
                        tints[name] = draw.color;
                    });
                }
                await Promise.all([...new Map(Object.values(layers).map(layer => [layer.texture!.serialize(), layer.texture!])).values()].map(async key => {
                    if (!await ModelTextures.preload(key)) throw new Error(`Missing special item texture ${key.toNamespacedString()}`);
                }));
                part.model = { ...part.model, ...layers.main, layers };
                part.tints = tints;
                return [part];
            }
            case "minecraft:chest":
            case "chest": {
                const angle = -(special.openness ?? 0) * Math.PI / 2;
                const chest = await load("chest", texture(special.texture, "chest"), new Matrix4(), {
                    lid: [angle, 0, 0], lock: [angle, 0, 0]
                });
                chest.model = { ...chest.model, render: "solid", layers: undefined };
                return [chest];
            }
            case "minecraft:shulker_box":
            case "shulker_box": {
                const openness = special.openness === undefined ? 0 : special.openness;
                const orientation = special.orientation === undefined ? "up" : special.orientation;
                const directions: Record<string, TripleArray> = {
                    down: [Math.PI, 0, 0], up: [0, 0, 0], north: [Math.PI / 2, 0, Math.PI],
                    south: [Math.PI / 2, 0, 0], west: [Math.PI / 2, 0, Math.PI / 2], east: [Math.PI / 2, 0, -Math.PI / 2]
                };
                if (!Object.prototype.hasOwnProperty.call(directions, orientation)) throw new Error(`Unsupported shulker-box orientation ${orientation}`);
                if (typeof openness !== "number" || !Number.isFinite(openness)) throw new Error("Shulker-box openness must be finite");
                if (typeof special.texture !== "string" || !special.texture) throw new Error("Shulker-box texture is required");
                const transform = new Matrix4().makeTranslation(8, 8, 8)
                    .multiply(new Matrix4().makeScale(0.9995, 0.9995, 0.9995))
                    .multiply(new Matrix4().makeRotationFromEuler(new Euler(...directions[orientation], "XYZ")))
                    .multiply(new Matrix4().makeScale(1, -1, -1))
                    .multiply(new Matrix4().makeTranslation(0, -16, 0));
                const box = await load("shulker_box", texture(special.texture, "shulker"), transform, { lid: [0, openness * Math.PI * 1.5, 0] });
                box.positions = { lid: [0, 24 - openness * 8, 0] };
                return [box];
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
