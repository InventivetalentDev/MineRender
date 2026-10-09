import { AssetKey, isAssetKey } from "../assets/AssetKey";
import { ModelTextures } from "../assets/ModelTextures";
import type { GuiLayer, GuiTextureLayer } from "./GuiLayer";
import { layoutGuiText, type GuiText, type GuiTextOptions } from "./GuiText";

/** Container coordinates in GUI pixels. Crops refer to vanilla's 256×256 sheets; {@link GuiHelper.container} scales them for resource packs. */
export const GUI_CONTAINER_LAYOUTS = {
    generic_54: {
        texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222],
        slotOrigin: [8, 18], slotOffset: [18, 18], rowSize: 9, slotCount: 54
    },
    crafting_table: {
        texture: "minecraft:gui/container/crafting_table", crop: [0, 0, 176, 166],
        slotOrigin: [30, 17], slotOffset: [18, 18], rowSize: 3, slotCount: 9, resultPosition: [124, 35]
    }
} as const;

export type GuiContainerType = keyof typeof GUI_CONTAINER_LAYOUTS;
export type GuiBossBarColor = "pink" | "blue" | "red" | "green" | "yellow" | "purple" | "white";
export type GuiBookButtonState = "hidden" | "normal" | "hover";

/** Creates GUI positions and layer lists for {@link MineRenderScene.addGui}. */
export class GuiHelper {

    /**
     * Creates a 182×5 boss bar using the active resource pack. Finite progress is clamped to 0–1.
     * The fill crops the source image; explicit crops do not apply `.mcmeta` sprite scaling.
     */
    public static async bossBar(options: GuiBossBarOptions = {}): Promise<GuiLayer[]> {
        const { color = "pink", progress = 1, position = [0, 0] } = options;
        this.validatePosition(position);
        if (!["pink", "blue", "red", "green", "yellow", "purple", "white"].includes(color)) {
            throw new Error(`Unsupported boss bar color: ${color}`);
        }
        if (!Number.isFinite(progress)) throw new Error("Boss bar progress must be finite");
        const value = Math.max(0, Math.min(1, progress));
        const width = value > 0 ? Math.floor(value * 181) + 1 : 0;
        const texture = `minecraft:gui/sprites/boss_bar/${color}`;
        const layers: GuiLayer[] = [{
            name: "boss-bar-background", texture: `${texture}_background`, position: [...position], size: [182, 5]
        }];
        if (width > 0) {
            layers.push({
                ...await this.cropTexture(`${texture}_progress`, [0, 0, width, 5], [182, 5], position),
                name: "boss-bar-progress"
            });
        }
        return layers;
    }

    /**
     * Creates a 192×192 book page with optional arrows and supplied text. Buttons are hidden by default.
     * Callers choose the page content and button states; this helper does not paginate or handle clicks.
     */
    public static async book(options: GuiBookOptions = {}): Promise<GuiLayer[]> {
        const { position = [0, 0], previous = "hidden", next = "hidden", text,
            color = 0x000000, shadow = false, maxWidth = 114, lineHeight = 9, ...style } = options;
        this.validatePosition(position);
        for (const state of [previous, next]) {
            if (!["hidden", "normal", "hover"].includes(state)) throw new Error(`Unsupported book button state: ${state}`);
        }
        const layers: GuiLayer[] = [{
            ...await this.cropTexture("minecraft:gui/book", [0, 0, 192, 192], [256, 256], position),
            name: "book-background"
        }];
        for (const [name, direction, state, x] of [
            ["previous", "backward", previous, 43], ["next", "forward", next, 116]
        ] as const) {
            if (state === "hidden") continue;
            layers.push({
                name: `book-${name}`,
                texture: `minecraft:gui/sprites/widget/page_${direction}${state === "hover" ? "_highlighted" : ""}`,
                position: [position[0] + x, position[1] + 157], size: [23, 13]
            });
        }
        if (text !== undefined) {
            layers.push({
                name: "book-text", text, position: [position[0] + 36, position[1] + 30],
                color, shadow, maxWidth, lineHeight, ...style
            });
        }
        return layers;
    }

    /** Creates a container background. Use {@link GUI_CONTAINER_LAYOUTS} with {@link inventorySlot} to place its items. */
    public static async container(type: GuiContainerType, position: [number, number] = [0, 0]): Promise<GuiLayer[]> {
        this.validatePosition(position);
        if (type !== "generic_54" && type !== "crafting_table") throw new Error(`Unsupported GUI container: ${type}`);
        const layout = GUI_CONTAINER_LAYOUTS[type];
        return [{ ...await this.cropTexture(layout.texture, layout.crop, [256, 256], position), name: "background" }];
    }

    private static validatePosition(position: [number, number]): void {
        if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) {
            throw new Error("GUI position must contain two finite coordinates");
        }
    }

    private static async cropTexture(texture: string, crop: readonly [number, number, number, number],
                                     referenceSize: [number, number], position: [number, number]): Promise<GuiTextureLayer> {
        const image = await ModelTextures.preload(AssetKey.parse("textures", texture));
        if (!image) throw new Error(`Could not load GUI texture ${texture}`);
        const [x, y, width, height] = crop;
        const scaleX = image.width / referenceSize[0], scaleY = image.height / referenceSize[1];
        return {
            texture, crop: [x * scaleX, y * scaleY, width * scaleX, height * scaleY],
            position: [...position], size: [width, height]
        };
    }

    /** Sizes a tooltip around supplied text; the first entry is its title. */
    public static async tooltip(lines: readonly GuiText[], options: GuiTooltipOptions = {}): Promise<GuiLayer[]> {
        if (!lines.length) return [];
        const { position = [0, 0], titleGap = 2, lineHeight = 10, shadow = true, ...style } = options;
        const textOptions = { ...style, lineHeight, shadow };
        const layouts = await Promise.all(lines.map(line => layoutGuiText(line, textOptions)));
        const width = Math.max(...layouts.map(layout => layout.width));
        const height = layouts.reduce((sum, layout) => sum + layout.height, 0) - 2 + (lines.length > 1 ? titleGap : 0);
        const layers: GuiLayer[] = ["background", "frame"].map(part => ({
            name: `tooltip-${part}`,
            texture: `minecraft:gui/sprites/tooltip/${part}`,
            position: [position[0] - 12, position[1] - 12],
            size: [width + 24, height + 24]
        }));
        let y = position[1];
        lines.forEach((text, index) => {
            layers.push({ ...textOptions, name: `tooltip-line-${index}`, text, position: [position[0], y] });
            y += layouts[index].height + (index === 0 ? titleGap : 0);
        });
        return layers;
    }

    /**
     * Calculates a slot's top-left position in GUI pixels.
     * @param slot - Zero-based slot index, or `[column, row]`.
     * @param origin - Position of the first slot.
     * @param offset - Horizontal and vertical spacing between slot origins, in pixels.
     * @param rowSize - Slots per row when `slot` is an index.
     */
    public static inventorySlot(slot: number | readonly [number, number], origin: readonly [number, number] = [0, 0], offset: readonly [number, number] = [18, 18], rowSize: number = 9): [number, number] {
        const [column, row] = typeof slot === "number" ? [slot % rowSize, Math.floor(slot / rowSize)] : slot;
        return [origin[0] + column * offset[0], origin[1] + row * offset[1]];
    }

    /** Creates crafting-table layers for ingredients and the result; stack counts are not drawn. */
    public static recipe(recipe: GuiRecipe, options: GuiRecipeOptions = {}): GuiLayer[] {
        const layout = GUI_CONTAINER_LAYOUTS.crafting_table;
        const layers: GuiLayer[] = [
            { name: "background", texture: layout.texture, crop: [...layout.crop] }
        ];
        const itemKey = (ingredient: GuiRecipeIngredient): AssetKey => {
            const item = typeof ingredient === "string" && !ingredient.startsWith("#") ? ingredient
                : typeof ingredient === "object" && "item" in ingredient ? ingredient.item
                : options.resolveIngredient?.(ingredient);
            if (isAssetKey(item)) return item;
            if (!item || item.startsWith("#")) {
                throw new Error(`Select a concrete item for recipe ingredient ${JSON.stringify(ingredient)}`);
            }
            const key = AssetKey.parse("models", item);
            return new AssetKey(key.namespace, key.getFullPath(), "models", "item");
        };
        const addIngredient = (ingredient: GuiRecipeIngredient, slot: number) => {
            layers.push({ name: `ingredient-${slot}`, item: itemKey(ingredient),
                position: this.inventorySlot(slot, layout.slotOrigin, layout.slotOffset, layout.rowSize) });
        };

        switch (recipe.type) {
            case "minecraft:crafting_shaped":
            case "crafting_shaped": {
                const pattern = recipe.pattern;
                if (!pattern.length || pattern.length > 3 || !pattern[0].length || pattern[0].length > 3
                    || pattern.some(row => row.length !== pattern[0].length)) {
                    throw new Error("Crafting patterns must be rectangular, with 1–3 rows and columns");
                }
                const cells = pattern.flatMap((row, y) => row.split("").map((symbol, x) => ({ symbol, x, y })))
                    .filter(cell => cell.symbol !== " ");
                if (!cells.length) throw new Error("Crafting patterns must contain an ingredient");
                const minX = Math.min(...cells.map(cell => cell.x)), maxX = Math.max(...cells.map(cell => cell.x));
                const minY = Math.min(...cells.map(cell => cell.y)), maxY = Math.max(...cells.map(cell => cell.y));
                // Trim outer spaces; vanilla centers one-column or one-row shaped recipes.
                const offsetX = minX === maxX ? 1 : 0, offsetY = minY === maxY ? 1 : 0;
                for (const { symbol, x, y } of cells) {
                    const ingredient = recipe.key[symbol];
                    if (!ingredient) throw new Error(`Missing recipe ingredient for symbol ${JSON.stringify(symbol)}`);
                    addIngredient(ingredient, (y - minY + offsetY) * 3 + x - minX + offsetX);
                }
                break;
            }
            case "minecraft:crafting_shapeless":
            case "crafting_shapeless":
                if (!recipe.ingredients.length || recipe.ingredients.length > 9) {
                    throw new Error("Shapeless crafting recipes require 1–9 ingredients");
                }
                recipe.ingredients.forEach(addIngredient);
                break;
            default:
                throw new Error(`Unsupported crafting recipe type: ${(recipe as { type: string }).type}`);
        }
        layers.push({ name: "result", item: itemKey("id" in recipe.result ? recipe.result.id : recipe.result.item),
            position: [...layout.resultPosition] });
        return layers;
    }

}

/** Settings passed to {@link GuiHelper.bossBar}. */
export interface GuiBossBarOptions {
    /** Vanilla sprite color. Defaults to `pink`. */
    color?: GuiBossBarColor;
    /** Fill from 0 to 1, rounded to vanilla's discrete pixel width. Defaults to 1. */
    progress?: number;
    /** Top-left position in GUI pixels. Defaults to `[0, 0]`. */
    position?: [number, number];
}

/** Settings passed to {@link GuiHelper.book}. Text defaults to black, unshadowed, and wrapped at 114 pixels. */
export interface GuiBookOptions extends GuiTextOptions {
    /** Top-left position of the book background in GUI pixels. Defaults to `[0, 0]`. */
    position?: [number, number];
    previous?: GuiBookButtonState;
    next?: GuiBookButtonState;
    /** Content for one page. The caller keeps it within the 128-pixel text height. */
    text?: GuiText;
}

/** Settings passed to {@link GuiHelper.tooltip}. Its default `lineHeight` is 10 GUI pixels. */
export interface GuiTooltipOptions extends GuiTextOptions {
    /** Top-left text position, inside the tooltip's padding. */
    position?: [number, number];
    /** Extra space after the title, in pixels. Defaults to 2. */
    titleGap?: number;
}

type GuiRecipeIngredientValue = string | { item: string } | { tag: string };

/** An item, tag, or alternatives list. Tags and alternatives need `GuiRecipeOptions.resolveIngredient`. */
export type GuiRecipeIngredient = GuiRecipeIngredientValue | readonly GuiRecipeIngredientValue[];

/** Shaped or shapeless crafting data accepted by {@link GuiHelper.recipe}. */
export type GuiRecipe = ({
    type: "minecraft:crafting_shaped" | "crafting_shaped";
    pattern: readonly string[];
    key: Readonly<Record<string, GuiRecipeIngredient>>;
} | {
    type: "minecraft:crafting_shapeless" | "crafting_shapeless";
    ingredients: readonly GuiRecipeIngredient[];
}) & {
    result: { id: string; count?: number } | { item: string; count?: number };
};

/** Settings passed as the second argument to {@link GuiHelper.recipe}. */
export interface GuiRecipeOptions {
    /** Selects a concrete item ID or model AssetKey for a tag or alternatives array. */
    resolveIngredient?: (ingredient: GuiRecipeIngredient) => string | AssetKey;
}
