import type { RequestConfig, RequestResponse } from "../../../request";
import { Maybe } from "../../../util";
import { MinecraftAsset } from "../../../MinecraftAsset";

/** Configures a hosted asset request and converts its response into an asset. */
export interface ResponseParser<T extends MinecraftAsset> {
    /** Sets response decoding or other request options before the request starts. */
    config(request: RequestConfig);

    /** Returns `undefined` to permit source fallback, or throws to report a parse failure. */
    parse(response: RequestResponse): Maybe<T> | Promise<Maybe<T>>;
}