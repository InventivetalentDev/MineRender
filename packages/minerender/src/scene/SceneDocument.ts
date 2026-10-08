import type { CapeLayout } from "../skin/CapeLayout";
import { SKIN_PARTS } from "../skin/SkinPart";
import type { TripleArray } from "../model/Model";
import { DISPLAY_POSITIONS, DisplayPosition } from "../model/DisplayPosition";
import type { GuiItemLayer, GuiTextLayer, GuiTextureLayer } from "../gui/GuiLayer";

/** Portable scene setup. Positions use model units (16 per block); rotations use radians. */
export interface SceneDocument {
    format: "minerender-scene";
    version: 1;
    minecraftVersion?: string;
    camera?: { position: TripleArray; target: TripleArray };
    objects: SceneObjectDefinition[];
}

export interface SceneObjectDefinitionBase {
    id: string;
    name?: string;
    position?: TripleArray;
    rotation?: TripleArray;
    scale?: TripleArray;
    visible?: boolean;
}

export type SceneSkinPosePart = "head" | "body" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg" | "cape";

export interface SceneSkinDefinition extends SceneObjectDefinitionBase {
    type: "skin";
    /** Texture URL, Minecraft username, or UUID. Omit for Steve, or Alex with slim: true, from the active asset version. */
    skin?: string;
    cape?: { texture: string; layout?: CapeLayout };
    options?: { slim?: boolean; legacy?: boolean };
    /** Mesh names from SkinPart; hiding a base part does not hide its overlay. */
    hiddenParts?: string[];
    /** Absolute local XYZ joint rotations in radians; omitted joints keep their default pose. */
    pose?: Partial<Record<SceneSkinPosePart, TripleArray>>;
}

export interface SceneBlockDefinition extends SceneObjectDefinitionBase {
    type: "block";
    asset: string;
    state?: Record<string, string>;
    options?: { wireframe?: boolean; tints?: Record<number, number> };
}

export interface SceneModelDefinition extends SceneObjectDefinitionBase {
    type: "item" | "model";
    asset: string;
    options?: { wireframe?: boolean; displayPosition?: DisplayPosition; tints?: Record<number, number> };
}

export interface SceneEntityDefinition extends SceneObjectDefinitionBase {
    type: "entity";
    asset: string;
    texture?: string;
    layers?: string[];
    when?: string[];
    textures?: Record<string, string>;
    options?: { flip?: boolean; wireframe?: boolean; tints?: Record<string, string | number> };
    animation?: { name: string; loop?: boolean; speed?: number; time?: number; paused?: boolean };
}

export type SceneGuiLayer = (Omit<GuiTextureLayer, "texture"> & { texture: string })
    | (Omit<GuiItemLayer, "item"> & { item: string })
    | (Omit<GuiTextLayer, "font"> & { font?: string });

export interface SceneGuiDefinition extends SceneObjectDefinitionBase {
    type: "gui";
    layers: SceneGuiLayer[];
}

export type SceneObjectDefinition = SceneSkinDefinition | SceneBlockDefinition | SceneModelDefinition
    | SceneEntityDefinition | SceneGuiDefinition;

type JsonObject = Record<string, unknown>;
type Validator = (value: unknown, path: string) => void;

function fail(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, "expected a JSON object");
    for (const key of Object.keys(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail(`${path}.${key}`, "unsupported property");
    }
    return value as JsonObject;
}

function fields(value: unknown, path: string, allowed: Record<string, Validator>, required: string[] = []): JsonObject {
    const input = object(value, path);
    for (const key of required) if (input[key] === undefined) fail(`${path}.${key}`, "required");
    for (const [key, entry] of Object.entries(input)) {
        if (!Object.prototype.hasOwnProperty.call(allowed, key)) fail(`${path}.${key}`, "unsupported property");
        if (entry !== undefined) allowed[key](entry, `${path}.${key}`);
    }
    return input;
}

const text: Validator = (value, path) => {
    if (typeof value !== "string" || !value.trim()) fail(path, "expected a nonempty string");
};
const literalText: Validator = (value, path) => {
    if (typeof value !== "string") fail(path, "expected a string");
};
const boolean: Validator = (value, path) => {
    if (typeof value !== "boolean") fail(path, "expected a boolean");
};
const number: Validator = (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
};
const positive: Validator = (value, path) => {
    number(value, path);
    if ((value as number) <= 0) fail(path, "expected a positive number");
};
const nonnegative: Validator = (value, path) => {
    number(value, path);
    if ((value as number) < 0) fail(path, "expected a nonnegative number");
};
const color: Validator = (value, path) => {
    number(value, path);
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffff) {
        fail(path, "expected an RGB integer from 0 to 16777215");
    }
};
const asset: Validator = (value, path) => {
    text(value, path);
    if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(value as string)
        || (value as string).split(/[:/]/).some(part => !part || part === "." || part === "..")) {
        fail(path, "expected a resource ID such as minecraft:stone");
    }
};
const version: Validator = (value, path) => {
    text(value, path);
    if (!/^[a-zA-Z0-9._-]+$/.test(value as string)) fail(path, "expected a Minecraft version without slashes");
};
const tuple = (size: number, item: Validator = number): Validator => (value, path) => {
    if (!Array.isArray(value) || value.length !== size) fail(path, `expected ${size} numbers`);
    for (let index = 0; index < size; index++) item(value[index], `${path}[${index}]`);
};
const list = (item: Validator): Validator => (value, path) => {
    if (!Array.isArray(value)) fail(path, "expected an array");
    for (let index = 0; index < value.length; index++) item(value[index], `${path}[${index}]`);
};
const dictionary = (item: Validator, numericKeys = false): Validator => (value, path) => {
    for (const [key, entry] of Object.entries(object(value, path))) {
        if (numericKeys && !/^\d+$/.test(key)) fail(`${path}.${key}`, "expected a nonnegative tint index");
        item(entry, `${path}.${key}`);
    }
};
const enumeration = (values: readonly string[]): Validator => (value, path) => {
    if (!values.includes(value as string)) fail(path, `expected one of: ${values.join(", ")}`);
};
const textStyle = { color, bold: boolean, italic: boolean };

function guiLayer(value: unknown, path: string): void {
    const layer = object(value, path);
    if (["texture", "item", "text"].filter(key => layer[key] !== undefined).length !== 1) {
        fail(path, "expected exactly one of texture, item, or text");
    }
    const layout = { name: text, position: tuple(2), size: tuple(2, positive) };
    if (layer.texture !== undefined) {
        fields(value, path, { ...layout, texture: asset, crop: (value, path) => {
            tuple(4)(value, path);
            const [x, y, width, height] = value as number[];
            nonnegative(x, `${path}[0]`); nonnegative(y, `${path}[1]`);
            positive(width, `${path}[2]`); positive(height, `${path}[3]`);
        } });
    } else if (layer.item !== undefined) {
        fields(value, path, { ...layout, item: asset, tints: dictionary(color, true) });
    } else {
        fields(value, path, { ...layout, ...textStyle, font: asset, shadow: boolean, maxWidth: positive, lineHeight: positive,
            text: (value, path) => {
                if (typeof value === "string") return;
                list((run, path) => { fields(run, path, { text: literalText, ...textStyle }, ["text"]); })(value, path);
            }
        });
    }
}

function validateObject(value: unknown, path: string): void {
    const input = object(value, path);
    const common = { id: text, name: text, type: text, position: tuple(3), rotation: tuple(3), scale: tuple(3), visible: boolean };
    const required = ["id", "type"];
    const renderOptions = { wireframe: boolean };
    switch (input.type) {
        case "skin":
            fields(value, path, { ...common, skin: text,
                cape: (value, path) => { fields(value, path, { texture: text, layout: enumeration(["minecraft", "optifine", "labymod"]) }, ["texture"]); },
                hiddenParts: list(enumeration(SKIN_PARTS)),
                pose: (value, path) => { fields(value, path, {
                    head: tuple(3), body: tuple(3), rightArm: tuple(3), leftArm: tuple(3),
                    rightLeg: tuple(3), leftLeg: tuple(3), cape: tuple(3)
                }); },
                options: (value, path) => { fields(value, path, { slim: boolean, legacy: boolean }); }
            }, required);
            break;
        case "block":
            fields(value, path, { ...common, asset, state: dictionary(text),
                options: (value, path) => { fields(value, path, { ...renderOptions, tints: dictionary(color, true) }); }
            }, [...required, "asset"]);
            break;
        case "item":
        case "model":
            fields(value, path, { ...common, asset,
                options: (value, path) => { fields(value, path, { ...renderOptions, displayPosition: enumeration(DISPLAY_POSITIONS), tints: dictionary(color, true) }); }
            }, [...required, "asset"]);
            break;
        case "entity":
            fields(value, path, { ...common, asset, texture: asset, layers: list(text), when: list(text), textures: dictionary(asset),
                options: (value, path) => { fields(value, path, { ...renderOptions, flip: boolean,
                    tints: dictionary((value, path) => { typeof value === "string" ? text(value, path) : color(value, path); }) }); },
                animation: (value, path) => { fields(value, path, { name: text, loop: boolean, speed: nonnegative, time: nonnegative, paused: boolean }, ["name"]); }
            }, [...required, "asset"]);
            if (Array.isArray(input.layers) && !input.layers.length) fail(`${path}.layers`, "expected at least one layer");
            break;
        case "gui":
            fields(value, path, { ...common, layers: list(guiLayer) }, [...required, "layers"]);
            break;
        default:
            fail(`${path}.type`, "expected skin, block, item, entity, model, or gui");
    }
}

/** Validates and copies a scene document without requesting assets or changing the active asset version. */
export function parseSceneDocument(value: unknown): SceneDocument {
    if (typeof value === "string") {
        try { value = JSON.parse(value); }
        catch { fail("scene", "invalid JSON"); }
    }
    const input = fields(value, "scene", {
        format: enumeration(["minerender-scene"]),
        version: (value, path) => { if (value !== 1) fail(path, "only scene document version 1 is supported"); },
        minecraftVersion: version,
        camera: (value, path) => { fields(value, path, { position: tuple(3), target: tuple(3) }, ["position", "target"]); },
        objects: list(validateObject)
    }, ["format", "version", "objects"]);
    const ids = new Set<string>();
    for (const [index, entry] of (input.objects as SceneObjectDefinition[]).entries()) {
        if (ids.has(entry.id)) fail(`scene.objects[${index}].id`, `duplicate object ID "${entry.id}"`);
        ids.add(entry.id);
    }
    return JSON.parse(JSON.stringify(input)) as SceneDocument;
}
