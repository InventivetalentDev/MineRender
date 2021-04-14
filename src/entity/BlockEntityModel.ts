import { BasicMinecraftAsset, MinecraftAsset } from "../MinecraftAsset";
import { ModelPart } from "../model/ModelPart";

export interface BlockEntityModel extends BasicMinecraftAsset {
    parts?: { [p: string]: ModelPart };
}
