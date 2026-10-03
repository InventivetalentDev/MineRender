import { Serializable } from "../Serializable";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { AssetLoader } from "./AssetLoader";

export type AssetType = "models" | "textures" | "blockstates" | string;

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
export class AssetKey extends BasicAssetKey {

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

        let extension = assetType === "textures" ? ".png" :
            origin?.assetType || ".json";

        return new AssetKey(namespace, path, assetType, type, "assets", extension, origin?.root);
    }

    toString(): string {
        let a = [
            (typeof this.root !== 'undefined' || AssetLoader.ROOT !== DEFAULT_ROOT) ? (this.root ?? AssetLoader.ROOT) : "__root__",
            this.rootType ?? "__rootType__",
            this.assetType ?? "__assetType__",
            this.type ?? "__type__",
            this.namespace,
            this.path
        ];
        return a.join("/");
    }

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

    serialize(): string {
        return this.toString();
    }
}

export function isBasicAssetKey(obj: any): obj is BasicAssetKey {
    return "namespace" in obj && "path" in obj;
}

export function isAssetKey(obj: any): obj is AssetKey {
    return isBasicAssetKey(obj) && "parse" in obj;
}
