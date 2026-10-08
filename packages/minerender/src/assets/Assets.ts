import { Models } from "./Models";
import { Model } from "../model/Model";
import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { BlockStates } from "./BlockStates";
import { AssetKey, AssetType } from "./AssetKey";

export const DEFAULT_ROOT = "https://assets.mcasset.cloud/1.21.11";
export const DEFAULT_NAMESPACE = "minecraft";

/** Convenience accessors for model and blockstate loading. */
export class Assets {

    /**
     * @deprecated
     */
    public static parseAssetKey(assetType: AssetType, str: string, origin?: AssetKey): AssetKey {
        return AssetKey.parse(assetType, str, origin);
    }

    /** Loads a model with its parent chain resolved. See {@link Models.getMerged}. */
    public static async getModel(key: AssetKey): Promise<Maybe<Model>> {
        return Models.getMerged(key);
    }

    /** Loads a blockstate definition. See {@link BlockStates.get}. */
    public static async getBlockState(key: AssetKey): Promise<Maybe<BlockState>> {
        return BlockStates.get(key);
    }

}
