import { MinecraftAsset } from "../../MinecraftAsset";
import { AssetKey } from "../AssetKey";
import { Maybe } from "../../util";
import { AssetParser } from "./parser/AssetParsers";

export abstract class AssetSource {

    protected constructor() {
    }

    public abstract get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>>;

}