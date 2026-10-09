import { Buffer } from "buffer";
import { MeshBasicMaterial } from "three";
import { AssetKey, isResourceLocation } from "../assets/AssetKey";
import { ModelTextures } from "../assets/ModelTextures";
import { md5 } from "../util/util";
import { Skins } from "./Skins";
import { SkinTextures } from "./SkinTextures";

interface Profile {
    name?: string;
    id?: number[];
    properties?: { name: string; value: string; signature?: string }[];
    texture?: string;
}

/** Resolves Minecraft profile components to resource textures or shared, prepared player skins. */
export class PlayerHeadTextures {

    /** Resource textures retain their pixels; downloaded skins use the skin pipeline's legacy and opacity rules. */
    public static async get(value: unknown, root?: string): Promise<{ texture: AssetKey; material?: MeshBasicMaterial }> {
        const profile = this.profile(value);
        const uuid = profile?.id ?? this.offlineUuid(profile?.name);
        let src: string | undefined;
        if (profile?.texture !== undefined) {
            const [namespace, path] = profile.texture.includes(":") ? profile.texture.split(":") : ["minecraft", profile.texture];
            return { texture: await this.resource(new AssetKey(namespace, path, "textures", undefined, "assets", ".png", root)) };
        }
        if (profile) {
            if (profile.properties!.length || profile.name !== undefined && profile.id !== undefined) {
                src = this.propertyUrl(profile.properties!);
            } else if (profile.name !== undefined || profile.id !== undefined) {
                src = profile.id ? await Skins.fromUuid(this.uuidString(profile.id)) : await Skins.fromUsername(profile.name!);
            }
        }
        const names = ["alex", "ari", "efe", "kai", "makena", "noor", "steve", "sunny", "zuri"];
        const index = profile ? ((uuid.reduce((hash, word) => hash ^ word, 0) % 18) + 18) % 18 : 6;
        const texture = new AssetKey("minecraft", `player/${index < 9 ? "slim" : "wide"}/${names[index % 9]}`,
            "textures", "entity", "assets", ".png", root);
        if (src) {
            try {
                const skin = await SkinTextures.get(src);
                return { texture, material: skin.material };
            } catch {
                // A missing or invalid downloaded skin uses the profile's default, without caching the failure.
            }
        }
        return { texture: await this.resource(texture) };
    }

    private static async resource(texture: AssetKey): Promise<AssetKey> {
        if (!await ModelTextures.preload(texture)) throw new Error(`Missing player-head texture ${texture.toNamespacedString()}`);
        return texture;
    }

    private static profile(value: unknown): Profile | undefined {
        if (value === undefined) return undefined;
        if (typeof value === "string") value = { name: value };
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Player profile must be a name or an object");
        const input = value as Record<string, unknown>;
        const result: Profile = {};
        if (input.name !== undefined) {
            if (typeof input.name !== "string" || input.name.length > 16 || /[^\x21-\x7e]/.test(input.name)) throw new Error("Invalid player profile name");
            result.name = input.name;
        }
        if (input.id !== undefined) {
            if (!Array.isArray(input.id) || input.id.length !== 4 || !input.id.every(word => typeof word === "number" && Number.isInteger(word) && word >= -2147483648 && word <= 2147483647)) {
                throw new Error("Player profile id must contain four signed 32-bit integers");
            }
            result.id = [...input.id];
        }
        if (input.texture !== undefined) {
            if (!isResourceLocation(input.texture)) throw new Error("Invalid player profile texture identifier");
            result.texture = input.texture;
        }
        const supplied = input.properties;
        if (supplied === undefined) result.properties = [];
        else if (Array.isArray(supplied)) {
            if (supplied.length > 16 || supplied.some(property => !property || typeof property !== "object"
                || typeof property.name !== "string" || property.name.length > 64 || typeof property.value !== "string" || property.value.length > 32767
                || property.signature !== undefined && (typeof property.signature !== "string" || property.signature.length > 1024))) throw new Error("Invalid player profile properties");
            result.properties = supplied.map(property => ({ ...property }));
        } else if (supplied && typeof supplied === "object") {
            const entries = Object.entries(supplied);
            if (entries.length > 16 || entries.some(([name, values]) => !Array.isArray(values) || values.some(value => typeof value !== "string"))) throw new Error("Invalid player profile properties");
            result.properties = entries.flatMap(([name, values]) => (values as string[]).map(value => ({ name, value })));
        } else throw new Error("Invalid player profile properties");
        return result;
    }

    private static propertyUrl(properties: NonNullable<Profile["properties"]>): string | undefined {
        const value = properties.find(property => property.name === "textures")?.value;
        if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(value)) return undefined;
        try {
            const textures = JSON.parse(Buffer.from(value, "base64").toString("utf8")).textures;
            if (!textures || typeof textures !== "object" || Array.isArray(textures)) return undefined;
            for (const texture of Object.values(textures) as { url?: unknown }[]) {
                if (!texture || typeof texture.url !== "string" || !/^https?:\/\//.test(texture.url)) return undefined;
                const url = new URL(texture.url);
                const host = url.hostname;
                if (!host.endsWith(".minecraft.net") && !host.endsWith(".mojang.com")
                    || ["bugs.mojang.com", "education.minecraft.net", "feedback.minecraft.net"].some(blocked => host.endsWith(blocked))) return undefined;
            }
            return textures.SKIN?.url;
        } catch {
            return undefined;
        }
    }

    private static offlineUuid(name?: string): number[] {
        if (name === undefined) return [0, 0, 0, 0];
        const bytes = Buffer.from(md5(`OfflinePlayer:${name}`), "hex");
        bytes[6] = (bytes[6] & 0x0f) | 0x30;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return [0, 4, 8, 12].map(offset => bytes.readInt32BE(offset));
    }

    private static uuidString(words: number[]): string {
        const hex = words.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
}
