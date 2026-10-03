import { InstanceReference } from "./InstanceReference";
import { SceneObject } from "../renderer/SceneObject";
import { Maybe } from "../util/util";
import { prefix } from "../util/log";

const p = prefix("InstanceManager");

export class InstanceManager {

    public readonly isInstanceManager: true = true;

    protected readonly instanceCache: { [key: string]: Promise<InstanceReference<SceneObject>>; } = {};

    constructor() {
    }

    public async get<T extends SceneObject>(key: string): Promise<Maybe<InstanceReference<T>>> {
        if (key in this.instanceCache) {
            console.debug(p, "key in cache", key)
            // create next instance of existing object
            return (await this.instanceCache[key]).nextInstance() as InstanceReference<T>;
        }
        return undefined;
    }

    public async getOrCreate<T extends SceneObject>(key: string, supplier: () => T | Promise<T>): Promise<InstanceReference<T>> {
        if (key in this.instanceCache) {
            return await (this.get<T>(key)) as InstanceReference<T>;
        }
        console.debug(p, "key not in cache", key)
        this.instanceCache[key] = new Promise<InstanceReference<SceneObject>>(async (resolve) => {
            const obj = await supplier();
            const instance = obj.nextInstance();
            // this.instanceCache[key] = Promise.resolve(instance);
            resolve(instance);
        })
        return await this.instanceCache[key] as InstanceReference<T>;
    }

    public reset() {
        for (let instanceCacheKey in this.instanceCache) {
            delete this.instanceCache[instanceCacheKey];
        }
    }


}

export function isInstanceManager(obj: any): obj is InstanceManager {
    return (<InstanceManager>obj).isInstanceManager;
}
