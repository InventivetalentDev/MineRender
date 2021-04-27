import { Models } from "./Models";
import { Model } from "../model/Model";
import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { BlockStates } from "./BlockStates";
import { AssetKey, AssetType } from "./AssetKey";

export const DEFAULT_ROOT = "https://cdn.mcasset.cloud/file/minecraft-assets/1.16.5";
export const DEFAULT_NAMESPACE = "minecraft";

export class Assets {

    /**
     * @deprecated
     */
    public static parseAssetKey(assetType: AssetType, str: string, origin?: AssetKey): AssetKey {
        return AssetKey.parse(assetType, str, origin);
    }

    public static async getModel(key: AssetKey): Promise<Maybe<Model>> {
        return Models.getMerged(key);
    }

    public static async getBlockState(key: AssetKey): Promise<Maybe<BlockState>> {
        return BlockStates.get(key);
    }

}
