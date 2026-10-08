import { AssetLoadError, AssetSource } from "../AssetSource";
import { ArchiveProxy } from "./ArchiveProxy";
import { ArchiveEntry } from "./ArchiveEntry";
import { MinecraftAsset } from "../../../MinecraftAsset";
import { AssetKey } from "../../AssetKey";
import { AssetParser, ResponseParser } from "../parser";
import { Maybe } from "../../../util";
import { Requests } from "../../../request";
import { HostedAssetSource } from "../HostedAssetSource";
import type { RequestConfig } from "../../../request";
import { BrowserArchiveProxy } from "./BrowserArchiveProxy";

/** Loads assets from resource-pack ZIP entries. Register it with {@link AssetLoader.addSource}. */
export class ArchiveAssetSource extends AssetSource implements ArchiveProxy {

    readonly _archiveProxy: ArchiveProxy;

    constructor(archiveProxy: ArchiveProxy) {
        super();
        console.log(archiveProxy)
        this._archiveProxy = archiveProxy;
    }

    /** Creates a browser ZIP source from a Blob or File. */
    public static blob(blob: Blob): ArchiveAssetSource {
        return new ArchiveAssetSource(new BrowserArchiveProxy(blob));
    }

    public get cacheId(): Maybe<string> {
        const id = this._archiveProxy.id;
        return id === undefined ? undefined : `archive:${id}`;
    }

    public async getEntries(): Promise<ArchiveEntry[]> {
        return this._archiveProxy.getEntries();
    }

    public async getEntry(path: string): Promise<Maybe<ArchiveEntry>> {
        const entries = await this.getEntries();
        return entries.find(e => e.filename === path);
    }

    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        const responseParser = HostedAssetSource.PARSER_MAP.get(parser as AssetParser) as ResponseParser<T>;
        return this.load(key, responseParser);
    }

    protected async load<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        const path = `${this.assetBasePath(key)}${key.type !== undefined ? key.type + '/' : ''}${key.path}${key.extension}`;
        let url: string | undefined;
        try {
            const entry = await this.getEntry(path);
            if (!entry) {
                return undefined;
            }
            url = URL.createObjectURL(await entry.getData());
            const request: RequestConfig = { url };
            parser.config(request);
            const response = await Requests.genericRequest(request);
            if (response.data === undefined) {
                throw new Error("Asset response has no data");
            }
            return await parser.parse(response);
        } catch (cause) {
            throw new AssetLoadError(this, key, path, cause);
        } finally {
            if (url !== undefined) {
                URL.revokeObjectURL(url);
            }
        }
    }

    public assetBasePath(key: AssetKey) {
        return `${key.rootType !== undefined ? key.rootType + '/' : ''}${key.namespace !== undefined ? key.namespace + '/' : ''}${key.assetType !== undefined ? key.assetType + '/' : ''}`;
    }

}