import { PersistentCache } from "../../cache/PersistentCache";

/**
 * {@link PersistentCache} backed by localforage (IndexedDB / WebSQL / localStorage).
 * Uses an in-memory store if browser storage fails or takes more than one second to initialize.
 */
export class BrowserCache extends PersistentCache<LocalForage> {

    private initialized?: Promise<boolean>;
    private memory?: Map<string, unknown>;

    constructor(backing: LocalForage) {
        super(backing);
    }

    private async initialize(): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const ready = await Promise.race([
                Promise.resolve().then(() => this.backing.ready()).then(() => true, () => false),
                new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); })
            ]);
            if (!ready) this.memory = new Map();
            return ready;
        } finally {
            clearTimeout(timer);
        }
    }

    private async run<T>(operation: () => Promise<T>, fallback: (memory: Map<string, unknown>) => T): Promise<T> {
        if (!this.memory && await (this.initialized ??= this.initialize())) {
            try {
                const value = await operation();
                if (!this.memory) return value;
            } catch {
                this.memory ??= new Map();
            }
        }
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

    async forEach<T>(callback: (v: T, k: string) => void): Promise<void> {
        const entries = await this.run(async () => {
            const entries: Array<[string, T]> = [];
            await this.backing.iterate<T, void>((value, key) => { entries.push([key, value]); });
            return entries;
        }, memory => [...memory.entries()] as Array<[string, T]>);
        for (const [key, value] of entries) callback(value, key);
    }

}
