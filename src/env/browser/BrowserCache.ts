import { PersistentCache } from "../../cache/PersistentCache";

/**
 * {@link PersistentCache} backed by localforage (IndexedDB / WebSQL / localStorage).
 */
export class BrowserCache extends PersistentCache<LocalForage> {

    constructor(backing: LocalForage) {
        super(backing);
    }

    get<T>(key: string): Promise<T> {
        return this.backing.getItem<T>(key) as Promise<T>;
    }

    put<T>(key: string, value: T): Promise<T> {
        return this.backing.setItem<T>(key, value);
    }

    delete<T>(key: string): Promise<void> {
        return this.backing.removeItem(key);
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
        return this.backing.iterate<T, void>((v: T, k: string) => {
            callback(v, k);
        });
    }

}
