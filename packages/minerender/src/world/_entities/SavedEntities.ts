import type { Compound } from "prismarine-nbt";
import { AssetKey } from "../../assets/AssetKey";
import type { DyeColor } from "../../assets/BannerPatterns";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";

const WOOL_COLORS: DyeColor[] = [
    "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
    "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"
];

interface SavedEntityAppearance {
    texture?: AssetKey;
    when?: string[];
    tints?: Record<string, number>;
    woolDye?: DyeColor;
}

function integer(nbt: Compound, name: string, type: "byte" | "int"): number {
    const tag = nbt.value[name];
    return tag?.type === type && Number.isInteger(tag.value) ? tag.value as number : 0;
}

const appearance: Record<string, (nbt: Compound) => SavedEntityAppearance | undefined> = {
    sheep: nbt => {
        const savedColor = integer(nbt, "Color", "byte");
        const color = savedColor >= 0 && savedColor < WOOL_COLORS.length ? savedColor : 0;
        return {
            when: [...(color !== 0 ? ["dyed"] : []), ...(integer(nbt, "Sheared", "byte") === 0 ? ["not_sheared"] : [])],
            woolDye: WOOL_COLORS[color]
        };
    },
    fox: nbt => {
        const type = nbt.value.Type;
        const texture = `fox/${type?.type === "string" && type.value === "snow" ? "snow_fox" : "fox"}`;
        return { texture: new AssetKey("minecraft", texture, "textures", "entity", "assets", ".png") };
    },
    axolotl: nbt => {
        const variant = ["lucy", "wild", "gold", "cyan", "blue"][integer(nbt, "Variant", "int")] ?? "lucy";
        return { texture: new AssetKey("minecraft", `axolotl/axolotl_${variant}`, "textures", "entity", "assets", ".png") };
    },
    parrot: nbt => {
        const variant = ["red_blue", "blue", "green", "yellow_blue", "grey"][Math.max(0, Math.min(4, integer(nbt, "Variant", "int")))];
        return { texture: new AssetKey("minecraft", `parrot/parrot_${variant}`, "textures", "entity", "assets", ".png") };
    }
};

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
    const handler = Object.prototype.hasOwnProperty.call(appearance, model) ? appearance[model] : undefined;
    return { key: new AssetKey("minecraft", model), yaw, ...handler?.(nbt) };
}
