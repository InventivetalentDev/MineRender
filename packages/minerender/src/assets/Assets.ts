import type { Models } from "./Models";
import { Model } from "../model/Model";
import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import type { BlockStates } from "./BlockStates";
import { AssetKey, AssetType } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";

export { DEFAULT_ROOT, DEFAULT_NAMESPACE } from "./AssetDefaults";

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
        return AssetLoader.context.models.getMerged(key);
    }

    /** Loads a blockstate definition. See {@link BlockStates.get}. */
    public static async getBlockState(key: AssetKey): Promise<Maybe<BlockState>> {
        return AssetLoader.context.blockStates.get(key);
    }

}
