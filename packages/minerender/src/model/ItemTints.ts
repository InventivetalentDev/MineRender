import { AssetKey } from "../assets/AssetKey";
import { MineRenderError } from "../error/MineRenderError";
import { AssetContext } from "../assets/AssetContext";
import { Colormaps } from "../texture/Colormaps";
import type { ItemModel, ItemTintColor, Model } from "./Model";

/** Resolves item-preview colors from vanilla tint definitions, stack components, and caller overrides. */
export class ItemTints {

    /** Resolves preview colors from item definitions; explicit per-index colors take precedence. */
    public static async get(model: Model, tints?: Record<number, number>): Promise<Record<number, number> | undefined> {
        const assets = AssetContext.for(model);
        const sources = (model as ItemModel).tints;
        if (!sources?.length) return tints;
        const components = (model as ItemModel).components ?? {};
        const colors = { ...tints };
        await Promise.all(sources.map(async (source, index) => {
            if (colors[index] !== undefined) return;
            switch (source.type) {
                case "constant":
                case "minecraft:constant":
                    colors[index] = this.rgb(source.value);
                    break;
                case "grass":
                case "minecraft:grass":
                    colors[index] = await Colormaps.grassColor(assets.bind(AssetKey.parse("textures", "minecraft:colormap/grass", model.key)), source.temperature, source.downfall);
                    break;
                case "dye":
                case "minecraft:dye":
                    colors[index] = this.colorOrDefault(components["minecraft:dyed_color"], source.default, true);
                    break;
                case "potion":
                case "minecraft:potion": {
                    const value = typeof components["minecraft:potion_contents"] === "string" ? undefined
                        : this.componentField(components, "potion_contents", "custom_color");
                    colors[index] = this.colorOrDefault(value, source.default);
                    break;
                }
                case "map_color":
                case "minecraft:map_color":
                    colors[index] = this.colorOrDefault(components["minecraft:map_color"], source.default);
                    break;
                case "firework":
                case "minecraft:firework": {
                    const values = this.componentField(components, "firework_explosion", "colors");
                    if (values !== undefined && !Array.isArray(values)) throw new MineRenderError("Item tint firework_explosion.colors must be an array");
                    if (!values?.length) {
                        colors[index] = this.rgb(source.default);
                        break;
                    }
                    const rgb = (values as unknown[]).map(value => this.componentColor(value));
                    const red = Math.floor(rgb.reduce((sum, color) => sum + (color >> 16 & 255), 0) / rgb.length);
                    const green = Math.floor(rgb.reduce((sum, color) => sum + (color >> 8 & 255), 0) / rgb.length);
                    const blue = Math.floor(rgb.reduce((sum, color) => sum + (color & 255), 0) / rgb.length);
                    colors[index] = red << 16 | green << 8 | blue;
                    break;
                }
                case "team":
                case "minecraft:team":
                    colors[index] = this.rgb(source.default);
                    break;
                case "custom_model_data":
                case "minecraft:custom_model_data": {
                    const colorIndex = source.index ?? 0;
                    if (!Number.isSafeInteger(colorIndex) || colorIndex < 0) throw new MineRenderError("Item tint custom_model_data index must be a nonnegative integer");
                    const values = this.componentField(components, "custom_model_data", "colors");
                    if (values !== undefined && !Array.isArray(values)) throw new MineRenderError("Item tint custom_model_data.colors must be an array");
                    colors[index] = this.colorOrDefault((values as unknown[] | undefined)?.[colorIndex], source.default, true);
                    break;
                }
                default:
                    throw new MineRenderError(`Unsupported item tint source ${(source as { type: string }).type}`);
            }
        }));
        return colors;
    }

    private static componentField(components: Record<string, unknown>, id: string, field: string): unknown {
        const value = components[`minecraft:${id}`];
        if (value === undefined) return undefined;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new MineRenderError(`Item tint ${id} must be an object`);
        return (value as Record<string, unknown>)[field];
    }

    private static colorOrDefault(value: unknown, fallback: ItemTintColor, allowTriple = false): number {
        return value === undefined ? this.rgb(fallback) : this.componentColor(value, allowTriple);
    }

    private static componentColor(value: unknown, allowTriple = false): number {
        if (typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return this.rgb(value);
        if (allowTriple && Array.isArray(value) && value.length === 3 && value.every(channel => typeof channel === "number" && Number.isFinite(channel))) {
            return this.rgb(value as ItemTintColor) & 0xffffff;
        }
        throw new MineRenderError(`Item tint component color must be a packed integer${allowTriple ? " or RGB triple" : ""}`);
    }

    private static rgb(color: ItemTintColor): number {
        if (!Array.isArray(color)) return color & 0xffffff;
        const [red, green, blue] = color.map(channel => Math.floor(Math.fround(Math.fround(channel) * 255)) & 255);
        return (red << 16) | (green << 8) | blue;
    }

}
