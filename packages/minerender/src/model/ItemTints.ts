import { isResourceLocation } from "../assets/AssetKey";
import { MineRenderError } from "../error/MineRenderError";
import { Colormaps } from "../texture/Colormaps";
import type { ItemModel, ItemTintColor, Model } from "./Model";
import { MineRenderData, type MineRenderDatasets } from "../assets/MineRenderData";

/** Resolves item-preview colors from vanilla tint definitions, stack components, and caller overrides. */
export class ItemTints {

    /** Lists potion IDs from the selected version's registry. */
    public static async getPotionList(root?: string): Promise<string[]> {
        return Object.keys((await MineRenderData.get("potionColors", root)).potions).sort();
    }

    /** Resolves preview colors from item definitions; explicit per-index colors take precedence. */
    public static async get(model: Model, tints?: Record<number, number>): Promise<Record<number, number> | undefined> {
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
                    colors[index] = await Colormaps.grassColor(model.key, source.temperature, source.downfall);
                    break;
                case "dye":
                case "minecraft:dye":
                    colors[index] = this.colorOrDefault(components["minecraft:dyed_color"], source.default, true);
                    break;
                case "potion":
                case "minecraft:potion": {
                    colors[index] = await this.potionColor(components["minecraft:potion_contents"], source.default, model.key?.root);
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

    /** Whether a potion component contains a known effect, including effects with hidden particles. */
    public static async hasPotionEffects(value: unknown, root?: string): Promise<boolean> {
        if (value === undefined) return false;
        const data = await MineRenderData.get("potionColors", root);
        const { effects } = this.potionEffects(value, data);
        return effects.some(effect => Object.prototype.hasOwnProperty.call(data.effects, effect.id));
    }

    private static async potionColor(value: unknown, fallback: ItemTintColor, root?: string): Promise<number> {
        if (value === undefined) return this.rgb(fallback);
        const contents = this.potionContents(value);
        if (contents.custom_color !== undefined) return this.componentColor(contents.custom_color);
        const [data, resolved] = await Promise.all([MineRenderData.get("potionColors", root), MineRenderData.resolve(root)]);
        const { effects, unresolved } = this.potionEffects(contents, data);
        if (unresolved) return this.rgb(fallback);
        const version = /^1\.(\d+)(?:\.(\d+))?$/.exec(resolved.version);
        const legacy = !!version && (Number(version[1]) < 20 || Number(version[1]) === 20 && Number(version[2] ?? 0) < 5);
        let red = 0, green = 0, blue = 0, weight = 0;
        const add = (total: number, channel: number) => legacy ? Math.fround(total + Math.fround(channel / 255)) : total + channel;
        for (const effect of effects) {
            if (effect.show_particles === false) continue;
            const color = data.effects[effect.id], contribution = effect.amplifier + 1;
            red = add(red, (color >> 16 & 255) * contribution);
            green = add(green, (color >> 8 & 255) * contribution);
            blue = add(blue, (color & 255) * contribution);
            weight += contribution;
        }
        if (!weight) return legacy ? (effects.length ? 0 : 3694022) : this.rgb(fallback);
        const channel = (value: number) => Math.floor(legacy ? Math.fround(Math.fround(value / weight) * 255) : value / weight);
        return channel(red) << 16 | channel(green) << 8 | channel(blue);
    }

    private static potionContents(value: unknown): Record<string, unknown> {
        if (typeof value === "string") return { potion: value };
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new MineRenderError("Item tint potion_contents must be a potion ID or object");
        return value as Record<string, unknown>;
    }

    private static potionEffects(value: unknown, data: MineRenderDatasets["potionColors"]): {
        effects: { id: string; amplifier: number; show_particles?: boolean }[]; unresolved: boolean;
    } {
        const contents = this.potionContents(value);
        const identifier = (id: unknown): string => {
            if (!isResourceLocation(id)) {
                throw new MineRenderError("Item tint potion and effect IDs must be identifiers");
            }
            return id.includes(":") ? id : `minecraft:${id}`;
        };
        const values: unknown[] = [];
        let unresolved = false;
        if (contents.potion !== undefined) {
            const id = identifier(contents.potion);
            if (Object.prototype.hasOwnProperty.call(data.potions, id)) values.push(...data.potions[id]);
            else unresolved = true;
        }
        if (contents.custom_effects !== undefined) {
            if (!Array.isArray(contents.custom_effects)) throw new MineRenderError("Item tint potion_contents.custom_effects must be an array");
            values.push(...contents.custom_effects);
        }
        const effects = values.map(value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new MineRenderError("Item tint potion effects must be objects");
            const effect = value as Record<string, unknown>;
            const id = identifier(effect.id);
            const amplifier = effect.amplifier === undefined ? 0 : effect.amplifier;
            if (typeof amplifier !== "number" || !Number.isInteger(amplifier) || amplifier < 0 || amplifier > 255) {
                throw new MineRenderError("Item tint potion effect amplifiers must be integers from 0 to 255");
            }
            if (effect.show_particles !== undefined && typeof effect.show_particles !== "boolean") {
                throw new MineRenderError("Item tint potion effect show_particles must be a boolean");
            }
            if (effect.show_particles !== false && !Object.prototype.hasOwnProperty.call(data.effects, id)) unresolved = true;
            return { id, amplifier, show_particles: effect.show_particles as boolean | undefined };
        });
        return { effects, unresolved };
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
