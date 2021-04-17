import { BasicMinecraftAsset, MinecraftAsset } from "../MinecraftAsset";
import { ModelPart } from "../model/ModelPart";

export interface EntityModel extends BasicMinecraftAsset {
    parts?: { [p: string]: ModelPart };
}
