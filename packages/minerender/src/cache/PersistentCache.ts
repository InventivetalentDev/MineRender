import { Env } from "../Env";

/**
 * Key/value store that survives a page reload or process restart.
 *
 * The concrete backing store is supplied by the active {@link EnvProvider} - `localforage`
 * (IndexedDB) in the browser, `node-persist` (disk) under Node - so this file itself stays
 * free of any platform-specific import.
 */
export abstract class PersistentCache<B = unknown> {

    /** Bump to invalidate every persisted entry. */
    public static readonly VERSION = 1;

    public static open(name: string): PersistentCache {
        return Env.provider.openCache(name, PersistentCache.VERSION);
    }

    protected constructor(readonly backing: B) {
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
