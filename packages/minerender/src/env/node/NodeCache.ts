import type { LocalStorage } from "node-persist";
import { PersistentCache } from "../../cache/PersistentCache";

/**
 * {@link PersistentCache} backed by node-persist (one directory of JSON files per cache).
 *
 * node-persist requires an explicit `init()` before any read or write; that is done lazily on
 * first access so that merely constructing the cache stays free of filesystem side effects.
 */
export class NodeCache extends PersistentCache<LocalStorage> {

    private initialized: Promise<unknown> | undefined;

    constructor(backing: LocalStorage) {
        super(backing);
    }

    private ready(): Promise<unknown> {
        return this.initialized ??= this.backing.init();
    }

    async get<T>(key: string): Promise<T> {
        await this.ready();
        return this.backing.getItem(key);
    }

    async put<T>(key: string, value: T): Promise<T> {
        await this.ready();
        return this.backing.setItem(key, value).then(res => res.content);
    }

    async delete<T>(key: string): Promise<void> {
        await this.ready();
        await this.backing.removeItem(key);
    }

    async clear(): Promise<void> {
        await this.ready();
        return this.backing.clear();
    }

    async length(): Promise<number> {
        await this.ready();
        return this.backing.length();
    }

    async keys(): Promise<string[]> {
        await this.ready();
        return this.backing.keys();
    }

    async forEach<T>(callback: (v: T, k: string) => void): Promise<void> {
        await this.ready();
        return this.backing.forEach(d => {
            callback(d.value, d.key);
        });
    }

}
