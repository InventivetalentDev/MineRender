import { Matrix4 } from "three";
import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Caching } from "../cache/Caching";
import type { MinecraftAsset } from "../MinecraftAsset";
import type { BlockStateProperties } from "../model/block/BlockStateProperties";
import type { TripleArray } from "../model/Model";
import type { Maybe } from "../util";

/** One model drawn by a block-entity renderer. */
export interface BlockEntityPart {
    model: string;
    /** Model layer; defaults to "main". */
    layer?: string;
    /** Set only when the texture differs from the layer's default. */
    textureLocation?: string;
    /** Blockstate multipart syntax: every property must match, and "a|b" matches either value. */
    when?: Record<string, string>;
}

/** Degrees per property value, or degrees per unit of a numeric property. */
export type BlockEntityRotation = { property: string; degrees: Record<string, number> } | { property: string; step: number };

export interface BlockEntityEntry {
    parts: BlockEntityPart[];
    rotation?: BlockEntityRotation;
    /** Offset in model units, applied before the rotation. */
    translation?: TripleArray;
}

/** The dataset's `blocks.json`: block ID to the models its block-entity renderer draws. */
export type BlockEntityIndex = MinecraftAsset & { [block: string]: BlockEntityEntry };

export interface ResolvedBlockEntity {
    parts: BlockEntityPart[];
    /** Degrees counter-clockwise seen from above, about the block's vertical centre axis. */
    rotation: number;
    translation: TripleArray;
}

export class BlockEntities {

    /**
     * Loads the block index of a version. Versions and sources without one yield an empty index, and so does
     * a failed load: the index is optional, and blocks must not retry or fail with it one by one. The empty
     * result is cached like any other; `Caching.clear()` or `AssetLoader.setVersion()` forces a new attempt.
     */
    public static async getIndex(root?: string): Promise<BlockEntityIndex> {
        // The index sits next to the namespace directories, at <root>/entity-models/blocks.json.
        const key = new AssetKey("entity-models", "blocks", undefined, undefined, undefined, ".json", root);
        key.rootType = undefined!;
        const index = await Caching.blockEntityIndexCache.get(key.serialize(), async () => {
            try {
                return await AssetLoader.get<BlockEntityIndex>(key, AssetParser.JSON) ?? {};
            } catch (error) {
                console.warn("Could not load the block entity index; block entities are drawn as plain block models", error);
                return {};
            }
        });
        return index ?? {};
    }

    /** The index entry of a block ID such as `minecraft:chest`. */
    public static entry(index: BlockEntityIndex, block: string): Maybe<BlockEntityEntry> {
        const entry = Object.prototype.hasOwnProperty.call(index, block) ? index[block] : undefined;
        return Array.isArray(entry?.parts) ? entry : undefined;
    }

    /** Selects the parts and placement for a block ID such as `minecraft:chest`; undefined when nothing is drawn. */
    public static resolve(index: BlockEntityIndex, block: string, state: BlockStateProperties = {}): Maybe<ResolvedBlockEntity> {
        const entry = this.entry(index, block);
        if (!entry) return undefined;
        // Default block states may hold booleans, numbers and upper-case enum names.
        const value = (property: string) => String(state[property]).toLowerCase();
        const parts = entry.parts.filter(part => Object.entries(part.when ?? {})
            .every(([property, values]) => String(values).split("|").includes(value(property))));
        if (!parts.length) return undefined;
        let rotation = 0;
        if (entry.rotation) {
            const selected = value(entry.rotation.property);
            rotation = "degrees" in entry.rotation ? entry.rotation.degrees[selected] : Number(selected) * entry.rotation.step;
            if (!Number.isFinite(rotation)) rotation = 0;
        }
        return { parts, rotation, translation: entry.translation ?? [0, 0, 0] };
    }

    /** Placement in block space (0..16 per axis), applied on top of the model's own transform. */
    public static matrix(resolved: ResolvedBlockEntity, matrix: Matrix4 = new Matrix4()): Matrix4 {
        return matrix.makeTranslation(8, 0, 8)
            .multiply(new Matrix4().makeRotationY(resolved.rotation * Math.PI / 180))
            .multiply(new Matrix4().makeTranslation(resolved.translation[0] - 8, resolved.translation[1], resolved.translation[2] - 8));
    }

}
