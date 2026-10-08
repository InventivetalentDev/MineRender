import merge from "ts-deepmerge";
import { AssetContext } from "../assets/AssetContext";
import type { DeepPartial } from "../util/util";

/** Merges render settings while preserving the asset context's identity and loaded-asset provenance. */
export function mergeAssetOptions<T extends { assets?: AssetContext }>(defaults: T,
    options?: DeepPartial<Omit<T, "assets">> & { assets?: AssetContext }, origin?: object): T {
    const { assets: defaultAssets, ...defaultValues } = defaults;
    const { assets, ...values } = options ?? {};
    const merged = merge({}, defaultValues, values) as T;
    merged.assets = AssetContext.origin(origin) ?? assets ?? defaultAssets;
    return merged;
}
