import type { Metadata, NBT, NBTFormat } from "prismarine-nbt";
import { Buffer } from "buffer";
import { MinecraftAsset } from "../MinecraftAsset";

/** Decodes Named Binary Tag (NBT) data for structure and world parsers. */
export class NBTHelper {

    /** Parses NBT bytes and preserves format and compression metadata. Omit `format` for automatic detection. */
    public static async fromBuffer(data: Uint8Array | ArrayBuffer, format?: NBTFormat): Promise<NBTAsset> {
        const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));
        const prismarineNbt = await import("prismarine-nbt");
        const { parsed, type, metadata } = await prismarineNbt.parse(buffer, format);
        return Object.assign(parsed, {
            format: type,
            metadata,
            compression: buffer[0] === 0x1f && buffer[1] === 0x8b ? "gzip" as const : "none" as const
        });
    }

}

/** Decoded NBT with the source format and parser metadata attached. */
export interface NBTAsset extends MinecraftAsset, NBT {
    format?: NBTFormat;
    metadata?: Metadata;
    compression?: "gzip" | "none";
}
