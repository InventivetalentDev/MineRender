import { Requests } from "../../../request/Requests";
import type { PackFormat } from "./PackMetadata";

export class PackFormats {

    private static readonly versions = new Map<string, Promise<Record<"assets" | "data", PackFormat>>>();

    /** Resolves a Minecraft version's pack formats from mcmeta's extracted client metadata. */
    public static async get(version: string, type: "assets" | "data"): Promise<PackFormat> {
        let pending = this.versions.get(version);
        if (!pending) {
            pending = this.load(version);
            this.versions.set(version, pending);
        }
        try {
            return (await pending)[type];
        } catch (cause) {
            if (this.versions.get(version) === pending) this.versions.delete(version);
            const option = type === "assets" ? "resourcePackFormat" : "dataPackFormat";
            const reason = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Could not resolve the pack format for Minecraft ${version}. Set ArchiveAssetSource ${option} explicitly. ${reason}`);
        }
    }

    private static async load(version: string): Promise<Record<"assets" | "data", PackFormat>> {
        const response = await Requests.genericRequest({
            url: `https://raw.githubusercontent.com/misode/mcmeta/${encodeURIComponent(version)}-summary/version.json`,
            responseType: "json"
        });
        const data = response.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Expected version metadata to be an object");
        }
        const format = (type: "resource" | "data"): PackFormat => {
            const major = data[`${type}_pack_version`];
            const minor = data[`${type}_pack_version_minor`] === undefined ? 0 : data[`${type}_pack_version_minor`];
            if (typeof major !== "number" || !Number.isSafeInteger(major) || major < 0
                || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0) {
                throw new Error(`Invalid ${type} pack format in version metadata`);
            }
            return Object.freeze([major, minor] as const);
        };
        return { assets: format("resource"), data: format("data") };
    }

}
