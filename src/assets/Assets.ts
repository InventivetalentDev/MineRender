import { AssetKey, AssetType } from "../cache/CacheKey";

export const DEFAULT_ROOT = "https://cdn.mcasset.cloud/file/minecraft-assets/1.16.5";
export const DEFAULT_NAMESPACE = "minecraft";

export class Assets {

    public static parseAssetKey(assetType: AssetType, str: string, origin?: AssetKey): AssetKey {
        let namespace = origin?.namespace || DEFAULT_NAMESPACE;
        if (str.includes(":")) {
            let split = str.split("\:");
            namespace = split[0];
            str = split[1];
        }

        let split = str.split("\/");
        let type = split[0];
        split.shift();
        let path = split.join("/");

        let extension = assetType === "models" ? ".json" :
            assetType === "textures" ? ".png" :
                origin?.assetType || "";

        return {
            root: origin?.root,
            assetType,
            namespace,
            type,
            path,
            extension
        }
    }

}
