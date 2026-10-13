import type { SceneDocument, SceneObjectDefinition, SceneSkinDefinition } from "minerender";

export const SHORTHAND_TYPES = ["skin", "block", "item", "entity", "model"] as const;
export type ShorthandType = typeof SHORTHAND_TYPES[number];
export const CONTENT_MODIFIERS = ["skin.slim", "cape", "cape.layout", "animate"];

export function booleanParam(params: URLSearchParams, name: string, fallback: boolean): boolean {
    const value = params.get(name);
    if (value === null) return fallback;
    if (value !== "true" && value !== "false") throw new Error(`${name}: expected true or false`);
    return value === "true";
}

export function shorthandScene(type: ShorthandType, params: URLSearchParams): SceneDocument {
    const value = params.get(type)!;
    if (!value.trim()) throw new Error(`${type}: expected a value`);
    for (const name of ["skin.slim", "cape", "cape.layout"]) {
        if (params.has(name) && type !== "skin") throw new Error(`${name} requires the skin shorthand`);
    }
    if (params.has("animate") && type !== "entity") throw new Error("animate requires the entity shorthand");
    let object: SceneObjectDefinition;
    if (type === "skin") {
        const skin: SceneSkinDefinition = { id: "skin", type, skin: value };
        if (params.has("skin.slim")) skin.options = { slim: booleanParam(params, "skin.slim", false) };
        if (params.has("cape.layout") && !params.has("cape")) throw new Error("cape.layout requires cape");
        if (params.has("cape")) {
            const layout = params.get("cape.layout") ?? "minecraft";
            if (layout !== "minecraft" && layout !== "optifine" && layout !== "labymod") {
                throw new Error("cape.layout: expected minecraft, optifine, or labymod");
            }
            skin.cape = { texture: params.get("cape")!, layout };
        }
        object = skin;
    } else if (type === "block") {
        const match = /^([^\[\]]+)(?:\[([^\[\]]+)\])?$/.exec(value);
        if (!match) throw new Error("block: expected an ID with optional states, such as minecraft:oak_stairs[facing=east]");
        object = { id: "block", type, asset: match[1] };
        if (match[2] !== undefined) {
            const states = new Map<string, string>();
            for (const entry of match[2].split(",")) {
                const pair = /^([a-z0-9_]+)=([a-z0-9_-]+)$/.exec(entry);
                if (!pair) throw new Error("block: expected comma-separated name=value states");
                if (states.has(pair[1])) throw new Error(`block: duplicate state ${pair[1]}`);
                states.set(pair[1], pair[2]);
            }
            object.state = Object.fromEntries(states);
        }
    } else if (type === "entity") {
        object = { id: type, type, asset: value };
        if (params.has("animate")) object.animation = { name: params.get("animate")!, loop: true };
    } else {
        object = { id: type, type, asset: value };
    }
    return { format: "minerender-scene", version: 1, objects: [object] };
}
