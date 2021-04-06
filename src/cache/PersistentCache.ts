import { Env } from "../Env";
import NodePersist, { LocalStorage } from "node-persist";
import { isBrowser, isNode } from "browser-or-node";
import localforage from "localforage";

export abstract class PersistentCache {

    public static readonly VERSION = 1;

    public static open(name: string): PersistentCache {
        if (isNode) {
            const backing = NodePersist.create({
                dir: name + this.VERSION,
                encoding: "utf8"
            })
            return new NodeCache(backing);
        } else if (isBrowser) {
            const backing = localforage.createInstance({
                name: name,
                version: this.VERSION
            })
            return new BrowserCache(backing);
        } else {
            throw new Error("Neither node or browser?!");
        }
    }

    protected constructor(readonly backing: LocalForage | LocalStorage) {
    }

    abstract get<T>(key: string): Promise<T>;

    async getOrLoad<T>(key: string, loader: (key: string) => Promise<T>): Promise<T> {
        let v = await this.get<T>(key);
        if (typeof v === "undefined" || v === null) {
            v = await loader(key);
            await this.put<T>(key, v);
        }
        return v;
    }

    abstract put<T>(key: string, value: T): Promise<T>;

    abstract delete<T>(key: string): Promise<void>;

    abstract clear(): Promise<void> ;

    abstract length(): Promise<number> ;

    abstract keys(): Promise<string[]>;

    abstract forEach<T>(callback: (v: T, k: string) => void): Promise<void>;

}

class NodeCache extends PersistentCache {

    constructor(backing: NodePersist.LocalStorage) {
        super(backing);
    }

    get<T>(key: string): Promise<T> {
        return this.backing.getItem(key);
    }

    put<T>(key: string, value: T): Promise<T> {
        return (<LocalStorage>this.backing).setItem(key, value).then(res => res.content);
    }

    delete<T>(key: string): Promise<void> {
        return (<LocalStorage>this.backing).removeItem(key).then(res => {
        })
    }

    clear(): Promise<void> {
        return this.backing.clear();
    }

    length(): Promise<number> {
        return this.backing.length();
    }

    keys(): Promise<string[]> {
        return this.backing.keys();
    }

    forEach<T>(callback: (v: T, k: string) => void): Promise<void> {
        return (<LocalStorage>this.backing).forEach(d => {
            callback(d.value, d.key);
        })
    }

}

class BrowserCache extends PersistentCache {

    constructor(backing: LocalForage) {
        super(backing);
    }

    get<T>(key: string): Promise<T> {
        return this.backing.getItem(key);
    }

    put<T>(key: string, value: T): Promise<T> {
        return (<LocalForage>this.backing).setItem(key, value);
    }

    delete<T>(key: string): Promise<void> {
        return (<LocalForage>this.backing).removeItem(key);
    }


    clear(): Promise<void> {
        return this.backing.clear();
    }

    length(): Promise<number> {
        return this.backing.length();
    }

    keys(): Promise<string[]> {
        return this.backing.keys();
    }

    forEach<T>(callback: (v: T, k: string) => void): Promise<void> {
        return (<LocalForage>this.backing).iterate((v: T, k: string) => {
            callback(v, k);
        })
    }

}
