import { PersistentCache } from "../../cache/PersistentCache";
import { prefix } from "../../util/log";

const p = prefix("BrowserCache");

/**
 * {@link PersistentCache} backed by localforage (IndexedDB / WebSQL / localStorage).
 * Uses an in-memory store when browser storage cannot be opened.
 */
export class BrowserCache extends PersistentCache<LocalForage> {

    private initialized?: Promise<boolean>;
    private memory?: Map<string, unknown>;

    constructor(backing: LocalForage) {
        super(backing);
    }

    private async initialize(): Promise<boolean> {
        try {
            await this.backing.ready();
            return true;
        } catch (error) {
            this.memory = new Map();
            console.warn(p, "Could not open browser storage; using an in-memory store", error);
            return false;
        }
    }

    private async run<T>(operation: () => Promise<T>, fallback: (memory: Map<string, unknown>) => T): Promise<T> {
        if (await (this.initialized ??= this.initialize())) return operation();
        return fallback(this.memory!);
    }

    get<T>(key: string): Promise<T> {
        return this.run(() => this.backing.getItem<T>(key), memory => memory.get(key) as T) as Promise<T>;
    }

    put<T>(key: string, value: T): Promise<T> {
        return this.run(() => this.backing.setItem<T>(key, value), memory => {
            memory.set(key, value);
            return value;
        });
    }

    delete<T>(key: string): Promise<void> {
        return this.run(() => this.backing.removeItem(key), memory => { memory.delete(key); });
    }

    clear(): Promise<void> {
        return this.run(() => this.backing.clear(), memory => memory.clear());
    }

    length(): Promise<number> {
        return this.run(() => this.backing.length(), memory => memory.size);
    }

    keys(): Promise<string[]> {
        return this.run(() => this.backing.keys(), memory => [...memory.keys()]);
    }

    forEach<T>(callback: (v: T, k: string) => void): Promise<void> {
        return this.run(() => this.backing.iterate<T, void>((value, key) => {
            callback(value, key);
        }), memory => memory.forEach((value, key) => callback(value as T, key)));
    }

}
