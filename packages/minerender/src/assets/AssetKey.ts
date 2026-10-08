import { Serializable } from "../Serializable";
import { DEFAULT_NAMESPACE } from "./Assets";
import { AssetLoader } from "./AssetLoader";

export type AssetType = "models" | "textures" | "blockstates" | string;

/** A Minecraft namespace and path, such as `minecraft` and `zombie`. */
export class BasicAssetKey implements Serializable {

    readonly namespace: string;
    readonly path: string;

    constructor(key: BasicAssetKey);
    constructor(namespace: string, path: string);
    constructor(namespaceOrKey: string | BasicAssetKey, path?: string) {
        if (path) {
            this.namespace = namespaceOrKey as string;
            this.path = path;
        } else {
            this.namespace = (namespaceOrKey as BasicAssetKey).namespace;
            this.path = (namespaceOrKey as BasicAssetKey).path
        }
    }

    toNamespacedString() {
        return this.namespace + ":" + this.path;
    }

    toString() {
        return this.toNamespacedString();
    }

    serialize(): string {
        return this.toString();
    }
}

// TODO: rewrite this to be less dumb
/** Locates an asset by namespace, directory, extension, and optional asset root. */
export class AssetKey extends BasicAssetKey {

    public readonly isAssetKey: true = true;

    /**
     * Creates a key from separate path components. Use {@link parse} for a combined reference.
     *
     * @param assetType - Asset directory, such as `models`, `textures`, or `blockstates`.
     * @param type - Subdirectory, such as `block` or `item`.
     * @param rootType - Top-level directory, usually `assets` or `data`.
     * @param root - Base URL override for hosted asset sources.
     */
    constructor(
        readonly namespace: string, readonly path: string,
        public assetType?: AssetType,
        public type?: string,
        public rootType: "assets" | "data" | string = "assets",
        public extension: ".json" | ".png" | string = ".json",
        public root?: string,
    ) {
        super(namespace, path);
    }


    /**
     * Parses an asset reference such as `minecraft:block/stone`.
     * A missing namespace defaults to the origin's namespace or `minecraft`.
     *
     * @param assetType - Asset category, such as `models` or `textures`.
     * @param str - Path with an optional namespace and file extension.
     * @param origin - Supplies the asset root, default namespace, and non-texture extension.
     * @returns A key with the matching extension removed from its path. Textures use `.png`;
     * other assets use the origin's extension or `.json`.
     */
    public static parse(assetType: AssetType, str: string, origin?: AssetKey): AssetKey {
        let namespace = origin?.namespace || DEFAULT_NAMESPACE;
        if (str.includes(":")) {
            let split = str.split("\:");
            namespace = split[0];
            str = split[1];
        }

        let split = str.split("\/");
        let type: string | undefined = undefined;
        if (split.length > 1) {
            type = split[0];
            split.shift();
        }
        let path = split.join("/");

        const extension = assetType === "textures" ? ".png" :
            origin?.extension ?? ".json";
        if (extension && path.endsWith(extension)) {
            path = path.slice(0, -extension.length);
        }

        return new AssetKey(namespace, path, assetType, type, "assets", extension, origin?.root);
    }

    toString(): string {
        let a = [
            this.root ?? AssetLoader.ROOT,
            this.rootType ?? "__rootType__",
            this.assetType ?? "__assetType__",
            this.type ?? "__type__",
            this.namespace,
            this.path
        ];
        return a.join("/");
    }

    /** Joins the type subdirectory and path without adding a namespace or file extension. */
    getFullPath() {
        let p: string[] = [];
        if (this.type) {
            p.push(this.type);
        }
        p.push(this.path);
        return p.join("/");
    }

    toNamespacedString() {
        return this.namespace + ":" + this.getFullPath();
    }

    /** Returns a cache identifier that includes the explicit root or {@link AssetLoader.ROOT}. */
    serialize(): string {
        return this.toString();
    }
}

export function isBasicAssetKey(obj: any): obj is BasicAssetKey {
    return obj !== null && typeof obj === "object"
        && typeof obj.namespace === "string" && typeof obj.path === "string";
}

export function isAssetKey(obj: any): obj is AssetKey {
    return isBasicAssetKey(obj) && (<AssetKey>obj).isAssetKey === true;
}
