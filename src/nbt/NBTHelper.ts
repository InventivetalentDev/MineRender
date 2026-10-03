import type { NBT } from "prismarine-nbt";
import { MinecraftAsset } from "../MinecraftAsset";

export class NBTHelper {

    public static async fromBuffer(buffer: Buffer): Promise<NBTAsset> {
        const prismarineNbt = await import("prismarine-nbt");
        const { parsed, type, metadata } = await prismarineNbt.parse(buffer);
        return parsed;
    }

}

export interface NBTAsset extends MinecraftAsset, NBT {
}
