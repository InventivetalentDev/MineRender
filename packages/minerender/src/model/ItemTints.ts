import { MineRenderError } from "../error/MineRenderError";
import { Colormaps } from "../texture/Colormaps";
import type { ItemModel, ItemTintColor, Model } from "./Model";

export class ItemTints {

    /** Resolves preview colors from item definitions; explicit per-index colors take precedence. */
    public static async get(model: Model, tints?: Record<number, number>): Promise<Record<number, number> | undefined> {
        const sources = (model as ItemModel).tints;
        if (!sources?.length) return tints;
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
                    colors[index] = await Colormaps.grassColor(model.key, source.temperature, source.downfall);
                    break;
                case "dye":
                case "minecraft:dye":
                case "potion":
                case "minecraft:potion":
                case "map_color":
                case "minecraft:map_color":
                case "firework":
                case "minecraft:firework":
                case "team":
                case "minecraft:team":
                case "custom_model_data":
                case "minecraft:custom_model_data":
                    colors[index] = this.rgb(source.default);
                    break;
                default:
                    throw new MineRenderError(`Unsupported item tint source ${(source as { type: string }).type}`);
            }
        }));
        return colors;
    }

    private static rgb(color: ItemTintColor): number {
        if (!Array.isArray(color)) return color & 0xffffff;
        const [red, green, blue] = color.map(channel => Math.floor(Math.fround(Math.fround(channel) * 255)));
        return (red << 16) | (green << 8) | blue;
    }

}
