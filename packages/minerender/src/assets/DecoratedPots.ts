import { AssetKey } from "./AssetKey";

/** Minecraft 1.21.11 sherd items that select decorated-pot patterns. */
export const POTTERY_SHERDS: readonly string[] = Object.freeze([
    "angler", "archer", "arms_up", "blade", "brewer", "burn", "danger", "explorer", "flow", "friend", "guster",
    "heart", "heartbreak", "howl", "miner", "mourner", "plenty", "prize", "scrape", "sheaf", "shelter", "skull", "snort"
].map(pattern => `minecraft:${pattern}_pottery_sherd`));

export type DecoratedPotSide = "back" | "left" | "right" | "front";

/** Resolves Minecraft 1.21.11 pot decorations to the four side textures. */
export class DecoratedPots {

    /** Reads up to four item IDs in back, left, right, front order; missing and unmapped items use plain sides. */
    public static getSideTextures(value: unknown, root?: string): Record<DecoratedPotSide, AssetKey> {
        const items = value === undefined ? [] : value;
        if (!Array.isArray(items) || items.length > 4) throw new Error("pot_decorations must be an array of at most four item IDs");
        const textures = items.map(item => {
            if (typeof item !== "string" || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(item)) throw new Error("Pot decorations must be item identifiers");
            const id = item.includes(":") ? item : `minecraft:${item}`;
            return POTTERY_SHERDS.includes(id) ? id.slice("minecraft:".length).replace(/_sherd$/, "_pattern") : "decorated_pot_side";
        });
        return Object.fromEntries((["back", "left", "right", "front"] as const).map((side, index) => [side,
            new AssetKey("minecraft", `decorated_pot/${textures[index] ?? "decorated_pot_side"}`, "textures", "entity", "assets", ".png", root)
        ])) as Record<DecoratedPotSide, AssetKey>;
    }
}
