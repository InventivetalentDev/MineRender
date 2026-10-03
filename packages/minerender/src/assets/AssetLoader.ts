import { Model, TextureAsset } from "../model/Model";
import { Maybe } from "../util/util";
import { Requests } from "../request/Requests";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo, ImageLoader } from "../image/ImageLoader";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { BlockState } from "../model/block/BlockState";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { ListAsset } from "../ListAsset";
import { AssetKey } from "./AssetKey";
import { NBTAsset, NBTHelper } from "../nbt/NBTHelper";
import { prefix } from "../util/log";
import { AssetSource } from "./source/AssetSource";
import { AssetParser } from "./source/parser/AssetParsers";
import { HostedAssetSource } from "./source";
import merge from "ts-deepmerge";

const p = prefix("AssetLoader");


export class AssetLoader {

    static ROOT: string = DEFAULT_ROOT;

    private static _SOURCES: AssetSourceReference[] = [];

    public static addSource(key: string, source: AssetSource, override: boolean = true) {
        if (override) {
            const existing = this.removeSource(key);
            if (existing) {
                console.log(p, "Removed existing AssetSource", key);
            }
        }

        this._SOURCES.unshift({key, source});
        console.log(p, "Added AssetSource", key);
    }

    public static removeSource(key: string): Maybe<AssetSource> {
        const index = this._SOURCES.findIndex(s => s.key === key);
        if (index != -1) {
            const spliced = this._SOURCES.splice(index, 1);
            if (spliced.length > 0) {
                return spliced[0].source;
            }
        }
        return undefined;
    }

    static {
        this.addSource("mcassets-fallback", new HostedAssetSource('https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master'));
        this.addSource("mcassets", new HostedAssetSource(DEFAULT_ROOT));
    }

    public static async getAll<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T[]> {
        console.log(this._SOURCES)
        let promises: Promise<Maybe<T>>[] = [];
        for (const source of this._SOURCES) {
            promises.push(source.source.get<T>(key, parser));
        }
        return Promise.all(promises).then(results => {
            return results.filter(r => r != undefined) as T[];
        });
    }

    public static async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        console.log(this._SOURCES)
        let promises: Promise<Maybe<T>>[] = [];
        for (const source of this._SOURCES) {
            promises.push(source.source.get<T>(key, parser));
        }
        return Promise.all(promises).then(results => {
            const fallback = results[results.length - 1];
            for (const result of results) {
                if (result) {
                    if (fallback) {
                        // we have a fallback, so merge it with the result
                        return merge({}, fallback, result) as T;
                    }
                    return result;
                }
            }
            return undefined;
        });
    }

}

interface AssetSourceReference {
    key: string;
    source: AssetSource;
}
