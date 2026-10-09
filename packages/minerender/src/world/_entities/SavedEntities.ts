import type { Compound } from "prismarine-nbt";
import { AssetKey } from "../../assets/AssetKey";
import { DYE_COLORS } from "../../assets/BannerPatterns";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";

// Sheep darken each dye channel; white wool has its own fixed shade.
const WOOL_COLORS = Object.values(DYE_COLORS).map((color, index) => index === 0 ? 0xe6e6e6 :
    (Math.floor((color >> 16 & 255) * 0.75) << 16)
    | (Math.floor((color >> 8 & 255) * 0.75) << 8) | Math.floor((color & 255) * 0.75));

interface SavedEntityAppearance {
    texture?: AssetKey;
    when?: string[];
    tints?: Record<string, number>;
}

function appearance(model: string, nbt: Compound): SavedEntityAppearance {
    const integer = (name: string, type: "byte" | "int") => {
        const tag = nbt.value[name];
        return tag?.type === type && Number.isInteger(tag.value) ? tag.value as number : 0;
    };
    if (model === "sheep") {
        const savedColor = integer("Color", "byte");
        const color = savedColor >= 0 && savedColor < WOOL_COLORS.length ? savedColor : 0;
        return {
            when: [...(color !== 0 ? ["dyed"] : []), ...(integer("Sheared", "byte") === 0 ? ["not_sheared"] : [])],
            tints: { wool_color: WOOL_COLORS[color] }
        };
    }
    let texture: string;
    if (model === "fox") {
        const type = nbt.value.Type;
        texture = `fox/${type?.type === "string" && type.value === "snow" ? "snow_fox" : "fox"}`;
    } else if (model === "axolotl") {
        const variant = ["lucy", "wild", "gold", "cyan", "blue"][integer("Variant", "int")] ?? "lucy";
        texture = `axolotl/axolotl_${variant}`;
    } else if (model === "parrot") {
        const variant = ["red_blue", "blue", "green", "yellow_blue", "grey"][Math.max(0, Math.min(4, integer("Variant", "int")))];
        texture = `parrot/parrot_${variant}`;
    } else {
        return {};
    }
    return { texture: new AssetKey("minecraft", texture, "textures", "entity", "assets", ".png") };
}

/** Resolves a saved model key, appearance, and yaw; malformed records remain data only. */
export function resolveSavedEntity(entity: MultiBlockEntity): ({ key: AssetKey; yaw: number } & SavedEntityAppearance) | undefined {
    if (!entity || !Array.isArray(entity.position) || entity.position.length !== 3
        || ![0, 1, 2].every(index => Number.isFinite(entity.position[index]))) return undefined;
    const nbt = entity.nbt as Compound | undefined;
    if (nbt?.type !== "compound" || !nbt.value || typeof nbt.value !== "object" || Array.isArray(nbt.value)) return undefined;
    const id = nbt.value.id;
    if (id?.type !== "string" || typeof id.value !== "string") return undefined;
    const model = id.value.startsWith("minecraft:") ? id.value.slice(10) : id.value;

    let yaw = 0;
    const rotation = nbt.value.Rotation;
    if (rotation !== undefined) {
        if (rotation?.type !== "list" || !Array.isArray(rotation.value?.value)) return undefined;
        const values = rotation.value.value;
        if (values.length) {
            if ((rotation.value.type !== "float" && rotation.value.type !== "double")
                || values.length !== 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return undefined;
            // Minecraft yaw turns from +Z towards -X; three.js rotates in the opposite direction.
            yaw = -(values[0] as number) / 180 * Math.PI;
        }
    }
    return { key: new AssetKey("minecraft", model), yaw, ...appearance(model, nbt) };
}
