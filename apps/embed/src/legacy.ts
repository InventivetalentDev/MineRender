import type { SceneDocument } from "minerender";

export function normalizeLegacyParams(input: URLSearchParams): URLSearchParams {
    const params = new URLSearchParams(input);
    for (const [target, aliases] of Object.entries({ skin: ["skin.name", "skin.url"], cape: ["cape.user", "cape.url"] })) {
        const supplied = [target, ...aliases].filter(key => params.has(key));
        if (supplied.length > 1) throw new Error(`Use only one of ${[target, ...aliases].join(", ")}`);
        if (supplied.length && supplied[0] !== target) {
            params.set(target, params.get(supplied[0])!);
            params.delete(supplied[0]);
        }
    }
    for (const name of ["skin.data", "cape.data"]) {
        if (params.has(name)) throw new Error(`${name} is unsupported; use a PNG data URL in a scene document`);
    }
    if (params.has("autoResize")) throw new Error("autoResize is unsupported; embeds always follow the iframe size");
    if (params.has("showAxes")) throw new Error("showAxes is unsupported; remove it from the embed URL");
    return params;
}

export function legacyModelScene(value: string): SceneDocument {
    const assets = value.split(",");
    if (assets.length > 32) throw new Error("models: at most 32 models are supported");
    return {
        format: "minerender-scene", version: 1,
        objects: assets.map((asset, index) => ({ id: `model-${index + 1}`, type: "model", asset }))
    };
}
