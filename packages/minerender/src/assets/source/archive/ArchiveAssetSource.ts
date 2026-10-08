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
import { AssetLoader } from "../../AssetLoader";
import { PackMetadata, type PackFormat } from "./PackMetadata";
import { PackFormats } from "./PackFormats";

export interface ArchiveAssetSourceOptions {
    /** Target resource-pack format. Omit to look up the version selected by AssetLoader.setVersion. */
    resourcePackFormat?: PackFormat;
    /** Target data-pack format, used for assets under data/. Omit to look up the selected version. */
    dataPackFormat?: PackFormat;
}

/** Loads assets from resource-pack ZIP entries. Register it with {@link AssetLoader.addSource}. */
export class ArchiveAssetSource extends AssetSource implements ArchiveProxy {

    readonly _archiveProxy: ArchiveProxy;
    private readonly options: ArchiveAssetSourceOptions;
    private entries?: Promise<ArchiveEntry[]>;
    private metadata?: Promise<PackMetadata>;

    constructor(archiveProxy: ArchiveProxy, options: ArchiveAssetSourceOptions = {}) {
        super();
        this._archiveProxy = archiveProxy;
        const copyFormat = (format?: PackFormat): PackFormat | undefined =>
            typeof format === "object" ? [format[0], format[1]] : format;
        this.options = {
            resourcePackFormat: copyFormat(options.resourcePackFormat),
            dataPackFormat: copyFormat(options.dataPackFormat)
        };
    }

    /** Creates a browser ZIP source from a Blob or File. */
    public static blob(blob: Blob, options?: ArchiveAssetSourceOptions): ArchiveAssetSource {
        return new ArchiveAssetSource(new BrowserArchiveProxy(blob), options);
    }

    public get cacheId(): Maybe<string> {
        const id = this._archiveProxy.id;
        const formats = [this.options.resourcePackFormat ?? AssetLoader.version, this.options.dataPackFormat ?? AssetLoader.version];
        return id === undefined ? undefined : `archive-metadata:1:${id}:${JSON.stringify(formats)}`;
    }

    public async getEntries(): Promise<ArchiveEntry[]> {
        return this.entries ??= this._archiveProxy.getEntries().catch(error => {
            this.entries = undefined;
            throw error;
        });
    }

    public async getEntry(path: string): Promise<Maybe<ArchiveEntry>> {
        const entries = await this.getEntries();
        return entries.find(e => e.filename === path);
    }

    private async getMetadata(key: AssetKey): Promise<PackMetadata> {
        try {
            return await (this.metadata ??= this.getEntry("pack.mcmeta").then(async entry =>
                PackMetadata.parse(entry ? JSON.parse(await (await entry.getData()).text()) : {})).catch(error => {
                this.metadata = undefined;
                throw error;
            }));
        } catch (cause) {
            throw new AssetLoadError(this, key, "pack.mcmeta", cause);
        }
    }

    public async blocks(key: AssetKey): Promise<boolean> {
        if (key.rootType !== "assets" && key.rootType !== "data") return false;
        const metadata = await this.getMetadata(key);
        const path = `${key.assetType !== undefined ? key.assetType + '/' : ''}${key.getFullPath()}${key.extension}`;
        return metadata.blocks(key.namespace, path);
    }

    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        const responseParser = HostedAssetSource.PARSER_MAP.get(parser as AssetParser) as ResponseParser<T>;
        return this.load(key, responseParser);
    }

    protected async load<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        const path = `${this.assetBasePath(key)}${key.type !== undefined ? key.type + '/' : ''}${key.path}${key.extension}`;
        const version = AssetLoader.version;
        let selectedPath = path;
        let url: string | undefined;
        try {
            let directories: string[] = [];
            if (key.rootType === "assets" || key.rootType === "data") {
                const metadata = await this.getMetadata(key);
                if (metadata.hasOverlays) {
                    const format = (key.rootType === "assets" ? this.options.resourcePackFormat : this.options.dataPackFormat)
                        ?? await PackFormats.get(version, key.rootType);
                    directories = metadata.overlayDirectories(format);
                }
            }
            let entry: ArchiveEntry | undefined;
            for (const directory of [...directories, ""]) {
                selectedPath = directory ? `${directory}/${path}` : path;
                entry = await this.getEntry(selectedPath);
                if (entry) break;
            }
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
            if (cause instanceof AssetLoadError) throw cause;
            throw new AssetLoadError(this, key, selectedPath, cause);
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
