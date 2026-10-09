import { AssetLoadError, AssetSource } from "./AssetSource";
import { BlockState, Model, TextureAsset } from "../../model";
import type { RequestConfig, RequestResponse } from "../../request";
import { Maybe, prefix } from "../../util";
import { MinecraftTextureMeta } from "../../MinecraftTextureMeta";
import { NBTAsset, NBTHelper } from "../../nbt";
import { ImageLoader } from "../../image";
import { ListAsset } from "../../ListAsset";
import { MinecraftAsset } from "../../MinecraftAsset";
import { AssetKey } from "../AssetKey";
import { DEFAULT_NAMESPACE } from "../AssetDefaults";
import { RequestError, Requests } from "../../request";
import { AssetLoader } from "../AssetLoader";
import type { AssetContext } from "../AssetContext";
import { AssetParser } from "./parser";
import { ResponseParser } from "./parser";
import merge from "ts-deepmerge";

const p = prefix("HostedAssetSource");

const DEFAULT_OPTIONS: HostedAssetSourceOptions = {
    retryDefaults: true
}

/** Loads assets over HTTP from a Minecraft directory tree rooted at the constructor's URL. */
export class HostedAssetSource extends AssetSource {

    static readonly MODEL: ResponseParser<Model> = {
        config(request: RequestConfig) {
        },
        parse(response: RequestResponse): Maybe<Model> {
            return response.data as Model;
        }
    }
    static readonly BLOCKSTATE: ResponseParser<BlockState> = {
        config(request: RequestConfig) {
        },
        parse(response: RequestResponse): Maybe<BlockState> {
            return response.data as BlockState;
        }
    }
    static readonly META: ResponseParser<MinecraftTextureMeta> = {
        config(request: RequestConfig) {
            // request.responseType = "arraybuffer";
        },
        parse(response: RequestResponse): Maybe<MinecraftTextureMeta> {
            return response.data as MinecraftTextureMeta;
        }
    }
    static readonly NBT: ResponseParser<NBTAsset> = {
        config(request: RequestConfig) {
            request.responseType = "arraybuffer";
        },
        parse(response: RequestResponse): Promise<Maybe<NBTAsset>> {
            return NBTHelper.fromBuffer(Buffer.from(response.data));
        }
    }
    static readonly IMAGE: ResponseParser<TextureAsset> = {
        config(request: RequestConfig) {
            request.responseType = "arraybuffer";
        },
        async parse(response: RequestResponse): Promise<Maybe<TextureAsset>> {
            return await ImageLoader.processResponse(response) as TextureAsset;
        }
    }
    static readonly LIST: ResponseParser<ListAsset> = {
        config(request: RequestConfig) {
        },
        parse(response: RequestResponse): Maybe<ListAsset> {
            return response.data as ListAsset;
        }
    }
    static readonly JSON: ResponseParser<any> = {
        config(request: RequestConfig) {
        },
        parse(response: RequestResponse): Maybe<any> {
            return response.data;
        }
    }

    static readonly PARSER_MAP: Map<AssetParser, ResponseParser<any>> = new Map<AssetParser, ResponseParser<any>>([
        [AssetParser.MODEL, HostedAssetSource.MODEL],
        [AssetParser.BLOCKSTATE, HostedAssetSource.BLOCKSTATE],
        [AssetParser.META, HostedAssetSource.META],
        [AssetParser.NBT, HostedAssetSource.NBT],
        [AssetParser.IMAGE, HostedAssetSource.IMAGE],
        [AssetParser.LIST, HostedAssetSource.LIST],
        [AssetParser.JSON, HostedAssetSource.JSON],
    ]);

    /** Retries missing assets with the `minecraft` namespace and default root. Other failures reject. */
    public async loadOrRetryWithDefaults<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>, assets: AssetContext = AssetLoader.context): Promise<Maybe<T>> {
        const direct = await this.load<T>(key, parser, assets);
        if (typeof direct !== "undefined") {
            return direct;
        }
        if (key.namespace !== DEFAULT_NAMESPACE) {
            console.info(p, "Retrying", key, "with default namespace");
            // Try on the same host but with default minecraft: namespace
            const namespaceKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.rootType, key.extension, key.root);
            const namespaced = await this.load<T>(namespaceKey, parser, assets);
            if (typeof namespaced !== "undefined") {
                return namespaced;
            }
            if ((typeof key.root !== "undefined" && key.root !== assets.root) || (typeof this.root !== "undefined" && this.root !== assets.root)) {
                console.info(p, "Retrying", key, "with default root+namespace");
                // Try both defaults
                const namespacedRootedKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.rootType, key.extension, assets.root);
                const namespacedRooted = await this.load<T>(namespacedRootedKey, parser, assets);
                if (typeof namespacedRooted !== "undefined") {
                    return namespacedRooted;
                }
            }
        } else if ((typeof key.root !== "undefined" && key.root !== assets.root) || (typeof this.root !== "undefined" && this.root !== assets.root)) {
            console.info(p, "Retrying", key, "with default root");
            // Try on default root
            const rootKey = new AssetKey(key.namespace, key.path, key.assetType, key.type, key.rootType, key.extension, assets.root);
            const rooted = await this.load<T>(rootKey, parser, assets);
            if (typeof rooted !== "undefined") {
                return rooted;
            }
        }
        return undefined;
    }


    protected async load<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>, assets: AssetContext = AssetLoader.context): Promise<Maybe<T>> {
        console.info(p, "Loading", key);
        const url = `${ this.assetBasePath(key, assets) }${ key.type !== undefined ? key.type + '/' : '' }${ key.path }${ key.extension }`;
        console.debug(p, url);
        const request: RequestConfig = { url };
        try {
            parser.config(request);
            let response: RequestResponse;
            try {
                response = await Requests.mcAssetRequest(request);
            } catch (cause) {
                // HTTP 404 is the only request failure that permits source fallback.
                if (cause instanceof RequestError && cause.response?.status === 404) {
                    return undefined;
                }
                throw cause;
            }
            if (response.data === undefined) {
                throw new Error("Asset response has no data");
            }
            return await parser.parse(response);
        } catch (cause) {
            throw new AssetLoadError(this, key, request.url, cause);
        }
    }

    public assetBasePath(key: AssetKey, assets: AssetContext = AssetLoader.context) {
        return `${ key.root ?? this.root ?? assets.root }/${ key.rootType !== undefined ? key.rootType + '/' : '' }${ key.namespace !== undefined ? key.namespace + '/' : '' }${ key.assetType !== undefined ? key.assetType + '/' : '' }`;
    }

    private readonly _root: string;
    private readonly _options: HostedAssetSourceOptions;

    /**
     * Creates a hosted source for {@link AssetLoader.addSource}.
     * Set `options.retryDefaults` to `false` to restrict lookups to the requested namespace and root.
     */
    public constructor(root: string, options?: Partial<HostedAssetSourceOptions>) {
        super();
        this._root = root;
        this._options = merge({}, DEFAULT_OPTIONS, options ?? {});
    }

    public get root(): string {
        return this._root;
    }

    public get cacheId(): string {
        return `hosted:${this._root}`;
    }

    public getCacheId(assets: AssetContext): string {
        return this.options.retryDefaults ? `${this.cacheId}:retry-defaults:${assets.root}` : this.cacheId;
    }

    public get options(): HostedAssetSourceOptions {
        return this._options;
    }

    public get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser, assets: AssetContext = AssetLoader.context): Promise<Maybe<T>> {
        const responseParser = HostedAssetSource.PARSER_MAP.get(parser) as ResponseParser<T>;
        if (this.options.retryDefaults) {
            return this.loadOrRetryWithDefaults(key, responseParser, assets);
        }
        return this.load(key, responseParser, assets);
    }

}

interface HostedAssetSourceOptions {
    retryDefaults: boolean;
}
