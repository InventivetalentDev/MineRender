import * as prismarineNbt from "prismarine-nbt";
import { NBT } from "prismarine-nbt";
import { MinecraftAsset } from "../MinecraftAsset";

export class NBTHelper {

    public static async fromBuffer(buffer: Buffer): Promise<NBTAsset> {
        const { parsed, type, metadata } = await prismarineNbt.parse(buffer);
        return parsed;
    }

}

export interface NBTAsset extends MinecraftAsset, NBT {
}
