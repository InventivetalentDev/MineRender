import { Euler, Matrix4, MeshBasicMaterial } from "three";
import { AssetKey } from "../assets/AssetKey";
import { Entities } from "../assets/Entities";
import { BannerPatterns, DYE_COLORS } from "../assets/BannerPatterns";
import { DecoratedPots } from "../assets/DecoratedPots";
import { ModelTextures } from "../assets/ModelTextures";
import { CubeFace } from "../CubeFace";
import { PlayerHeadTextures } from "../skin/PlayerHeadTextures";
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
    faces?: Record<string, CubeFace[]>;
    /** Shared prepared material; the renderer clones it and retains ownership of only that clone. */
    material?: MeshBasicMaterial;
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
            case "minecraft:decorated_pot":
            case "decorated_pot": {
                const sideTextures = DecoratedPots.getSideTextures(components["minecraft:pot_decorations"], root);
                const baseTexture = texture("decorated_pot_base", "decorated_pot");
                const [base, sides] = await Promise.all([
                    load("decorated_pot_base", baseTexture, new Matrix4()),
                    load("decorated_pot_sides", texture("decorated_pot_side", "decorated_pot"), new Matrix4())
                ]);
                const layers: Record<string, EntityLayer> = {
                    base: { key: base.model.key, texture: baseTexture, layer: base.model.layer, render: "solid" }
                };
                for (const side of ["front", "back", "left", "right"] as const) {
                    const part = sides.model.layer.root.children[side];
                    if (!part) throw new Error(`Decorated-pot entity model is missing its ${side} side`);
                    layers[side] = { key: sides.model.key, texture: sideTextures[side], render: "solid", layer: {
                        ...sides.model.layer, root: { ...sides.model.layer.root, cubes: [], children: {
                            [side]: part
                        } }
                    } };
                }
                await Promise.all([...new Map(Object.values(layers).map(layer => [layer.texture!.serialize(), layer.texture!])).values()].map(async key => {
                    if (!await ModelTextures.preload(key)) throw new Error(`Missing special item texture ${key.toNamespacedString()}`);
                }));
                base.model = { ...base.model, ...layers.base, layers };
                base.faces = { front: [CubeFace.NORTH], back: [CubeFace.NORTH], left: [CubeFace.NORTH], right: [CubeFace.NORTH] };
                return [base];
            }
            case "minecraft:player_head":
            case "player_head": {
                const skin = await PlayerHeadTextures.get(components["minecraft:profile"], root);
                const part = await load("player_head", skin.texture,
                    new Matrix4().makeTranslation(8, 0, 8).multiply(new Matrix4().makeScale(-1, -1, 1)), { head: [0, Math.PI, 0] });
                const main = { ...part.model, texture: skin.texture, render: "translucent" as const };
                part.model = { ...main, layers: { main } };
                part.material = skin.material;
                return [part];
            }
            case "minecraft:copper_golem_statue":
            case "copper_golem_statue": {
                if (!["standing", "sitting", "running", "star"].includes(special.pose)) throw new Error(`Unsupported copper-golem statue pose ${special.pose}`);
                const location = typeof special.texture === "string" && /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/.exec(special.texture);
                if (!location) throw new Error("Copper-golem statue texture must be a resource identifier");
                // This renderer names a complete resource path, including any file extension.
                const key = new AssetKey(location[1] ?? "minecraft", location[2], undefined, undefined, "assets", "", root);
                const statue = await load(special.pose === "standing" ? "copper_golem" : `copper_golem_${special.pose}`, key,
                    new Matrix4().makeTranslation(8, 24, 8).multiply(new Matrix4().makeScale(-1, -1, 1)));
                const pose = statue.model.layer.root.pose;
                statue.rotations.root = [pose.rotation[0], Math.PI, Math.PI];
                statue.positions = { root: [pose.offset[0], 0, pose.offset[2]] };
                statue.model = { ...statue.model, texture: key, render: "cutout", layers: undefined };
                return [statue];
            }
            case "minecraft:trident":
            case "trident":
            case "minecraft:conduit":
            case "conduit": {
                const trident = special.type === "trident" || special.type === "minecraft:trident";
                const part = await load(trident ? "trident" : "conduit", texture(trident ? "trident" : "conduit/base", ""),
                    trident ? new Matrix4().makeScale(1, -1, -1) : new Matrix4().makeTranslation(8, 8, 8), {}, trident ? ["main"] : ["shell"]);
                part.model = { ...part.model, render: "solid", layers: part.model.layers && Object.fromEntries(
                    Object.entries(part.model.layers).map(([name, layer]) => [name, { ...layer, render: "solid" }])) };
                return [part];
            }
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
