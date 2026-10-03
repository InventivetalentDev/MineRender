import { AssetSource } from "../AssetSource";
import { ArchiveProxy } from "./ArchiveProxy";
import { ArchiveEntry } from "./ArchiveEntry";
import { MinecraftAsset } from "../../../MinecraftAsset";
import { AssetKey } from "../../AssetKey";
import { AssetParser, ResponseParser } from "../parser";
import { Maybe, prefix } from "../../../util";
import { Requests } from "../../../request";
import { HostedAssetSource } from "../HostedAssetSource";
import { AssetLoader } from "../../AssetLoader";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { BrowserArchiveProxy } from "./BrowserArchiveProxy";

const p = prefix("ArchiveAssetSource");

export class ArchiveAssetSource extends AssetSource implements ArchiveProxy {

    readonly _archiveProxy: ArchiveProxy;

    constructor(archiveProxy: ArchiveProxy) {
        super();
        console.log(archiveProxy)
        this._archiveProxy = archiveProxy;
    }

    public static blob(blob: Blob): ArchiveAssetSource {
        return new ArchiveAssetSource(new BrowserArchiveProxy(blob));
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

        console.log("ArchiveAssetSource.get", key, parser);
        let entries = (await this.getEntries());

        const path = `${this.assetBasePath(key)}${key.type !== undefined ? key.type + '/' : ''}${key.path}${key.extension}`;
        console.log(path);
        const entry = await this.getEntry(path);
        console.log(entry);
        if (!entry) {
            return undefined;
        }

        let blob = await entry.getData();
        const url = URL.createObjectURL(blob);
        console.log(url);
        let req = {
            url: url,
        };
        responseParser.config(req);
        return Requests.genericRequest(req)
            .then(response => {
                if (response && response.data) {
                    try {
                        return responseParser.parse(response);
                    } catch (e) {
                        console.warn("Parser failed to process response", response, e);
                        throw e;
                    }
                }
                return undefined;
            })
            .catch(err => {
                if (err.response) {
                    let response = err.response as AxiosResponse;
                    if (response.status === 404) {
                        console.debug(p, key, "not found");
                        return undefined;
                    }
                }
                console.debug(p, "Failed to load", key, err?.message);
                return undefined;
            })
    }

    //TODO: abstract this
    protected async load<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        console.info(p, "Loading", key);
        const url = `${this.assetBasePath(key)}${key.type !== undefined ? key.type + '/' : ''}${key.path}${key.extension}`;
        console.debug(p, url);
        let req: AxiosRequestConfig = {
            url: url
        };
        parser.config(req);
        // @ts-ignore
        return await Requests.genericRequest(req)
            .then(response => {
                if (response && response.data) {
                    try {
                        return parser.parse(response);
                    } catch (e) {
                        console.warn("Parser failed to process response", response, e);
                        throw e;
                    }
                }
                return undefined;
            })
            .catch(err => {
                if (err.response) {
                    let response = err.response as AxiosResponse;
                    if (response.status === 404) {
                        console.debug(p, key, "not found");
                        return undefined;
                    }
                }
                console.debug(p, "Failed to load", key, err?.message);
                return undefined;
            })
    }

    public assetBasePath(key: AssetKey) {
        return `${key.rootType !== undefined ? key.rootType + '/' : ''}${key.namespace !== undefined ? key.namespace + '/' : ''}${key.assetType !== undefined ? key.assetType + '/' : ''}`;
    }

}