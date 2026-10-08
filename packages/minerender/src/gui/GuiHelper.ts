import { AssetKey, isAssetKey } from "../assets/AssetKey";
import type { GuiLayer } from "./GuiLayer";
import { layoutGuiText, type GuiText, type GuiTextOptions } from "./GuiText";

/** Creates GUI positions and layer lists for {@link MineRenderScene.addGui}. */
export class GuiHelper {

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
    public static inventorySlot(slot: number | [number, number], origin: [number, number] = [0, 0], offset: [number, number] = [18, 18], rowSize: number = 9): [number, number] {
        const [column, row] = typeof slot === "number" ? [slot % rowSize, Math.floor(slot / rowSize)] : slot;
        return [origin[0] + column * offset[0], origin[1] + row * offset[1]];
    }

    /** Creates crafting-table layers for ingredients and the result; stack counts are not drawn. */
    public static recipe(recipe: GuiRecipe, options: GuiRecipeOptions = {}): GuiLayer[] {
        const layers: GuiLayer[] = [
            { name: "background", texture: "minecraft:gui/container/crafting_table", crop: [0, 0, 176, 166] }
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
                position: this.inventorySlot(slot, [30, 17], [18, 18], 3) });
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
            position: [124, 35] });
        return layers;
    }

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
