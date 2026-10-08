import { Requests } from "../../../request/Requests";
import type { PackFormat } from "./PackMetadata";

export class PackFormats {

    private static readonly versions = new Map<string, {
        formats: Promise<Record<"assets" | "data", PackFormat>>;
        expires: number;
    }>();

    /** Resolves pack formats from Mojang's client metadata hosted on assets.mcasset.cloud. */
    public static async get(version: string, type: "assets" | "data"): Promise<PackFormat> {
        let pending = this.versions.get(version);
        if (!pending || pending.expires <= Date.now()) {
            pending = {
                formats: this.load(version),
                expires: ["latest", "release", "snapshot"].includes(version) ? Date.now() + 300_000 : Infinity
            };
            this.versions.set(version, pending);
        }
        try {
            return (await pending.formats)[type];
        } catch (cause) {
            if (this.versions.get(version) === pending) this.versions.delete(version);
            const option = type === "assets" ? "resourcePackFormat" : "dataPackFormat";
            const reason = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Could not resolve the pack format for Minecraft ${version}. Set ArchiveAssetSource ${option} explicitly. ${reason}`);
        }
    }

    private static async load(version: string): Promise<Record<"assets" | "data", PackFormat>> {
        const response = await Requests.genericRequest({
            url: `https://assets.mcasset.cloud/${encodeURIComponent(version)}/game-version.json`,
            responseType: "json"
        });
        const data = response.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Expected version metadata to be an object");
        }
        const packs = data.pack_version;
        if (typeof packs !== "number" && (!packs || typeof packs !== "object" || Array.isArray(packs))) {
            throw new Error("Expected pack_version to be a number or an object");
        }
        const format = (type: "resource" | "data"): PackFormat => {
            const modern = typeof packs === "object" && ["resource_major", "resource_minor", "data_major", "data_minor"].some(key => key in packs);
            const major = typeof packs === "number" ? packs : packs[modern ? `${type}_major` : type];
            const minor = modern ? packs[`${type}_minor`] : 0;
            if (typeof major !== "number" || !Number.isSafeInteger(major) || major < 0
                || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0) {
                throw new Error(`Invalid ${type} pack format in version metadata`);
            }
            return Object.freeze([major, minor] as const);
        };
        return { assets: format("resource"), data: format("data") };
    }

}
