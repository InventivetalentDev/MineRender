import { InstanceReference } from "./InstanceReference";
import { SceneObject } from "../renderer/SceneObject";
import { Maybe } from "../util/util";
import { prefix } from "../util/log";

const p = prefix("InstanceManager");

/** Shares initialized model objects by cache key and allocates references to their placements. */
export class InstanceManager {

    public readonly isInstanceManager: true = true;

    protected readonly instanceCache: { [key: string]: Promise<InstanceReference<SceneObject>>; } = {};
    private readonly initialized = new Map<string, SceneObject>();

    constructor() {
    }

    /** Allocates a new placement of a cached model, or returns `undefined` if the key is unknown. */
    public async get<T extends SceneObject>(key: string): Promise<Maybe<InstanceReference<T>>> {
        if (key in this.instanceCache) {
            console.debug(p, "key in cache", key)
            // create next instance of existing object
            const pending = this.instanceCache[key];
            const reference = await pending;
            if (this.instanceCache[key] !== pending) return undefined;
            return reference.nextInstance() as InstanceReference<T>;
        }
        return undefined;
    }

    /** Allocates a placement, calling the supplier once when the shared model is first needed. */
    public async getOrCreate<T extends SceneObject>(key: string, supplier: () => T | Promise<T>): Promise<InstanceReference<T>> {
        if (key in this.instanceCache) {
            const reference = await this.get<T>(key);
            return reference ?? this.getOrCreate(key, supplier);
        }
        console.debug(p, "key not in cache", key)
        const pending = Promise.resolve().then(supplier).then(obj => {
            const reference = obj.nextInstance();
            if (this.instanceCache[key] === pending) this.initialized.set(key, obj);
            return reference;
        });
        this.instanceCache[key] = pending;
        try {
            return await pending as InstanceReference<T>;
        } catch (error) {
            if (this.instanceCache[key] === pending) {
                delete this.instanceCache[key];
            }
            throw error;
        }
    }

    /** Disposes matching initialized pools with no live placements, leaving pending and active pools alone. */
    public pruneUnused(matches: (object: SceneObject) => boolean): number {
        let removed = 0;
        for (const [key, object] of this.initialized) {
            if (object.instanceCounter || !matches(object)) continue;
            this.initialized.delete(key);
            delete this.instanceCache[key];
            object.removeFromScene();
            object.dispose();
            removed++;
        }
        return removed;
    }

    /** Forgets cached models without disposing them or releasing their existing placements. */
    public reset() {
        this.initialized.clear();
        for (let instanceCacheKey in this.instanceCache) {
            delete this.instanceCache[instanceCacheKey];
        }
    }


}

export function isInstanceManager(obj: any): obj is InstanceManager {
    return (<InstanceManager>obj).isInstanceManager;
}
