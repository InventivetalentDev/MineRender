import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Maybe } from "../../../util";
import { MinecraftAsset } from "../../../MinecraftAsset";

export interface ResponseParser<T extends MinecraftAsset> {
    config(request: AxiosRequestConfig);

    parse(response: AxiosResponse): Maybe<T> | Promise<Maybe<T>>;
}