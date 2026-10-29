import { AssetKey, BasicAssetKey, isResourceLocation } from "../assets/AssetKey";
import { AssetLoader } from "../assets/AssetLoader";
import { Entities } from "../assets/Entities";
import { AssetParser } from "../assets/source/parser/AssetParsers";
import { Caching } from "../cache/Caching";
import type { EntityLayer, EntityModel, EntityTransformOp } from "../entity/EntityModel";
import { MineRenderError } from "../error/MineRenderError";
import type { Maybe } from "../util/util";

export type ArmorSlot = "head" | "chest" | "legs" | "feet";

export interface ArmorTrim {
    /** `trim_pattern` registry ID, such as `minecraft:sentry`. */
    pattern: string;
    /** `trim_material` registry ID, such as `minecraft:iron`. */
    material: string;
}

/** An equipment asset ID, such as `minecraft:diamond`, or the asset with the worn item's state. */
export type ArmorPiece = string | {
    asset: string;
    /** `dyed_color` as an RGB integer. */
    color?: number;
    trim?: ArmorTrim;
    /** Draws the enchantment glint, as an enchanted item does. */
    glint?: boolean;
};

export type ArmorSet = Partial<Record<ArmorSlot, ArmorPiece>>;

const ARMOR_TRANSFORM: EntityTransformOp[] = [
    { rotate: [0, Math.PI, 0] }, { scale: [-1, -1, 1] }, { translate: [0, -24, 0] }
];

/** Resolves humanoid equipment assets into armor draws. */
export class Armor {
    /** Loads 1.21.4+ armor in SkinObject's frame, or returns undefined when no layer draws. */
    public static async getEntity(armor: ArmorSet): Promise<Maybe<EntityModel>> {
        const model = await Entities.getModelFile(new BasicAssetKey("minecraft", "player"));
        const layers: Record<string, EntityLayer> = {};
        // HumanoidArmorLayer.submit draws the helmet last.
        const slots = { chest: "chestplate", legs: "leggings", feet: "boots", head: "helmet" } as const;
        for (const slot of Object.keys(slots) as ArmorSlot[]) {
            const value = armor[slot];
            if (value === undefined) continue;
            const piece = typeof value === "string" ? { asset: value } : value;
            const name = slots[slot], geometry = model?.layers[name];
            if (!geometry) throw new MineRenderError(`Missing armor geometry ${name}; armor needs Minecraft 1.21.4 or later`);
            const id = this.identifier(piece.asset);
            const key = new AssetKey(id.namespace, id.path, "equipment", undefined, "assets", ".json");
            const equipment = await Caching.equipmentCache.get(key.serialize(), () => AssetLoader.get(key, AssetParser.JSON)) as Maybe<{
                layers: Record<string, { texture: string; dyeable?: { color_when_undyed?: number | [number, number, number] } }[]>;
            }>;
            if (!equipment) throw new MineRenderError(`Missing equipment asset ${piece.asset}; armor takes equipment asset IDs such as minecraft:diamond and needs Minecraft 1.21.4 or later`);
            // HumanoidArmorLayer.usesInnerModel selects the inner texture only for leggings.
            const layerType = slot === "legs" ? "humanoid_leggings" : "humanoid";
            const equipmentLayers = equipment.layers[layerType];
            if (!equipmentLayers?.length) continue;
            let count = 0;
            const add = (texture: AssetKey, settings: Partial<EntityLayer>) => {
                layers[++count === 1 ? name : `${name}#${count}`] = { key: texture, texture, layer: geometry, ...settings };
            };
            let glint = piece.glint;
            for (const layer of equipmentLayers) {
                let color: number | undefined;
                if (layer.dyeable) {
                    // EquipmentLayerRenderer.getColorForLayer treats dyed colour 0 as undyed.
                    const undyed = layer.dyeable.color_when_undyed;
                    color = piece.color || (Array.isArray(undyed)
                        ? (Math.floor(undyed[0] * 255) << 16) | (Math.floor(undyed[1] * 255) << 8) | Math.floor(undyed[2] * 255)
                        : undyed === undefined ? undefined : undyed & 0xffffff);
                    if (color === undefined) continue;
                }
                const texture = this.identifier(layer.texture);
                add(new AssetKey(texture.namespace, `equipment/${layerType}/${texture.path}`, "textures", "entity", "assets", ".png"),
                    { ...(color !== undefined && { color }), ...(glint && { glint: true }) });
                // EquipmentLayerRenderer.renderLayers consumes foil on the first drawn layer.
                glint = false;
            }
            if (piece.trim) {
                const patternId = this.identifier(piece.trim.pattern), materialId = this.identifier(piece.trim.material);
                const patternKey = new AssetKey(patternId.namespace, patternId.path, "trim_pattern", undefined, "data", ".json");
                const materialKey = new AssetKey(materialId.namespace, materialId.path, "trim_material", undefined, "data", ".json");
                const pattern = await Caching.trimCache.get(patternKey.serialize(), () => AssetLoader.get(patternKey, AssetParser.JSON)) as Maybe<{ asset_id: string; decal?: boolean }>;
                if (!pattern) throw new MineRenderError(`Missing trim pattern ${piece.trim.pattern}`);
                const material = await Caching.trimCache.get(materialKey.serialize(), () => AssetLoader.get(materialKey, AssetParser.JSON)) as Maybe<{ asset_name: string; override_armor_assets?: Record<string, string> }>;
                if (!material) throw new MineRenderError(`Missing trim material ${piece.trim.material}`);
                const patternAsset = this.identifier(pattern.asset_id);
                // MaterialAssetGroup.assetId keys overrides by equipment asset, not by item ID.
                const suffix = material.override_armor_assets?.[id.toNamespacedString()] ?? material.asset_name;
                add(new AssetKey(patternAsset.namespace, `entity/${layerType}/${patternAsset.path}`, "textures", "trims", "assets", ".png"), {
                    palette: {
                        key: new AssetKey("minecraft", "color_palettes/trim_palette", "textures", "trims", "assets", ".png"),
                        permutation: new AssetKey("minecraft", `color_palettes/${suffix}`, "textures", "trims", "assets", ".png")
                    },
                    render: pattern.decal ? "cutout_z_offset" : "cutout"
                });
            }
        }
        const first = Object.values(layers)[0];
        return first ? { ...first, id: "minecraft:player", layers, transform: ARMOR_TRANSFORM } : undefined;
    }

    private static identifier(value: string): BasicAssetKey {
        if (!isResourceLocation(value) || value.split(/[:/]/).some(part => !part || part === "." || part === "..")) {
            throw new MineRenderError(`Invalid armor identifier ${value}`);
        }
        const [namespace, path] = value.includes(":") ? value.split(":") : ["minecraft", value];
        return new BasicAssetKey(namespace, path);
    }
}
