import { AssetKey } from "./AssetKey";
import { MineRenderData, MineRenderDatasets } from "./MineRenderData";
import { Maybe } from "../util/util";

export type RenameKind = "blocks" | "items" | "entities";

/** Maps IDs that older Minecraft versions used to the IDs the selected version uses. */
export class Renames {
    /** Loads the selected version's rename table, or `undefined` when its published data has none. */
    public static async get(root?: string): Promise<Maybe<MineRenderDatasets["renames"]>> {
        const resolved = await MineRenderData.resolve(root);
        return resolved.manifest.datasets.renames ? MineRenderData.get("renames", root) : undefined;
    }

    /**
     * Returns the ID that replaced `id`, or `undefined` when `id` keeps its meaning.
     * Without a data version, an ID that the selected version still registers keeps its meaning.
     */
    public static async resolve(kind: RenameKind, id: string, dataVersion?: number, root?: string): Promise<Maybe<string>> {
        const data = await this.get(root);
        if (!data || !Object.prototype.hasOwnProperty.call(data[kind], id)) return undefined;
        const entry = data[kind][id];
        if (dataVersion === undefined) return entry.registered ? undefined : entry.ranges[entry.ranges.length - 1].to;
        if (dataVersion < data.baseDataVersion) return undefined;
        return entry.ranges.find(range => dataVersion < range.before)?.to;
    }

    /** Returns a copy of `key` for the replacement ID, or `undefined` when the ID keeps its meaning. */
    public static async key(kind: RenameKind, key: AssetKey): Promise<Maybe<AssetKey>> {
        const renamed = await this.resolve(kind, `${key.namespace}:${key.path}`, undefined, key.root);
        if (!renamed) return undefined;
        const [namespace, path] = renamed.split(":");
        return new AssetKey(namespace, path, key.assetType, key.type, key.rootType, key.extension, key.root);
    }
}
