import type { RequestConfig, RequestResponse } from "../../../request";
import { Maybe } from "../../../util";
import { MinecraftAsset } from "../../../MinecraftAsset";

export interface ResponseParser<T extends MinecraftAsset> {
    config(request: RequestConfig);

    parse(response: RequestResponse): Maybe<T> | Promise<Maybe<T>>;
}